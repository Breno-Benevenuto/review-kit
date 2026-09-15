import assert from "node:assert/strict";

const LAYER_PATTERNS = [
  { layer: "controller", pattern: /(^|[/\\])controllers?([/\\]|$)/i },
  { layer: "controller", pattern: /(^|[/\\])api([/\\]|$)/i },
  { layer: "flow", pattern: /(^|[/\\])flows?([/\\]|$)/i },
  { layer: "service", pattern: /(^|[/\\])services?([/\\]|$)/i },
  { layer: "repository", pattern: /(^|[/\\])repositories?([/\\]|$)/i },
  { layer: "dto", pattern: /(^|[/\\])dto([/\\]|$)/i },
];

const LAYER_RANK = {
  controller: 0,
  flow: 1,
  dto: 2,
  service: 3,
  repository: 4,
  model: 5,
  config: 6,
  other: 7,
};

function classifyLayer(filePath) {
  for (const { layer, pattern } of LAYER_PATTERNS) {
    if (pattern.test(filePath)) {
      return layer;
    }
  }
  return "other";
}

function layerRank(layer) {
  return LAYER_RANK[layer] ?? LAYER_RANK.other;
}

function compareLayerThenPath(a, b) {
  const la = layerRank(classifyLayer(a));
  const lb = layerRank(classifyLayer(b));
  if (la !== lb) {
    return la - lb;
  }
  return a.localeCompare(b);
}

const DEFERRED_CONFIG_EXT = /\.(json|xml|yaml|yml)$/i;

function isDeferredReviewPath(filePath) {
  const norm = filePath.replace(/\\/g, "/");
  const base = norm.split("/").pop() ?? norm;
  if (DEFERRED_CONFIG_EXT.test(base)) {
    return true;
  }
  if (/(^|\/)tests?(\/|$)/i.test(norm)) {
    return true;
  }
  if (/Test\.(java|kt)$/.test(base)) {
    return true;
  }
  if (/\.(spec|test)\.(ts|tsx|js|jsx)$/.test(base)) {
    return true;
  }
  return false;
}

function extractImports(content) {
  const specs = [];
  const re = /^\s*import\s+([\w.]+)\s*;/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    specs.push(m[1]);
  }
  return specs;
}

function resolveImport(fromFile, spec, knownPaths) {
  const tail = spec.split(".").pop()?.toLowerCase();
  if (!tail) {
    return undefined;
  }
  const candidates = [...knownPaths].filter((p) => p.endsWith(`/${tail}.java`) || p.endsWith(`/${tail}.kt`));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function topologicalCallerFirstOrder(paths, readFile) {
  const known = new Set(paths);
  const inDegree = new Map(paths.map((p) => [p, 0]));
  const outgoing = new Map(paths.map((p) => [p, []]));
  for (const path of paths) {
    for (const spec of extractImports(readFile(path))) {
      const target = resolveImport(path, spec, known);
      if (target && target !== path) {
        inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
        outgoing.get(path).push(target);
      }
    }
  }
  const ready = paths.filter((p) => inDegree.get(p) === 0).sort(compareLayerThenPath);
  const ordered = [];
  while (ready.length > 0) {
    const next = ready.shift();
    ordered.push(next);
    for (const target of outgoing.get(next) ?? []) {
      const deg = inDegree.get(target) - 1;
      inDegree.set(target, deg);
      if (deg === 0) {
        ready.push(target);
        ready.sort(compareLayerThenPath);
      }
    }
  }
  return ordered.length === paths.length ? ordered : [...paths].sort(compareLayerThenPath);
}

function suggestReviewOrder(paths, readFile = () => "") {
  const primary = paths.filter((p) => !isDeferredReviewPath(p));
  const deferred = paths.filter((p) => isDeferredReviewPath(p));
  const orderedPrimary = topologicalCallerFirstOrder(primary, readFile);
  const orderedDeferred = [...deferred].sort((a, b) => {
    const da = DEFERRED_CONFIG_EXT.test(a.split("/").pop() ?? "") ? 0 : 1;
    const db = DEFERRED_CONFIG_EXT.test(b.split("/").pop() ?? "") ? 0 : 1;
    return da !== db ? da - db : compareLayerThenPath(a, b);
  });
  return [...orderedPrimary, ...orderedDeferred];
}

assert.equal(classifyLayer("src/main/java/com/app/controllers/OrderController.java"), "controller");
assert.equal(classifyLayer("src/main/java/com/app/flow/ResizeImageFlow.java"), "flow");
assert.equal(classifyLayer("src/main/kotlin/com/app/flows/ProcessFlow.kt"), "flow");

const ordered = suggestReviewOrder([
  "src/main/java/com/app/service/ImageService.java",
  "src/main/java/com/app/flow/ResizeImageFlow.java",
  "src/main/java/com/app/controllers/ImageController.java",
]);
assert.deepEqual(ordered, [
  "src/main/java/com/app/controllers/ImageController.java",
  "src/main/java/com/app/flow/ResizeImageFlow.java",
  "src/main/java/com/app/service/ImageService.java",
]);

const sources = {
  "src/main/java/com/app/controllers/ImageController.java":
    "import com.app.flow.ResizeImageFlow;",
  "src/main/java/com/app/flow/ResizeImageFlow.java": "import com.app.service.ImageService;",
  "src/main/java/com/app/service/ImageService.java": "",
};
const callOrder = suggestReviewOrder(Object.keys(sources), (p) => sources[p]);
assert.deepEqual(callOrder, [
  "src/main/java/com/app/controllers/ImageController.java",
  "src/main/java/com/app/flow/ResizeImageFlow.java",
  "src/main/java/com/app/service/ImageService.java",
]);

const withDeferred = suggestReviewOrder(
  [
    "src/test/java/com/app/ImageControllerTest.java",
    "helm/values.yaml",
    "src/main/java/com/app/controllers/ImageController.java",
  ],
  (p) => sources[p] ?? "",
);
assert.deepEqual(withDeferred, [
  "src/main/java/com/app/controllers/ImageController.java",
  "helm/values.yaml",
  "src/test/java/com/app/ImageControllerTest.java",
]);

assert.ok(layerRank("flow") > layerRank("controller"));
assert.ok(layerRank("service") > layerRank("flow"));

function parseEnvLine(line, key) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = trimmed.match(new RegExp(`^(?:export\\s+)?${escaped}\\s*=\\s*(.*)$`));
  if (!match?.[1]) return undefined;
  let value = match[1].trim();
  const inlineComment = value.indexOf(" #");
  if (inlineComment >= 0) value = value.slice(0, inlineComment).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value.trim() || undefined;
}

assert.equal(
  parseEnvLine("export GITLAB_TOKEN=fake.token.value.01.0testcase", "GITLAB_TOKEN"),
  "fake.token.value.01.0testcase",
);

function inferGitLabBaseUrlFromRemote(remote) {
  const ssh = remote.trim().match(/^git@([^:]+):/);
  if (!ssh?.[1]) return undefined;
  const host = ssh[1].startsWith("gitlabssh.") ? ssh[1].replace(/^gitlabssh\./, "gitlab.") : ssh[1];
  return `https://${host}`;
}

assert.equal(
  inferGitLabBaseUrlFromRemote("git@gitlabssh.example.com:group/repo.git"),
  "https://gitlab.example.com",
);

console.log("self-check ok");
