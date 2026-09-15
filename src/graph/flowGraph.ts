import type { FlowEdge, FlowGraph, FlowNode, MergeRequestChange } from "../gitlab/types";
import {
  buildDependencyEdges,
  classifyLayer,
  suggestReviewOrder,
} from "./dependencyAnalyzer";

export function effectivePath(change: MergeRequestChange): string {
  if (change.deleted_file) {
    return change.old_path;
  }
  return change.new_path;
}

export async function buildFlowGraph(
  changes: MergeRequestChange[],
  readFile: (path: string) => Promise<string>,
): Promise<FlowGraph> {
  const paths = [...new Set(changes.map(effectivePath).filter(Boolean))];
  const contents = new Map<string, string>();
  for (const path of paths) {
    contents.set(path, await readFile(path));
  }
  const readSync = (path: string) => contents.get(path) ?? "";
  const edgesRaw = await buildDependencyEdges(paths, readFile);
  const nodes: FlowNode[] = paths.map((path) => ({
    id: path,
    path,
    layer: classifyLayer(path),
    label: path.split("/").pop() ?? path,
  }));
  const edges: FlowEdge[] = edgesRaw.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
  }));
  const suggestedOrder = suggestReviewOrder(paths, readSync);
  return { nodes, edges, suggestedOrder };
}

export function summarizeDiff(change: MergeRequestChange): string {
  const diff = change.diff ?? "";
  const added = (diff.match(/^\+[^+]/gm) ?? []).length;
  const removed = (diff.match(/^-[^-]/gm) ?? []).length;
  const path = effectivePath(change);
  const layer = classifyLayer(path);
  const parts = [`Layer: ${layer}`, `+${added} / -${removed} lines`];
  if (change.new_file) {
    parts.push("new file");
  }
  if (change.deleted_file) {
    parts.push("deleted");
  }
  if (change.renamed_file) {
    parts.push(`renamed from ${change.old_path}`);
  }
  const contractHint = detectContractHints(diff);
  if (contractHint) {
    parts.push(contractHint);
  }
  return parts.join(" · ");
}

function detectContractHints(diff: string): string | undefined {
  if (/^[-+].*\b(public|protected)\s+[\w<>,\s]+\s+\w+\s*\(/m.test(diff)) {
    return "possible method signature change";
  }
  if (/^[-+].*@(Get|Post|Put|Patch|Delete|RequestMapping)/m.test(diff)) {
    return "possible API route change";
  }
  return undefined;
}
