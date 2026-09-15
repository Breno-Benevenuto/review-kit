import * as path from "node:path";
import * as vscode from "vscode";
import type { GitLabClient } from "../gitlab/client";
import { resolveProjectIdForMr } from "../gitlab/projectContext";
import type { MrTreeContext } from "../providers/mrTreeProvider";
import { effectivePath } from "../graph/flowGraph";
import { buildFileUri } from "../providers/gitlabContentProvider";
import type { MrEditorReviewController } from "./mrEditorReview";
import { getCurrentGitBranch } from "./gitBranch";
import type { ReviewSession } from "./reviewSession";
import { getRawFileCached, rawFileCacheKey } from "./rawFileCache";
import { languageIdForPath } from "./languageId";

export async function openFileForAnalysis(
  client: GitLabClient,
  session: ReviewSession,
  changeCtx: Extract<MrTreeContext, { kind: "file" }>,
  reviewEditor?: MrEditorReviewController,
): Promise<vscode.Uri | undefined> {
  const filePath = effectivePath(changeCtx.change);
  const diff = changeCtx.change.diff ?? "";
  const folder = vscode.workspace.workspaceFolders?.[0];
  const uri = folder
    ? await resolveHeadUri(client, session, changeCtx, folder)
    : buildFileUri(
        resolveProjectIdForMr(changeCtx.mr.project_id),
        filePath,
        changeCtx.diffRefs.head_sha,
      );

  const languageId = languageIdForPath(filePath);
  await vscode.window.showTextDocument(uri, {
    viewColumn: vscode.ViewColumn.Two,
    preview: false,
    preserveFocus: false,
  });
  await applyLanguageWithRetry(uri, languageId);
  reviewEditor?.focusFile(filePath, diff);
  void vscode.commands.executeCommand("setContext", "reviewKit.mrReviewActive", true);
  return uri;
}

async function resolveHeadUri(
  client: GitLabClient,
  session: ReviewSession,
  ctx: Extract<MrTreeContext, { kind: "file" }>,
  folder: vscode.WorkspaceFolder,
): Promise<vscode.Uri> {
  const filePath = effectivePath(ctx.change);
  const cacheRoot = vscode.Uri.joinPath(folder.uri, ".review-kit", "cache", `${ctx.mr.project_id}-${ctx.mr.iid}`);
  await ensureReviewKitGitignore(folder.uri);
  const projectId = resolveProjectIdForMr(ctx.mr.project_id);
  const headContent = await getRawFileCached(
    () => client.getFileRaw(projectId, filePath, ctx.diffRefs.head_sha),
    rawFileCacheKey(projectId, ctx.diffRefs.head_sha, filePath),
  );
  const onSourceBranch = (await getCurrentGitBranch(folder.uri.fsPath)) === session.mr.source_branch;
  const workspaceFile = vscode.Uri.joinPath(folder.uri, ...filePath.split("/"));
  if (onSourceBranch) {
    try {
      await vscode.workspace.fs.stat(workspaceFile);
      return workspaceFile;
    } catch {
      return await writeUnder(cacheRoot, "head", filePath, headContent);
    }
  }
  if (!onSourceBranch) {
    void vscode.window.setStatusBarMessage(
      `Review Kit: checkout \`${session.mr.source_branch}\` para LSP e referências completas`,
      6000,
    );
  }
  return await writeUnder(cacheRoot, "head", filePath, headContent);
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

async function applyLanguageWithRetry(uri: vscode.Uri, languageId: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(40);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (doc && doc.languageId !== languageId && languageId !== "plaintext") {
      await vscode.languages.setTextDocumentLanguage(doc, languageId);
    }
    if (doc?.languageId === languageId) {
      return;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
