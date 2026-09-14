import * as vscode from "vscode";
import type { MergeRequestSummary, MrReviewState } from "../gitlab/types";
import { mrKey } from "../providers/mrTreeProvider";

const STATE_KEY = "reviewKit.mrReviewState";

export class ReviewProgressProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const state = this.readAll();
    const keys = Object.keys(state);
    if (keys.length === 0) {
      const empty = new vscode.TreeItem("No MR review progress yet");
      empty.contextValue = "hint";
      return [empty];
    }
    return keys.map((key) => {
      const reviewed = state[key]?.reviewedPaths.length ?? 0;
      const item = new vscode.TreeItem(key, vscode.TreeItemCollapsibleState.None);
      item.description = `${reviewed} file(s) reviewed`;
      item.iconPath = new vscode.ThemeIcon("checklist");
      return item;
    });
  }

  isReviewed(mr: MergeRequestSummary, path: string): boolean {
    const s = this.read(mr);
    return s.reviewedPaths.includes(path);
  }

  toggleReviewed(mr: MergeRequestSummary, path: string): boolean {
    const key = mrKey(mr);
    const s = this.read(mr);
    const idx = s.reviewedPaths.indexOf(path);
    if (idx >= 0) {
      s.reviewedPaths.splice(idx, 1);
    } else {
      s.reviewedPaths.push(path);
    }
    this.write(key, s);
    this.refresh();
    return s.reviewedPaths.includes(path);
  }

  countReviewed(mr: MergeRequestSummary): number {
    return this.read(mr).reviewedPaths.length;
  }

  private read(mr: MergeRequestSummary): MrReviewState {
    return this.readAll()[mrKey(mr)] ?? { reviewedPaths: [] };
  }

  private readAll(): Record<string, MrReviewState> {
    return this.context.workspaceState.get(STATE_KEY, {});
  }

  private write(key: string, state: MrReviewState): void {
    const all = this.readAll();
    all[key] = state;
    void this.context.workspaceState.update(STATE_KEY, all);
  }
}
