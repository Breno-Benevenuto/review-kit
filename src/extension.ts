import * as vscode from "vscode";
import { GitLabApiError, GitLabClient, GitLabNetworkError } from "./gitlab/client";
import { resolveGitLabTlsInsecure } from "./gitlab/gitlabHttp";
import { effectivePath } from "./graph/flowGraph";
import { registerGitLabContentProvider } from "./providers/gitlabContentProvider";
import {
  mrKey,
  MrTreeProvider,
  openFileDiff,
  type MrTreeContext,
} from "./providers/mrTreeProvider";
import { ReviewProgressProvider } from "./review/reviewProgress";
import { createReviewSession, type ReviewSession } from "./review/reviewSession";
import { orderChanges, orderChangesAsync } from "./review/orderChanges";
import {
  getOutputChannel,
  gitlabBaseUrl,
  gitlabBaseUrlResolutionNote,
  refreshGitLabBaseUrl,
  resolveGitLabToken,
  readGitLabTokenFromEnvironment,
  TOKEN_KEY,
  type GitLabTokenSource,
} from "./gitlab/tokenResolve";
import { resolveWorkspaceGitLabProject } from "./gitlab/workspaceProject";
import {
  getActiveGitLabProject,
  resolveProjectIdForMr,
  setActiveGitLabProject,
} from "./gitlab/projectContext";
import { callMergeRequestApi, formatMrGitLabActionError } from "./gitlab/mrApiRoute";
import { VisualReviewPanel, type WebviewRequest } from "./webview/visualReviewPanel";
import type { MergeRequestChange, MergeRequestSummary } from "./gitlab/types";
import {
  cancelReviewDraftSession,
  commentErrorMessage,
  commentMrFromActiveReview,
  commentNowOnLine,
  commentOnActiveEditorLine,
  commentOnLineAt,
  openLineCommentComposer,
  promptAndPostLineThread,
  promptAndPostMrComment,
  replyToMrDiscussion,
  resolveCommentTarget,
  submitAllQueuedReviewComments,
  submitInlineLineComment,
} from "./review/commentCommands";
import { onReviewDraftsChanged } from "./review/reviewDrafts";
import { targetFromSession, commentSideForDocument, matchMrFilePath } from "./review/mrComments";
import { registerAutoLanguageOnOpen } from "./review/diffEditorEnhancer";
import { MrEditorReviewController } from "./review/mrEditorReview";
import { registerMrReviewInlayHints, type MrReviewInlayHintsProvider } from "./review/mrReviewInlayHints";
import {
  navigateToQueuedComment,
  revealMrLine,
  toggleQueuedCommentInDiff,
} from "./review/draftCommentNavigation";
import { fetchMrDiscussionThreads } from "./review/mrDiscussionsLoad";
import { setMrDiscussionsRefreshHandler } from "./review/mrDiscussionsRefresh";
import {
  registerDraftCommentThreads,
  type DraftCommentThreadController,
} from "./review/draftCommentThreads";
import {
  registerMrDiscussionCommentThreads,
  type MrDiscussionCommentThreadsController,
} from "./review/mrDiscussionCommentThreads";
import {
  clearMrDiscussionsCache,
  setMrDiscussionsCache,
} from "./review/mrDiscussionsCache";
import { registerMrReviewCodeLens, type MrReviewCodeLensProvider } from "./review/mrReviewCodeLens";
import { MrReviewStatusBar, resolveActiveReviewFilePath } from "./review/mrReviewStatusBar";
import { setMrEditorReviewController } from "./review/reviewEditorRef";
import { getCurrentGitBranch } from "./review/gitBranch";
import { reviewFilePosition, setDiffReviewOpen, stepReviewPath } from "./review/reviewFileNavigation";
import { clearRawFileCache } from "./review/rawFileCache";
import { collectChangedSymbolRefs } from "./review/changedSymbolRefs";
import { openFileForAnalysis } from "./review/openFileForAnalysis";
import { buildFlowGraphFromChanges } from "./graph/mrFlowDiagram";
import {
  isValidMergeRequestSummary,
  mergeRequestRef,
  normalizeMergeRequestSummary,
} from "./gitlab/normalizeMr";

const FILE_DOUBLE_CLICK_MS = 450;

