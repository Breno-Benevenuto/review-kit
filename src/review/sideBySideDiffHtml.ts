import { escapeHtml } from "./diffPresentation";
import { languageIdForPath } from "./languageId";
import { highlightLine } from "./syntaxPreviewHighlight";
import type { MrDiscussionThreadView } from "../gitlab/types";
import type { DraftComment } from "./reviewDrafts";
import {
  anchorsForRow,
  commentCountForAnchors,
  indexDraftsByAnchor,
  indexThreadsByAnchor,
  threadFlagsForAnchors,
  threadPinTitle,
} from "./lineDiscussionIndex";
import { renderInlineThreadPanel } from "./inlineDiffCommentsHtml";

export type SideBySideRow = {
  leftNum?: number;
  leftText?: string;
  leftCls: "ctx" | "del" | "pad";
  rightNum?: number;
  rightText?: string;
  rightCls: "ctx" | "add" | "mod" | "pad";
};

export type SideBySideDiffContext = {
  filePath: string;
  threads: MrDiscussionThreadView[];
  drafts: readonly DraftComment[];
};

export function buildSideBySideRows(diff: string): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let newLine = 1;
  let oldLine = 1;
  const lines = diff.split("\n");
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (raw.startsWith("@@")) {
      const newMatch = raw.match(/\+(\d+)(?:,(\d+))?/);
      const oldMatch = raw.match(/-(\d+)(?:,(\d+))?/);
      if (newMatch) {
        newLine = Number(newMatch[1]);
      }
      if (oldMatch) {
        oldLine = Number(oldMatch[1]);
      }
      rows.push({
        leftCls: "pad",
        rightCls: "pad",
        leftText: raw,
        rightText: raw,
      });
      i++;
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("\\")) {
      i++;
      continue;
    }
    if (raw.startsWith("-")) {
      const dels: { text: string; num: number }[] = [];
      while (i < lines.length && lines[i].startsWith("-")) {
        dels.push({ text: lines[i].slice(1), num: oldLine });
        oldLine++;
        i++;
      }
      const adds: { text: string; num: number }[] = [];
      while (i < lines.length && lines[i].startsWith("+")) {
        adds.push({ text: lines[i].slice(1), num: newLine });
        newLine++;
        i++;
      }
      const pairs = Math.max(dels.length, adds.length);
      for (let p = 0; p < pairs; p++) {
        const del = dels[p];
        const add = adds[p];
        rows.push({
          leftNum: del?.num,
          leftText: del?.text,
          leftCls: del ? "del" : "pad",
          rightNum: add?.num,
          rightText: add?.text,
          rightCls: add ? (del ? "mod" : "add") : "pad",
        });
      }
      continue;
    }
    if (raw.startsWith("+")) {
      rows.push({
        leftCls: "pad",
        rightNum: newLine,
        rightText: raw.slice(1),
        rightCls: "add",
      });
      newLine++;
      i++;
      continue;
    }
    if (raw.startsWith(" ")) {
      rows.push({
        leftNum: oldLine,
        leftText: raw.slice(1),
        leftCls: "ctx",
        rightNum: newLine,
        rightText: raw.slice(1),
        rightCls: "ctx",
      });
      oldLine++;
      newLine++;
      i++;
      continue;
    }
    i++;
  }
  return rows;
}

export function renderSideBySideDiffHtml(filePath: string, diff: string, ctx?: SideBySideDiffContext): string {
  if (!diff.trim()) {
    return `<p class="diff-empty">Sem diff textual para este arquivo.</p>`;
  }
  const languageId = languageIdForPath(filePath);
  const rows = buildSideBySideRows(diff);
  const threadsByLine = ctx ? indexThreadsByAnchor(ctx.threads, ctx.filePath) : new Map();
  const draftsByLine = ctx ? indexDraftsByAnchor(ctx.drafts, ctx.filePath) : new Map();

  const body = rows
    .map((row) => {
      if (row.leftCls === "pad" && row.rightCls === "pad" && row.leftText?.startsWith("@@")) {
        const hunk = escapeHtml(row.leftText);
        return `<div class="diff-hunk">${hunk}</div>`;
      }
      const anchors = anchorsForRow(row);
      const commentCount = commentCountForAnchors(anchors, threadsByLine, draftsByLine);
      const flags = threadFlagsForAnchors(anchors, threadsByLine, draftsByLine);
      const markerParts: string[] = [];
      if (commentCount > 0) {
        markerParts.push("has-comments");
      }
      if (flags.open > 0) {
        markerParts.push("has-open-threads");
      }
      if (flags.resolved > 0) {
        markerParts.push("has-resolved-threads");
      }
      if (flags.open === 0 && flags.resolved > 0) {
        markerParts.push("resolved-only");
      }
      const markerClass = markerParts.join(" ");
      const pinTitle = escapeHtml(threadPinTitle(flags));
      const pin =
        commentCount > 0
          ? `<button type="button" class="thread-pin" title="${pinTitle}" aria-label="Comentários"></button>`
          : `<span class="thread-pin empty"></span>`;

      const leftGutter =
        row.leftNum !== undefined
          ? `<span class="gutter left">${row.leftNum}</span>`
          : `<span class="gutter empty"></span>`;
      const rightGutter =
        row.rightNum !== undefined
          ? `<span class="gutter right">${row.rightNum}</span>`
          : `<span class="gutter empty"></span>`;
      const leftCommentable = row.leftNum !== undefined ? ` data-comment-side="old" data-comment-line="${row.leftNum}"` : "";
      const rightCommentable = row.rightNum !== undefined ? ` data-comment-side="new" data-comment-line="${row.rightNum}"` : "";
      const leftCode =
        row.leftText !== undefined
          ? highlightLine(row.leftText, languageId)
          : "";
      const rightCode =
        row.rightText !== undefined
          ? highlightLine(row.rightText, languageId)
          : "";
      const inlineThread = renderInlineThreadPanel(anchors, threadsByLine, draftsByLine);
      const anchorAttr = anchors.length > 0 ? ` data-anchors="${escapeHtml(anchors.join(","))}"` : "";
      return `<div class="diff-line-block"${anchorAttr}>
  <div class="diff-row ${markerClass}">
    <div class="diff-marker">${pin}</div>
    <div class="diff-cell left ${row.leftCls} commentable"${leftCommentable}>${leftGutter}<code>${leftCode || "&nbsp;"}</code></div>
    <div class="diff-cell right ${row.rightCls} commentable"${rightCommentable}>${rightGutter}<code>${rightCode || "&nbsp;"}</code></div>
  </div>
  ${inlineThread}
</div>`;
    })
    .join("");
  return `<div class="diff-split-head">
  <span class="diff-head-marker"></span>
  <span class="diff-col-title">Base</span>
  <span class="diff-col-title">Head (MR)</span>
</div>
<div class="diff-split" data-active-path="${escapeHtml(filePath)}">${body}</div>`;
}
