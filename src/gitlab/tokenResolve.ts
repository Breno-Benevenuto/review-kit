import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

const TOKEN_KEY = "reviewKit.gitlabToken";

export function gitlabBaseUrl(): string {
  return (
    vscode.workspace.getConfiguration("reviewKit").get<string>("gitlabUrl") ??
    "https://gitlab.com"
  );
}

export function readGitLabTokenFromCursorEnvFile(): string | undefined {
  try {
    const file = path.join(os.homedir(), ".cursor", ".env.cursor");
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const match = trimmed.match(/^(?:export\s+)?GITLAB_TOKEN=(.+)$/);
      if (!match) {
        continue;
      }
      return match[1].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function resolveGitLabToken(context: vscode.ExtensionContext): Promise<string | undefined> {
  const stored = await context.secrets.get(TOKEN_KEY);
  if (stored) {
    return stored;
  }
  if (process.env.GITLAB_TOKEN) {
    return process.env.GITLAB_TOKEN;
  }
  return readGitLabTokenFromCursorEnvFile();
}

export function getOutputChannel(): vscode.OutputChannel {
  return vscode.window.createOutputChannel("Review Kit");
}
