import { GitLabApiError } from "./client";
import { getActiveGitLabProject } from "./projectContext";
import type { MergeRequestSummary } from "./types";

export function mergeRequestApiProjectIds(mr: MergeRequestSummary): number[] {
  const workspaceId = getActiveGitLabProject()?.id;
  const ordered = [mr.project_id, mr.target_project_id, mr.source_project_id, workspaceId];
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const raw of ordered) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export async function callMergeRequestApi<T>(
  mr: MergeRequestSummary,
  fn: (projectId: number) => Promise<T>,
): Promise<T> {
  const ids = mergeRequestApiProjectIds(mr);
  if (ids.length === 0) {
    throw new GitLabApiError("Nenhum project_id válido para o MR", 400);
  }
  let lastError: unknown;
  for (let i = 0; i < ids.length; i++) {
    try {
      return await fn(ids[i]!);
    } catch (e) {
      lastError = e;
      if (!shouldRetryMrApiOnAnotherProject(e) || i >= ids.length - 1) {
        throw e;
      }
    }
  }
  throw lastError ?? new GitLabApiError("Falha ao chamar API do MR", 500);
}

function shouldRetryMrApiOnAnotherProject(error: unknown): boolean {
  return error instanceof GitLabApiError && [401, 403, 404, 405].includes(error.status);
}

export function formatMrGitLabActionError(error: unknown): string {
  if (!(error instanceof GitLabApiError)) {
    return String(error);
  }
  const path = error.apiPath ? ` (${error.apiPath})` : "";
  if (error.status === 401) {
    return (
      `GitLab HTTP 401${path}: token sem permissão ou expirado. ` +
      "Use PAT com escopo api (ou read+write) e role Developer+ no projeto; confira reviewKit.gitlabUrl."
    );
  }
  if (error.status === 403) {
    return (
      `GitLab HTTP 403${path}: sem permissão para aprovar/revisar este MR. ` +
      "Confira seu papel no projeto e se approvals estão habilitados."
    );
  }
  if (error.status === 404) {
    return (
      `GitLab HTTP 404${path}: MR ou rota não encontrado neste project_id. ` +
      "Atualize a lista de MRs ou abra o MR de novo."
    );
  }
  return `GitLab HTTP ${error.status}${path}: ${error.message}`;
}
