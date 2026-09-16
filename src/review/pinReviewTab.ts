import * as vscode from "vscode";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pinActiveEditorTab(): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(35);
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (!tab) {
      continue;
    }
    if (tab.isPinned) {
      return;
    }
    await vscode.commands.executeCommand("workbench.action.pinEditor");
    if (vscode.window.tabGroups.activeTabGroup.activeTab?.isPinned) {
      return;
    }
  }
}

export async function pinTabForTextUri(uri: vscode.Uri): Promise<void> {
  const want = uri.toString();
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(40);
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (!(input instanceof vscode.TabInputText)) {
          continue;
        }
        if (input.uri.toString() !== want) {
          continue;
        }
        if (tab.isPinned) {
          return;
        }
        await vscode.window.showTextDocument(uri, {
          viewColumn: group.viewColumn,
          preview: false,
          preserveFocus: attempt > 2,
        });
        await pinActiveEditorTab();
        return;
      }
    }
  }
}

export async function pinDiffTabByTitle(title: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(40);
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.label !== title) {
          continue;
        }
        const input = tab.input;
        if (!(input instanceof vscode.TabInputTextDiff)) {
          continue;
        }
        if (tab.isPinned) {
          return;
        }
        await vscode.commands.executeCommand("vscode.diff", input.original, input.modified, tab.label, {
          viewColumn: group.viewColumn,
          preview: false,
        });
        await pinActiveEditorTab();
        return;
      }
    }
  }
}
