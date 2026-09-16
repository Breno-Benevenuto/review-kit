import type { MrDiscussionThreadView } from "../gitlab/types";
import type { DraftComment } from "./reviewDrafts";
import { discussionMatchesFilePath } from "./mrDiscussionsPanel";
import type { SideBySideRow } from "./sideBySideDiffHtml";

export type LineCommentSide = "new" | "old";

export function lineAnchorKey(side: LineCommentSide, line: number): string {
  return `${side}:${line}`;
}

export function parseLineAnchorKey(key: string): { side: LineCommentSide; line: number } | undefined {
  const match = key.match(/^(new|old):(\d+)$/);
  if (!match) {
    return undefined;
  }
  return { side: match[1] as LineCommentSide, line: Number(match[2]) };
}

export function indexThreadsByAnchor(
  threads: MrDiscussionThreadView[],
  filePath: string,
): Map<string, MrDiscussionThreadView[]> {
  const map = new Map<string, MrDiscussionThreadView[]>();
  for (const thread of threads) {
    if (!discussionMatchesFilePath(thread.anchorPath, filePath)) {
      continue;
    }
    if (thread.anchorLine === undefined || !thread.anchorSide) {
      continue;
    }
    const key = lineAnchorKey(thread.anchorSide, thread.anchorLine);
    const list = map.get(key) ?? [];
    list.push(thread);
    map.set(key, list);
  }
  return map;
}

export function indexDraftsByAnchor(
  drafts: readonly DraftComment[],
  filePath: string,
): Map<string, DraftComment[]> {
  const map = new Map<string, DraftComment[]>();
  for (const draft of drafts) {
    if (!discussionMatchesFilePath(draft.filePath, filePath)) {
      continue;
    }
    const key = lineAnchorKey(draft.side, draft.line);
    const list = map.get(key) ?? [];
    list.push(draft);
    map.set(key, list);
  }
  return map;
}

export function anchorsForRow(row: SideBySideRow): string[] {
  const keys: string[] = [];
  if (row.leftNum !== undefined) {
    keys.push(lineAnchorKey("old", row.leftNum));
  }
  if (row.rightNum !== undefined) {
    keys.push(lineAnchorKey("new", row.rightNum));
  }
  return keys;
}

export function commentCountForAnchors(
  anchors: string[],
  threadsByLine: Map<string, MrDiscussionThreadView[]>,
  draftsByLine: Map<string, DraftComment[]>,
): number {
  let count = 0;
  for (const key of anchors) {
    count += (threadsByLine.get(key)?.length ?? 0) + (draftsByLine.get(key)?.length ?? 0);
  }
  return count;
}

export type AnchorThreadFlags = {
  open: number;
  resolved: number;
  drafts: number;
};

export function threadFlagsForAnchors(
  anchors: string[],
  threadsByLine: Map<string, MrDiscussionThreadView[]>,
  draftsByLine: Map<string, DraftComment[]>,
): AnchorThreadFlags {
  let open = 0;
  let resolved = 0;
  let drafts = 0;
  for (const key of anchors) {
    drafts += draftsByLine.get(key)?.length ?? 0;
    for (const thread of threadsByLine.get(key) ?? []) {
      if (thread.resolved) {
        resolved += 1;
      } else {
        open += 1;
      }
    }
  }
  return { open, resolved, drafts };
}

export function threadPinTitle(flags: AnchorThreadFlags): string {
  const parts: string[] = [];
  if (flags.open > 0) {
    parts.push(`${flags.open} aberta(s)`);
  }
  if (flags.resolved > 0) {
    parts.push(`${flags.resolved} resolvida(s)`);
  }
  if (flags.drafts > 0) {
    parts.push(`${flags.drafts} na fila`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Comentários";
}
