import * as vscode from "vscode";
import type { GitLabClient } from "../gitlab/client";
import type { MergeRequestChange, MergeRequestSummary } from "../gitlab/types";
import { effectivePath } from "../graph/flowGraph";
import { buildFileUri } from "./gitlabContentProvider";

export type MrTreeContext =
  | { kind: "mr"; mr: MergeRequestSummary; changes?: MergeRequestChange[]; diffRefs?: { base_sha: string; head_sha: string } }
  | { kind: "file"; mr: MergeRequestSummary; change: MergeRequestChange; diffRefs: { base_sha: string; head_sha: string } };

export class MrTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private mergeRequests: MergeRequestSummary[] = [];
  private changesByMrKey = new Map<string, { changes: MergeRequestChange[]; base_sha: string; head_sha: string }>();
  private mrByKey = new Map<string, MergeRequestSummary>();

  constructor(
    private readonly getClient: () => GitLabClient | undefined,
    private readonly isReviewed: (mrKey: string, path: string) => boolean,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setMergeRequests(mrs: MergeRequestSummary[]): void {
    this.mergeRequests = mrs;
    this.mrByKey.clear();
    for (const mr of mrs) {
      this.mrByKey.set(mrKey(mr), mr);
    }
    this.refresh();
  }

  cacheChanges(mr: MergeRequestSummary, changes: MergeRequestChange[], base_sha: string, head_sha: string): void {
    this.changesByMrKey.set(mrKey(mr), { changes, base_sha, head_sha });
    this.refresh();
  }

  getMrContext(item: vscode.TreeItem): MrTreeContext | undefined {
    return item.command?.arguments?.[0] as MrTreeContext | undefined;
  }

  getMr(key: string): MergeRequestSummary | undefined {
    return this.mrByKey.get(key);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      if (this.mergeRequests.length === 0) {
        const hint = new vscode.TreeItem("Configure token and refresh");
        hint.contextValue = "hint";
        return [hint];
      }
      return this.mergeRequests.map((mr) => {
        const key = mrKey(mr);
        const item = new vscode.TreeItem(mr.title, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = key;
        item.description = mr.references.full;
        item.tooltip = mr.web_url;
        item.contextValue = "mr";
        item.iconPath = new vscode.ThemeIcon("git-merge");
        return item;
      });
    }

    const key = element.id;
    const mr = key ? this.mrByKey.get(key) : undefined;
    if (mr) {
      const cachedKey = mrKey(mr);
      let cached = this.changesByMrKey.get(cachedKey);
      if (!cached) {
        const client = this.getClient();
        if (!client) {
          return [];
        }
        try {
          const payload = await client.getMergeRequestChanges(mr.project_id, mr.iid);
          cached = {
            changes: payload.changes,
            base_sha: payload.diff_refs.base_sha,
            head_sha: payload.diff_refs.head_sha,
          };
          this.changesByMrKey.set(cachedKey, cached);
        } catch (e) {
          const err = new vscode.TreeItem(`Failed to load changes: ${String(e)}`);
          return [err];
        }
      }
      return cached.changes.map((change) => {
        const path = effectivePath(change);
        const item = new vscode.TreeItem(path, vscode.TreeItemCollapsibleState.None);
        item.description = change.new_file ? "new" : change.deleted_file ? "deleted" : "";
        item.contextValue = "changedFile";
        item.iconPath = new vscode.ThemeIcon(this.isReviewed(cachedKey, path) ? "check" : "file");
        item.command = {
          command: "reviewKit.openFileDiff",
          title: "Open diff",
          arguments: [
            {
              kind: "file",
              mr,
              change,
              diffRefs: { base_sha: cached.base_sha, head_sha: cached.head_sha },
            } satisfies MrTreeContext,
          ],
        };
        return item;
      });
    }
    return [];
  }
}

export function mrKey(mr: MergeRequestSummary): string {
  return `${mr.project_id}:${mr.iid}`;
}

export async function openFileDiff(ctx: Extract<MrTreeContext, { kind: "file" }>): Promise<void> {
  const path = effectivePath(ctx.change);
  const left = buildFileUri(ctx.mr.project_id, path, ctx.diffRefs.base_sha);
  const right = buildFileUri(ctx.mr.project_id, path, ctx.diffRefs.head_sha);
  const title = `${path} (MR !${ctx.mr.iid})`;
  await vscode.commands.executeCommand("vscode.diff", left, right, title);
}
