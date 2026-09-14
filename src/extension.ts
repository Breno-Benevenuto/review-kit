import * as vscode from "vscode";
import { GitLabApiError, GitLabClient } from "./gitlab/client";
import { buildFlowGraph, effectivePath, summarizeDiff } from "./graph/flowGraph";
import { registerGitLabContentProvider } from "./providers/gitlabContentProvider";
import {
  mrKey,
  MrTreeProvider,
  openFileDiff,
  type MrTreeContext,
} from "./providers/mrTreeProvider";
import { ReviewProgressProvider } from "./review/reviewProgress";
import { FileContextPanel } from "./webview/fileContextPanel";
import { FlowGraphPanel } from "./webview/flowGraphPanel";
import type { MergeRequestSummary } from "./gitlab/types";

const TOKEN_KEY = "reviewKit.gitlabToken";

let client: GitLabClient | undefined;
let activeGraphPaths = new Map<string, string>();
let lastGraphOrder: string[] = [];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const progress = new ReviewProgressProvider(context);
  const mrTree = new MrTreeProvider(
    () => client,
    (mrKeyStr, path) => {
      const [projectId, iid] = mrKeyStr.split(":");
      return progress.isReviewed(
        { project_id: Number(projectId), iid: Number(iid) } as MergeRequestSummary,
        path,
      );
    },
  );

  registerGitLabContentProvider(context, () => client);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("reviewKit.mrs", mrTree),
    vscode.window.registerTreeDataProvider("reviewKit.reviewProgress", progress),
    vscode.commands.registerCommand("reviewKit.configureToken", () => configureToken(context)),
    vscode.commands.registerCommand("reviewKit.refreshMrs", () => refreshMrs(mrTree)),
    vscode.commands.registerCommand("reviewKit.openFileDiff", (ctx: MrTreeContext) =>
      handleOpenFileDiff(ctx, progress),
    ),
    vscode.commands.registerCommand("reviewKit.openFileFromGraph", (path: string) => {
      void openFromGraphPath(path);
    }),
    vscode.commands.registerCommand("reviewKit.openFlowGraph", (item: vscode.TreeItem) => {
      const mr = item?.id ? mrTree.getMr(item.id) : undefined;
      if (mr) {
        void openFlowGraph(context, mr);
      }
    }),
    vscode.commands.registerCommand("reviewKit.toggleFileReviewed", (ctx: MrTreeContext) => {
      if (ctx.kind === "file") {
        progress.toggleReviewed(ctx.mr, effectivePath(ctx.change));
        mrTree.refresh();
      }
    }),
    vscode.commands.registerCommand("reviewKit.postComment", () => postComment()),
    vscode.commands.registerCommand("reviewKit.approveMr", () => approveMr(true)),
    vscode.commands.registerCommand("reviewKit.requestChanges", () => approveMr(false)),
  );

  await restoreClient(context);
}

export function deactivate(): void {
  client = undefined;
}

async function restoreClient(context: vscode.ExtensionContext): Promise<void> {
  const token = await context.secrets.get(TOKEN_KEY);
  const baseUrl = vscode.workspace.getConfiguration("reviewKit").get<string>("gitlabUrl") ?? "https://gitlab.com";
  if (token) {
    client = new GitLabClient(baseUrl, token);
  }
}

async function configureToken(context: vscode.ExtensionContext): Promise<void> {
  const token = await vscode.window.showInputBox({
    title: "GitLab Personal Access Token",
    password: true,
    ignoreFocusOut: true,
    placeHolder: "glpat-…",
    prompt: "Token needs read_api and write_repository for comments/approve",
  });
  if (!token) {
    return;
  }
  const baseUrl = vscode.workspace.getConfiguration("reviewKit").get<string>("gitlabUrl") ?? "https://gitlab.com";
  const probe = new GitLabClient(baseUrl, token);
  try {
    const { username } = await probe.validateToken();
    await context.secrets.store(TOKEN_KEY, token);
    client = probe;
    void vscode.window.showInformationMessage(`Review Kit connected as @${username}`);
  } catch (e) {
    const msg = e instanceof GitLabApiError ? `GitLab error ${e.status}` : String(e);
    void vscode.window.showErrorMessage(`Review Kit: invalid token or URL (${msg})`);
  }
}

