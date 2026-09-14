export type GitLabUser = {
  id: number;
  username: string;
  name: string;
};

export type MergeRequestSummary = {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  web_url: string;
  state: string;
  draft?: boolean;
  references: { full: string };
  author: GitLabUser;
  source_branch: string;
  target_branch: string;
  description?: string | null;
};

export type MergeRequestChange = {
  old_path: string;
  new_path: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  diff?: string;
};

export type MergeRequestDiffRefs = {
  base_sha: string;
  head_sha: string;
  start_sha: string;
};

export type MergeRequestChanges = {
  changes: MergeRequestChange[];
  diff_refs: MergeRequestDiffRefs;
};

export type FlowNode = {
  id: string;
  path: string;
  layer: string;
  label: string;
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
};

export type FlowGraph = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  suggestedOrder: string[];
};

export type MrReviewState = {
  reviewedPaths: string[];
};
