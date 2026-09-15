import * as vscode from "vscode";
import { parseDiffLineMarkers } from "./diffMarkers";

export type SymbolRefSummary = {
  name: string;
  kind: string;
  line: number;
  referenceCount: number;
  references: { file: string; line: number }[];
};

const SYMBOL_KINDS = new Set([
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Constructor,
]);

export async function collectChangedSymbolRefs(
  document: vscode.TextDocument,
  diff: string,
): Promise<SymbolRefSummary[]> {
  const { added, inHunk } = parseDiffLineMarkers(diff);
  const touched = new Set<number>([...added, ...inHunk]);
  if (touched.size === 0) {
    return [];
  }
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    "vscode.executeDocumentSymbolProvider",
    document.uri,
  );
  if (!symbols?.length) {
    return [];
  }
  const candidates = flattenSymbols(symbols).filter((s) => {
    if (!SYMBOL_KINDS.has(s.kind)) {
      return false;
    }
    const start = s.range.start.line + 1;
    const end = s.range.end.line + 1;
    for (let line = start; line <= end; line++) {
      if (touched.has(line)) {
        return true;
      }
    }
    return false;
  });
  const out: SymbolRefSummary[] = [];
  for (const sym of candidates.slice(0, 6)) {
    const pos = sym.selectionRange.start;
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      document.uri,
      pos,
    );
    const refs = (locations ?? []).slice(0, 10)
      .map((loc) => ({
        file: loc.uri.path.split("/").slice(-3).join("/"),
        line: loc.range.start.line + 1,
      }));
    out.push({
      name: sym.name,
      kind: vscode.SymbolKind[sym.kind] ?? "Symbol",
      line: pos.line + 1,
      referenceCount: locations?.length ?? 0,
      references: refs,
    });
  }
  return out;
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

export function renderSymbolRefsHtml(refs: SymbolRefSummary[]): string {
  if (refs.length === 0) {
    return `<p class="refs-empty">Nenhuma referência LSP para métodos alterados (abra o arquivo no editor e use a branch do MR para resultados melhores).</p>`;
  }
  const items = refs
    .map((r) => {
      const refLines =
        r.references.length > 0
          ? r.references
              .map((ref) => `<li><code>${escapeAttr(ref.file)}:${ref.line}</code></li>`)
              .join("")
          : `<li class="muted">Sem referências fora do próprio arquivo</li>`;
      return `<div class="ref-card">
  <div class="ref-head"><strong>${escapeAttr(r.name)}</strong> <span class="ref-kind">${escapeAttr(r.kind)}</span> <span class="ref-line">L${r.line}</span> <span class="ref-count">${r.referenceCount} ref(s)</span></div>
  <ul class="ref-list">${refLines}</ul>
</div>`;
    })
    .join("");
  return `<section class="symbol-refs"><h3>Referências (métodos no diff)</h3>${items}</section>`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
