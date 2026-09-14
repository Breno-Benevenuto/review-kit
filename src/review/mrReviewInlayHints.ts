import * as vscode from "vscode";
import { commentSideForDocument, matchMrFilePath } from "./mrComments";
import { getReviewDrafts, isDraftExpanded } from "./reviewDrafts";
import type { ReviewSession } from "./reviewSession";

export class MrReviewInlayHintsProvider implements vscode.InlayHintsProvider {
  private readonly onDidChangeInlayHintsEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this.onDidChangeInlayHintsEmitter.event;

  constructor(private readonly getSession: () => ReviewSession | undefined) {}

  refresh(): void {
    this.onDidChangeInlayHintsEmitter.fire();
  }

  provideInlayHints(
    document: vscode.TextDocument,
    _range: vscode.Range,
    _token: vscode.CancellationToken,
  ): vscode.InlayHint[] {
    const session = this.getSession();
    if (!session) {
      return [];
    }
    const filePath = matchMrFilePath(session, document.uri);
    if (!filePath) {
      return [];
    }
    const side = commentSideForDocument(document.uri);
    const draftsOnFile = getReviewDrafts().filter((d) => d.filePath === filePath && d.side === side);
    const draftByLine = new Map<number, (typeof draftsOnFile)[number]>();
    for (const draft of draftsOnFile) {
      if (!draftByLine.has(draft.line)) {
        draftByLine.set(draft.line, draft);
      }
    }

    const hints: vscode.InlayHint[] = [];
    for (let line = 1; line <= document.lineCount; line++) {
      const parts: vscode.InlayHintLabelPart[] = [];
      const plus = new vscode.InlayHintLabelPart("+");
      plus.tooltip = "Comentar nesta linha";
      plus.command = {
        command: "reviewKit.commentOnLineAt",
        title: "Comentar",
        arguments: [line, side, filePath],
      };
      parts.push(plus);

      const draft = draftByLine.get(line);
      if (draft) {
        const expanded = isDraftExpanded(draft.id);
        const mark = new vscode.InlayHintLabelPart(expanded ? "▼" : "💬");
        mark.tooltip = expanded ? "Fechar comentário da fila no diff" : "Abrir comentário da fila no diff";
        mark.command = {
          command: "reviewKit.toggleDraftCommentInDiff",
          title: expanded ? "Fechar" : "Abrir",
          arguments: [draft.id],
        };
        parts.push(mark);
      }

      const hint = new vscode.InlayHint(new vscode.Position(line - 1, 0), parts);
      hint.paddingRight = true;
      hints.push(hint);
    }
    return hints;
  }
}

export function registerMrReviewInlayHints(
  context: vscode.ExtensionContext,
  getSession: () => ReviewSession | undefined,
): MrReviewInlayHintsProvider {
  const provider = new MrReviewInlayHintsProvider(getSession);
  context.subscriptions.push(
    vscode.languages.registerInlayHintsProvider({ scheme: "file" }, provider),
    vscode.languages.registerInlayHintsProvider({ scheme: "review-kit-gitlab" }, provider),
  );
  return provider;
}
