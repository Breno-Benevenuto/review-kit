import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DEFAULT_GITLAB_URL,
  inferGitLabBaseUrlFromRemote,
  normalizeGitLabApiBaseUrl,
  readGitLabUrlFromCursorEnvFile,
  readGitLabUrlFromProcessEnv,
  readGitLabTokenFromCursorEnvFile,
  readGitLabTokenFromProcessEnv,
  stripTrailingSlash,
} from "./gitlabEnv";

const TOKEN_KEY = "reviewKit.gitlabToken";

export { TOKEN_KEY };

export type GitLabTokenSource = "env" | "env-file" | "pat" | "none";

let resolvedBaseUrl: string | undefined;
let resolvedBaseUrlNote: string | undefined;

export function gitlabBaseUrlResolutionNote(): string | undefined {
  return resolvedBaseUrlNote;
}

function finalizeGitLabBaseUrl(raw: string, source: string): string {
  const normalized = normalizeGitLabApiBaseUrl(raw);
  if (normalized !== stripTrailingSlash(raw)) {
    resolvedBaseUrlNote = `${source}: ${stripTrailingSlash(raw)} → API ${normalized} (SSH host ≠ API HTTPS)`;
  } else {
    resolvedBaseUrlNote = undefined;
  }
  resolvedBaseUrl = normalized;
  return normalized;
}

const execFileAsync = promisify(execFile);

export function gitlabBaseUrl(): string {
  return resolvedBaseUrl ?? resolveGitLabBaseUrlFromConfigAndEnv() ?? DEFAULT_GITLAB_URL;
}

export async function refreshGitLabBaseUrl(): Promise<string> {
  const fromSetting = vscode.workspace.getConfiguration("reviewKit").get<string>("gitlabUrl")?.trim();
  if (fromSetting) {
    return finalizeGitLabBaseUrl(fromSetting, "reviewKit.gitlabUrl");
  }

  const fromEnv = readGitLabUrlFromProcessEnv() ?? readGitLabUrlFromCursorEnvFile();
  if (fromEnv) {
    return finalizeGitLabBaseUrl(fromEnv, "GITLAB_URL");
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    try {
      const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
        cwd: folder.uri.fsPath,
      });
      const remote = stdout.trim();
      const inferred = remote ? inferGitLabBaseUrlFromRemote(remote) : undefined;
      if (inferred) {
        return finalizeGitLabBaseUrl(inferred, "git remote origin");
      }
    } catch {
      // ignore
    }
  }

  resolvedBaseUrlNote = undefined;
  resolvedBaseUrl = DEFAULT_GITLAB_URL;
  return resolvedBaseUrl;
}

function resolveGitLabBaseUrlFromConfigAndEnv(): string | undefined {
  const fromSetting = vscode.workspace.getConfiguration("reviewKit").get<string>("gitlabUrl")?.trim();
  if (fromSetting) {
    return normalizeGitLabApiBaseUrl(fromSetting);
  }
  const fromEnv = readGitLabUrlFromProcessEnv() ?? readGitLabUrlFromCursorEnvFile();
  if (fromEnv) {
    return normalizeGitLabApiBaseUrl(fromEnv);
  }
  return resolvedBaseUrl;
}

export function readGitLabTokenFromEnvironment(): { token?: string; source: GitLabTokenSource } {
  const fromProcess = readGitLabTokenFromProcessEnv();
  if (fromProcess) {
    return { token: fromProcess, source: "env" };
  }
  const fromFile = readGitLabTokenFromCursorEnvFile();
  if (fromFile) {
    return { token: fromFile, source: "env-file" };
  }
  return { source: "none" };
}

export async function resolveGitLabToken(
  context: vscode.ExtensionContext,
): Promise<{ token?: string; source: GitLabTokenSource }> {
  const preferEnv = vscode.workspace.getConfiguration("reviewKit").get<boolean>("preferGitLabTokenFromEnv", true);
  const fromEnv = readGitLabTokenFromEnvironment();
  if (preferEnv && fromEnv.token) {
    return fromEnv;
  }

  const stored = (await context.secrets.get(TOKEN_KEY))?.trim();
  if (stored) {
    return { token: stored, source: "pat" };
  }

  if (fromEnv.token) {
    return fromEnv;
  }

  return { source: "none" };
}

export function getOutputChannel(): vscode.OutputChannel {
  return vscode.window.createOutputChannel("Review Kit");
}

export { DEFAULT_GITLAB_URL } from "./gitlabEnv";
