import * as vscode from "vscode";
import { matchMrFilePath } from "./mrComments";
import type { ReviewSession } from "./reviewSession";

export class MrReviewCodeLensProvider implements vscode.CodeLensProvider {
  private readonly onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;

  constructor(
    private readonly getSession: () => ReviewSession | undefined,
    private readonly isPathReviewed: (session: ReviewSession, path: string) => boolean,
  ) {}

  refresh(): void {
    this.onDidChangeCodeLensesEmitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const session = this.getSession();
    if (!session) {
      return [];
    }
    const filePath = matchMrFilePath(session, document.uri);
    if (!filePath) {
      return [];
    }
    const reviewed = this.isPathReviewed(session, filePath);
    const range = new vscode.Range(0, 0, 0, 0);
    const title = reviewed
      ? "✓ Revisado — clique para desmarcar (Alt+Enter)"
      : "Marcar arquivo como revisado (Alt+Enter)";
    return [
      new vscode.CodeLens(range, {
        title,
        command: "reviewKit.toggleReviewedInDiff",
      }),
    ];
  }
}

export function registerMrReviewCodeLens(
  context: vscode.ExtensionContext,
  getSession: () => ReviewSession | undefined,
  isPathReviewed: (session: ReviewSession, path: string) => boolean,
): MrReviewCodeLensProvider {
  const provider = new MrReviewCodeLensProvider(getSession, isPathReviewed);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, provider),
    vscode.languages.registerCodeLensProvider({ scheme: "review-kit-gitlab" }, provider),
  );
  return provider;
}
