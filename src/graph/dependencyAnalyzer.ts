const LAYER_PATTERNS: { layer: string; pattern: RegExp }[] = [
  { layer: "controller", pattern: /(^|[/\\])controllers?([/\\]|$)/i },
  { layer: "controller", pattern: /(^|[/\\])api([/\\]|$)/i },
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
  dto: 1,
  service: 2,
  repository: 3,
  model: 4,
  config: 5,
  other: 6,
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
  const known = new Set(paths);
  const edges: { source: string; target: string }[] = [];
  for (const path of paths) {
    const content = await readFile(path);
    for (const spec of extractImports(content)) {
      const target = resolveImport(path, spec, known);
      if (target && target !== path) {
        edges.push({ source: path, target });
      }
    }
  }
  return edges;
}

export function suggestReviewOrder(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const la = layerRank(classifyLayer(a));
    const lb = layerRank(classifyLayer(b));
    if (la !== lb) {
      return la - lb;
    }
    return a.localeCompare(b);
  });
}

export { LAYER_RANK };
