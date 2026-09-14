import * as vscode from "vscode";
import type { GitLabClient } from "../gitlab/client";
import { GitLabApiError } from "../gitlab/client";
import type { ReviewSession } from "./reviewSession";
import {
  postGeneralMrComment,
  postLineThreadComment,
  resolveFilePathFromEditor,
  targetFromSession,
  commentSideForDocument,
  matchMrFilePath,
  type LineCommentSide,
  type MrCommentTarget,
} from "./mrComments";
import { VisualReviewPanel } from "../webview/visualReviewPanel";
import { getActiveGitLabProject, resolveProjectIdForMr } from "../gitlab/projectContext";
import type { MergeRequestSummary } from "../gitlab/types";
import {
  addReviewDraft,
  clearReviewDrafts,
  discardReviewDraftSession,
  getReviewDrafts,
  stopReviewDraftMode,
} from "./reviewDrafts";
import { requestMrDiscussionsRefresh } from "./mrDiscussionsRefresh";

export async function submitLineThreadDirect(
  client: GitLabClient,
  session: ReviewSession,
  filePath: string,
  line: number,
  body: string,
  side: LineCommentSide = "new",
): Promise<void> {
  const target = targetFromSession(session);
  const change = session.changeByPath.get(filePath);
  await postLineThreadComment(client, target, filePath, line, body, change, side);
  notifyThreadPosted(target.mr, filePath, line);
  requestMrDiscussionsRefresh(session);
}

export function beginReviewDraftSession(): void {
  VisualReviewPanel.current?.refresh();
}

export async function openLineCommentComposer(
  client: GitLabClient,
  session: ReviewSession,
  filePath: string,
  line: number,
  side: LineCommentSide = "new",
): Promise<void> {
  const fileName = filePath.split("/").pop() ?? filePath;
  const body = await vscode.window.showInputBox({
    title: `${fileName}:${line}`,
    placeHolder: "Comentário…",
    ignoreFocusOut: true,
    prompt: "Enter = próximo passo · Esc = cancelar",
  });
  if (!body?.trim()) {
    return;
  }
  const action = await vscode.window.showQuickPick(
    [
      { label: "$(save) Salvar na fila", pick: "save" as const },
      { label: "$(cloud-upload) Enviar agora", pick: "send" as const },
    ],
    { placeHolder: "Salvar ou enviar?", ignoreFocusOut: true },
  );
  if (!action) {
    return;
  }
  const text = body.trim();
  if (action.pick === "save") {
    addReviewDraft(filePath, line, side, text);
    VisualReviewPanel.current?.refresh();
    void vscode.window.setStatusBarMessage(`Fila: ${getReviewDrafts().length} comentário(s)`, 2500);
    return;
  }
  try {
    await submitLineThreadDirect(client, session, filePath, line, text, side);
  } catch (e) {
    void vscode.window.showErrorMessage(`Review Kit: ${commentErrorMessage(e)}`);
  }
}

export async function submitAllQueuedReviewComments(
  client: GitLabClient,
  session: ReviewSession,
): Promise<void> {
  const queued = [...getReviewDrafts()];
  if (queued.length === 0) {
    void vscode.window.showInformationMessage("Nenhum comentário na fila.");
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    `Enviar ${queued.length} comentário(s) para o GitLab?`,
    { modal: true },
    "Enviar todos",
  );
  if (choice !== "Enviar todos") {
    return;
  }
  const target = targetFromSession(session);
  let ok = 0;
  const errors: string[] = [];
  for (const draft of queued) {
    const change = session.changeByPath.get(draft.filePath);
    try {
      await postLineThreadComment(
        client,
        target,
        draft.filePath,
        draft.line,
        draft.body,
        change,
        draft.side,
      );
      ok++;
    } catch (e) {
      errors.push(`${draft.filePath}:${draft.line} — ${commentErrorMessage(e)}`);
    }
  }
  clearReviewDrafts();
  stopReviewDraftMode();
  VisualReviewPanel.current?.refresh();
  if (errors.length > 0) {
    void vscode.window.showErrorMessage(
      `Review Kit: ${ok}/${queued.length} enviados. Falhas:\n${errors.slice(0, 3).join("\n")}`,
    );
    return;
  }
  notifyPosted(session.mr, `${ok} comentário(s) publicados no MR`);
  requestMrDiscussionsRefresh(session);
}

export function cancelReviewDraftSession(): void {
  discardReviewDraftSession();
  VisualReviewPanel.current?.refresh();
  void vscode.window.setStatusBarMessage("Review Kit: fila de comentários descartada", 2500);
}

export async function promptAndPostLineThread(
  client: GitLabClient,
  session: ReviewSession,
  filePath: string,
  line: number,
  side: LineCommentSide = "new",
): Promise<void> {
  await openLineCommentComposer(client, session, filePath, line, side);
}

