import * as vscode from "vscode";
import type { FlowGraph } from "../gitlab/types";

export class FlowGraphPanel {
  public static current: FlowGraphPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.panel = panel;
    panel.onDidDispose(() => {
      FlowGraphPanel.current = undefined;
    });
    panel.webview.onDidReceiveMessage((msg: { type: string; path?: string }) => {
      if (msg.type === "openFile" && msg.path) {
        void vscode.commands.executeCommand("reviewKit.openFileFromGraph", msg.path);
      }
    });
  }

  static show(extensionUri: vscode.Uri, graph: FlowGraph, title: string): FlowGraphPanel {
    if (FlowGraphPanel.current) {
      FlowGraphPanel.current.panel.reveal();
      FlowGraphPanel.current.render(graph, title);
      return FlowGraphPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      "reviewKit.flowGraph",
      "Review flow",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );
    const instance = new FlowGraphPanel(panel, extensionUri);
    FlowGraphPanel.current = instance;
    instance.render(graph, title);
    return instance;
  }

  highlightPath(path: string): void {
    this.panel.webview.postMessage({ type: "highlight", path });
  }

  private render(graph: FlowGraph, title: string): void {
    this.panel.title = title;
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "graphView.js"),
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "graphView.css"),
    );
    const nonce = randomNonce();
    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    html, body, #root { margin: 0; height: 100%; width: 100%; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    window.__REVIEW_KIT_GRAPH__ = ${JSON.stringify(graph)};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function randomNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}
