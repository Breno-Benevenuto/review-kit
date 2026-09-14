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

function suggestReviewOrder(paths) {
  return [...paths].sort((a, b) => {
    const la = layerRank(classifyLayer(a));
    const lb = layerRank(classifyLayer(b));
    if (la !== lb) {
      return la - lb;
    }
    return a.localeCompare(b);
  });
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
assert.ok(layerRank("flow") > layerRank("controller"));
assert.ok(layerRank("service") > layerRank("flow"));

console.log("self-check ok");