let client: GitLabClient | undefined;
let output = getOutputChannel();
let activeSession: ReviewSession | undefined;
let mrEditorReview: MrEditorReviewController | undefined;
let mrReviewStatusBar: MrReviewStatusBar | undefined;
let mrReviewCodeLens: MrReviewCodeLensProvider | undefined;
let mrInlayHints: MrReviewInlayHintsProvider | undefined;
let draftCommentThreads: DraftCommentThreadController | undefined;
let mrDiscussionComments: MrDiscussionCommentThreadsController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const progress = new ReviewProgressProvider(context);
  mrEditorReview = new MrEditorReviewController(context);
  setMrEditorReviewController(mrEditorReview);
  mrInlayHints = registerMrReviewInlayHints(context, () => activeSession);
  draftCommentThreads = registerDraftCommentThreads(context, () => activeSession);
  mrDiscussionComments = registerMrDiscussionCommentThreads(
    context,
    () => activeSession,
    () => client,
  );
  setMrDiscussionsRefreshHandler((session) => {
    void refreshMrDiscussionsForSession(session);
  });
  mrReviewCodeLens = registerMrReviewCodeLens(
    context,
    () => activeSession,
    (session, path) => progress.isReviewed(session.mr, path),
  );
  mrReviewStatusBar = new MrReviewStatusBar(
    () => activeSession,
    (session, path) => progress.isReviewed(session.mr, path),
    () => mrReviewCodeLens?.refresh(),
  );
  mrReviewStatusBar.bind(context);
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
  registerAutoLanguageOnOpen(context);

  const mrTreeView = vscode.window.createTreeView("reviewKit.mrs", {
    treeDataProvider: mrTree,
    canSelectMany: false,
  });
  let lastTreeClick: { id: string; kind: "mr" | "file"; at: number } | undefined;
  mrTreeView.onDidChangeSelection((event) => {
    const item = event.selection[0];
    if (!item?.id) {
      return;
    }
    const now = Date.now();
    if (item.contextValue === "mr") {
      const mr = mrTree.getMr(item.id);
      if (!mr) {
        return;
      }
      if (
        lastTreeClick?.kind === "mr" &&
        lastTreeClick.id === item.id &&
        now - lastTreeClick.at <= FILE_DOUBLE_CLICK_MS
      ) {
        lastTreeClick = undefined;
        void startVisualReview(mr, progress, mrTree);
        return;
      }
      lastTreeClick = { id: item.id, kind: "mr", at: now };
      void prefetchMrChanges(mr, mrTree);
      return;
    }
    if (item.contextValue !== "changedFile") {
      return;
    }
    const ctx = mrTree.getFileContext(item);
    if (!ctx) {
      return;
    }
    if (
      lastTreeClick?.kind === "file" &&
      lastTreeClick.id === item.id &&
      now - lastTreeClick.at <= FILE_DOUBLE_CLICK_MS
    ) {
      lastTreeClick = undefined;
      void openMrFileDiff(ctx, progress, mrTree);
      return;
    }
    lastTreeClick = { id: item.id, kind: "file", at: now };
    void selectFileInReview(ctx, progress, mrTree);
  });

  context.subscriptions.push(
    mrTreeView,
    vscode.window.registerTreeDataProvider("reviewKit.reviewProgress", progress),
    vscode.commands.registerCommand("reviewKit.configureToken", () => configureToken(context, mrTree)),
    vscode.commands.registerCommand("reviewKit.refreshMrs", () => refreshMrs(mrTree)),
    vscode.commands.registerCommand("reviewKit.reloadGitLabToken", () => {
      void restoreClient(context, mrTree).then(() => {
        void refreshMrs(mrTree);
        void vscode.window.showInformationMessage("Review Kit: token GitLab recarregado.");
      });
    }),
    vscode.commands.registerCommand(
      "reviewKit.openVisualReview",
      async (arg?: string | MergeRequestSummary | vscode.TreeItem) => {
        const mr = await resolveMergeRequestForOpen(arg, mrTree, mrTreeView);
        if (!mr) {
          void vscode.window.showWarningMessage("Selecione um MR na árvore Review Kit.");
          return;
        }
        void startVisualReview(mr, progress, mrTree);
      },
    ),
    vscode.commands.registerCommand("reviewKit.openVisualReviewFile", (ctx: MrTreeContext) => {
      if (ctx.kind === "file") {
        void openMrFileDiff(ctx, progress, mrTree);
      }
    }),
    vscode.commands.registerCommand("reviewKit.openMrFileDiff", (ctx: MrTreeContext) => {
      if (ctx.kind === "file") {
        void openMrFileDiff(ctx, progress, mrTree);
      }
    }),
    vscode.commands.registerCommand("reviewKit.openFileDiff", (ctx: MrTreeContext) => {
      if (ctx.kind === "file" && activeSession) {
        void openDiffForPath(activeSession, effectivePath(ctx.change));
      }
    }),
    vscode.commands.registerCommand("reviewKit.toggleFileReviewed", (ctx: MrTreeContext) => {
      if (ctx.kind === "file") {
        progress.toggleReviewed(ctx.mr, effectivePath(ctx.change));
        mrTree.refresh();
        syncReviewedPanel(ctx.mr, progress);
      }
    }),
    vscode.commands.registerCommand("reviewKit.postComment", () => void postComment()),
    vscode.commands.registerCommand("reviewKit.commentOnLine", () => {
      const gitlab = client;
      if (!gitlab) {
        void vscode.window.showWarningMessage("Configure o token GitLab primeiro.");
        return;
      }
      void commentOnActiveEditorLine(gitlab, activeSession, (s, editor, line, side) => {
        mrDiscussionComments?.openAtLine(s, editor, line, side);
      });
    }),
    vscode.commands.registerCommand(
      "reviewKit.commentOnLineAt",
      (line?: number, side: "new" | "old" = "new", filePath?: string) => {
        const gitlab = client;
        if (!gitlab) {
          void vscode.window.showWarningMessage("Configure o token GitLab primeiro.");
          return;
        }
        const editor = vscode.window.activeTextEditor;
        const lineNum = line ?? (editor ? editor.selection.active.line + 1 : undefined);
        if (!lineNum) {
          void vscode.window.showWarningMessage("Posicione o cursor na linha do arquivo.");
          return;
        }
        if (activeSession && editor && mrDiscussionComments && matchMrFilePath(activeSession, editor.document.uri)) {
          mrDiscussionComments.openAtLine(activeSession, editor, lineNum, side);
          return;
        }
        void commentOnLineAt(gitlab, activeSession, lineNum, side, filePath);
      },
    ),
    vscode.commands.registerCommand("reviewKit.commentMrFromReview", () => {
      const gitlab = client;
      if (!gitlab) {
        void vscode.window.showWarningMessage("Configure o token GitLab primeiro.");
        return;
      }
      void commentMrFromActiveReview(gitlab, activeSession);
    }),
    vscode.commands.registerCommand("reviewKit.approveMr", () => approveMr(true)),
    vscode.commands.registerCommand("reviewKit.requestChanges", () => approveMr(false)),
    vscode.commands.registerCommand("reviewKit.reviewNextFile", () =>
      void stepReviewInSession(1, progress, mrTree),
    ),
    vscode.commands.registerCommand("reviewKit.reviewPrevFile", () =>
      void stepReviewInSession(-1, progress, mrTree),
    ),
    vscode.commands.registerCommand("reviewKit.startReview", () => {
      if (!activeSession || !client) {
        void vscode.window.showWarningMessage("Abra a revisão visual de um MR primeiro.");
        return;
      }
      void commentNowFromActiveEditor(client, activeSession);
    }),
    vscode.commands.registerCommand("reviewKit.commentNow", () => {
      const gitlab = client;
      if (!gitlab || !activeSession) {
        void vscode.window.showWarningMessage("Abra a revisão visual de um MR primeiro.");
        return;
      }
      void commentNowFromActiveEditor(gitlab, activeSession);
    }),
    vscode.commands.registerCommand("reviewKit.openCommentComposer", () => {
      const gitlab = client;
      if (!gitlab || !activeSession) {
        void vscode.window.showWarningMessage("Abra a revisão visual de um MR primeiro.");
        return;
      }
      void commentNowFromActiveEditor(gitlab, activeSession);
    }),
    vscode.commands.registerCommand("reviewKit.submitAllDrafts", () => {
      const gitlab = client;
      if (!gitlab || !activeSession) {
        void vscode.window.showWarningMessage("Abra a revisão visual de um MR primeiro.");
        return;
      }
      void submitAllQueuedReviewComments(gitlab, activeSession);
    }),
    vscode.commands.registerCommand("reviewKit.cancelReviewDrafts", () => {
      cancelReviewDraftSession();
      syncDraftCommentUi();
    }),
    vscode.commands.registerCommand("reviewKit.goToDraftComment", (draftId?: string) => {
      if (!activeSession || !draftId) {
        return;
      }
      void navigateToQueuedComment(activeSession, draftId, openReviewDiff, syncDraftCommentUi);
    }),
    vscode.commands.registerCommand("reviewKit.toggleDraftCommentInDiff", (draftId?: string) => {
      if (!activeSession || !draftId) {
        return;
      }
      void toggleQueuedCommentInDiff(activeSession, draftId, openReviewDiff, syncDraftCommentUi);
    }),
    vscode.commands.registerCommand("reviewKit.diffNextChange", () =>
      void vscode.commands.executeCommand("workbench.action.compareEditor.nextChange"),
    ),
    vscode.commands.registerCommand("reviewKit.diffPrevChange", () =>
      void vscode.commands.executeCommand("workbench.action.compareEditor.previousChange"),
    ),
    vscode.commands.registerCommand("reviewKit.toggleReviewedInDiff", () => {
      toggleReviewedForActiveFile(progress, mrTree);
    }),
    vscode.commands.registerCommand("reviewKit.markFileReviewed", () => {
      toggleReviewedForActiveFile(progress, mrTree);
    }),
    vscode.commands.registerCommand("reviewKit.unmarkFileReviewed", () => {
      toggleReviewedForActiveFile(progress, mrTree);
    }),
  );

  await restoreClient(context, mrTree);
  void refreshMrs(mrTree);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void refreshMrs(mrTree);
    }),
    onReviewDraftsChanged(() => {
      VisualReviewPanel.current?.refresh();
      syncDraftCommentUi();
    }),
  );
}

