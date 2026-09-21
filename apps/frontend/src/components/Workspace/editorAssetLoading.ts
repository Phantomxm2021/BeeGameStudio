/** Bound decode/fetch bursts while keeping every verified resource available to pickers. */
export async function mapEditorAssets<T, R>(items: readonly T[], load: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await load(items[index]);
    }
  }));
  return results;
}
