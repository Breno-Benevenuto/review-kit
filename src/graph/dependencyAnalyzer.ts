const LAYER_PATTERNS: { layer: string; pattern: RegExp }[] = [
  { layer: "controller", pattern: /(^|[/\\])controllers?([/\\]|$)/i },
  { layer: "controller", pattern: /(^|[/\\])api([/\\]|$)/i },
  { layer: "flow", pattern: /(^|[/\\])flows?([/\\]|$)/i },
  { layer: "service", pattern: /(^|[/\\])services?([/\\]|$)/i },
  { layer: "repository", pattern: /(^|[/\\])repositories?([/\\]|$)/i },
  { layer: "repository", pattern: /(^|[/\\])dao([/\\]|$)/i },
  { layer: "model", pattern: /(^|[/\\])models?([/\\]|$)/i },
  { layer: "model", pattern: /(^|[/\\])entities?([/\\]|$)/i },
  { layer: "dto", pattern: /(^|[/\\])dto([/\\]|$)/i },
  { layer: "config", pattern: /(^|[/\\])config([/\\]|$)/i },
];

const LAYER_RANK: Record<string, number> = {
  controller: 0,
  flow: 1,
  dto: 2,
  service: 3,
  repository: 4,
  model: 5,
  config: 6,
  other: 7,
};

export function classifyLayer(filePath: string): string {
  for (const { layer, pattern } of LAYER_PATTERNS) {
    if (pattern.test(filePath)) {
      return layer;
    }
  }
  return "other";
}

export function layerRank(layer: string): number {
  return LAYER_RANK[layer] ?? LAYER_RANK.other;
}

const IMPORT_PATTERNS = [
  /^\s*import\s+[\w.*{},\s]+\s+from\s+['"]([^'"]+)['"]/gm,
  /^\s*import\s+['"]([^'"]+)['"]/gm,
  /^\s*import\s+static\s+[\w.]+\s*;/gm,
  /^\s*import\s+([\w.]+)\s*;/gm,
];

