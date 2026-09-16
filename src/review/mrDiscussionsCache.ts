import type { MergeRequestSummary, MrDiscussionThreadView } from "../gitlab/types";
import { mrKey } from "../providers/mrTreeProvider";

type CacheEntry = {
  threads: MrDiscussionThreadView[];
  error?: string;
};

let cache: { key: string; entry: CacheEntry } | undefined;

export function setMrDiscussionsCache(
  mr: MergeRequestSummary,
  threads: MrDiscussionThreadView[],
  error?: string,
): void {
  cache = { key: mrKey(mr), entry: { threads, error } };
}

export function getMrDiscussionsCache(mr: MergeRequestSummary): CacheEntry {
  if (!cache || cache.key !== mrKey(mr)) {
    return { threads: [] };
  }
  return cache.entry;
}

export function clearMrDiscussionsCache(): void {
  cache = undefined;
}