function syncDraftCommentUi(): void {
  draftCommentThreads?.sync();
  mrInlayHints?.refresh();
}

async function refreshMrDiscussionsForSession(session: ReviewSession): Promise<void> {
  const panel = VisualReviewPanel.current;
  if (!client) {
    return;
  }
  panel?.setDiscussionsLoading(true);
  try {
    const projectId = resolveProjectIdForMr(session.mr.project_id);
    const threads = await fetchMrDiscussionThreads(client, projectId, session.mr.iid);
    setMrDiscussionsCache(session.mr, threads);
    panel?.setDiscussions(threads);
    mrDiscussionComments?.sync(session);
    VisualReviewPanel.current?.refresh();
  } catch (e) {
    const msg = e instanceof GitLabApiError ? `HTTP ${e.status}: ${e.message}` : String(e);
    setMrDiscussionsCache(session.mr, [], msg);
    panel?.setDiscussions([], msg);
    mrDiscussionComments?.sync(session);
  }
}

export function deactivate(): void {
  client = undefined;
  activeSession = undefined;
  clearMrDiscussionsCache();
  setMrDiscussionsRefreshHandler(undefined);
  setMrEditorReviewController(undefined);
  mrEditorReview = undefined;
  mrDiscussionComments = undefined;
}

async function restoreClient(context: vscode.ExtensionContext, mrTree?: MrTreeProvider): Promise<void> {
  await refreshGitLabBaseUrl();
  const resolved = await resolveGitLabToken(context);
  const baseUrl = gitlabBaseUrl();
  if (resolved.token) {
    client = new GitLabClient(baseUrl, resolved.token);
    output.appendLine(`GitLab client ready (${baseUrl}) · token: ${describeTokenSource(resolved.source)} · TLS insecure: ${resolveGitLabTlsInsecure(baseUrl)}`);
    const urlNote = gitlabBaseUrlResolutionNote();
    if (urlNote) {
      output.appendLine(urlNote);
    }
    syncGitLabAuthUi(mrTree);
    return;
  }
  client = undefined;
  output.appendLine(
    "Sem token GitLab. Use Review Kit: Configure GitLab Token ou GITLAB_TOKEN em ~/.cursor/.env.cursor.",
  );
  syncGitLabAuthUi(mrTree);
}

function syncGitLabAuthUi(mrTree?: MrTreeProvider): void {
  void vscode.commands.executeCommand("setContext", "reviewKit.gitlabConnected", !!client);
  mrTree?.refresh();
}