function resolveImport(fromFile: string, spec: string, knownPaths: Set<string>): string | undefined {
  if (spec.startsWith(".")) {
    const baseDir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
    const joined = normalizePath(`${baseDir}/${spec}`);
    return matchKnown(joined, knownPaths);
  }
  const tail = spec.split(".").pop()?.toLowerCase();
  if (!tail) {
    return undefined;
  }
  const candidates = [...knownPaths].filter(
    (p) => p.endsWith(`/${tail}.java`) || p.endsWith(`/${tail}.kt`) || p.endsWith(`/${tail}.ts`),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function normalizePath(path: string): string {
  const parts = path.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

function matchKnown(base: string, knownPaths: Set<string>): string | undefined {
  const direct = [...knownPaths].find((p) => p === base || p === `${base}.java` || p === `${base}.kt`);
  if (direct) {
    return direct;
  }
  const suffix = base.split("/").pop();
  if (!suffix) {
    return undefined;
  }
  const matches = [...knownPaths].filter((p) => p.includes(`/${suffix}.`));
  return matches.length === 1 ? matches[0] : undefined;
}

export function extractImports(content: string): string[] {
  const specs: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      if (m[1]) {
        specs.push(m[1]);
      }
    }
  }
  return specs;
}

export async function buildDependencyEdges(
  paths: string[],
  readFile: (path: string) => Promise<string>,
): Promise<{ source: string; target: string }[]> {
  const contents = new Map<string, string>();
  for (const path of paths) {
    contents.set(path, await readFile(path));
  }
  return buildDependencyEdgesSync(paths, (p) => contents.get(p) ?? "");
}

export function buildDependencyEdgesSync(
  paths: string[],
  readFile: (path: string) => string,
): { source: string; target: string }[] {
  const known = new Set(paths);
  const edges: { source: string; target: string }[] = [];
  for (const path of paths) {
    const content = readFile(path);
    for (const spec of extractImports(content)) {
      const target = resolveImport(path, spec, known);
      if (target && target !== path) {
        edges.push({ source: path, target });
      }
    }
  }
  return edges;
}

export function contentForImportScan(contentOrDiff: string): string {
  if (!contentOrDiff.includes("\n+++") && !contentOrDiff.includes("\n@@")) {
    return contentOrDiff;
  }
  const lines: string[] = [];
  for (const raw of contentOrDiff.split("\n")) {
    if (raw.startsWith("+++") || raw.startsWith("---")) {
      continue;
    }
    if (raw.startsWith("+") || raw.startsWith(" ")) {
      lines.push(raw.slice(1));
    }
  }
  return lines.join("\n");
}

const DEFERRED_CONFIG_EXT = /\.(json|xml|yaml|yml)$/i;

export function isDeferredReviewPath(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/");
  const base = norm.split("/").pop() ?? norm;
  if (DEFERRED_CONFIG_EXT.test(base)) {
    return true;
  }
  if (/(^|\/)tests?(\/|$)/i.test(norm)) {
    return true;
  }
  if (/(^|\/)__tests__(\/|$)/.test(norm)) {
    return true;
  }
  if (/(^|\/)test(\/|$)/i.test(norm) && /\.(java|kt|scala|go)$/.test(base)) {
    return true;
  }
  if (/Test\.(java|kt|scala)$/.test(base)) {
    return true;
  }
  if (/Tests\.(java|kt)$/.test(base)) {
    return true;
  }
  if (/\.(spec|test)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(base)) {
    return true;
  }
  if (/_test\.go$/.test(base)) {
    return true;
  }
  if (/(^|\/)spec(\/|$)/i.test(norm) && /\.(ts|tsx|js|jsx)$/.test(base)) {
    return true;
  }
  return false;
}

function deferredSortKey(path: string): number {
  const base = path.split("/").pop() ?? path;
  if (DEFERRED_CONFIG_EXT.test(base)) {
    return 0;
  }
  return 1;
}

function compareLayerThenPath(a: string, b: string): number {
  const la = layerRank(classifyLayer(a));
  const lb = layerRank(classifyLayer(b));
  if (la !== lb) {
    return la - lb;
  }
  return a.localeCompare(b);
}

export function mergeReviewEdges(
  ...groups: { source: string; target: string }[][]
): { source: string; target: string }[] {
  const keys = new Set<string>();
  const merged: { source: string; target: string }[] = [];
  for (const group of groups) {
    for (const edge of group) {
      const key = `${edge.source}\t${edge.target}`;
      if (keys.has(key) || edge.source === edge.target) {
        continue;
      }
      keys.add(key);
      merged.push(edge);
    }
  }
  return merged;
}

function topologicalCallerFirstOrder(
  paths: string[],
  edges: { source: string; target: string }[],
): string[] {
  if (paths.length <= 1) {
    return [...paths];
  }
  const pathSet = new Set(paths);
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const p of paths) {
    inDegree.set(p, 0);
    outgoing.set(p, []);
  }
  for (const { source, target } of edges) {
    if (!pathSet.has(source) || !pathSet.has(target)) {
      continue;
    }
    inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
    outgoing.get(source)!.push(target);
  }
  const ready = paths.filter((p) => (inDegree.get(p) ?? 0) === 0).sort(compareLayerThenPath);
  const ordered: string[] = [];
  while (ready.length > 0) {
    const next = ready.shift()!;
    ordered.push(next);
    for (const target of outgoing.get(next) ?? []) {
      const deg = (inDegree.get(target) ?? 0) - 1;
      inDegree.set(target, deg);
      if (deg === 0) {
        insertSorted(ready, target, compareLayerThenPath);
      }
    }
  }
  if (ordered.length < paths.length) {
    const remaining = paths.filter((p) => !ordered.includes(p)).sort(compareLayerThenPath);
    ordered.push(...remaining);
  }
  return ordered;
}

function insertSorted(list: string[], value: string, compare: (a: string, b: string) => number): void {
  let i = 0;
  while (i < list.length && compare(list[i], value) < 0) {
    i++;
  }
  list.splice(i, 0, value);
}

export function suggestReviewOrder(
  paths: string[],
  readFile?: (path: string) => string,
  referenceEdges?: { source: string; target: string }[],
): string[] {
  const read = readFile ?? (() => "");
  const primary = paths.filter((p) => !isDeferredReviewPath(p));
  const deferred = paths.filter((p) => isDeferredReviewPath(p));
  const importEdges = buildDependencyEdgesSync(primary, (p) => contentForImportScan(read(p)));
  const edges = mergeReviewEdges(importEdges, referenceEdges ?? []);
  const orderedPrimary = topologicalCallerFirstOrder(primary, edges);
  const orderedDeferred = [...deferred].sort((a, b) => {
    const da = deferredSortKey(a);
    const db = deferredSortKey(b);
    if (da !== db) {
      return da - db;
    }
    return compareLayerThenPath(a, b);
  });
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const p of [...orderedPrimary, ...orderedDeferred]) {
    if (seen.has(p)) {
      continue;
    }
    seen.add(p);
    merged.push(p);
  }
  for (const p of paths) {
    if (!seen.has(p)) {
      merged.push(p);
    }
  }
  return merged;
}

export { LAYER_RANK };
