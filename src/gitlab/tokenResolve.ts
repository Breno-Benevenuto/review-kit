import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

const TOKEN_KEY = "reviewKit.gitlabToken";
export const AUTH_KIND_KEY = "reviewKit.authKind";

export { TOKEN_KEY };

export const DEFAULT_GITLAB_URL = "https://gitlab.com";

export type GitLabTokenSource = "env" | "env-file" | "oauth" | "pat" | "secret-storage" | "none";

export function gitlabBaseUrl(): string {
  return (
    vscode.workspace.getConfiguration("reviewKit").get<string>("gitlabUrl") ??
    DEFAULT_GITLAB_URL
  );
}

export function readGitLabTokenFromCursorEnvFile(): string | undefined {
  const candidates = [
    path.join(os.homedir(), ".cursor", ".env.cursor"),
    path.join(os.homedir(), ".cursor", ".env"),
  ];
  for (const file of candidates) {
    const token = parseGitLabTokenFromEnvFile(file);
    if (token) {
      return token;
    }
  }
  return undefined;
}

function parseGitLabTokenFromEnvFile(filePath: string): string | undefined {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    for (const line of text.split("\n")) {
      const token = parseGitLabTokenLine(line);
      if (token) {
        return token;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function parseGitLabTokenLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }
  const match = trimmed.match(/^(?:export\s+)?GITLAB_TOKEN\s*=\s*(.+?)(?:\s+#.*)?$/);
  if (!match?.[1]) {
    return undefined;
  }
  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value.trim() || undefined;
}

export function readGitLabTokenFromEnvironment(): { token?: string; source: GitLabTokenSource } {
  const fromProcess = process.env.GITLAB_TOKEN?.trim();
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
    const kind = (await context.secrets.get(AUTH_KIND_KEY))?.trim();
    const source: GitLabTokenSource =
      kind === "oauth" ? "oauth" : kind === "pat" ? "pat" : "secret-storage";
    return { token: stored, source };
  }

  if (fromEnv.token) {
    return fromEnv;
  }

  return { source: "none" };
}

export function getOutputChannel(): vscode.OutputChannel {
  return vscode.window.createOutputChannel("Review Kit");
}
