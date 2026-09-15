import { execFile } from "node:child_process";
import * as http from "node:http";
import * as https from "node:https";
import { promisify } from "node:util";
import { URL } from "node:url";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

export type GitLabHttpResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

const RETRYABLE = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"]);

export function resolveGitLabTlsInsecure(baseUrl: string): boolean {
  const cfg = vscode.workspace.getConfiguration("reviewKit").get<unknown>("gitlabInsecureTls", "auto");
  if (cfg === true || cfg === "true") {
    return true;
  }
  if (cfg === false || cfg === "false") {
    return false;
  }
  if (process.env.GITLAB_INSECURE_TLS === "1" || process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    return true;
  }
  try {
    const host = new URL(baseUrl).hostname;
    return host.endsWith(".local");
  } catch {
    return false;
  }
}

function preferCurlTransport(baseUrl: string): boolean {
  const cfg = vscode.workspace.getConfiguration("reviewKit").get<string>("gitlabHttpTransport", "auto");
  if (cfg === "curl") {
    return true;
  }
  if (cfg === "node") {
    return false;
  }
  if (process.env.REVIEW_KIT_GITLAB_CURL === "1") {
    return true;
  }
  try {
    const host = new URL(baseUrl).hostname;
    return host.endsWith(".local");
  } catch {
    return false;
  }
}

function maxRetries(): number {
  return vscode.workspace.getConfiguration("reviewKit").get<number>("gitlabHttpRetries", 3);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function gitlabRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  insecureTls: boolean,
  baseUrlForPolicy?: string,
): Promise<GitLabHttpResponse> {
  const policyBase = baseUrlForPolicy ?? url;
  if (preferCurlTransport(policyBase)) {
    try {
      return await curlGitLabRequest(url, init, insecureTls);
    } catch (curlErr) {
      const msg = curlErr instanceof Error ? curlErr.message : String(curlErr);
      if (!msg.includes("ENOENT") && !msg.includes("not found")) {
        throw curlErr;
      }
    }
  }

  const attempts = Math.max(1, maxRetries());
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await nodeGitLabRequest(url, init, insecureTls);
    } catch (e) {
      lastError = e;
      const code = e instanceof Error && "code" in e ? String((e as NodeJS.ErrnoException).code) : "";
      if (!RETRYABLE.has(code) || attempt === attempts - 1) {
        break;
      }
      await sleep(400 * 2 ** attempt);
    }
  }

  if (preferCurlTransport(policyBase) || shouldTryCurlFallback(lastError)) {
    return curlGitLabRequest(url, init, insecureTls);
  }

  throw lastError;
}

function shouldTryCurlFallback(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
  return RETRYABLE.has(code);
}

function nodeGitLabRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  insecureTls: boolean,
): Promise<GitLabHttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const headers: Record<string, string> = {
      Connection: "close",
      "User-Agent": "review-kit",
      ...(init.headers ?? {}),
    };
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: init.method ?? "GET",
        headers,
        rejectUnauthorized: isHttps ? !insecureTls : undefined,
        servername: parsed.hostname,
        family: 4,
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("ETIMEDOUT"));
    });
    req.on("error", reject);
    if (init.body) {
      req.write(init.body);
    }
    req.end();
  });
}

async function curlGitLabRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  insecureTls: boolean,
): Promise<GitLabHttpResponse> {
  const statusMarker = "\n\u001eSTATUS\u001e";
  const args = [
    "-sS",
    "-L",
    "--max-redirs",
    "6",
    "--connect-timeout",
    "25",
    "--max-time",
    "120",
    "-w",
    `${statusMarker}%{http_code}`,
  ];
  if (insecureTls) {
    args.push("-k");
  }
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    args.push("-H", `${key}: ${value}`);
  }
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    args.push("-X", method);
  }
  if (init.body) {
    args.push("--data-binary", init.body);
  }
  args.push(url);

  const { stdout } = await execFileAsync("curl", args, { maxBuffer: 64 * 1024 * 1024 });
  const idx = stdout.lastIndexOf(statusMarker);
  if (idx < 0) {
    throw new Error("curl: resposta inesperada");
  }
  const body = stdout.slice(0, idx);
  const status = Number.parseInt(stdout.slice(idx + statusMarker.length), 10);
  if (!Number.isFinite(status)) {
    throw new Error("curl: status HTTP inválido");
  }
  return { status, headers: {}, body };
}

export function headerValue(headers: http.IncomingHttpHeaders, name: string): string | undefined {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}
