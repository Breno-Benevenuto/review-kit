import * as vscode from "vscode";
import {
  collapseDraft,
  expandDraft,
  getReviewDrafts,
  isDraftExpanded,
  type DraftComment,
} from "./reviewDrafts";
import { findMrEditorForSide } from "./draftCommentNavigation";
import type { ReviewSession } from "./reviewSession";

export class DraftCommentThreadController {
  private readonly controller: vscode.CommentController;
  private readonly threads = new Map<string, vscode.CommentThread>();
  private syncingCollapsibleState = false;

  constructor(
    context: vscode.ExtensionContext,
    private readonly getSession: () => ReviewSession | undefined,
  ) {
    this.controller = vscode.comments.createCommentController("reviewKit.draftQueue", "Review Kit — fila");
    this.controller.options = {
      prompt: "Comentário na fila (somente leitura até enviar)",
    };
    context.subscriptions.push(this.controller);

    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.sync()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.sync()),
    );
  }

  sync(): void {
    const session = this.getSession();
    const drafts = getReviewDrafts();
    const draftIds = new Set(drafts.map((d) => d.id));

    for (const [id, thread] of this.threads) {
      if (!draftIds.has(id)) {
        thread.dispose();
        this.threads.delete(id);
      }
    }

    if (!session || drafts.length === 0) {
      return;
    }

    for (const draft of drafts) {
      this.syncDraftThread(session, draft);
    }
  }

  disposeAll(): void {
    for (const thread of this.threads.values()) {
      thread.dispose();
    }
    this.threads.clear();
  }

  private syncDraftThread(session: ReviewSession, draft: DraftComment): void {
    const editor = findMrEditorForSide(session, draft.filePath, draft.side);
    if (!editor) {
      const existing = this.threads.get(draft.id);
      if (existing) {
        existing.dispose();
        this.threads.delete(draft.id);
      }
      return;
    }

    const lineIndex = Math.min(
      Math.max(draft.line - 1, 0),
      Math.max(0, editor.document.lineCount - 1),
    );
    const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
    const uri = editor.document.uri;
    const expanded = isDraftExpanded(draft.id);

    let thread = this.threads.get(draft.id);
    if (!thread) {
      thread = this.controller.createCommentThread(uri, range, [this.toComment(draft)]);
      thread.canReply = false;
      thread.collapsibleState = expanded
        ? vscode.CommentThreadCollapsibleState.Expanded
        : vscode.CommentThreadCollapsibleState.Collapsed;
      const draftId = draft.id;
      thread.onDidChangeCollapsibleState(() => {
        if (this.syncingCollapsibleState) {
          return;
        }
        const current = this.threads.get(draftId);
        if (!current) {
          return;
        }
        const isExpanded =
          current.collapsibleState === vscode.CommentThreadCollapsibleState.Expanded;
        if (isExpanded) {
          expandDraft(draftId);
        } else {
          collapseDraft(draftId);
        }
      });
      this.threads.set(draft.id, thread);
      return;
    }

    if (thread.uri.toString() !== uri.toString() || !thread.range || thread.range.start.line !== lineIndex) {
      thread.dispose();
      this.threads.delete(draft.id);
      this.syncDraftThread(session, draft);
      return;
    }

    thread.comments = [this.toComment(draft)];
    this.syncingCollapsibleState = true;
    try {
      thread.collapsibleState = expanded
        ? vscode.CommentThreadCollapsibleState.Expanded
        : vscode.CommentThreadCollapsibleState.Collapsed;
    } finally {
      this.syncingCollapsibleState = false;
    }
  }

  private toComment(draft: DraftComment): vscode.Comment {
    return {
      body: new vscode.MarkdownString(draft.body),
      mode: vscode.CommentMode.Preview,
      author: { name: "Fila (rascunho)" },
    };
  }
}

export function registerDraftCommentThreads(
  context: vscode.ExtensionContext,
  getSession: () => ReviewSession | undefined,
): DraftCommentThreadController {
  return new DraftCommentThreadController(context, getSession);
}