export async function commentNowOnLine(
  client: GitLabClient,
  session: ReviewSession,
  filePath: string,
  line: number,
  side: LineCommentSide = "new",
): Promise<void> {
  await openLineCommentComposer(client, session, filePath, line, side);
}

export async function promptAndPostMrComment(
  client: GitLabClient,
  target: MrCommentTarget,
): Promise<void> {
  const body = await vscode.window.showInputBox({
    title: `Nota geral no MR !${target.iid}`,
    placeHolder: "Comentário sem linha específica…",
    ignoreFocusOut: true,
    prompt: "Não cria thread no código — use “Thread na linha” para isso",
  });
  if (!body?.trim()) {
    return;
  }
  await postGeneralMrComment(client, target, body.trim());
  notifyPosted(target.mr, "Nota geral publicada");
}

export async function commentOnLineAt(
  client: GitLabClient,
  session: ReviewSession | undefined,
  line: number,
  side: LineCommentSide = "new",
  filePath?: string,
): Promise<void> {
  if (!session) {
    void vscode.window.showWarningMessage("Abra a revisão visual de um MR primeiro.");
    return;
  }
  const editor = vscode.window.activeTextEditor;
  const resolvedPath =
    filePath ??
    (editor ? matchMrFilePath(session, editor.document.uri) : undefined) ??
    VisualReviewPanel.current?.getActivePath();
  if (!resolvedPath) {
    void vscode.window.showWarningMessage(
      "Este arquivo não faz parte do MR ativo. Abra um arquivo alterado do MR no editor.",
    );
    return;
  }
  const resolvedSide = editor ? commentSideForDocument(editor.document.uri) : side;
  await promptAndPostLineThread(client, session, resolvedPath, line, resolvedSide);
}

export async function commentOnActiveEditorLine(
  client: GitLabClient,
  session: ReviewSession | undefined,
): Promise<void> {
  if (!session) {
    void vscode.window.showWarningMessage("Abra a revisão visual de um MR primeiro.");
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("Abra o arquivo do MR no editor e posicione o cursor na linha.");
    return;
  }
  const line = editor.selection.active.line + 1;
  const filePath = resolveFilePathFromEditor(session, undefined, editor.document.uri.toString());
  if (!filePath) {
    void vscode.window.showWarningMessage("Este arquivo não faz parte do MR ativo.");
    return;
  }
  const side = commentSideForDocument(editor.document.uri);
  await promptAndPostLineThread(client, session, filePath, line, side);
}

export async function commentMrFromActiveReview(
  client: GitLabClient,
  session: ReviewSession | undefined,
): Promise<void> {
  if (!session) {
    void vscode.window.showWarningMessage("Abra a revisão de um MR primeiro.");
    return;
  }
  await promptAndPostMrComment(client, targetFromSession(session));
}

export async function resolveCommentTarget(
  client: GitLabClient,
  activeSession: ReviewSession | undefined,
): Promise<MrCommentTarget | undefined> {
  if (activeSession) {
    return targetFromSession(activeSession);
  }
  const active = getActiveGitLabProject();
  if (!active) {
    void vscode.window.showWarningMessage("Carregue os MRs do projeto (refresh) ou abra a revisão visual.");
    return undefined;
  }
  const mrs = await client.listOpenMergeRequestsForProject(active.id);
  const pick = await vscode.window.showQuickPick(
    mrs.map((mr) => ({
      label: mr.references?.full ?? `!${mr.iid}`,
      description: mr.title,
      mr,
    })),
    { placeHolder: "MR para comentar" },
  );
  if (!pick) {
    return undefined;
  }
  const changes = await client.getMergeRequestChanges(
    resolveProjectIdForMr(pick.mr.project_id),
    pick.mr.iid,
  );
  return {
    projectId: resolveProjectIdForMr(pick.mr.project_id),
    iid: pick.mr.iid,
    mr: pick.mr,
    diffRefs: {
      base_sha: changes.diff_refs.base_sha,
      head_sha: changes.diff_refs.head_sha,
      start_sha: changes.diff_refs.start_sha,
    },
  };
}

function notifyThreadPosted(mr: MergeRequestSummary, filePath: string, line: number): void {
  notifyPosted(mr, `Thread aberta na linha ${line} · ${filePath.split("/").pop() ?? filePath}`);
}

export function notifyPosted(mr: MergeRequestSummary, message: string): void {
  const link = mr.web_url;
  void vscode.window
    .showInformationMessage(`GitLab: ${message} (${mr.references?.full ?? `!${mr.iid}`})`, "Abrir MR")
    .then((choice) => {
      if (choice === "Abrir MR" && link) {
        void vscode.env.openExternal(vscode.Uri.parse(link));
      }
    });
}

export function commentErrorMessage(error: unknown): string {
  if (error instanceof GitLabApiError) {
    return `GitLab HTTP ${error.status}: ${error.message}`;
  }
  return String(error);
}
