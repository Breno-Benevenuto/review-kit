import * as vscode from "vscode";
import type { ReviewSession } from "./reviewSession";
import { matchMrFilePath } from "./mrComments";
import { reviewFilePosition } from "./reviewFileNavigation";
import { VisualReviewPanel } from "../webview/visualReviewPanel";

export class MrReviewStatusBar implements vscode.Disposable {
  private readonly prevItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private readonly positionItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  private readonly nextItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  private readonly reviewedItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 88);
  private readonly noteItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 89);

  constructor(
    private readonly getSession: () => ReviewSession | undefined,
    private readonly isPathReviewed: (session: ReviewSession, path: string) => boolean,
    private readonly onAfterRefresh?: () => void,
  ) {
    this.prevItem.command = "reviewKit.reviewPrevFile";
    this.nextItem.command = "reviewKit.reviewNextFile";
    this.reviewedItem.command = "reviewKit.toggleReviewedInDiff";
    this.noteItem.command = "reviewKit.commentMrFromReview";
  }

  bind(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      this.prevItem,
      this.positionItem,
      this.nextItem,
      this.reviewedItem,
      this.noteItem,
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.window.onDidChangeTextEditorSelection(() => this.refresh()),
    );
    this.refresh();
  }

  refresh(): void {
    const session = this.getSession();
    if (!session) {
      this.hideAll();
      void vscode.commands.executeCommand("setContext", "reviewKit.mrReviewActive", false);
      void vscode.commands.executeCommand("setContext", "reviewKit.diffReviewOpen", false);
      return;
    }

    const filePath = resolveActiveReviewFilePath(session);
    if (!filePath) {
      this.hideAll();
      void vscode.commands.executeCommand("setContext", "reviewKit.mrReviewActive", false);
      return;
    }

    void vscode.commands.executeCommand("setContext", "reviewKit.mrReviewActive", true);
    const { index, total, label } = reviewFilePosition(session, filePath);
    const atStart = index <= 1;
    const atEnd = index >= total;

    this.prevItem.text = "$(chevron-left) Anterior";
    this.prevItem.tooltip = "Arquivo anterior no MR (Alt+←)";
    this.prevItem.command = atStart ? undefined : "reviewKit.reviewPrevFile";
    this.prevItem.show();

    this.positionItem.text = `$(git-compare) ${label}`;
    this.positionItem.tooltip = "Navegação pelo diff do MR";
    this.positionItem.show();

    this.nextItem.text = "Próximo $(chevron-right)";
    this.nextItem.tooltip = "Próximo arquivo no MR (Alt+→)";
    this.nextItem.command = atEnd ? undefined : "reviewKit.reviewNextFile";
    this.nextItem.show();

    const reviewed = this.isPathReviewed(session, filePath);
    void vscode.commands.executeCommand("setContext", "reviewKit.activeFileReviewed", reviewed);
    this.reviewedItem.text = reviewed
      ? "$(check) Revisado"
      : "$(circle-outline) Marcar revisado";
    this.reviewedItem.tooltip = reviewed ? "Desmarcar revisado" : "Marcar arquivo revisado (Alt+Enter)";
    this.reviewedItem.show();

    const ref = session.mr.references?.full ?? `!${session.mr.iid}`;
    this.noteItem.text = `$(note) ${ref}`;
    this.noteItem.tooltip = "Nota geral no MR";
    this.noteItem.show();
    this.onAfterRefresh?.();
  }

  private hideAll(): void {
    void vscode.commands.executeCommand("setContext", "reviewKit.activeFileReviewed", false);
    this.prevItem.hide();
    this.positionItem.hide();
    this.nextItem.hide();
    this.reviewedItem.hide();
    this.noteItem.hide();
  }

  dispose(): void {
    this.prevItem.dispose();
    this.positionItem.dispose();
    this.nextItem.dispose();
    this.reviewedItem.dispose();
    this.noteItem.dispose();
  }
}

export function resolveActiveReviewFilePath(session: ReviewSession): string | undefined {
  const panelPath = VisualReviewPanel.current?.getActivePath();
  if (panelPath && session.changeByPath.has(panelPath)) {
    return panelPath;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.uri.scheme === "file") {
    const fromEditor = matchMrFilePath(session, editor.document.uri);
    if (fromEditor) {
      return fromEditor;
    }
  }
  for (const visible of vscode.window.visibleTextEditors) {
    if (visible.document.uri.scheme !== "file") {
      continue;
    }
    const fromVisible = matchMrFilePath(session, visible.document.uri);
    if (fromVisible) {
      return fromVisible;
    }
  }
  return panelPath;
}
