import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorkspaceGitLabProject = {
  path: string;
  folderName: string;
};

export async function resolveWorkspaceGitLabProject(): Promise<WorkspaceGitLabProject | undefined> {
  const configured = vscode.workspace.getConfiguration("reviewKit").get<string>("projectPath")?.trim();
  if (configured) {
    return { path: configured.replace(/^\//, ""), folderName: configured.split("/").pop() ?? configured };
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }

  const remote = await readOriginRemote(folder.uri.fsPath);
  if (!remote) {
    return undefined;
  }

  const path = parseGitLabProjectPath(remote, gitlabBaseUrl());
  if (!path) {
    return undefined;
  }

  return { path, folderName: folder.name };
}

function gitlabBaseUrl(): string {
  return (
    vscode.workspace.getConfiguration("reviewKit").get<string>("gitlabUrl") ??
    "https://gitlab.com"
  );
}

async function readOriginRemote(repoPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: repoPath });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function parseGitLabProjectPath(remote: string, _gitlabBaseUrl: string): string | undefined {
  const cleaned = remote.trim().replace(/\.git$/, "");

  const sshMatch = cleaned.match(/^git@[^:]+:(.+)$/);
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }

  try {
    const url = new URL(cleaned.startsWith("http") ? cleaned : `https://${cleaned}`);
    const path = url.pathname.replace(/^\//, "");
    return path || undefined;
  } catch {
    return undefined;
  }
}