function describeTokenSource(source: GitLabTokenSource): string {
  switch (source) {
    case "env":
      return "GITLAB_TOKEN (ambiente)";
    case "env-file":
      return "GITLAB_TOKEN (~/.cursor/.env.cursor)";
    case "pat":
      return "token salvo (Configure GitLab Token)";
    default:
      return "desconhecido";
  }
}

async function configureToken(context: vscode.ExtensionContext, mrTree: MrTreeProvider): Promise<void> {
  const token = await vscode.window.showInputBox({
    title: "GitLab access token",
    password: true,
    ignoreFocusOut: true,
    placeHolder: "Cole o token (GitLab → Settings → Access tokens)",
    prompt: "Escopos: read_api (+ escrita para comentários/approve). Instância: reviewKit.gitlabUrl",
  });
  if (!token?.trim()) {
    return;
  }
  const trimmed = token.trim();
  await refreshGitLabBaseUrl();
  const baseUrl = gitlabBaseUrl();
  const probe = new GitLabClient(baseUrl, trimmed);
  try {
    const { username } = await probe.validateToken();
    await context.secrets.store(TOKEN_KEY, trimmed);
    client = probe;
    syncGitLabAuthUi(mrTree);

    const preferEnv = vscode.workspace.getConfiguration("reviewKit").get<boolean>("preferGitLabTokenFromEnv", true);
    const fromEnv = readGitLabTokenFromEnvironment();
    if (preferEnv && fromEnv.token && fromEnv.token !== trimmed) {
      void vscode.window.showWarningMessage(
        "Review Kit: GITLAB_TOKEN no ambiente tem prioridade sobre o token salvo. " +
          "Desative reviewKit.preferGitLabTokenFromEnv ou remova GITLAB_TOKEN.",
      );
    }

    void vscode.window.showInformationMessage(`Review Kit: conectado como @${username} · ${baseUrl}`);
    void refreshMrs(mrTree);
  } catch (e) {
    const detail =
      e instanceof GitLabNetworkError
        ? e.message
        : e instanceof GitLabApiError
          ? `HTTP ${e.status} em ${baseUrl}/api/v4/user — confira token (escopo api), GITLAB_URL e reviewKit.gitlabUrl`
          : String(e);
    void vscode.window.showErrorMessage(`Review Kit: falha ao conectar (${detail})`);
  }
}

async function refreshMrs(mrTree: MrTreeProvider): Promise<void> {
  if (!client) {
    void vscode.window.showWarningMessage(
      "Review Kit: sem token GitLab. Veja Output → Review Kit ou use Configure GitLab Token.",
    );
    output.show(true);
    return;
  }
  const project = await resolveWorkspaceGitLabProject();
  if (!project) {
    mrTree.setMergeRequests([]);
    mrTree.setProjectHint("Abra a pasta do serviço (git origin) ou defina reviewKit.projectPath");
    output.appendLine("No GitLab project from workspace (origin remote or reviewKit.projectPath).");
    output.show(true);
    return;
  }
  try {
    const resolved = await client.resolveProject(project.path);
    setActiveGitLabProject(resolved);
    output.appendLine(
      `Project resolved: id=${resolved.id} path=${resolved.path_with_namespace} (from origin ${project.path})`,
    );
    const mrs = await client.listOpenMergeRequestsForProject(resolved.id);
    mrTree.setProjectHint(undefined);
    mrTree.setMergeRequests(mrs);
    output.appendLine(`Loaded ${mrs.length} open MR(s) for ${project.folderName}.`);
    if (mrs.length === 0) {
      void vscode.window.showInformationMessage(
        `Review Kit: nenhum MR aberto em ${project.folderName}.`,
      );
    }
  } catch (e) {
    const msg = e instanceof GitLabApiError ? `HTTP ${e.status}: ${e.message}` : String(e);
    output.appendLine(`MR load failed: ${msg}`);
    output.show(true);
    void vscode.window.showErrorMessage(`Review Kit: failed to load MRs (${msg})`);
  }
}

async function prefetchMrChanges(mr: MergeRequestSummary, mrTree: MrTreeProvider): Promise<void> {
  const gitlab = client;
  if (!gitlab || mrTree.getCachedChanges(mr)) {
    return;
  }
  try {
    const projectId = resolveProjectIdForMr(mr.project_id);
    const workspaceId = getActiveGitLabProject()?.id;
    const payload = await gitlab.getMergeRequestChangesWithFallback(projectId, mr.iid, workspaceId);
    mrTree.cacheChanges(
      mr,
      payload.changes,
      payload.diff_refs.base_sha,
      payload.diff_refs.head_sha,
      payload.diff_refs.start_sha,
    );
  } catch {
    /* prefetch is best-effort */
  }
}

function refineReviewOrderInBackground(
  mr: MergeRequestSummary,
  changes: MergeRequestChange[],
  progress: ReviewProgressProvider,
): void {
  void (async () => {
    try {
      const ordered = await orderChangesAsync(changes);
      if (!activeSession || mrKey(activeSession.mr) !== mrKey(mr)) {
        return;
      }
      const before = activeSession.cards.map((c) => c.path).join("\0");
      const after = ordered.map((c) => effectivePath(c)).join("\0");
      if (before === after) {
        return;
      }
      const activePath = VisualReviewPanel.current?.getActivePath();
      const newSession = createReviewSession(
        activeSession.mr,
        changes,
        activeSession.diffRefs,
        { description: activeSession.mrDescription, flowGraph: activeSession.flowGraph },
        ordered,
      );
      activeSession = newSession;
      mrEditorReview?.setSession(newSession);
      const reviewed = new Set(
        newSession.cards.filter((c) => progress.isReviewed(mr, c.path)).map((c) => c.path),
      );
      VisualReviewPanel.current?.updateSession(newSession, reviewed);
      if (activePath && newSession.changeByPath.has(activePath)) {
        VisualReviewPanel.current?.setActivePath(activePath);
      }
      mrReviewStatusBar?.refresh();
    } catch {
      /* keep import-based order */
    }
  })();
}

