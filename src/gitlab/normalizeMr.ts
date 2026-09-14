import type { MergeRequestSummary } from "./types";

export function normalizeMergeRequestSummary(raw: MergeRequestSummary): MergeRequestSummary {
  const iid = Number(raw.iid);
  const project_id = Number(raw.project_id);
  const id = Number(raw.id);
  const refs = raw.references?.full ? raw.references : { full: Number.isFinite(iid) ? `!${iid}` : "!?" };
  return {
    ...raw,
    id: Number.isFinite(id) ? id : raw.id,
    iid: Number.isFinite(iid) ? iid : raw.iid,
    project_id: Number.isFinite(project_id) ? project_id : raw.project_id,
    references: refs,
  };
}

export function isValidMergeRequestSummary(mr: MergeRequestSummary | undefined): mr is MergeRequestSummary {
  if (!mr) {
    return false;
  }
  return Number.isFinite(mr.iid) && mr.iid > 0 && Number.isFinite(mr.project_id) && mr.project_id > 0;
}

export function mergeRequestRef(mr: MergeRequestSummary): string {
  return mr.references?.full ?? `!${mr.iid}`;
}
