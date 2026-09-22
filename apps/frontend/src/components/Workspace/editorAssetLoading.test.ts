import { describe, expect, it } from 'vitest';
import { mapEditorAssets } from './editorAssetLoading';

describe('editor asset queue', () => {
  it.each([4, 16])('bounds concurrency to %s and preserves manifest order despite out-of-order completion', async concurrency => {
    let active = 0, peak = 0;
    const result = await mapEditorAssets(Array.from({ length: 32 }, (_, i) => i), async i => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, i % 2 ? 0 : 5));
      active--;
      return i;
    }, undefined, concurrency);
    expect(peak).toBe(concurrency);
    expect(result).toEqual(Array.from({ length: 32 }, (_, i) => i));
  });

  it('does not start queued files after Cancel', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    await expect(mapEditorAssets([0, 1, 2, 3, 4, 5], async i => {
      started.push(i);
      await Promise.resolve();
      controller.abort();
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(started).toEqual([0, 1, 2, 3]);
  });
});