async function startVisualReview(
  mr: MergeRequestSummary,
  progress: ReviewProgressProvider,
  mrTree: MrTreeProvider,
  startPath?: string,
): Promise<void> {
  if (!client) {
    return;
  }
  mr = normalizeMergeRequestSummary(mr);
  if (!isValidMergeRequestSummary(mr)) {
    void vscode.window.showErrorMessage(
      "Review Kit: MR inválido (sem iid). Atualize a lista de MRs (refresh).",
    );
    return;
  }
  try {
    const projectId = resolveProjectIdForMr(mr.project_id);
    const workspaceId = getActiveGitLabProject()?.id;
    const cached = mrTree.getCachedChanges(mr);
    const changesPromise = cached
      ? Promise.resolve({
          changes: cached.changes,
          diff_refs: {
            base_sha: cached.base_sha,
            head_sha: cached.head_sha,
            start_sha: cached.start_sha,
          },
        })
      : client.getMergeRequestChangesWithFallback(projectId, mr.iid, workspaceId);
    const hasDescription = (mr.description ?? "").trim().length > 0;
    const mrDetailPromise = hasDescription
      ? Promise.resolve(null)
      : callMergeRequestApi(mr, (pid) => client!.getMergeRequest(pid, mr.iid)).catch(() => null);
    const [payload, fullMr] = await Promise.all([changesPromise, mrDetailPromise]);
    if (!cached) {
      mrTree.cacheChanges(
        mr,
        payload.changes,
        payload.diff_refs.base_sha,
        payload.diff_refs.head_sha,
        payload.diff_refs.start_sha,
      );
    }
    let description = (mr.description ?? "").trim();
    if (fullMr) {
      mr = normalizeMergeRequestSummary({ ...mr, ...fullMr });
      description = (fullMr.description ?? "").trim();
    }
    const orderedChanges = orderChanges(payload.changes);
    const flowGraph = buildFlowGraphFromChanges(orderedChanges);
    const session = createReviewSession(
      mr,
      payload.changes,
      {
        base_sha: payload.diff_refs.base_sha,
        head_sha: payload.diff_refs.head_sha,
        start_sha: payload.diff_refs.start_sha,
      },
      { description, flowGraph },
      orderedChanges,
    );
    activeSession = session;
    mrEditorReview?.setSession(session);
    mrInlayHints?.refresh();
    cancelReviewDraftSession();
    clearRawFileCache();
    clearMrDiscussionsCache();
    const highlightPath = startPath ?? session.cards[0]?.path;
    if (!highlightPath) {
      void vscode.window.showInformationMessage("MR sem arquivos para revisar.");
      return;
    }
    const reviewed = new Set(
      session.cards.filter((c) => progress.isReviewed(mr, c.path)).map((c) => c.path),
    );
    VisualReviewPanel.open(session, highlightPath, reviewed, (msg) => {
      const current = activeSession;
      if (current) {
        handleVisualReviewMessage(msg, current, progress, mrTree);
      }
    });
    void selectReviewFile(session, highlightPath);
    void refreshMrDiscussionsForSession(session);
    refineReviewOrderInBackground(mr, payload.changes, progress);
    mrReviewStatusBar?.refresh();
  } catch (e) {
    const msg = e instanceof GitLabApiError ? formatGitLabError(e, mr) : String(e);
    output.appendLine(`openVisualReview failed: ${msg}`);
    void vscode.window.showErrorMessage(`Review Kit: ${msg}`);
  }
}

function formatGitLabError(error: GitLabApiError, mr?: MergeRequestSummary): string {
  const ref = mr && isValidMergeRequestSummary(mr) ? mergeRequestRef(mr) : "MR";
  const path = error.apiPath ? ` · ${error.apiPath}` : "";
  if (error.status === 404) {
    return `HTTP 404 ao carregar ${ref}${path}. MR pode ser de outro projeto/fork — confira reviewKit.gitlabUrl e reviewKit.projectPath.`;
  }
  return `HTTP ${error.status}: ${error.message}${path}`;
}

async function ensureReviewSessionForMr(
  mr: MergeRequestSummary,
  progress: ReviewProgressProvider,
  mrTree: MrTreeProvider,
): Promise<ReviewSession | undefined> {
  if (activeSession && mrKey(activeSession.mr) === mrKey(mr)) {
    return activeSession;
  }
  await startVisualReview(mr, progress, mrTree);
  return activeSession;
}

async function selectFileInReview(
  ctx: Extract<MrTreeContext, { kind: "file" }>,
  progress: ReviewProgressProvider,
  mrTree: MrTreeProvider,
): Promise<void> {
  const session = await ensureReviewSessionForMr(ctx.mr, progress, mrTree);
  if (!session) {
    return;
  }
  const path = effectivePath(ctx.change);
  await selectReviewFile(session, path);
  mrReviewStatusBar?.refresh();
}

async function openMrFileDiff(
  ctx: Extract<MrTreeContext, { kind: "file" }>,
  progress: ReviewProgressProvider,
  mrTree: MrTreeProvider,
): Promise<void> {
  const session = await ensureReviewSessionForMr(ctx.mr, progress, mrTree);
  if (!session) {
    return;
  }
  const path = effectivePath(ctx.change);
  await openReviewFile(session, path);
  mrReviewStatusBar?.refresh();
}

