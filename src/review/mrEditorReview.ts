import * as vscode from "vscode";
import { parseDiffLineMarkers } from "./diffMarkers";
import type { ReviewSession } from "./reviewSession";
import { matchMrFilePath } from "./mrComments";

type ActiveReviewFile = {
  filePath: string;
  diff: string;
  markers: ReturnType<typeof parseDiffLineMarkers>;
};

export class MrEditorReviewController {
  private session: ReviewSession | undefined;
  private activeFile: ActiveReviewFile | undefined;
  private readonly addedType: vscode.TextEditorDecorationType;

  constructor(context: vscode.ExtensionContext) {
    this.addedType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor("diffEditor.insertedLineBackground"),
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.addedForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    context.subscriptions.push(
      this.addedType,
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.syncFromActiveEditor();
        this.refreshDecorations();
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshDecorations()),
    );
  }

  setSession(session: ReviewSession | undefined): void {
    this.session = session;
    if (!session) {
      this.activeFile = undefined;
      this.clearAllDecorations();
    }
  }

  focusFile(filePath: string, diff: string): void {
    this.activeFile = { filePath, diff, markers: parseDiffLineMarkers(diff) };
    void vscode.commands.executeCommand("setContext", "reviewKit.mrReviewActive", true);
    setTimeout(() => this.refreshDecorations(), 80);
    setTimeout(() => this.refreshDecorations(), 350);
  }

  syncFromActiveEditor(): void {
    if (!this.session) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const filePath = matchMrFilePath(this.session, editor.document.uri);
    if (!filePath) {
      return;
    }
    const change = this.session.changeByPath.get(filePath);
    const diff = change?.diff ?? "";
    this.activeFile = { filePath, diff, markers: parseDiffLineMarkers(diff) };
    void vscode.commands.executeCommand("setContext", "reviewKit.mrReviewActive", true);
  }

  getActiveFilePath(): string | undefined {
    return this.activeFile?.filePath;
  }

  getSession(): ReviewSession | undefined {
    return this.session;
  }

  requestLineThreadFromEditor(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage("Abra o arquivo do MR no editor.");
      return;
    }
    const filePath = matchMrFilePath(this.session!, editor.document.uri);
    if (!filePath) {
      return;
    }
    const line = editor.selection.active.line + 1;
    const side = editor.document.uri.fsPath.includes("/.review-kit/cache/") &&
      editor.document.uri.fsPath.includes("/base/")
      ? "old"
      : "new";
    void vscode.commands.executeCommand("reviewKit.commentOnLineAt", line, side, filePath);
  }

  private refreshDecorations(): void {
    if (!this.session) {
      this.clearAllDecorations();
      return;
    }
    for (const editor of vscode.window.visibleTextEditors) {
      const filePath = matchMrFilePath(this.session, editor.document.uri);
      if (!filePath) {
        continue;
      }
      const change = this.session.changeByPath.get(filePath);
      const diff =
        this.activeFile?.filePath === filePath
          ? this.activeFile.diff
          : (change?.diff ?? "");
      this.applyToEditor(editor, parseDiffLineMarkers(diff));
    }
  }

  private applyToEditor(
    editor: vscode.TextEditor,
    markers: ReturnType<typeof parseDiffLineMarkers>,
  ): void {
    const doc = editor.document;
    const { added } = markers;
    const addedRanges: vscode.Range[] = [];
    for (const line of added) {
      if (line < 1 || line > doc.lineCount) {
        continue;
      }
      addedRanges.push(new vscode.Range(line - 1, 0, line - 1, Number.MAX_SAFE_INTEGER));
    }
    editor.setDecorations(this.addedType, addedRanges);
  }

  private clearAllDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.addedType, []);
    }
  }
}
