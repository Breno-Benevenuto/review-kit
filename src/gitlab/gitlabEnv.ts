import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const DEFAULT_GITLAB_URL = "https://gitlab.com";

const CURSOR_ENV_FILES = [
  path.join(os.homedir(), ".cursor", ".env.cursor"),
  path.join(os.homedir(), ".cursor", ".env"),
];

export function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

export function parseEnvLine(line: string, key: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = trimmed.match(new RegExp(`^(?:export\\s+)?${escaped}\\s*=\\s*(.*)$`));
  if (!match?.[1]) {
    return undefined;
  }
  let value = match[1].trim();
  const inlineComment = value.indexOf(" #");
  if (inlineComment >= 0) {
    value = value.slice(0, inlineComment).trim();
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value.trim() || undefined;
}

export function readFromCursorEnvFiles(key: string): string | undefined {
  for (const file of CURSOR_ENV_FILES) {
    try {
      const text = fs.readFileSync(file, "utf8");
      for (const line of text.split("\n")) {
        const value = parseEnvLine(line, key);
        if (value) {
          return value;
        }
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

export function readGitLabTokenFromCursorEnvFile(): string | undefined {
  return readFromCursorEnvFiles("GITLAB_TOKEN");
}

export function readGitLabUrlFromCursorEnvFile(): string | undefined {
  return readFromCursorEnvFiles("GITLAB_URL");
}

export function readGitLabTokenFromProcessEnv(): string | undefined {
  return process.env.GITLAB_TOKEN?.trim() || undefined;
}

export function readGitLabUrlFromProcessEnv(): string | undefined {
  return process.env.GITLAB_URL?.trim() || undefined;
}

export function normalizeGitLabApiBaseUrl(baseUrl: string): string {
  try {
    const u = new URL(stripTrailingSlash(baseUrl));
    if (u.hostname.startsWith("gitlabssh.")) {
      u.hostname = u.hostname.replace(/^gitlabssh\./, "gitlab.");
    }
    return stripTrailingSlash(u.toString());
  } catch {
    return stripTrailingSlash(baseUrl);
  }
}

export function inferGitLabBaseUrlFromRemote(remote: string): string | undefined {
  const cleaned = remote.trim();
  const ssh = cleaned.match(/^git@([^:]+):/);
  if (ssh?.[1]) {
    return normalizeGitLabApiBaseUrl(`https://${ssh[1]}`);
  }
  try {
    const withScheme = cleaned.startsWith("http") ? cleaned : `https://${cleaned}`;
    const url = new URL(withScheme.replace(/\.git$/, ""));
    return normalizeGitLabApiBaseUrl(`${url.protocol}//${url.host}`);
  } catch {
    return undefined;
  }
}
