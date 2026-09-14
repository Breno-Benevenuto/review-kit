import type { PreviewLine } from "./diffHunks";

export type DiffLineMarkers = {
  added: Set<number>;
  inHunk: Set<number>;
  oldInHunk: Set<number>;
  removed: PreviewLine[];
  stats: { added: number; removed: number; modified: number };
};

export function parseDiffLineMarkers(diff: string): DiffLineMarkers {
  const added = new Set<number>();
  const inHunk = new Set<number>();
  const oldInHunk = new Set<number>();
  const removed: PreviewLine[] = [];
  let newLine = 1;
  let oldLine = 1;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      const newMatch = raw.match(/\+(\d+)(?:,(\d+))?/);
      const oldMatch = raw.match(/-(\d+)(?:,(\d+))?/);
      if (newMatch) {
        newLine = Number(newMatch[1]);
      }
      if (oldMatch) {
        oldLine = Number(oldMatch[1]);
      }
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("\\")) {
      continue;
    }
    if (raw.startsWith("+")) {
      added.add(newLine);
      inHunk.add(newLine);
      newLine++;
      continue;
    }
    if (raw.startsWith("-")) {
      oldInHunk.add(oldLine);
      removed.push({ number: newLine, oldLine, text: raw.slice(1), kind: "remove" });
      oldLine++;
      continue;
    }
    if (raw.startsWith(" ")) {
      inHunk.add(newLine);
      oldInHunk.add(oldLine);
      newLine++;
      oldLine++;
    }
  }

  let modified = 0;
  for (const line of inHunk) {
    if (!added.has(line)) {
      modified++;
    }
  }

  return {
    added,
    inHunk,
    oldInHunk,
    removed,
    stats: { added: added.size, removed: removed.length, modified },
  };
}
