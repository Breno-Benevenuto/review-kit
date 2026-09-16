import * as vscode from "vscode";
import type { ReviewSession } from "./reviewSession";

export class MrReviewInlayHintsProvider implements vscode.InlayHintsProvider {
  private readonly onDidChangeInlayHintsEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this.onDidChangeInlayHintsEmitter.event;

  constructor(_getSession: () => ReviewSession | undefined) {}

  refresh(): void {
    this.onDidChangeInlayHintsEmitter.fire();
  }

  provideInlayHints(
    _document: vscode.TextDocument,
    _range: vscode.Range,
    _token: vscode.CancellationToken,
  ): vscode.InlayHint[] {
    return [];
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
