import { classifyLayer } from "../graph/dependencyAnalyzer";
import type { MergeRequestChange } from "../gitlab/types";
import { effectivePath } from "../graph/flowGraph";

export type FileReviewCard = {
  path: string;
  fileName: string;
  layer: string;
  index: number;
  added: number;
  removed: number;
  summary: string;
  risks: string[];
  newFile: boolean;
  deletedFile: boolean;
};

const RISK_RULES: { label: string; pattern: RegExp }[] = [
  { label: "catch genérico", pattern: /catch\s*\(\s*(Exception|Throwable)\b/ },
  { label: "possível NPE (.get())", pattern: /\.get\(\)/ },
  { label: "System.out/err", pattern: /System\.(out|err)\./ },
  { label: "TODO/FIXME", pattern: /\b(TODO|FIXME|HACK)\b/i },
  { label: "alteração de assinatura", pattern: /^[+-].*\b(public|protected)\s+[\w<>,\s]+\s+\w+\s*\(/m },
  { label: "endpoint HTTP", pattern: /^[+-].*@(Get|Post|Put|Patch|Delete|RequestMapping)/m },
  { label: "senha/secret hardcoded", pattern: /(password|secret|api[_-]?key)\s*=\s*["'][^"']+["']/i },
];

export function buildFileReviewCard(change: MergeRequestChange, index: number): FileReviewCard {
  const path = effectivePath(change);
  const diff = change.diff ?? "";
  const added = (diff.match(/^\+[^+]/gm) ?? []).length;
  const removed = (diff.match(/^-[^-]/gm) ?? []).length;
  const risks = detectRisks(diff);
  const layer = classifyLayer(path);
  const parts = [`+${added}`, `-${removed}`];
  if (change.new_file) {
    parts.push("novo");
  }
  if (change.deleted_file) {
    parts.push("removido");
  }
  return {
    path,
    fileName: path.split("/").pop() ?? path,
    layer,
    index,
    added,
    removed,
    summary: parts.join(" · "),
    risks,
    newFile: change.new_file,
    deletedFile: change.deleted_file,
  };
}

export function detectRisks(diff: string): string[] {
  const found = new Set<string>();
  for (const { label, pattern } of RISK_RULES) {
    if (pattern.test(diff)) {
      found.add(label);
    }
  }
  return [...found];
}

export function renderUnifiedDiffHtml(diff: string, path: string): string {
  if (!diff.trim()) {
    return `<p class="empty">Sem diff textual para <code>${escapeHtml(path)}</code>.</p>`;
  }
  const lines = diff.split("\n");
  const htmlLines = lines.map((line) => {
    let cls = "ctx";
    let display = line;
    if (line.startsWith("+++") || line.startsWith("---")) {
      cls = "meta";
    } else if (line.startsWith("@@")) {
      cls = "hunk";
    } else if (line.startsWith("+")) {
      cls = "add";
    } else if (line.startsWith("-")) {
      cls = "del";
    }
    const risk = RISK_RULES.some((r) => r.pattern.test(line)) ? " risk" : "";
    return `<div class="line ${cls}${risk}">${escapeHtml(display)}</div>`;
  });
  return `<div class="diff">${htmlLines.join("")}</div>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
