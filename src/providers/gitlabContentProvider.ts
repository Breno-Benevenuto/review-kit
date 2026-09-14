import * as vscode from "vscode";
import { GitLabClient } from "../gitlab/client";

const SCHEME = "review-kit-gitlab";

export function buildFileUri(projectId: number, filePath: string, ref: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: SCHEME,
    path: `/${filePath}`,
    query: `projectId=${projectId}&ref=${encodeURIComponent(ref)}`,
  });
}

export class GitLabContentProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private getClient: () => GitLabClient | undefined) {}

  refresh(uri: vscode.Uri): void {
    this.onDidChangeEmitter.fire(uri);
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const client = this.getClient();
    if (!client) {
      return "";
    }
    const params = new URLSearchParams(uri.query);
    const projectId = Number(params.get("projectId"));
    const ref = params.get("ref") ?? "";
    const filePath = uri.path.replace(/^\//, "");
    return client.getFileRaw(projectId, filePath, ref);
  }
}

export function registerGitLabContentProvider(
  context: vscode.ExtensionContext,
  getClient: () => GitLabClient | undefined,
): GitLabContentProvider {
  const provider = new GitLabContentProvider(getClient);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
  );
  return provider;
}
