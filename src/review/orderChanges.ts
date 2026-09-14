import type { MergeRequestChange } from "../gitlab/types";
import { suggestReviewOrder } from "../graph/dependencyAnalyzer";
import { effectivePath } from "../graph/flowGraph";

export function orderChanges(changes: MergeRequestChange[]): MergeRequestChange[] {
  const byPath = new Map<string, MergeRequestChange>();
  for (const change of changes) {
    byPath.set(effectivePath(change), change);
  }
  const order = suggestReviewOrder([...byPath.keys()]);
  return order.map((path) => byPath.get(path)).filter((c): c is MergeRequestChange => c !== undefined);
}
