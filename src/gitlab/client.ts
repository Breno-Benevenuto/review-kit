import type {
  GitLabDiscussion,
  MergeRequestChanges,
  MergeRequestSummary,
} from "./types";
import { normalizeMergeRequestSummary } from "./normalizeMr";
import {
  gitlabRequest,
  headerValue,
  resolveGitLabTlsInsecure,
  type GitLabHttpResponse,
} from "./gitlabHttp";
import { redactGitLabSecrets } from "./redactSecrets";

export type GitLabProjectRef = {
  id: number;
  path_with_namespace: string;
};

export function filterOpenMergeRequests(mrs: MergeRequestSummary[]): MergeRequestSummary[] {
  return mrs.filter((mr) => mr.state === "opened");
}

export class GitLabApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly apiPath?: string,
  ) {
    super(message);
    this.name = "GitLabApiError";
  }
}

export class GitLabNetworkError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GitLabNetworkError";
  }
}

type AuthMode = "private-token" | "bearer";

export class GitLabClient {
  private readonly insecureTls: boolean;

  constructor(
    private readonly baseUrl: string,
    token: string,
  ) {
    this.token = token.trim();
    this.insecureTls = resolveGitLabTlsInsecure(baseUrl);
  }

  private readonly token: string;

  private authHeaders(mode: AuthMode): Record<string, string> {
    if (mode === "bearer") {
      return { Authorization: `Bearer ${this.token}` };
    }
    return { "PRIVATE-TOKEN": this.token };
  }

