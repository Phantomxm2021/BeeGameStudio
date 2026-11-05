import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPublicationCoverCandidates } from './publicationCoverCandidates';
import { beeGameAdapter } from '../../services/beeGameAdapter';
import type { BeeGameProjectResourcePayload } from '../../services/api';
import zh from '../../i18n/locales/zh.json';

vi.mock('../../services/beeGameAdapter', () => ({ beeGameAdapter: { getProjectAssets: vi.fn(), loadProjectAssetFile: vi.fn(), capturePublicationCovers: vi.fn() } }));
const labels = zh.beegame.livePreview;
const resource = (id: string, paths: string[], status: BeeGameProjectResourcePayload['status'] = 'verified'): BeeGameProjectResourcePayload => ({
  id, status, root_path: paths[0], file_paths: paths, source: { type: 'agent-authored', created_at: '', reason: 'fixture' },
  provisional: false, selected_at: '', selection_reason: [],
});

describe('existing project cover candidates', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(beeGameAdapter.capturePublicationCovers).mockResolvedValue({ covers: [1, 2, 3].map(n => ({ mediaType: 'image/webp', filename: `game-preview-${n}.webp`, data: `frame-${n}` })) });
    let sample = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), fillRect: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(64 * 36 * 4).fill((sample++ * 80) % 256) })) } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/webp;base64,processed');
    vi.stubGlobal('Image', class {
      naturalWidth = 1600; naturalHeight = 1000; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.mocked(beeGameAdapter.loadProjectAssetFile).mockResolvedValue(new Blob(['fixture'], { type: 'image/png' }));
  });
  it('reads three distinct existing image paths, excluding failed resources and non-images', async () => {
    vi.mocked(beeGameAdapter.getProjectAssets).mockResolvedValue({ version: 9, requirements: [], resources: [
      resource('failed', ['bad.png'], 'failed'),
      resource('art', ['one.png', 'music.ogg', 'two.jpg', 'three.webp', 'four.png']),
      resource('duplicate', ['one.png']),
    ] });
    const signal = new AbortController().signal;
    const result = await loadPublicationCoverCandidates('project', labels, signal);
    expect(result.map(cover => cover.filename)).toEqual(['one.webp', 'two.webp', 'three.webp']);
    expect(beeGameAdapter.loadProjectAssetFile).toHaveBeenCalledTimes(3);
    expect(beeGameAdapter.loadProjectAssetFile).toHaveBeenCalledWith('project', 'art', 'one.png', signal);
    expect(beeGameAdapter.capturePublicationCovers).not.toHaveBeenCalled();
    const context = document.createElement('canvas').getContext('2d')!;
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 50, 1600, 900, 0, 0, 1280, 720);
  });
  it('fills missing options with three-frame captures instead of duplicating project images', async () => {
    vi.mocked(beeGameAdapter.getProjectAssets).mockResolvedValue({ version: 9, requirements: [], resources: [resource('art', ['one.png', 'one.png'])] });
    expect((await loadPublicationCoverCandidates('project', labels)).map(cover => cover.filename)).toEqual(['one.webp', 'game-preview-1.webp', 'game-preview-2.webp']);
    vi.mocked(beeGameAdapter.getProjectAssets).mockResolvedValue({ version: 9, requirements: [], resources: [] });
    expect((await loadPublicationCoverCandidates('project', labels)).map(cover => cover.filename)).toEqual(['game-preview-1.webp', 'game-preview-2.webp', 'game-preview-3.webp']);
  });
  it('uses screenshots when project images are icons or square textures', async () => {
    vi.stubGlobal('Image', class {
      naturalWidth = 128; naturalHeight = 128; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.mocked(beeGameAdapter.getProjectAssets).mockResolvedValue({ version: 9, requirements: [], resources: [resource('icons', ['icon.png'])] });
    const result = await loadPublicationCoverCandidates('project', labels);
    expect(result.map(cover => cover.data)).toEqual(['frame-1', 'frame-2', 'frame-3']);
    expect(beeGameAdapter.capturePublicationCovers).toHaveBeenCalledExactlyOnceWith('project');
  });
  it('compares visible image content and does not fill slots with repeated views', async () => {
    const context = document.createElement('canvas').getContext('2d')!;
    vi.mocked(context.getImageData).mockReturnValue({ data: new Uint8ClampedArray(64 * 36 * 4).fill(30) } as ImageData);
    vi.mocked(beeGameAdapter.getProjectAssets).mockResolvedValue({ version: 9, requirements: [], resources: [resource('art', ['one.png', 'copy.jpg', 'another-copy.webp'])] });
    const result = await loadPublicationCoverCandidates('project', labels);
    expect(result.map(cover => cover.filename)).toEqual(['one.webp']);
    expect(beeGameAdapter.capturePublicationCovers).toHaveBeenCalledOnce();
  });
  it('reports resource read failures instead of pretending the project has no images', async () => {
    vi.mocked(beeGameAdapter.getProjectAssets).mockRejectedValue(new Error('Asset manifest unreadable'));
    await expect(loadPublicationCoverCandidates('project', labels)).rejects.toThrow('Asset manifest unreadable');
    vi.mocked(beeGameAdapter.getProjectAssets).mockResolvedValue({ version: 9, requirements: [], resources: [resource('art', ['one.png'])] });
    vi.mocked(beeGameAdapter.loadProjectAssetFile).mockRejectedValue(new Error('Image unavailable'));
    await expect(loadPublicationCoverCandidates('project', labels)).rejects.toThrow('Image unavailable');
  });
});
