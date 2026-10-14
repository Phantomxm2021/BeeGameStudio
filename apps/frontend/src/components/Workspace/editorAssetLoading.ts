/** Match registered metadata by full sibling path; an explicit JSON root wins. */
export function editorAtlasPath(resource: { root_path: string; file_paths: string[] }, imagePath: string): string | undefined {
  const stem = imagePath.replace(/\.[^.]+$/, '');
  const candidates = [`${stem}.json`, `${stem}.atlas.json`].filter(path => resource.file_paths.includes(path));
  return candidates.includes(resource.root_path) ? resource.root_path : candidates[0];
}

/** Bound decode/fetch bursts while keeping every verified resource available to pickers. */
export async function mapEditorAssets<T, R>(items: readonly T[], load: (item: T) => Promise<R>, signal?: AbortSignal, concurrency = 4): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      signal?.throwIfAborted();
      const index = next++;
      results[index] = await load(items[index]);
    }
  }));
  return results;
}
