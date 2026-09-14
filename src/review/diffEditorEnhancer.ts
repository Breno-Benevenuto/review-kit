import * as path from "node:path";
import * as vscode from "vscode";
import { closeOtherMrDiffTabs, focusModifiedSide } from "./diffFocus";
import { languageIdForPath } from "./languageId";

export async function openSideBySideColoredDiff(options: {
  left: vscode.Uri;
  right: vscode.Uri;
  title: string;
  filePath: string;
  viewColumn?: vscode.ViewColumn;
  onRightOpened?: (rightUri: vscode.Uri) => void;
}): Promise<void> {
  const viewColumn = options.viewColumn ?? vscode.ViewColumn.Two;
  await closeOtherMrDiffTabs(options.title);
  await vscode.commands.executeCommand("vscode.diff", options.left, options.right, options.title, {
    preview: false,
    viewColumn,
  });

  const languageId = languageIdForPath(options.filePath);
  await applyLanguageWithRetry(options.left, options.right, languageId);

  await focusModifiedSide(options.right);
  options.onRightOpened?.(options.right);

  const inline = vscode.workspace.getConfiguration("reviewKit").get<boolean>("diffInline") ?? false;
  if (inline) {
    await vscode.commands.executeCommand("toggleInlineView");
  }
}

async function applyLanguageWithRetry(
  left: vscode.Uri,
  right: vscode.Uri,
  languageId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(40);
    const targets = [left.toString(), right.toString()];
    for (const doc of vscode.workspace.textDocuments) {
      if (!targets.includes(doc.uri.toString())) {
        continue;
      }
      if (doc.languageId !== languageId) {
        await vscode.languages.setTextDocumentLanguage(doc, languageId);
      }
    }
    const editors = vscode.window.visibleTextEditors.filter((e) => targets.includes(e.document.uri.toString()));
    if (editors.length >= 2 && editors.every((e) => e.document.languageId === languageId)) {
      return;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerAutoLanguageOnOpen(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId !== "plaintext") {
        return;
      }
      const fsPath = doc.uri.fsPath;
      if (!fsPath.includes(`${path.sep}.review-kit${path.sep}`)) {
        return;
      }
      const languageId = languageIdForPath(fsPath);
      if (languageId === "plaintext") {
        return;
      }
      void vscode.languages.setTextDocumentLanguage(doc, languageId);
    }),
  );
}
