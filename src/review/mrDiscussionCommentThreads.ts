import * as vscode from "vscode";
import type { MrDiscussionNoteView, MrDiscussionThreadView } from "../gitlab/types";
import {
  commentSideForDocument,
  matchMrFilePath,
  type LineCommentSide,
} from "./mrComments";
import { discussionMatchesFilePath } from "./mrDiscussionsPanel";
import { getMrDiscussionsCache } from "./mrDiscussionsCache";
import type { ReviewSession } from "./reviewSession";
import {
  queueInlineLineComment,
  replyToMrDiscussion,
  submitInlineLineComment,
} from "./commentCommands";
import type { GitLabClient } from "../gitlab/client";

const CONTROLLER_ID = "reviewKit.mrDiscussions";

type ThreadMeta =
  | { kind: "new"; filePath: string; line: number; side: LineCommentSide }
  | { kind: "gitlab"; discussionId: string; filePath: string; line: number; side: LineCommentSide };

export class MrDiscussionCommentThreadsController {
  private readonly controller: vscode.CommentController;
  private readonly threads = new Map<string, vscode.CommentThread>();
  private readonly meta = new WeakMap<vscode.CommentThread, ThreadMeta>();
  private lastClick: { key: string; at: number } | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getSession: () => ReviewSession | undefined,
    private readonly getClient: () => GitLabClient | undefined,
  ) {
    this.controller = vscode.comments.createCommentController(CONTROLLER_ID, "Review Kit — MR");
    this.controller.options = {
      prompt: "Comentário no MR",
      placeHolder: "Escreva um comentário…",
    };
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document) => {
        const session = this.getSession();
        if (!session || !matchMrFilePath(session, document.uri)) {
          return [];
        }
        const last = Math.max(0, document.lineCount - 1);
        return [new vscode.Range(0, 0, last, 0)];
      },
    };
    context.subscriptions.push(this.controller);

    context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse) {
          return;
        }
        this.handleEditorClick(e.textEditor);
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.syncVisibleEditors()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.syncVisibleEditors()),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("reviewKit.mrEditorCommentSend", (reply: vscode.CommentReply) => {
        void this.submitNewComment(reply, "send");
      }),
      vscode.commands.registerCommand("reviewKit.mrEditorCommentQueue", (reply: vscode.CommentReply) => {
        void this.submitNewComment(reply, "queue");
      }),
      vscode.commands.registerCommand("reviewKit.mrEditorCommentReply", (reply: vscode.CommentReply) => {
        void this.submitReply(reply);
      }),
    );
  }

  sync(session?: ReviewSession): void {
    const active = session ?? this.getSession();
    if (!active) {
      this.disposeAll();
      return;
    }
    this.syncVisibleEditors(active);
  }

  openAtLine(
    session: ReviewSession,
    editor: vscode.TextEditor,
    line: number,
    side: LineCommentSide,
  ): void {
    const filePath = matchMrFilePath(session, editor.document.uri);
    if (!filePath) {
      return;
    }
    const existing = this.findThreadAt(filePath, line, side);
    if (existing) {
      existing.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      return;
    }
    this.createNewThread(editor, filePath, line, side);
  }

  private handleEditorClick(editor: vscode.TextEditor): void {
    const session = this.getSession();
    if (!session) {
      return;
    }
    const filePath = matchMrFilePath(session, editor.document.uri);
    if (!filePath) {
      return;
    }
    const line = editor.selection.active.line + 1;
    const side = commentSideForDocument(editor.document.uri);
    const key = `${editor.document.uri.toString()}:${line}`;
    const now = Date.now();
    if (this.lastClick?.key === key && now - this.lastClick.at < 400) {
      this.lastClick = undefined;
      this.openAtLine(session, editor, line, side);
      return;
    }
    this.lastClick = { key, at: now };
    const thread = this.findThreadAt(filePath, line, side);
    if (thread) {
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    }
  }

  private syncVisibleEditors(session?: ReviewSession): void {
    const active = session ?? this.getSession();
    if (!active) {
      return;
    }
    const { threads: gitlabThreads } = getMrDiscussionsCache(active.mr);
    const wanted = new Set<string>();

    for (const editor of vscode.window.visibleTextEditors) {
      const filePath = matchMrFilePath(active, editor.document.uri);
      if (!filePath) {
        continue;
      }
      const side = commentSideForDocument(editor.document.uri);
      for (const discussion of gitlabThreads) {
        if (!discussionMatchesFilePath(discussion.anchorPath, filePath)) {
          continue;
        }
        if (discussion.anchorLine === undefined || discussion.anchorSide !== side) {
          continue;
        }
        const id = `gitlab:${discussion.id}`;
        wanted.add(id);
        this.upsertGitlabThread(editor, discussion, filePath, side, id);
      }
    }

    for (const [id, thread] of this.threads) {
      const meta = this.meta.get(thread);
      if (meta?.kind === "gitlab" && !wanted.has(id)) {
        thread.dispose();
        this.threads.delete(id);
      }
    }
  }

  private upsertGitlabThread(
    editor: vscode.TextEditor,
    discussion: MrDiscussionThreadView,
    filePath: string,
    side: LineCommentSide,
    id: string,
  ): void {
    const line = discussion.anchorLine!;
    const lineIndex = Math.min(Math.max(line - 1, 0), Math.max(0, editor.document.lineCount - 1));
    const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
    const uri = editor.document.uri;
    const comments = discussion.notes.map((n) => this.toGitlabComment(n));

    let thread = this.threads.get(id);
    if (!thread) {
      thread = this.controller.createCommentThread(uri, range, comments);
      thread.canReply = !discussion.resolved;
      thread.contextValue = discussion.resolved ? "gitlabResolved" : "gitlab";
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      if (discussion.resolved) {
        thread.label = "Resolvido";
        thread.state = vscode.CommentThreadState.Resolved;
      } else {
        thread.label = undefined;
        thread.state = vscode.CommentThreadState.Unresolved;
      }
      this.meta.set(thread, {
        kind: "gitlab",
        discussionId: discussion.id,
        filePath,
        line,
        side,
      });
      this.threads.set(id, thread);
      return;
    }

    if (thread.uri.toString() !== uri.toString() || thread.range?.start.line !== lineIndex) {
      thread.dispose();
      this.threads.delete(id);
      this.upsertGitlabThread(editor, discussion, filePath, side, id);
      return;
    }
    thread.comments = comments;
    thread.canReply = !discussion.resolved;
    thread.contextValue = discussion.resolved ? "gitlabResolved" : "gitlab";
    if (discussion.resolved) {
      thread.label = "Resolvido";
      thread.state = vscode.CommentThreadState.Resolved;
    } else {
      thread.label = undefined;
      thread.state = vscode.CommentThreadState.Unresolved;
    }
  }

  private createNewThread(
    editor: vscode.TextEditor,
    filePath: string,
    line: number,
    side: LineCommentSide,
  ): void {
    const id = `new:${filePath}:${side}:${line}`;
    const existing = this.threads.get(id);
    if (existing) {
      existing.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      return;
    }
    const lineIndex = Math.min(Math.max(line - 1, 0), Math.max(0, editor.document.lineCount - 1));
    const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
    const thread = this.controller.createCommentThread(editor.document.uri, range, []);
    thread.canReply = false;
    thread.contextValue = "newLine";
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    thread.label = "Novo comentário";
    this.meta.set(thread, { kind: "new", filePath, line, side });
    this.threads.set(id, thread);
  }

  private findThreadAt(
    filePath: string,
    line: number,
    side: LineCommentSide,
  ): vscode.CommentThread | undefined {
    const pendingId = `new:${filePath}:${side}:${line}`;
    const pending = this.threads.get(pendingId);
    if (pending) {
      return pending;
    }
    for (const [id, thread] of this.threads) {
      if (!id.startsWith("gitlab:")) {
        continue;
      }
      const m = this.meta.get(thread);
      if (m?.kind === "gitlab" && m.filePath === filePath && m.line === line && m.side === side) {
        return thread;
      }
    }
    return undefined;
  }

  private async submitNewComment(reply: vscode.CommentReply, action: "send" | "queue"): Promise<void> {
    const session = this.getSession();
    const client = this.getClient();
    const meta = this.meta.get(reply.thread);
    if (!session || !meta || meta.kind !== "new") {
      return;
    }
    const text = reply.text.trim();
    if (!text) {
      return;
    }
    if (action === "send" && !client) {
      void vscode.window.showWarningMessage("Configure o token GitLab primeiro.");
      return;
    }
    if (action === "send" && client) {
      await submitInlineLineComment(client, session, meta.filePath, meta.line, meta.side, text, "send");
    } else {
      await queueInlineLineComment(meta.filePath, meta.line, meta.side, text);
    }
    reply.thread.dispose();
    for (const [id, thread] of this.threads) {
      if (thread === reply.thread) {
        this.threads.delete(id);
        break;
      }
    }
  }

  private async submitReply(reply: vscode.CommentReply): Promise<void> {
    const session = this.getSession();
    const client = this.getClient();
    const meta = this.meta.get(reply.thread);
    if (!session || !client || !meta || meta.kind !== "gitlab") {
      return;
    }
    const text = reply.text.trim();
    if (!text) {
      return;
    }
    await replyToMrDiscussion(client, session, meta.discussionId, text);
  }

  private toGitlabComment(note: MrDiscussionNoteView): vscode.Comment {
    return {
      body: new vscode.MarkdownString(note.body),
      mode: vscode.CommentMode.Preview,
      author: { name: note.isCurrentUser ? "Você" : note.authorName },
      timestamp: new Date(note.createdAt),
    };
  }

  private disposeAll(): void {
    for (const thread of this.threads.values()) {
      thread.dispose();
    }
    this.threads.clear();
  }
}

export function registerMrDiscussionCommentThreads(
  context: vscode.ExtensionContext,
  getSession: () => ReviewSession | undefined,
  getClient: () => GitLabClient | undefined,
): MrDiscussionCommentThreadsController {
  return new MrDiscussionCommentThreadsController(context, getSession, getClient);
}
