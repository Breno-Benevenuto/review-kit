import * as path from "node:path";
import * as vscode from "vscode";
import { getCurrentGitBranch } from "./gitBranch";

export function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\//, "");
}

export async function findExistingWorkspaceUriForRepoPath(filePath: string): Promise<vscode.Uri | undefined> {
  const segments = normalizeRepoPath(filePath).split("/");
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const uri = vscode.Uri.joinPath(folder.uri, ...segments);
    try {
      await vscode.workspace.fs.stat(uri);
      return uri;
    } catch {
      continue;
    }
  }
  return undefined;
}

export async function workspaceFolderForRepoPath(
  filePath: string,
): Promise<vscode.WorkspaceFolder | undefined> {
  const segments = normalizeRepoPath(filePath).split("/");
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, ...segments));
      return folder;
    } catch {
      continue;
    }
  }
  return vscode.workspace.workspaceFolders?.[0];
}

export async function notifyBranchMismatchForLsp(
  sessionSourceBranch: string,
  filePath: string,
): Promise<void> {
  const folder = await workspaceFolderForRepoPath(filePath);
  if (!folder) {
    return;
  }
  const branch = await getCurrentGitBranch(folder.uri.fsPath);
  if (branch === sessionSourceBranch) {
    return;
  }
  void vscode.window.setStatusBarMessage(
    `Review Kit: branch \`${branch ?? "?"}\` ≠ \`${sessionSourceBranch}\` — arquivo do workspace (LSP ativo; conteúdo pode diferir do MR). Checkout na branch do MR para alinhar.`,
    9000,
  );
}

export async function writeMrCacheFile(
  cacheRoot: vscode.Uri,
  side: "base" | "head",
  filePath: string,
  content: string,
): Promise<vscode.Uri> {
  const target = vscode.Uri.joinPath(cacheRoot, side, ...normalizeRepoPath(filePath).split("/"));
  const dir = vscode.Uri.file(path.dirname(target.fsPath));
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
  return target;
}

export async function ensureReviewKitGitignore(workspaceRoot: vscode.Uri): Promise<void> {
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

export async function resolveMrHeadUriForEditor(
  filePath: string,
  sessionSourceBranch: string,
  headContent: string,
  cacheRoot: vscode.Uri,
): Promise<vscode.Uri> {
  const workspaceUri = await findExistingWorkspaceUriForRepoPath(filePath);
  if (workspaceUri) {
    await notifyBranchMismatchForLsp(sessionSourceBranch, filePath);
    return workspaceUri;
  }
  const folder = await workspaceFolderForRepoPath(filePath);
  const branch = folder ? await getCurrentGitBranch(folder.uri.fsPath) : undefined;
  if (branch !== sessionSourceBranch) {
    void vscode.window.setStatusBarMessage(
      `Review Kit: arquivo novo no MR — faça checkout em \`${sessionSourceBranch}\` ou use o diff visual (cópia em cache sem LSP completo).`,
      9000,
    );
  }
  return writeMrCacheFile(cacheRoot, "head", filePath, headContent);
}

export async function warmDocumentLanguageFeatures(uri: vscode.Uri): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(120);
    const open = vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString());
    if (!open) {
      continue;
    }
    await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      uri,
    );
    return;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
