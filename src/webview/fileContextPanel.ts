import * as vscode from "vscode";

export class FileContextPanel {
  public static current: FileContextPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    panel.onDidDispose(() => {
      FileContextPanel.current = undefined;
    });
  }

  static show(): FileContextPanel {
    if (FileContextPanel.current) {
      FileContextPanel.current.panel.reveal();
      return FileContextPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      "reviewKit.fileContext",
      "Review context",
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
      { enableScripts: false },
    );
    FileContextPanel.current = new FileContextPanel(panel);
    return FileContextPanel.current;
  }

  update(path: string, summary: string, suggestedOrder: string[]): void {
    const orderHtml = suggestedOrder
      .map((p, i) => `<li>${i + 1}. ${escapeHtml(p)}</li>`)
      .join("");
    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><style>
body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); padding: 12px; }
h2 { font-size: 14px; margin: 0 0 8px; }
p { line-height: 1.4; }
ol { padding-left: 18px; }
</style></head>
<body>
  <h2>${escapeHtml(path)}</h2>
  <p>${escapeHtml(summary)}</p>
  <h2>Suggested review order</h2>
  <ol>${orderHtml}</ol>
  <p>Use Cursor Chat on the diff for deeper analysis.</p>
</body></html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
