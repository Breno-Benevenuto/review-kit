import { escapeHtml } from "./diffPresentation";
import { languageIdForPath } from "./languageId";
import { highlightLine } from "./syntaxPreviewHighlight";

export type SideBySideRow = {
  leftNum?: number;
  leftText?: string;
  leftCls: "ctx" | "del" | "pad";
  rightNum?: number;
  rightText?: string;
  rightCls: "ctx" | "add" | "mod" | "pad";
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

export function renderSideBySideDiffHtml(filePath: string, diff: string): string {
  if (!diff.trim()) {
    return `<p class="diff-empty">Sem diff textual para este arquivo.</p>`;
  }
  const languageId = languageIdForPath(filePath);
  const rows = buildSideBySideRows(diff);
  const body = rows
    .map((row) => {
      if (row.leftCls === "pad" && row.rightCls === "pad" && row.leftText?.startsWith("@@")) {
        const hunk = escapeHtml(row.leftText);
        return `<div class="diff-hunk">${hunk}</div>`;
      }
      const leftGutter =
        row.leftNum !== undefined
          ? `<button type="button" class="gutter left" data-side="old" data-line="${row.leftNum}" title="Comentar (base)">${row.leftNum}</button>`
          : `<span class="gutter empty"></span>`;
      const rightGutter =
        row.rightNum !== undefined
          ? `<button type="button" class="gutter right" data-side="new" data-line="${row.rightNum}" title="Comentar (head)">${row.rightNum}</button>`
          : `<span class="gutter empty"></span>`;
      const leftCode =
        row.leftText !== undefined
          ? highlightLine(row.leftText, languageId)
          : "";
      const rightCode =
        row.rightText !== undefined
          ? highlightLine(row.rightText, languageId)
          : "";
      return `<div class="diff-row">
  <div class="diff-cell left ${row.leftCls}">${leftGutter}<code>${leftCode || "&nbsp;"}</code></div>
  <div class="diff-cell right ${row.rightCls}">${rightGutter}<code>${rightCode || "&nbsp;"}</code></div>
</div>`;
    })
    .join("");
  return `<div class="diff-split-head">
  <span class="diff-col-title">Base</span>
  <span class="diff-col-title">Head (MR)</span>
</div>
<div class="diff-split">${body}</div>`;
}
