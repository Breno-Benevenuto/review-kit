import type { GitLabClient } from "../gitlab/client";
import type { GitLabDiscussion, MrDiscussionNoteView, MrDiscussionThreadView } from "../gitlab/types";

export function mapMrDiscussions(
  raw: GitLabDiscussion[],
  currentUsername: string,
): MrDiscussionThreadView[] {
  const threads: MrDiscussionThreadView[] = [];
  for (const discussion of raw) {
    const notes = (discussion.notes ?? [])
      .filter((n) => !n.system && (n.body ?? "").trim().length > 0)
      .map((n) => toNoteView(n, currentUsername));
    if (notes.length === 0) {
      continue;
    }
    const involvesCurrentUser = notes.some((n) => n.isCurrentUser);
    const hasReplyFromOthers = notes.some(
      (n, idx) => !n.isCurrentUser && notes.slice(0, idx).some((prev) => prev.isCurrentUser),
    );
    const anchor = notes.find((n) => n.filePath && n.line !== undefined) ?? notes[0];
    threads.push({
      id: discussion.id,
      notes,
      involvesCurrentUser,
      hasReplyFromOthers,
      anchorPath: anchor?.filePath,
      anchorLine: anchor?.line,
      anchorSide: anchor?.side,
    });
  }
  return threads.sort((a, b) => {
    if (a.hasReplyFromOthers !== b.hasReplyFromOthers) {
      return a.hasReplyFromOthers ? -1 : 1;
    }
    if (a.involvesCurrentUser !== b.involvesCurrentUser) {
      return a.involvesCurrentUser ? -1 : 1;
    }
    return 0;
  });
}

function toNoteView(
  note: GitLabDiscussion["notes"][number],
  currentUsername: string,
): MrDiscussionNoteView {
  const pos = note.position ?? undefined;
  let filePath: string | undefined;
  let line: number | undefined;
  let side: "new" | "old" | undefined;
  if (pos) {
    if (pos.new_line != null && pos.new_path) {
      filePath = pos.new_path;
      line = pos.new_line;
      side = "new";
    } else if (pos.old_line != null && pos.old_path) {
      filePath = pos.old_path;
      line = pos.old_line;
      side = "old";
    } else if (pos.new_path) {
      filePath = pos.new_path;
    } else if (pos.old_path) {
      filePath = pos.old_path;
    }
  }
  return {
    id: note.id,
    body: note.body.trim(),
    authorName: note.author?.name ?? note.author?.username ?? "?",
    authorUsername: note.author?.username ?? "",
    createdAt: note.created_at,
    isCurrentUser: note.author?.username === currentUsername,
    filePath,
    line,
    side,
  };
}

export function threadsWithRepliesToUser(threads: MrDiscussionThreadView[]): MrDiscussionThreadView[] {
  return threads.filter((t) => t.involvesCurrentUser);
}

export async function fetchMrDiscussionThreads(
  client: GitLabClient,
  projectId: number,
  mrIid: number,
): Promise<MrDiscussionThreadView[]> {
  const user = await client.getCurrentUser();
  const raw = await client.listMergeRequestDiscussions(projectId, mrIid);
  return mapMrDiscussions(raw, user.username);
}
