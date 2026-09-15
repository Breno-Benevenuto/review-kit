import * as vscode from "vscode";
import { languageIdForPath } from "./languageId";

export function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

export function workspaceUriForRepoPath(filePath: string, folder?: vscode.WorkspaceFolder): vscode.Uri | undefined {
  const root = folder ?? getWorkspaceFolder();
  if (!root) {
    return undefined;
  }
  const norm = filePath.replace(/\\/g, "/").replace(/^\//, "");
  return vscode.Uri.joinPath(root.uri, ...norm.split("/"));
}

export async function openRepoDocumentForPath(
  filePath: string,
  folder?: vscode.WorkspaceFolder,
): Promise<vscode.TextDocument | undefined> {
  const uri = workspaceUriForRepoPath(filePath, folder);
  if (!uri) {
    return undefined;
  }
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    return undefined;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  const languageId = languageIdForPath(filePath);
  if (doc.languageId !== languageId && languageId !== "plaintext") {
    await vscode.languages.setTextDocumentLanguage(doc, languageId);
  }
  return doc;
}

export async function openRepoDocumentsForPaths(
  paths: string[],
): Promise<{ folder: vscode.WorkspaceFolder; documents: Map<string, vscode.TextDocument> } | undefined> {
  const folder = getWorkspaceFolder();
  if (!folder) {
    return undefined;
  }
  const documents = new Map<string, vscode.TextDocument>();
  for (const filePath of paths) {
    const doc = await openRepoDocumentForPath(filePath, folder);
    if (doc) {
      documents.set(filePath, doc);
    }
  }
  if (documents.size === 0) {
    return undefined;
  }
  return { folder, documents };
}

export function repoRelativePath(uri: vscode.Uri, folder: vscode.WorkspaceFolder): string | undefined {
  const root = folder.uri.fsPath.replace(/\\/g, "/");
  const fsPath = uri.fsPath.replace(/\\/g, "/");
  if (!fsPath.startsWith(`${root}/`) && fsPath !== root) {
    return undefined;
  }
  const rel = fsPath === root ? "" : fsPath.slice(root.length + 1);
  if (!rel || rel.startsWith(".review-kit/") || rel.includes("/.review-kit/")) {
    return undefined;
  }
  return rel;
}

export function isRepoWorkspaceUri(uri: vscode.Uri, folder: vscode.WorkspaceFolder): boolean {
  return repoRelativePath(uri, folder) !== undefined;
}