  private url(path: string, query?: Record<string, string | number | boolean>): string {
    const normalized = this.baseUrl.replace(/\/$/, "");
    const u = new URL(`${normalized}/api/v4${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }

  private async fetchWithAuth(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string },
    authMode: AuthMode,
  ): Promise<GitLabHttpResponse> {
    let current = url;
    for (let hop = 0; hop < 6; hop++) {
      let res: GitLabHttpResponse;
      try {
        res = await gitlabRequest(
          current,
          {
            ...init,
            headers: { ...this.authHeaders(authMode), ...init.headers },
          },
          this.insecureTls,
          this.baseUrl,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const hint = msg.includes("UNABLE_TO_VERIFY") || msg.includes("certificate")
          ? " (TLS: ative reviewKit.gitlabInsecureTls ou GITLAB_INSECURE_TLS=1)"
          : "";
        throw new GitLabNetworkError(redactGitLabSecrets(`Rede GitLab: ${msg}${hint}`, this.token), e);
      }
      if (res.status >= 300 && res.status < 400) {
        const location = headerValue(res.headers, "location");
        if (!location) {
          return res;
        }
        current = new URL(location, current).toString();
        continue;
      }
      return res;
    }
    throw new GitLabApiError("Too many GitLab redirects", 310);
  }

  private async request<T>(path: string, init?: RequestInit, query?: Record<string, string | number | boolean>): Promise<T> {
    const url = this.url(path, query);
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    const extra = init?.headers as Record<string, string> | undefined;
    if (extra) {
      Object.assign(headers, extra);
    }
    const method = init?.method;
    const body = init?.body ? String(init.body) : undefined;

    let res = await this.fetchWithAuth(url, { method, headers, body }, "private-token");
    if (res.status === 401) {
      res = await this.fetchWithAuth(url, { method, headers, body }, "bearer");
    }
    if (res.status < 200 || res.status >= 300) {
      throw new GitLabApiError(res.body || `HTTP ${res.status}`, res.status, path);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return JSON.parse(res.body) as T;
  }

  async validateToken(): Promise<{ username: string }> {
    const user = await this.request<{ username: string }>("/user");
    return { username: user.username };
  }

  async getCurrentUser(): Promise<{ id: number; username: string; name: string }> {
    return this.request("/user");
  }

  async listMergeRequestDiscussions(projectId: number, mrIid: number): Promise<GitLabDiscussion[]> {
    const all: GitLabDiscussion[] = [];
    for (let page = 1; page <= 30; page++) {
      const batch = await this.request<GitLabDiscussion[]>(
        `/projects/${projectId}/merge_requests/${mrIid}/discussions`,
        undefined,
        { per_page: 100, page },
      );
      all.push(...batch);
      if (batch.length < 100) {
        break;
      }
    }
    return all;
  }

  async resolveProject(projectPath: string): Promise<GitLabProjectRef> {
    return this.request<GitLabProjectRef>(`/projects/${encodeURIComponent(projectPath)}`);
  }

  async listOpenMergeRequestsForProject(projectId: number): Promise<MergeRequestSummary[]> {
    const raw = await this.request<MergeRequestSummary[]>(
      `/projects/${projectId}/merge_requests`,
      undefined,
      {
        state: "opened",
        per_page: 50,
        order_by: "updated_at",
        sort: "desc",
      },
    );
    return filterOpenMergeRequests(raw).map((mr) => normalizeMergeRequestSummary(mr));
  }

  async getMergeRequest(projectId: number, mrIid: number): Promise<MergeRequestSummary> {
    const raw = await this.request<MergeRequestSummary>(
      `/projects/${projectId}/merge_requests/${mrIid}`,
    );
    return normalizeMergeRequestSummary(raw);
  }

  async getMergeRequestChanges(projectId: number, mrIid: number): Promise<MergeRequestChanges> {
    return this.request<MergeRequestChanges>(
      `/projects/${projectId}/merge_requests/${mrIid}/changes`,
    );
  }

  async getMergeRequestChangesWithFallback(
    mrProjectId: number,
    mrIid: number,
    workspaceProjectId?: number,
  ): Promise<MergeRequestChanges> {
    try {
      return await this.getMergeRequestChanges(mrProjectId, mrIid);
    } catch (e) {
      if (
        e instanceof GitLabApiError &&
        e.status === 404 &&
        workspaceProjectId !== undefined &&
        workspaceProjectId > 0 &&
        workspaceProjectId !== mrProjectId
      ) {
        return this.getMergeRequestChanges(workspaceProjectId, mrIid);
      }
      throw e;
    }
  }

  async getFileRaw(projectId: number, filePath: string, ref: string): Promise<string> {
    const encodedPath = encodeURIComponent(filePath);
    const url = this.url(`/projects/${projectId}/repository/files/${encodedPath}/raw`, { ref });
    let res = await this.fetchWithAuth(url, { headers: { Accept: "text/plain" } }, "private-token");
    if (res.status === 401) {
      res = await this.fetchWithAuth(url, { headers: { Accept: "text/plain" } }, "bearer");
    }
    if (res.status === 404) {
      return "";
    }
    if (res.status < 200 || res.status >= 300) {
      throw new GitLabApiError(res.body || `HTTP ${res.status}`, res.status);
    }
    return res.body;
  }

  async createMrNote(projectId: number, mrIid: number, body: string): Promise<void> {
    await this.request(`/projects/${projectId}/merge_requests/${mrIid}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
  }

  async createMrDiscussionNote(
    projectId: number,
    mrIid: number,
    discussionId: string,
    body: string,
  ): Promise<void> {
    await this.request(
      `/projects/${projectId}/merge_requests/${mrIid}/discussions/${encodeURIComponent(discussionId)}/notes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      },
    );
  }

  async createMrDiscussion(
    projectId: number,
    mrIid: number,
    body: string,
    position: {
      base_sha: string;
      start_sha: string;
      head_sha: string;
      old_path: string;
      new_path: string;
      new_line?: number;
      old_line?: number;
    },
  ): Promise<void> {
    const pos: Record<string, string | number> = {
      position_type: "text",
      base_sha: position.base_sha,
      start_sha: position.start_sha,
      head_sha: position.head_sha,
      old_path: position.old_path,
      new_path: position.new_path,
    };
    if (position.new_line !== undefined) {
      pos.new_line = position.new_line;
    }
    if (position.old_line !== undefined) {
      pos.old_line = position.old_line;
    }
    await this.request(`/projects/${projectId}/merge_requests/${mrIid}/discussions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, position: pos }),
    });
  }

  async approveMr(projectId: number, mrIid: number): Promise<void> {
    await this.postMrAction(`/projects/${projectId}/merge_requests/${mrIid}/approve`);
  }

  async unapproveMr(projectId: number, mrIid: number): Promise<void> {
    await this.postMrAction(`/projects/${projectId}/merge_requests/${mrIid}/unapprove`);
  }

  private async postMrAction(path: string): Promise<void> {
    await this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  }
}