function handleVisualReviewMessage(
  msg: WebviewRequest,
  session: ReviewSession,
  progress: ReviewProgressProvider,
  mrTree: MrTreeProvider,
): void {
  const panel = VisualReviewPanel.current;
  if (!panel) {
    return;
  }
  let active = panel.getActivePath();

  if (msg.type === "select" && msg.path) {
    active = msg.path;
    void selectReviewFile(session, active);
    mrReviewStatusBar?.refresh();
    return;
  }
  if (msg.type === "openFile" && msg.path) {
    void openReviewFile(session, msg.path);
    return;
  }
  if (msg.type === "openEditorDiff") {
    active = msg.path ?? active;
    void openEditorDiffForPath(session, active);
    return;
  }
  if (msg.type === "commentLineAt" && msg.path && msg.line) {
    const side = msg.side === "old" ? "old" : "new";
    const editor = vscode.window.activeTextEditor;
    if (editor && mrDiscussionComments) {
      mrDiscussionComments.openAtLine(session, editor, msg.line, side);
      return;
    }
    if (client) {
      void openLineCommentComposer(client, session, msg.path, msg.line, side);
    }
    return;
  }
  if (msg.type === "submitInlineComment" && msg.path && msg.line && msg.body) {
    if (client) {
      const side = msg.side === "old" ? "old" : "new";
      const action = msg.action === "queue" ? "queue" : "send";
      void submitInlineLineComment(client, session, msg.path, msg.line, side, msg.body, action);
    }
    return;
  }
  if (msg.type === "replyInlineComment" && msg.discussionId && msg.body) {
    if (client) {
      void replyToMrDiscussion(client, session, msg.discussionId, msg.body);
    }
    return;
  }
  if (msg.type === "prev") {
    active = stepReviewPath(session, active, -1);
  } else if (msg.type === "next") {
    active = stepReviewPath(session, active, 1);
  } else if (msg.type === "toggleReviewed") {
    progress.toggleReviewed(session.mr, active);
    mrTree.refresh();
    syncReviewedPanel(session.mr, progress);
    return;
  } else if (msg.type === "commentMr") {
    void submitMrCommentFromPanel(session);
    return;
  } else if (msg.type === "commentLine") {
    if (client) {
      void commentNowFromActiveEditor(client, session);
    }
    return;
  } else if (msg.type === "submitAllDrafts") {
    if (client) {
      void submitAllQueuedReviewComments(client, session);
    }
    return;
  } else if (msg.type === "cancelDrafts") {
    cancelReviewDraftSession();
    syncDraftCommentUi();
    return;
  } else if (msg.type === "goToDraft" && msg.id) {
    void navigateToQueuedComment(session, msg.id, openReviewDiff, syncDraftCommentUi);
    return;
  } else if (msg.type === "toggleDraft" && msg.id) {
    void toggleQueuedCommentInDiff(session, msg.id, openReviewDiff, syncDraftCommentUi);
    return;
  } else if (msg.type === "approveMr") {
    void approveMrForSession(session, true);
    return;
  } else if (msg.type === "rejectMr") {
    void approveMrForSession(session, false);
    return;
  } else if (msg.type === "refreshDiscussions") {
    void refreshMrDiscussionsForSession(session);
    return;
  } else if (msg.type === "goToThread" && msg.path && msg.line) {
    const side = msg.side === "old" ? "old" : "new";
    panel.setActivePath(msg.path);
    void (async () => {
      await openReviewFile(session, msg.path);
      await revealMrLine(session, msg.path, msg.line, side);
      const editor = vscode.window.activeTextEditor;
      if (editor && mrDiscussionComments) {
        mrDiscussionComments.openAtLine(session, editor, msg.line, side);
      }
    })();
    return;
  } else if (msg.type === "openExternalLink" && msg.href) {
    void vscode.env.openExternal(vscode.Uri.parse(msg.href));
    return;
  } else if (msg.type === "commentLineRemoved") {
    if (msg.oldLine) {
      void submitLineCommentFromPanel(session, msg.path ?? active, msg.oldLine, "old");
    }
    return;
  }

  void selectReviewFile(session, active);
}

async function stepReviewInSession(
  delta: number,
  progress: ReviewProgressProvider,
  mrTree: MrTreeProvider,
): Promise<void> {
  if (!activeSession) {
    void vscode.window.showWarningMessage("Abra a revisão visual de um MR primeiro.");
    return;
  }
  const panel = VisualReviewPanel.current;
  const current = panel?.getActivePath() ?? mrEditorReview?.getActiveFilePath() ?? activeSession.cards[0]?.path;
  if (!current) {
    return;
  }
  const next = stepReviewPath(activeSession, current, delta);
  if (next === current && delta !== 0) {
    return;
  }
  await selectReviewFile(activeSession, next);
  const { index, total } = reviewFilePosition(activeSession, next);
  void vscode.window.setStatusBarMessage(`Review Kit: diff ${index}/${total}`, 2000);
}

async function selectReviewFile(session: ReviewSession, path: string): Promise<void> {
  const change = session.changeByPath.get(path);
  if (change) {
    mrEditorReview?.focusFile(path, change.diff ?? "");
  }
  VisualReviewPanel.current?.setActivePath(path);
  VisualReviewPanel.current?.setSymbolRefs([]);
  VisualReviewPanel.current?.refresh();
  mrReviewStatusBar?.refresh();
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    VisualReviewPanel.current?.setOnSourceBranch(false);
    return;
  }
  void getCurrentGitBranch(folder.uri.fsPath).then((branch) => {
    if (VisualReviewPanel.current?.getSession() !== session) {
      return;
    }
    VisualReviewPanel.current?.setOnSourceBranch(branch === session.mr.source_branch);
  });
}

