import type {
  MergeRequestChanges,
  MergeRequestSummary,
} from "./types";

export class GitLabApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitLabApiError";
  }
}

export class GitLabClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

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

  private async request<T>(path: string, init?: RequestInit, query?: Record<string, string | number | boolean>): Promise<T> {
    const res = await fetch(this.url(path, query), {
      ...init,
      headers: {
        "PRIVATE-TOKEN": this.token,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new GitLabApiError(body || res.statusText, res.status);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  async validateToken(): Promise<{ username: string }> {
    const user = await this.request<{ username: string }>("/user");
    return { username: user.username };
  }

  async listOpenMergeRequests(): Promise<MergeRequestSummary[]> {
    return this.request<MergeRequestSummary[]>("/merge_requests", undefined, {
      state: "opened",
      scope: "all",
      per_page: 50,
      order_by: "updated_at",
      sort: "desc",
    });
  }

  async getMergeRequestChanges(projectId: number, mrIid: number): Promise<MergeRequestChanges> {
    return this.request<MergeRequestChanges>(
      `/projects/${encodeURIComponent(String(projectId))}/merge_requests/${mrIid}/changes`,
    );
  }

  async getFileRaw(projectId: number, filePath: string, ref: string): Promise<string> {
    const encodedProject = encodeURIComponent(String(projectId));
    const encodedPath = encodeURIComponent(filePath);
    const res = await fetch(
      this.url(`/projects/${encodedProject}/repository/files/${encodedPath}/raw`, { ref }),
      {
        headers: { "PRIVATE-TOKEN": this.token },
      },
    );
    if (res.status === 404) {
      return "";
    }
    if (!res.ok) {
      throw new GitLabApiError(await res.text(), res.status);
    }
    return res.text();
  }

  async createMrNote(projectId: number, mrIid: number, body: string): Promise<void> {
    await this.request(
      `/projects/${encodeURIComponent(String(projectId))}/merge_requests/${mrIid}/notes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      },
    );
  }

  async approveMr(projectId: number, mrIid: number): Promise<void> {
    await this.request(
      `/projects/${encodeURIComponent(String(projectId))}/merge_requests/${mrIid}/approve`,
      { method: "POST" },
    );
  }

  async unapproveMr(projectId: number, mrIid: number): Promise<void> {
    await this.request(
      `/projects/${encodeURIComponent(String(projectId))}/merge_requests/${mrIid}/unapprove`,
      { method: "POST" },
    );
  }
}
