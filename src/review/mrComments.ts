import * as vscode from "vscode";
import type { GitLabClient } from "../gitlab/client";
import { resolveProjectIdForMr } from "../gitlab/projectContext";
import type { MergeRequestChange, MergeRequestSummary } from "../gitlab/types";
import { effectivePath } from "../graph/flowGraph";
import type { ReviewSession } from "./reviewSession";

export type MrCommentTarget = {
  projectId: number;
  iid: number;
  mr: MergeRequestSummary;
  diffRefs: ReviewSession["diffRefs"];
};

export type LineCommentSide = "new" | "old";

export async function postGeneralMrComment(
  client: GitLabClient,
  target: MrCommentTarget,
  body: string,
): Promise<void> {
  await client.createMrNote(target.projectId, target.iid, body);
}

export async function postLineThreadComment(
  client: GitLabClient,
  target: MrCommentTarget,
  filePath: string,
  line: number,
  body: string,
  change: MergeRequestChange | undefined,
  side: LineCommentSide,
): Promise<void> {
  const oldPath = change?.old_path ?? filePath;
  const newPath = change?.new_path ?? filePath;
  const position = {
    base_sha: target.diffRefs.base_sha,
    start_sha: target.diffRefs.start_sha,
    head_sha: target.diffRefs.head_sha,
    old_path: oldPath,
    new_path: newPath,
    ...(side === "new" ? { new_line: line } : { old_line: line }),
  };
  await client.createMrDiscussion(target.projectId, target.iid, body, position);
}

export function targetFromSession(session: ReviewSession): MrCommentTarget {
  return {
    projectId: resolveProjectIdForMr(session.mr.project_id),
    iid: session.mr.iid,
    mr: session.mr,
    diffRefs: session.diffRefs,
  };
}

export function matchMrFilePath(session: ReviewSession, uri: vscode.Uri): string | undefined {
  const fsPath = uri.fsPath.replace(/\\/g, "/");
  for (const filePath of session.changeByPath.keys()) {
    const norm = filePath.replace(/\\/g, "/");
    if (fsPath.endsWith(`/${norm}`) || fsPath.endsWith(norm)) {
      return filePath;
    }
  }
  const cacheMatch = fsPath.match(/\.review-kit\/cache\/[^/]+-\d+\/(?:base|head)\/(.+)$/);
  if (cacheMatch) {
    const cachedPath = cacheMatch[1];
    if (session.changeByPath.has(cachedPath)) {
      return cachedPath;
    }
  }
  return undefined;
}

export function commentSideForDocument(uri: vscode.Uri): "new" | "old" {
  const fsPath = uri.fsPath.replace(/\\/g, "/");
  if (fsPath.includes("/.review-kit/cache/") && fsPath.includes("/base/")) {
    return "old";
  }
  return "new";
}

export function resolveFilePathFromEditor(
  session: ReviewSession,
  _activePath: string | undefined,
  documentUri: string,
): string | undefined {
  return matchMrFilePath(session, vscode.Uri.parse(documentUri));
}

export function effectivePathForChange(change: MergeRequestChange): string {
  return effectivePath(change);
}
