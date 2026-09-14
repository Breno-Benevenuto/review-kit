import assert from "node:assert/strict";

const LAYER_PATTERNS = [
  { layer: "controller", pattern: /(^|[/\\])controllers?([/\\]|$)/i },
  { layer: "service", pattern: /(^|[/\\])services?([/\\]|$)/i },
];

function classifyLayer(filePath) {
  for (const { layer, pattern } of LAYER_PATTERNS) {
    if (pattern.test(filePath)) {
      return layer;
    }
  }
  return "other";
}

assert.equal(classifyLayer("src/main/java/com/app/controllers/OrderController.java"), "controller");
console.log("self-check ok");
