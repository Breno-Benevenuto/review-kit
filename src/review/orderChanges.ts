import type { MergeRequestChange } from "../gitlab/types";
import { effectivePath } from "../graph/flowGraph";
import { suggestReviewOrder } from "../graph/dependencyAnalyzer";
import {
  buildReferenceEdgesForMr,
  changesToDiffMap,
  suggestReviewOrderWithCallGraph,
} from "./callGraphReviewOrder";

function mapOrderToChanges(
  order: string[],
  byPath: Map<string, MergeRequestChange>,
): MergeRequestChange[] {
  return order.map((path) => byPath.get(path)).filter((c): c is MergeRequestChange => c !== undefined);
}

export function orderChanges(
  changes: MergeRequestChange[],
  referenceEdges?: { source: string; target: string }[],
): MergeRequestChange[] {
  const byPath = new Map<string, MergeRequestChange>();
  for (const change of changes) {
    byPath.set(effectivePath(change), change);
  }
  const order = suggestReviewOrder(
    [...byPath.keys()],
    (path) => byPath.get(path)?.diff ?? "",
    referenceEdges,
  );
  return mapOrderToChanges(order, byPath);
}

const MAX_CALL_GRAPH_FILES = 24;

export async function orderChangesAsync(changes: MergeRequestChange[]): Promise<MergeRequestChange[]> {
  const byPath = new Map<string, MergeRequestChange>();
  for (const change of changes) {
    byPath.set(effectivePath(change), change);
  }
  const paths = [...byPath.keys()];
  if (paths.length > MAX_CALL_GRAPH_FILES) {
    return orderChanges(changes);
  }
  const readFile = (path: string) => byPath.get(path)?.diff ?? "";
  let referenceEdges: { source: string; target: string }[] = [];
  try {
    referenceEdges = await buildReferenceEdgesForMr(paths, changesToDiffMap(changes));
  } catch {
    referenceEdges = [];
  }
  const order = await suggestReviewOrderWithCallGraph(paths, readFile, referenceEdges);
  return mapOrderToChanges(order, byPath);
}