async function openReviewFile(session: ReviewSession, path: string): Promise<void> {
  await selectReviewFile(session, path);
  const change = session.changeByPath.get(path);
  if (!change || !client) {
    return;
  }
  const ctx: MrTreeContext = {
    kind: "file",
    mr: session.mr,
    change,
    diffRefs: session.diffRefs,
  };
  const headUri = await openFileForAnalysis(client, session, ctx, mrEditorReview);
  setDiffReviewOpen(true);
  mrEditorReview?.syncFromActiveEditor();
  mrReviewStatusBar?.refresh();
  mrInlayHints?.refresh();
  syncDraftCommentUi();
  void refreshSymbolRefsForPath(session, path, headUri);
  mrDiscussionComments?.sync(session);
  const { label } = reviewFilePosition(session, path);
  void vscode.window.setStatusBarMessage(
    `Review Kit: ${label} · duplo clique na linha para comentar`,
    2500,
  );
}

async function openReviewDiff(session: ReviewSession, path: string): Promise<void> {
  await openReviewFile(session, path);
}

async function openEditorDiffForPath(session: ReviewSession, path: string): Promise<void> {
  await selectReviewFile(session, path);
  await openDiffForPath(session, path);
  setDiffReviewOpen(true);
  mrEditorReview?.syncFromActiveEditor();
  mrReviewStatusBar?.refresh();
  mrInlayHints?.refresh();
  syncDraftCommentUi();
  const { label } = reviewFilePosition(session, path);
  void vscode.window.setStatusBarMessage(`Review Kit: diff no editor · ${label}`, 2500);
}

async function refreshSymbolRefsForPath(
  session: ReviewSession,
  path: string,
  headUri?: vscode.Uri,
): Promise<void> {
  const panel = VisualReviewPanel.current;
  if (!panel) {
    return;
  }
  panel.setSymbolRefsLoading(true);
  const change = session.changeByPath.get(path);
  if (!change?.diff || !headUri) {
    panel.setSymbolRefs([]);
    return;
  }
  try {
    const doc =
      vscode.workspace.textDocuments.find((d) => d.uri.toString() === headUri.toString()) ??
      (await vscode.workspace.openTextDocument(headUri));
    const refs = await collectChangedSymbolRefs(doc, change.diff);
    panel.setSymbolRefs(refs);
  } catch {
    panel.setSymbolRefs([]);
  }
}

async function openDiffForPath(session: ReviewSession, path: string): Promise<void> {
  const change = session.changeByPath.get(path);
  if (!change || !client) {
    return;
  }
  const ctx: MrTreeContext = {
    kind: "file",
    mr: session.mr,
    change,
    diffRefs: session.diffRefs,
  };
  await openFileDiff(client, ctx, session);
  setDiffReviewOpen(true);
  mrEditorReview?.syncFromActiveEditor();
  mrReviewStatusBar?.refresh();
}

function toggleReviewedForActiveFile(
  progress: ReviewProgressProvider,
  mrTree: MrTreeProvider,
): void {
  if (!activeSession) {
    void vscode.window.showWarningMessage("Abra a revisão visual de um MR primeiro.");
    return;
  }
  const path = resolveActiveReviewFilePath(activeSession);
  if (!path) {
    void vscode.window.showWarningMessage(
      "Foque o arquivo do MR no editor (duplo clique na fila) ou selecione-o na fila.",
    );
    return;
  }
  const reviewed = progress.toggleReviewed(activeSession.mr, path);
  mrTree.refresh();
  syncReviewedPanel(activeSession.mr, progress);
  mrReviewStatusBar?.refresh();
  const name = path.split("/").pop() ?? path;
  void vscode.window.setStatusBarMessage(
    reviewed ? `Review Kit: ${name} marcado como revisado` : `Review Kit: ${name} desmarcado`,
    3000,
  );
}

function syncReviewedPanel(mr: MergeRequestSummary, progress: ReviewProgressProvider): void {
  const panel = VisualReviewPanel.current;
  const session = activeSession;
  if (!panel || !session || mrKey(mr) !== mrKey(session.mr)) {
    return;
  }
  const reviewed = new Set(session.cards.filter((c) => progress.isReviewed(mr, c.path)).map((c) => c.path));
  panel.setReviewed(reviewed);
}

async function postComment(): Promise<void> {
  if (!client) {
    return;
  }
  try {
    const target = await resolveCommentTarget(client, activeSession);
    if (!target) {
      return;
    }
    await promptAndPostMrComment(client, target);
  } catch (e) {
    void vscode.window.showErrorMessage(`Review Kit: ${commentErrorMessage(e)}`);
  }
}

async function submitMrCommentFromPanel(session: ReviewSession): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await promptAndPostMrComment(client, targetFromSession(session));
  } catch (e) {
    void vscode.window.showErrorMessage(`Review Kit: ${commentErrorMessage(e)}`);
  }
}

async function submitLineCommentFromPanel(
  session: ReviewSession,
  filePath: string,
  line: number,
  side: "new" | "old" = "new",
): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await promptAndPostLineThread(client, session, filePath, line, side);
  } catch (e) {
    void vscode.window.showErrorMessage(`Review Kit: ${commentErrorMessage(e)}`);
  }
}

async function commentNowFromActiveEditor(
  gitlab: GitLabClient,
  session: ReviewSession,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const panelPath = VisualReviewPanel.current?.getActivePath();
  const filePath =
    (editor ? matchMrFilePath(session, editor.document.uri) : undefined) ?? panelPath;
  if (!filePath) {
    void vscode.window.showWarningMessage("Abra o diff ou o arquivo do MR no editor.");
    return;
  }
  const line = editor ? editor.selection.active.line + 1 : 1;
  const side = editor ? commentSideForDocument(editor.document.uri) : "new";
  if (editor && mrDiscussionComments && matchMrFilePath(session, editor.document.uri)) {
    mrDiscussionComments.openAtLine(session, editor, line, side);
    return;
  }
  try {
    await commentNowOnLine(gitlab, session, filePath, line, side);
  } catch (e) {
    void vscode.window.showErrorMessage(`Review Kit: ${commentErrorMessage(e)}`);
  }
}

