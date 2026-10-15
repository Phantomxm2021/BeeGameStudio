export { editorAtlasPath } from '../../../../../packages/scene-editor/src/ui-preview/uiAtlas';

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
