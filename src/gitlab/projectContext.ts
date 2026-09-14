import type { GitLabProjectRef } from "./client";

let activeProject: GitLabProjectRef | undefined;

export function setActiveGitLabProject(project: GitLabProjectRef | undefined): void {
  activeProject = project;
}

export function getActiveGitLabProject(): GitLabProjectRef | undefined {
  return activeProject;
}

/**
 * MR-scoped GitLab API routes must use the `project_id` from the merge request
 * (fork / cross-project MRs break if we always substitute the workspace project).
 */
export function resolveProjectIdForMr(mrProjectId: number): number {
  if (Number.isFinite(mrProjectId) && mrProjectId > 0) {
    return mrProjectId;
  }
  return activeProject?.id ?? mrProjectId;
}
