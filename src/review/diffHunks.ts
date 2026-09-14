import { parseDiffLineMarkers } from "./diffMarkers";

export type PreviewLine = {
  number: number;
  text: string;
  kind: "context" | "add" | "modify" | "remove";
  oldLine?: number;
};

export type PreviewBundle = {
  lines: PreviewLine[];
  removed: PreviewLine[];
  stats: { added: number; removed: number; modified: number };
};

export function buildHeadPreviewFromContent(content: string, diff: string): PreviewBundle {
  if (content.trim()) {
    return annotateFullFileWithDiff(content, diff);
  }
  const lines = buildHeadPreviewLines(diff);
  return {
    lines,
    removed: lines.filter((l) => l.kind === "remove"),
    stats: countStats(lines),
  };
}

function annotateFullFileWithDiff(content: string, diff: string): PreviewBundle {
  const { added, inHunk, removed, stats } = parseDiffLineMarkers(diff);

  const lines = content.split("\n").map((text, index) => {
    const number = index + 1;
    let kind: PreviewLine["kind"] = "context";
    if (added.has(number)) {
      kind = "add";
    } else if (inHunk.has(number)) {
      kind = "modify";
    }
    return { number, text, kind };
  });

  return { lines, removed, stats };
}

function buildHeadPreviewLines(diff: string): PreviewLine[] {
  const preview: PreviewLine[] = [];
  let newLine = 1;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      const match = raw.match(/\+(\d+)(?:,(\d+))?/);
      if (match) {
        newLine = Number(match[1]);
      }
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("\\")) {
      continue;
    }
    if (raw.startsWith("+")) {
      preview.push({ number: newLine, text: raw.slice(1), kind: "add" });
      newLine++;
      continue;
    }
    if (raw.startsWith("-")) {
      preview.push({ number: newLine, text: raw.slice(1), kind: "remove" });
      continue;
    }
    if (raw.startsWith(" ")) {
      preview.push({ number: newLine, text: raw.slice(1), kind: "context" });
      newLine++;
    }
  }

  return preview;
}

function countStats(lines: PreviewLine[]): PreviewBundle["stats"] {
  return {
    added: lines.filter((l) => l.kind === "add").length,
    removed: lines.filter((l) => l.kind === "remove").length,
    modified: lines.filter((l) => l.kind === "modify").length,
  };
}
