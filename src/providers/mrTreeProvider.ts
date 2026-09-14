import * as vscode from "vscode";
import type { GitLabClient } from "../gitlab/client";
import { resolveProjectIdForMr, getActiveGitLabProject } from "../gitlab/projectContext";
import type { MergeRequestChange, MergeRequestSummary } from "../gitlab/types";
import { effectivePath } from "../graph/flowGraph";
import { orderChanges } from "../review/orderChanges";
import { classifyLayer } from "../graph/dependencyAnalyzer";
import { buildFileUri } from "./gitlabContentProvider";
import { getMrEditorReviewController } from "../review/reviewEditorRef";
import type { ReviewSession } from "../review/reviewSession";

export type MrTreeContext =
  | { kind: "mr"; mr: MergeRequestSummary; changes?: MergeRequestChange[]; diffRefs?: { base_sha: string; head_sha: string } }
  | { kind: "file"; mr: MergeRequestSummary; change: MergeRequestChange; diffRefs: { base_sha: string; head_sha: string; start_sha?: string } };

export class MrTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private mergeRequests: MergeRequestSummary[] = [];
  private loadedOnce = false;
  private projectHint: string | undefined;
  private changesByMrKey = new Map<
    string,
    { changes: MergeRequestChange[]; base_sha: string; head_sha: string; start_sha: string }
  >();
  private mrByKey = new Map<string, MergeRequestSummary>();
  private fileContextById = new Map<string, Extract<MrTreeContext, { kind: "file" }>>();

  constructor(
    private readonly getClient: () => GitLabClient | undefined,
    private readonly isReviewed: (mrKey: string, path: string) => boolean,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setProjectHint(message: string | undefined): void {
    this.projectHint = message;
    this.loadedOnce = true;
    this.refresh();
  }

  setMergeRequests(mrs: MergeRequestSummary[]): void {
    this.mergeRequests = mrs;
    this.loadedOnce = true;
    this.mrByKey.clear();
    for (const mr of mrs) {
      this.mrByKey.set(mrKey(mr), mr);
    }
    this.refresh();
  }

  cacheChanges(
    mr: MergeRequestSummary,
    changes: MergeRequestChange[],
    base_sha: string,
    head_sha: string,
    start_sha: string,
  ): void {
    this.changesByMrKey.set(mrKey(mr), { changes, base_sha, head_sha, start_sha });
    this.refresh();
  }

  getCachedChanges(mr: MergeRequestSummary) {
    return this.changesByMrKey.get(mrKey(mr));
  }

  getMrContext(item: vscode.TreeItem): MrTreeContext | undefined {
    const fromCommand = item.command?.arguments?.[0] as MrTreeContext | undefined;
    if (fromCommand) {
      return fromCommand;
    }
    if (item.id?.startsWith("file:")) {
      return this.fileContextById.get(item.id);
    }
    const mr = item.id ? this.mrByKey.get(item.id) : undefined;
    if (mr) {
      return { kind: "mr", mr };
    }
    return undefined;
  }

  getFileContext(item: vscode.TreeItem): Extract<MrTreeContext, { kind: "file" }> | undefined {
    if (!item.id?.startsWith("file:")) {
      return undefined;
    }
    return this.fileContextById.get(item.id);
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
        const hintText =
          this.projectHint ??
          (this.loadedOnce ? "Nenhum MR aberto neste projeto" : "Clique em refresh (↑) para carregar MRs");
        const hint = new vscode.TreeItem(hintText);
        hint.contextValue = "hint";
        return [hint];
      }
      return this.mergeRequests.map((mr) => {
        const key = mrKey(mr);
        const item = new vscode.TreeItem(mr.title, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = key;
        item.description = `${mr.references?.full ?? `!${mr.iid}`}${mr.draft ? " · draft" : ""}`;
        item.tooltip = mr.web_url;
        item.contextValue = "mr";
        item.iconPath = new vscode.ThemeIcon("git-merge");
        item.command = {
          command: "reviewKit.openVisualReview",
          title: "Abrir revisão visual",
          arguments: [key],
        };
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
          const projectId = resolveProjectIdForMr(mr.project_id);
          const workspaceId = getActiveGitLabProject()?.id;
          const payload = await client.getMergeRequestChangesWithFallback(
            projectId,
            mr.iid,
            workspaceId,
          );
          cached = {
            changes: payload.changes,
            base_sha: payload.diff_refs.base_sha,
            head_sha: payload.diff_refs.head_sha,
            start_sha: payload.diff_refs.start_sha,
          };
          this.changesByMrKey.set(cachedKey, cached);
        } catch (e) {
          const err = new vscode.TreeItem(`Failed to load changes: ${String(e)}`);
          return [err];
        }
      }
      const ordered = orderChanges(cached.changes);
      for (const key of [...this.fileContextById.keys()]) {
        if (key.startsWith(`file:${cachedKey}:`)) {
          this.fileContextById.delete(key);
        }
      }
      return ordered.map((change, idx) => {
        const path = effectivePath(change);
        const layer = classifyLayer(path);
        const item = new vscode.TreeItem(`#${idx + 1} ${path.split("/").pop() ?? path}`, vscode.TreeItemCollapsibleState.None);
        item.description = `${layer} · ${change.new_file ? "novo" : change.deleted_file ? "removido" : "alterado"}`;
        item.tooltip = `${path}\nDuplo clique abre o diff`;
        item.contextValue = "changedFile";
        item.iconPath = new vscode.ThemeIcon(this.isReviewed(cachedKey, path) ? "check" : "file");
        const fileId = `file:${cachedKey}:${path}`;
        item.id = fileId;
        this.fileContextById.set(fileId, {
          kind: "file",
          mr,
          change,
          diffRefs: {
            base_sha: cached.base_sha,
            head_sha: cached.head_sha,
            start_sha: cached.start_sha,
          },
        });
        return item;
      });
    }
    return [];
  }
}

export function mrKey(mr: MergeRequestSummary): string {
  return `${mr.project_id}:${mr.iid}`;
}

export async function openFileDiff(
  client: GitLabClient | undefined,
  ctx: Extract<MrTreeContext, { kind: "file" }>,
  session?: ReviewSession,
): Promise<void> {
  if (client) {
    const { openInteractiveFileDiff } = await import("../review/interactiveDiff");
    await openInteractiveFileDiff(client, ctx, getMrEditorReviewController(), session);
    return;
  }
  const path = effectivePath(ctx.change);
  const projectId = resolveProjectIdForMr(ctx.mr.project_id);
  const left = buildFileUri(projectId, path, ctx.diffRefs.base_sha);
  const right = buildFileUri(projectId, path, ctx.diffRefs.head_sha);
  const title = `${path} (MR !${ctx.mr.iid})`;
  await vscode.commands.executeCommand("vscode.diff", left, right, title, {
    preview: false,
    viewColumn: vscode.ViewColumn.Two,
  });
}
