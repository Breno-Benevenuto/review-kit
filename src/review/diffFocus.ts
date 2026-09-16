import * as vscode from "vscode";
import type { ReviewSession } from "./reviewSession";
import { matchMrFilePath } from "./mrComments";
import { findExistingWorkspaceUriForRepoPath } from "./mrEditorUri";

export async function closeOtherMrDiffTabs(keepTitle?: string): Promise<void> {
  const toClose: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (!(input instanceof vscode.TabInputTextDiff)) {
        continue;
      }
      const rawLabel = tab.label;
      const label = typeof rawLabel === "string" ? rawLabel : String(rawLabel);
      if (!label.includes("(MR !")) {
        continue;
      }
      if (keepTitle && label === keepTitle) {
        continue;
      }
      toClose.push(tab);
    }
  }
  if (toClose.length > 0) {
    await vscode.window.tabGroups.close(toClose);
  }
}

export async function focusModifiedSide(rightUri: vscode.Uri): Promise<void> {
  for (let attempt = 0; attempt < 15; attempt++) {
    await sleep(50);
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === rightUri.toString(),
    );
    if (editor) {
      await vscode.window.showTextDocument(editor.document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
        selection: editor.selection,
      });
      return;
    }
  }
}

export async function revealProjectFileBesideDiff(
  session: ReviewSession,
  filePath: string,
  headUri: vscode.Uri,
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("reviewKit");
  if (!cfg.get<boolean>("openProjectEditorForNavigation", true)) {
    return;
  }
  const workspaceFile = await findExistingWorkspaceUriForRepoPath(filePath);
  const target = workspaceFile ?? headUri;
  if (workspaceFile && workspaceFile.toString() === headUri.toString()) {
    return;
  }
  const column =
    vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Two;
  const navColumn = column === vscode.ViewColumn.Two ? vscode.ViewColumn.Three : vscode.ViewColumn.Two;
  await vscode.window.showTextDocument(target, {
    viewColumn: navColumn,
    preview: false,
    preserveFocus: true,
  });
  void vscode.commands.executeCommand("setContext", "reviewKit.mrReviewActive", true);
  void matchMrFilePath(session, target);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
