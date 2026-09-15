import * as vscode from "vscode";
import type { MergeRequestChange } from "../gitlab/types";
import { effectivePath } from "../graph/flowGraph";
import { isDeferredReviewPath, suggestReviewOrder } from "../graph/dependencyAnalyzer";
import { parseDiffLineMarkers } from "./diffMarkers";
import {
  openRepoDocumentsForPaths,
  repoRelativePath,
} from "./repoWorkspaceDocuments";

export type CallEdge = { source: string; target: string };

const REF_SYMBOL_KINDS = new Set([
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Interface,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Constructor,
]);

const MAX_SYMBOLS_PER_FILE = 10;
const LS_WARMUP_MS = 120;

export async function buildCallEdgesFromReferences(
  documents: Map<string, vscode.TextDocument>,
  paths: string[],
  diffByPath: Map<string, string>,
  folder: vscode.WorkspaceFolder,
): Promise<CallEdge[]> {
  const pathSet = new Set(paths);
  const edgeKeys = new Set<string>();
  const edges: CallEdge[] = [];

  for (const calleePath of paths) {
    const doc = documents.get(calleePath);
    if (!doc) {
      continue;
    }
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      doc.uri,
    );
    if (!symbols?.length) {
      continue;
    }
    const diff = diffByPath.get(calleePath) ?? "";
    const candidates = pickSymbolsForReferences(flattenSymbols(symbols), diff);
    for (const sym of candidates) {
      const pos = sym.selectionRange.start;
      const locations = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
        "vscode.executeReferenceProvider",
        doc.uri,
        pos,
      );
      if (!locations?.length) {
        continue;
      }
      for (const loc of locations) {
        const callerPath = matchCallerPathFromRepoUri(loc.uri, folder, pathSet);
        if (!callerPath || callerPath === calleePath) {
          continue;
        }
        const key = `${callerPath}\t${calleePath}`;
        if (edgeKeys.has(key)) {
          continue;
        }
        edgeKeys.add(key);
        edges.push({ source: callerPath, target: calleePath });
      }
    }
  }
  return edges;
}

export async function buildReferenceEdgesForMr(
  paths: string[],
  diffByPath: Map<string, string>,
): Promise<CallEdge[]> {
  const primary = paths.filter((p) => !isDeferredReviewPath(p));
  const opened = await openRepoDocumentsForPaths(primary);
  if (!opened) {
    return [];
  }
  await sleep(LS_WARMUP_MS);
  return buildCallEdgesFromReferences(opened.documents, primary, diffByPath, opened.folder);
}

export async function suggestReviewOrderWithCallGraph(
  paths: string[],
  readFile: (path: string) => string,
  referenceEdges: CallEdge[],
): Promise<string[]> {
  return suggestReviewOrder(paths, readFile, referenceEdges);
}

function matchCallerPathFromRepoUri(
  uri: vscode.Uri,
  folder: vscode.WorkspaceFolder,
  paths: Set<string>,
): string | undefined {
  const rel = repoRelativePath(uri, folder);
  if (!rel || !paths.has(rel)) {
    return undefined;
  }
  return rel;
}

function pickSymbolsForReferences(symbols: vscode.DocumentSymbol[], diff: string): vscode.DocumentSymbol[] {
  const touched = diffTouchLines(diff);
  const filtered = symbols.filter((s) => REF_SYMBOL_KINDS.has(s.kind));
  const scored = filtered.map((sym) => {
    const start = sym.range.start.line + 1;
    const end = sym.range.end.line + 1;
    let touches = false;
    for (let line = start; line <= end; line++) {
      if (touched.has(line)) {
        touches = true;
        break;
      }
    }
    const kindBoost =
      sym.kind === vscode.SymbolKind.Method || sym.kind === vscode.SymbolKind.Function ? 2 : 1;
    return { sym, score: (touches ? 10 : 0) + kindBoost };
  });
  scored.sort((a, b) => b.score - a.score || a.sym.name.localeCompare(b.sym.name));
  return scored.slice(0, MAX_SYMBOLS_PER_FILE).map((s) => s.sym);
}

function diffTouchLines(diff: string): Set<number> {
  const { added, inHunk } = parseDiffLineMarkers(diff);
  return new Set([...added, ...inHunk]);
}

function flattenSymbols(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
  const out: vscode.DocumentSymbol[] = [];
  for (const s of symbols) {
    out.push(s);
    if (s.children?.length) {
      out.push(...flattenSymbols(s.children));
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function changesToDiffMap(changes: MergeRequestChange[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const change of changes) {
    map.set(effectivePath(change), change.diff ?? "");
  }
  return map;
}
