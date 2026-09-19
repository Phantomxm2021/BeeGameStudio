import { afterEach, describe, expect, it, vi } from 'vitest';
import { uiAtlasImages, uiImageKey } from './uiAtlas';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('UI atlas pixels', () => {
  function canvasMock() {
    vi.stubGlobal('Image', class {
      onload?: () => void;
      onerror?: () => void;
      naturalWidth = 512;
      naturalHeight = 512;
      set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
    });
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function(this: HTMLCanvasElement) { return `crop:${this.width}x${this.height}`; });
    return drawImage;
  }

  it('crops exact atlas rectangles and assembles declared panel parts', async () => {
    const draw = canvasMock();
    const sizes = { tl: [8, 8], tr: [8, 8], bl: [8, 8], br: [8, 8], h: [16, 8], v: [8, 16], c: [16, 16] };
    const metadata = {
      frames: Object.entries(sizes).map(([key, [w, h]], index) => ({ filename: `panel_${key}.png`, frame: { x: index * 20, y: 26, w, h } })),
      meta: { nine_slice: { panel: Object.fromEntries(Object.keys(sizes).map(key => [key, `panel_${key}.png`])) } },
    };
    const result = await uiAtlasImages('blob:sheet', metadata, new AbortController().signal);
    expect(result.panel_tl).toBe('crop:8x8');
    expect(result.panel).toBe('crop:32x32');
    expect(draw).toHaveBeenCalledTimes(16);
    expect(draw.mock.calls[0].slice(1)).toEqual([0, 26, 8, 8, 0, 0, 8, 8]);
    expect(draw.mock.calls.at(-1)?.slice(5)).toEqual([24, 24, 8, 8]);
  });

  it('does not turn missing or out-of-bounds frames into the whole sheet', async () => {
    canvasMock();
    await expect(uiAtlasImages('blob:sheet', { frames: [{ filename: 'bad', frame: { x: 500, y: 0, w: 24, h: 24 } }] }, new AbortController().signal)).rejects.toThrow('outside image');
    await expect(uiAtlasImages('blob:sheet', { frames: [{ filename: 'part', frame: { x: 0, y: 0, w: 8, h: 8 } }], meta: { nine_slice: { panel: { tl: 'part' } } } }, new AbortController().signal)).rejects.toThrow('missing part');
  });

  it('keeps member and case-sensitive frame identity separate', () => {
    expect(uiImageKey('UI', { member: 'sheet', frame: 'medal_S.png' })).toBe('UI:sheet#medal_S');
    expect(uiImageKey('UI', { frame: 'medal_s' })).not.toBe(uiImageKey('UI', { frame: 'medal_S' }));
  });

  it('honors cancellation before image decoding', async () => {
    canvasMock();
    const controller = new AbortController(); controller.abort();
    await expect(uiAtlasImages('blob:sheet', { frames: [{ filename: 'part', frame: { x: 0, y: 0, w: 8, h: 8 } }] }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
