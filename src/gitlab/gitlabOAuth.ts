import { createHash, randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { GitLabApiError, GitLabClient } from "./client";
import { AUTH_KIND_KEY, TOKEN_KEY, gitlabBaseUrl } from "./tokenResolve";

const OAUTH_CALLBACK_PATH = "/gitlab-oauth";
const DEFAULT_REDIRECT_URI = "vscode://review-kit.review-kit/gitlab-oauth";
const DEFAULT_SCOPES = "api read_user read_api write_repository";

type PendingOAuth = {
  verifier: string;
  resolve: (accessToken: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingByState = new Map<string, PendingOAuth>();

export function registerGitLabOAuthUriHandler(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri) {
        void completeOAuthFromUri(uri);
      },
    }),
  );
}

export async function signInWithGitLabOAuth(context: vscode.ExtensionContext): Promise<boolean> {
  const { clientId, clientSecret, redirectUri, scopes } = readOAuthSettings();
  if (!clientId) {
    void vscode.window.showErrorMessage(
      "Review Kit: defina reviewKit.gitlabOAuthClientId (Application ID do OAuth app no GitLab). " +
        `Redirect URI no GitLab: ${DEFAULT_REDIRECT_URI}`,
    );
    return false;
  }

  const baseUrl = gitlabBaseUrl().replace(/\/$/, "");
  const { verifier, challenge } = createPkcePair();
  const state = base64Url(randomBytes(16));

  const accessToken = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingByState.delete(state);
      reject(new Error("Tempo esgotado aguardando login no navegador (2 min)."));
    }, 120_000);

    pendingByState.set(state, { verifier, resolve, reject, timeout });

    const authorizeUrl = new URL(`${baseUrl}/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("scope", scopes);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    void vscode.env.openExternal(vscode.Uri.parse(authorizeUrl.toString()));
    void vscode.window.setStatusBarMessage(
      "Review Kit: conclua o login no GitLab no navegador (SSO)",
      8000,
    );
  }).finally(() => {
    pendingByState.delete(state);
  });

  const probe = new GitLabClient(baseUrl, accessToken);
  const { username } = await probe.validateToken();
  await context.secrets.store(TOKEN_KEY, accessToken);
  await context.secrets.store(AUTH_KIND_KEY, "oauth");
  void vscode.window.showInformationMessage(`Review Kit: conectado como @${username} (OAuth/SSO).`);
  return true;
}

async function completeOAuthFromUri(uri: vscode.Uri): Promise<void> {
  if (uri.path !== OAUTH_CALLBACK_PATH) {
    return;
  }
  const params = new URLSearchParams(uri.query);
  const error = params.get("error");
  const errorDescription = params.get("error_description");
  if (error) {
    failPendingOAuth(params.get("state"), new Error(errorDescription ?? error));
    void vscode.window.showErrorMessage(`Review Kit OAuth: ${errorDescription ?? error}`);
    return;
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    failPendingOAuth(state, new Error("Callback OAuth sem code/state."));
    return;
  }

  const pending = pendingByState.get(state);
  if (!pending) {
    void vscode.window.showWarningMessage("Review Kit: sessão OAuth expirada. Rode Entrar no GitLab de novo.");
    return;
  }

  try {
    const { clientId, clientSecret, redirectUri } = readOAuthSettings();
    const token = await exchangeAuthorizationCode({
      baseUrl: gitlabBaseUrl().replace(/\/$/, ""),
      clientId: clientId!,
      clientSecret,
      redirectUri,
      code,
      verifier: pending.verifier,
    });
    clearTimeout(pending.timeout);
    pending.resolve(token);
  } catch (e) {
    clearTimeout(pending.timeout);
    pending.reject(e instanceof Error ? e : new Error(String(e)));
    const msg = e instanceof GitLabApiError ? `HTTP ${e.status}` : String(e);
    void vscode.window.showErrorMessage(`Review Kit OAuth: falha ao obter token (${msg}).`);
  }
}

function failPendingOAuth(state: string | null, error: Error): void {
  if (!state) {
    return;
  }
  const pending = pendingByState.get(state);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timeout);
  pending.reject(error);
  pendingByState.delete(state);
}

async function exchangeAuthorizationCode(options: {
  baseUrl: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<string> {
  const body = new URLSearchParams({
    client_id: options.clientId,
    code: options.code,
    grant_type: "authorization_code",
    redirect_uri: options.redirectUri,
    code_verifier: options.verifier,
  });
  if (options.clientSecret) {
    body.set("client_secret", options.clientSecret);
  }

  const res = await fetch(`${options.baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new GitLabApiError(text || res.statusText, res.status, "/oauth/token");
  }
  const payload = JSON.parse(text) as { access_token?: string; error?: string; error_description?: string };
  if (payload.error) {
    throw new Error(payload.error_description ?? payload.error);
  }
  if (!payload.access_token) {
    throw new Error("Resposta OAuth sem access_token.");
  }
  return payload.access_token;
}

function readOAuthSettings(): {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string;
} {
  const cfg = vscode.workspace.getConfiguration("reviewKit");
  const clientId =
    cfg.get<string>("gitlabOAuthClientId")?.trim() || process.env.GITLAB_OAUTH_CLIENT_ID?.trim() || undefined;
  const clientSecret =
    cfg.get<string>("gitlabOAuthClientSecret")?.trim() ||
    process.env.GITLAB_OAUTH_CLIENT_SECRET?.trim() ||
    undefined;
  const redirectUri = cfg.get<string>("gitlabOAuthRedirectUri")?.trim() || DEFAULT_REDIRECT_URI;
  const scopes = cfg.get<string>("gitlabOAuthScopes")?.trim() || DEFAULT_SCOPES;
  return { clientId, clientSecret, redirectUri, scopes };
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export { DEFAULT_REDIRECT_URI };