async function refreshMrs(mrTree: MrTreeProvider): Promise<void> {
  if (!client) {
    void vscode.window.showWarningMessage("Review Kit: configure GitLab token first");
    return;
  }
  try {
    const mrs = await client.listOpenMergeRequests();
    mrTree.setMergeRequests(mrs);
  } catch (e) {
    void vscode.window.showErrorMessage(`Review Kit: failed to load MRs (${String(e)})`);
  }
}

async function handleOpenFileDiff(
  ctx: MrTreeContext,
  progress: ReviewProgressProvider,
): Promise<void> {
  if (ctx.kind !== "file") {
    return;
  }
  await openFileDiff(ctx);
  FlowGraphPanel.current?.highlightPath(effectivePath(ctx.change));
  const panel = FileContextPanel.show();
  const order = lastGraphOrder.length > 0 ? lastGraphOrder : [effectivePath(ctx.change)];
  panel.update(effectivePath(ctx.change), summarizeDiff(ctx.change), order);
  const reviewed = progress.countReviewed(ctx.mr);
  void vscode.window.setStatusBarMessage(
    `Review Kit: ${reviewed} file(s) marked reviewed for !${ctx.mr.iid}`,
    4000,
  );
}

async function openFlowGraph(context: vscode.ExtensionContext, mr: MergeRequestSummary): Promise<void> {
  if (!client) {
    return;
  }
  const payload = await client.getMergeRequestChanges(mr.project_id, mr.iid);
  const readFile = (path: string) => client!.getFileRaw(mr.project_id, path, payload.diff_refs.head_sha);
  const graph = await buildFlowGraph(payload.changes, readFile);
  lastGraphOrder = graph.suggestedOrder;
  for (const node of graph.nodes) {
    activeGraphPaths.set(node.path, mrKey(mr));
  }
  FlowGraphPanel.show(context.extensionUri, graph, `MR !${mr.iid} flow`);
}

async function openFromGraphPath(path: string): Promise<void> {
  const mrKeyStr = activeGraphPaths.get(path);
  if (!mrKeyStr || !client) {
    return;
  }
  const [projectId, iid] = mrKeyStr.split(":").map(Number);
  const payload = await client.getMergeRequestChanges(projectId, iid);
  const change = payload.changes.find((c) => effectivePath(c) === path);
  if (!change) {
    return;
  }
  const ctx: MrTreeContext = {
    kind: "file",
    mr: { project_id: projectId, iid } as MergeRequestSummary,
    change,
    diffRefs: { base_sha: payload.diff_refs.base_sha, head_sha: payload.diff_refs.head_sha },
  };
  await vscode.commands.executeCommand("reviewKit.openFileDiff", ctx);
}

async function postComment(): Promise<void> {
  if (!client) {
    return;
  }
  const mrRef = await pickMrRef();
  if (!mrRef) {
    return;
  }
  const body = await vscode.window.showInputBox({
    title: "Comment on merge request",
    placeHolder: "Review note…",
    ignoreFocusOut: true,
  });
  if (!body) {
    return;
  }
  await client.createMrNote(mrRef.projectId, mrRef.iid, body);
  void vscode.window.showInformationMessage("Comment posted to GitLab");
}

async function approveMr(approve: boolean): Promise<void> {
  if (!client) {
    return;
  }
  const mrRef = await pickMrRef();
  if (!mrRef) {
    return;
  }
  if (approve) {
    await client.approveMr(mrRef.projectId, mrRef.iid);
    void vscode.window.showInformationMessage("MR approved on GitLab");
  } else {
    await client.unapproveMr(mrRef.projectId, mrRef.iid);
    const body = await vscode.window.showInputBox({
      title: "Request changes (posted as MR note)",
      prompt: "Describe required changes",
      ignoreFocusOut: true,
    });
    if (body) {
      await client.createMrNote(mrRef.projectId, mrRef.iid, `**Changes requested:** ${body}`);
    }
    void vscode.window.showInformationMessage("Approval removed; note posted if provided");
  }
}

async function pickMrRef(): Promise<{ projectId: number; iid: number; label: string } | undefined> {
  if (!client) {
    return undefined;
  }
  const mrs = await client.listOpenMergeRequests();
  const pick = await vscode.window.showQuickPick(
    mrs.map((mr) => ({
      label: mr.references.full,
      description: mr.title,
      projectId: mr.project_id,
      iid: mr.iid,
    })),
    { placeHolder: "Select merge request" },
  );
  return pick;
}
