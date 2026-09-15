import type { FlowGraph, MergeRequestChange, MergeRequestSummary } from "../gitlab/types";
import { effectivePath } from "../graph/flowGraph";
import { buildFlowGraphFromChanges } from "../graph/mrFlowDiagram";
import { buildFileReviewCard, type FileReviewCard } from "./diffPresentation";
import { orderChanges } from "./orderChanges";

export type ReviewSession = {
  mr: MergeRequestSummary;
  diffRefs: { base_sha: string; head_sha: string; start_sha: string };
  orderedChanges: MergeRequestChange[];
  cards: FileReviewCard[];
  changeByPath: Map<string, MergeRequestChange>;
  mrDescription: string;
  flowGraph: FlowGraph;
};

export function createReviewSession(
  mr: MergeRequestSummary,
  changes: MergeRequestChange[],
  diffRefs: { base_sha: string; head_sha: string; start_sha: string },
  overview?: { description?: string; flowGraph?: FlowGraph },
  orderedChangesInput?: MergeRequestChange[],
): ReviewSession {
  const orderedChanges = orderedChangesInput ?? orderChanges(changes);
  const cards = orderedChanges.map((change, i) => buildFileReviewCard(change, i + 1));
  const changeByPath = new Map<string, MergeRequestChange>();
  for (const change of orderedChanges) {
    changeByPath.set(effectivePath(change), change);
  }
  const flowGraph = overview?.flowGraph ?? buildFlowGraphFromChanges(changes);
  const mrDescription =
    overview?.description?.trim() ?? (mr.description ?? "").trim();
  return { mr, diffRefs, orderedChanges, cards, changeByPath, mrDescription, flowGraph };
}
