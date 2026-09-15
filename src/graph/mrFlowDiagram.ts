import type { FlowGraph, MergeRequestChange } from "../gitlab/types";
import {
  buildDependencyEdgesSync,
  classifyLayer,
  contentForImportScan,
  layerRank,
  suggestReviewOrder,
} from "./dependencyAnalyzer";
import { effectivePath } from "./flowGraph";

export function buildFlowGraphFromChanges(changes: MergeRequestChange[]): FlowGraph {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    const path = effectivePath(change);
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    paths.push(path);
  }
  const changeByPath = new Map<string, MergeRequestChange>();
  for (const change of changes) {
    changeByPath.set(effectivePath(change), change);
  }
  const readFile = (path: string) => contentForImportScan(changeByPath.get(path)?.diff ?? "");
  const edgesRaw = buildDependencyEdgesSync(paths, readFile);
  const nodes = paths.map((path) => ({
    id: path,
    path,
    layer: classifyLayer(path),
    label: path.split("/").pop() ?? path,
  }));
  const edges = edgesRaw.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
  }));
  return { nodes, edges, suggestedOrder: paths.length > 0 ? paths : suggestReviewOrder(paths, readFile) };
}

const LAYER_LABELS: Record<string, string> = {
  controller: "Controller",
  flow: "Flow",
  dto: "DTO",
  service: "Service",
  repository: "Repo",
  model: "Model",
  config: "Config",
  other: "Outros",
};

export function renderMrFlowSvg(graph: FlowGraph, maxNodes = 18): string {
  const order = graph.suggestedOrder.slice(0, maxNodes);
  const pathSet = new Set(order);
  const nodes = graph.nodes.filter((n) => pathSet.has(n.path));
  if (nodes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="48"><text x="8" y="28" fill="currentColor" font-size="12">Nenhum arquivo no MR.</text></svg>`;
  }

  const positions = new Map<string, { x: number; y: number }>();
  const rowByLayer = new Map<string, number>();
  const layersPresent = [...new Set(nodes.map((n) => n.layer))].sort(
    (a, b) => layerRank(a) - layerRank(b),
  );
  const layerToCol = new Map(layersPresent.map((layer, i) => [layer, i]));

  for (const path of order) {
    const node = nodes.find((n) => n.path === path);
    if (!node) {
      continue;
    }
    const col = layerToCol.get(node.layer) ?? 0;
    const row = rowByLayer.get(node.layer) ?? 0;
    rowByLayer.set(node.layer, row + 1);
    positions.set(path, { x: 24 + col * 168, y: 36 + row * 62 });
  }

  let maxX = 320;
  let maxY = 120;
  for (const pos of positions.values()) {
    maxX = Math.max(maxX, pos.x + 150);
    maxY = Math.max(maxY, pos.y + 36);
  }

  const edges = graph.edges.filter(
    (e) => positions.has(e.source) && positions.has(e.target) && e.source !== e.target,
  );

  const headerLabels = layersPresent
    .map((layer) => {
      const col = layerToCol.get(layer) ?? 0;
      const x = 24 + col * 168 + 72;
      return `<text x="${x}" y="16" text-anchor="middle" fill="currentColor" font-size="10" opacity="0.75">${escapeXml(
        LAYER_LABELS[layer] ?? layer,
      )}</text>`;
    })
    .join("");

  const edgeLines = edges
    .map((e) => {
      const from = positions.get(e.source)!;
      const to = positions.get(e.target)!;
      const x1 = from.x + 144;
      const y1 = from.y + 14;
      const x2 = to.x;
      const y2 = to.y + 14;
      const midX = (x1 + x2) / 2;
      return `<path d="M${x1} ${y1} C${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.2" marker-end="url(#arrow)"/>`;
    })
    .join("");

  const boxes = nodes
    .map((node) => {
      const pos = positions.get(node.path);
      if (!pos) {
        return "";
      }
      const title = truncate(node.label, 18);
      return `<g class="flow-node" data-path="${escapeXml(node.path)}">
  <rect x="${pos.x}" y="${pos.y}" width="144" height="28" rx="6" fill="var(--vscode-badge-background, #445)" stroke="var(--vscode-panel-border, #666)" stroke-width="1"/>
  <text x="${pos.x + 8}" y="${pos.y + 18}" fill="var(--vscode-badge-foreground, #fff)" font-size="11">${escapeXml(title)}</text>
</g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX + 16}" height="${maxY + 24}" role="img" aria-label="Fluxo do MR">
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" fill-opacity="0.55"/>
    </marker>
  </defs>
  ${headerLabels}
  ${edgeLines}
  ${boxes}
</svg>`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
