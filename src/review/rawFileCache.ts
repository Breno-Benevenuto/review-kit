const cache = new Map<string, string>();

export function rawFileCacheKey(projectId: number, sha: string, filePath: string): string {
  return `${projectId}:${sha}:${filePath}`;
}

export function getCachedRawFile(key: string): string | undefined {
  return cache.get(key);
}

export function setCachedRawFile(key: string, content: string): void {
  cache.set(key, content);
}

export function clearRawFileCache(): void {
  cache.clear();
}

export async function getRawFileCached(
  fetch: () => Promise<string>,
  key: string,
): Promise<string> {
  const hit = cache.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const content = await fetch();
  cache.set(key, content);
  return content;
}
