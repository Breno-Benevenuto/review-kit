export type GitLabUser = {
  id: number;
  username: string;
  name: string;
};

export type MergeRequestSummary = {
  id: number;
  iid: number;
  project_id: number;
  source_project_id?: number;
  target_project_id?: number;
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

export type GitLabUserRef = {
  id: number;
  username: string;
  name: string;
};

export type GitLabNotePosition = {
  new_path?: string;
  old_path?: string;
  new_line?: number | null;
  old_line?: number | null;
};

export type GitLabDiscussionNote = {
  id: number;
  body: string;
  author: GitLabUserRef;
  created_at: string;
  system: boolean;
  position?: GitLabNotePosition | null;
};

export type GitLabDiscussion = {
  id: string;
  notes: GitLabDiscussionNote[];
};

export type MrDiscussionNoteView = {
  id: number;
  body: string;
  authorName: string;
  authorUsername: string;
  createdAt: string;
  isCurrentUser: boolean;
  filePath?: string;
  line?: number;
  side?: "new" | "old";
};

export type MrDiscussionThreadView = {
  id: string;
  notes: MrDiscussionNoteView[];
  involvesCurrentUser: boolean;
  hasReplyFromOthers: boolean;
  anchorPath?: string;
  anchorLine?: number;
  anchorSide?: "new" | "old";
};