async function approveMr(approve: boolean): Promise<void> {
  if (activeSession && VisualReviewPanel.current) {
    await approveMrForSession(activeSession, approve);
    return;
  }
  if (!client) {
    return;
  }
  const mr = await pickOpenMergeRequest();
  if (!mr) {
    return;
  }
  try {
    await runMrApprovalAction(mr, mergeRequestRef(mr), approve);
  } catch (e) {
    void vscode.window.showErrorMessage(`Review Kit: ${formatMrGitLabActionError(e)}`);
  }
}

async function approveMrForSession(session: ReviewSession, approve: boolean): Promise<void> {
  if (!client) {
    void vscode.window.showWarningMessage("Configure o token GitLab primeiro.");
    return;
  }
  const ref = mergeRequestRef(session.mr);
  try {
    await runMrApprovalAction(session.mr, ref, approve);
  } catch (e) {
    void vscode.window.showErrorMessage(`Review Kit: ${formatMrGitLabActionError(e)}`);
  }
}

async function runMrApprovalAction(
  mr: MergeRequestSummary,
  refLabel: string,
  approve: boolean,
): Promise<void> {
  if (!client) {
    return;
  }
  if (approve) {
    const confirm = await vscode.window.showWarningMessage(
      `Aprovar ${refLabel} no GitLab?`,
      { modal: true },
      "Aprovar",
    );
    if (confirm !== "Aprovar") {
      return;
    }
    await callMergeRequestApi(mr, (projectId) => client!.approveMr(projectId, mr.iid));
    void vscode.window.showInformationMessage(`Review Kit: ${refLabel} aprovado no GitLab.`);
    return;
  }
  const body = await vscode.window.showInputBox({
    title: `Rejeitar MR — ${refLabel}`,
    prompt: "Motivo (publicado como nota no MR; remove sua aprovação se existir)",
    ignoreFocusOut: true,
  });
  if (body === undefined) {
    return;
  }
  await callMergeRequestApi(mr, async (projectId) => {
    try {
      await client!.unapproveMr(projectId, mr.iid);
    } catch (e) {
      if (!(e instanceof GitLabApiError && e.status === 404)) {
        throw e;
      }
    }
  });
  const trimmed = body.trim();
  if (trimmed) {
    await callMergeRequestApi(mr, (projectId) =>
      client!.createMrNote(projectId, mr.iid, `**Mudanças solicitadas:** ${trimmed}`),
    );
  }
  void vscode.window.showInformationMessage(
    trimmed
      ? `Review Kit: ${refLabel} — aprovação removida e nota publicada.`
      : `Review Kit: ${refLabel} — aprovação removida (ou você ainda não tinha aprovado).`,
  );
}

async function pickOpenMergeRequest(): Promise<MergeRequestSummary | undefined> {
  if (!client) {
    return undefined;
  }
  const active = getActiveGitLabProject();
  if (!active) {
    return undefined;
  }
  const mrs = await client.listOpenMergeRequestsForProject(active.id);
  const pick = await vscode.window.showQuickPick(
    mrs.map((mr) => ({
      label: mr.references?.full ?? `!${mr.iid}`,
      description: mr.title,
      mr,
    })),
    { placeHolder: "Selecione o merge request" },
  );
  return pick?.mr;
}

function mrFromTreeItem(
  item: vscode.TreeItem,
  mrTree: MrTreeProvider,
): MergeRequestSummary | undefined {
  const ctx = mrTree.getMrContext(item);
  if (ctx) {
    return ctx.mr;
  }
  if (item.contextValue === "mr" && item.id) {
    return mrTree.getMr(item.id);
  }
  return undefined;
}

function resolveMergeRequestForCommand(
  arg: string | MergeRequestSummary | vscode.TreeItem | undefined,
  mrTree: MrTreeProvider,
  treeView: vscode.TreeView<vscode.TreeItem>,
): MergeRequestSummary | undefined {
  if (typeof arg === "string") {
    return mrTree.getMr(arg);
  }
  if (arg && typeof arg === "object" && "contextValue" in arg) {
    const fromItem = mrFromTreeItem(arg as vscode.TreeItem, mrTree);
    if (fromItem) {
      return fromItem;
    }
  }
  if (isValidMergeRequestSummary(arg as MergeRequestSummary | undefined)) {
    return arg as MergeRequestSummary;
  }
  if (arg && typeof arg === "object" && !("contextValue" in arg)) {
    const normalized = normalizeMergeRequestSummary(arg as MergeRequestSummary);
    if (isValidMergeRequestSummary(normalized)) {
      return normalized;
    }
  }
  const selected = treeView.selection[0];
  if (selected) {
    const fromSelection = mrFromTreeItem(selected, mrTree);
    if (fromSelection) {
      return fromSelection;
    }
  }
  if (activeSession && isValidMergeRequestSummary(activeSession.mr)) {
    return activeSession.mr;
  }
  return undefined;
}

async function resolveMergeRequestForOpen(
  arg: string | MergeRequestSummary | vscode.TreeItem | undefined,
  mrTree: MrTreeProvider,
  treeView: vscode.TreeView<vscode.TreeItem>,
): Promise<MergeRequestSummary | undefined> {
  const direct = resolveMergeRequestForCommand(arg, mrTree, treeView);
  if (direct) {
    return direct;
  }
  const cached = mrTree.listOpenMrs();
  if (cached.length === 1) {
    return cached[0];
  }
  if (cached.length > 1) {
    const pick = await vscode.window.showQuickPick(
      cached.map((mr) => ({
        label: mr.references?.full ?? `!${mr.iid}`,
        description: mr.title,
        mr,
      })),
      { placeHolder: "Selecione o merge request" },
    );
    return pick?.mr;
  }
  return pickOpenMergeRequest();
}
