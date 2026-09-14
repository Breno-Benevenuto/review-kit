import * as path from "node:path";
import * as vscode from "vscode";
import type { GitLabClient } from "../gitlab/client";
import { resolveProjectIdForMr } from "../gitlab/projectContext";
import type { MrTreeContext } from "../providers/mrTreeProvider";
import { effectivePath } from "../graph/flowGraph";
import { buildFileUri } from "../providers/gitlabContentProvider";
import { revealProjectFileBesideDiff } from "./diffFocus";
import { openSideBySideColoredDiff } from "./diffEditorEnhancer";
import type { MrEditorReviewController } from "./mrEditorReview";
import { getCurrentGitBranch } from "./gitBranch";
import type { ReviewSession } from "./reviewSession";
import { getRawFileCached, rawFileCacheKey } from "./rawFileCache";

export async function openInteractiveFileDiff(
  client: GitLabClient,
  ctx: Extract<MrTreeContext, { kind: "file" }>,
  reviewEditor?: MrEditorReviewController,
  session?: ReviewSession,
): Promise<void> {
  const filePath = effectivePath(ctx.change);
  const diff = ctx.change.diff ?? "";
  const title = `${filePath} (MR !${ctx.mr.iid})`;
  const folder = vscode.workspace.workspaceFolders?.[0];

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

  const leftUri = await writeUnder(cacheRoot, "base", filePath, baseContent);
  const onSourceBranch = (await getCurrentGitBranch(folder.uri.fsPath)) === ctx.mr.source_branch;
  const workspaceFile = vscode.Uri.joinPath(folder.uri, ...filePath.split("/"));

  let rightUri: vscode.Uri;
  if (onSourceBranch) {
    try {
      await vscode.workspace.fs.stat(workspaceFile);
      rightUri = workspaceFile;
    } catch {
      rightUri = await writeUnder(cacheRoot, "head", filePath, headContent);
    }
  } else {
    rightUri = await writeUnder(cacheRoot, "head", filePath, headContent);
  }

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

  if (!onSourceBranch) {
    void vscode.window.setStatusBarMessage(
      `Review Kit: checkout \`${ctx.mr.source_branch}\` para navegar no código como no projeto (Go to Definition)`,
      8000,
    );
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

async function writeUnder(root: vscode.Uri, side: "base" | "head", filePath: string, content: string): Promise<vscode.Uri> {
  const target = vscode.Uri.joinPath(root, side, ...filePath.split("/"));
  const dir = vscode.Uri.file(path.dirname(target.fsPath));
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
  return target;
}

async function ensureReviewKitGitignore(workspaceRoot: vscode.Uri): Promise<void> {
  const kitDir = vscode.Uri.joinPath(workspaceRoot, ".review-kit");
  const ignoreFile = vscode.Uri.joinPath(kitDir, ".gitignore");
  try {
    await vscode.workspace.fs.stat(ignoreFile);
    return;
  } catch {
    await vscode.workspace.fs.createDirectory(kitDir);
    await vscode.workspace.fs.writeFile(ignoreFile, Buffer.from("*\n!.gitignore\n", "utf8"));
  }
}
