import { escapeHtml } from "./diffPresentation";
import { parseDiffLineMarkers } from "./diffMarkers";

export function renderEditorReviewSummaryHtml(
  _filePath: string,
  diff: string,
  _onSourceBranch: boolean,
  _sourceBranch: string,
): string {
  const { removed } = parseDiffLineMarkers(diff);
  if (removed.length === 0) {
    return "";
  }
  return `<div class="removed-mini"><div class="section-title">Linhas removidas (comentário na versão antiga)</div>${removed
    .slice(0, 12)
    .map((line) => {
      const old = line.oldLine ?? line.number;
      return `<button type="button" class="removed-line" data-old-line="${old}">−${old} ${escapeHtml(line.text.slice(0, 80))}</button>`;
    })
    .join("")}${removed.length > 12 ? `<div class="more">+${removed.length - 12} no diff à esquerda</div>` : ""}</div>`;
}
