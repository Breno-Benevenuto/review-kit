import * as vscode from "vscode";
import type { GitLabClient } from "../gitlab/client";
import { resolveProjectIdForMr } from "../gitlab/projectContext";
import type { MrTreeContext } from "../providers/mrTreeProvider";
import { effectivePath } from "../graph/flowGraph";
import { buildFileUri } from "../providers/gitlabContentProvider";
import { revealProjectFileBesideDiff } from "./diffFocus";
import { openSideBySideColoredDiff } from "./diffEditorEnhancer";
import type { MrEditorReviewController } from "./mrEditorReview";
import type { ReviewSession } from "./reviewSession";
import { getRawFileCached, rawFileCacheKey } from "./rawFileCache";
import {
  ensureReviewKitGitignore,
  resolveMrHeadUriForEditor,
  writeMrCacheFile,
  workspaceFolderForRepoPath,
} from "./mrEditorUri";

export async function openInteractiveFileDiff(
  client: GitLabClient,
  ctx: Extract<MrTreeContext, { kind: "file" }>,
  reviewEditor?: MrEditorReviewController,
  session?: ReviewSession,
): Promise<void> {
  const filePath = effectivePath(ctx.change);
  const diff = ctx.change.diff ?? "";
  const title = `${filePath} (MR !${ctx.mr.iid})`;
  const folder = await workspaceFolderForRepoPath(filePath);

  if (!folder) {
    await openVirtualDiff(ctx, filePath, title, reviewEditor);
    return;
  }

  const cacheRoot = vscode.Uri.joinPath(folder.uri, ".review-kit", "cache", `${ctx.mr.project_id}-${ctx.mr.iid}`);
  await ensureReviewKitGitignore(folder.uri);

  const projectId = resolveProjectIdForMr(ctx.mr.project_id);
  const [baseContent, headContent] = await Promise.all([
    getRawFileCached(
      () => client.getFileRaw(projectId, filePath, ctx.diffRefs.base_sha),
      rawFileCacheKey(projectId, ctx.diffRefs.base_sha, filePath),
    ),
    getRawFileCached(
      () => client.getFileRaw(projectId, filePath, ctx.diffRefs.head_sha),
      rawFileCacheKey(projectId, ctx.diffRefs.head_sha, filePath),
    ),
  ]);

  const leftUri = await writeMrCacheFile(cacheRoot, "base", filePath, baseContent);
  const rightUri = await resolveMrHeadUriForEditor(
    filePath,
    ctx.mr.source_branch,
    headContent,
    cacheRoot,
  );
  await openSideBySideColoredDiff({
    left: leftUri,
    right: rightUri,
    title,
    filePath,
    onRightOpened: () => {
      reviewEditor?.focusFile(filePath, diff);
    },
  });

  if (session) {
    await revealProjectFileBesideDiff(session, filePath, rightUri);
  }

}

async function openVirtualDiff(
  ctx: Extract<MrTreeContext, { kind: "file" }>,
  filePath: string,
  title: string,
  reviewEditor?: MrEditorReviewController,
): Promise<void> {
  const left = buildFileUri(resolveProjectIdForMr(ctx.mr.project_id), filePath, ctx.diffRefs.base_sha);
  const right = buildFileUri(resolveProjectIdForMr(ctx.mr.project_id), filePath, ctx.diffRefs.head_sha);
  await openSideBySideColoredDiff({
    left,
    right,
    title,
    filePath,
    onRightOpened: () => {
      reviewEditor?.focusFile(filePath, ctx.change.diff ?? "");
    },
  });
}

