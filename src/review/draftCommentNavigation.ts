import * as vscode from "vscode";
import { commentSideForDocument, matchMrFilePath, type LineCommentSide } from "./mrComments";
import type { ReviewSession } from "./reviewSession";
import {
  collapseDraft,
  expandDraft,
  getReviewDraftById,
  isDraftExpanded,
} from "./reviewDrafts";
import { VisualReviewPanel } from "../webview/visualReviewPanel";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function findMrEditorForSide(
  session: ReviewSession,
  filePath: string,
  side: LineCommentSide,
): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find((editor) => {
    const matched = matchMrFilePath(session, editor.document.uri);
    if (matched !== filePath) {
      return false;
    }
    return commentSideForDocument(editor.document.uri) === side;
  });
}

export async function revealMrLine(
  session: ReviewSession,
  filePath: string,
  line: number,
  side: LineCommentSide,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(50);
    const editor = findMrEditorForSide(session, filePath, side);
    if (!editor) {
      continue;
    }
    const lineIndex = Math.min(Math.max(line - 1, 0), Math.max(0, editor.document.lineCount - 1));
    const pos = new vscode.Position(lineIndex, 0);
    const range = new vscode.Range(pos, pos);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    await vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false,
      selection: range,
    });
    return;
  }
  void vscode.window.showWarningMessage(
    "Review Kit: não foi possível focar a linha. Abra o arquivo do MR no editor.",
  );
}

export async function navigateToQueuedComment(
  session: ReviewSession,
  draftId: string,
  openDiff: (session: ReviewSession, path: string) => Promise<void>,
  syncDraftThreads: () => void,
): Promise<void> {
  const draft = getReviewDraftById(draftId);
  if (!draft) {
    void vscode.window.showWarningMessage("Comentário não está mais na fila.");
    return;
  }
  expandDraft(draft.id);
  VisualReviewPanel.current?.setActivePath(draft.filePath);
  await openDiff(session, draft.filePath);
  await revealMrLine(session, draft.filePath, draft.line, draft.side);
  syncDraftThreads();
  VisualReviewPanel.current?.refresh();
}

export async function toggleQueuedCommentInDiff(
  session: ReviewSession,
  draftId: string,
  openDiff: (session: ReviewSession, path: string) => Promise<void>,
  syncDraftThreads: () => void,
): Promise<void> {
  const draft = getReviewDraftById(draftId);
  if (!draft) {
    return;
  }
  if (isDraftExpanded(draft.id)) {
    collapseDraft(draft.id);
    syncDraftThreads();
    VisualReviewPanel.current?.refresh();
    return;
  }
  await navigateToQueuedComment(session, draftId, openDiff, syncDraftThreads);
}
