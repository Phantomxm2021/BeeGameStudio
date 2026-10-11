import { afterEach, expect, it, vi } from 'vitest';
import { loadUiFont } from './uiResourceLoading';
import { uiFontKey } from '../../../../../packages/scene-editor/src/ui-font-reference';
import { uiNodeStyle } from './UiContentRenderer';
import type { BeeGameUiContentNode } from '../../services/beeGameAdapter';

afterEach(() => vi.unstubAllGlobals());
it('loads selected font bytes and keeps member identities distinct through rendering', async () => {
  class Face {
    status = 'loaded';
    constructor(public family: string, public bytes: ArrayBuffer) {}
    async load() { return this; }
  }
  vi.stubGlobal('FontFace', Face);
  const resource = { id: 'FONT', root_path: 'fonts/regular.ttf', file_paths: ['fonts/regular.ttf', 'fonts/bold.ttf'] };
  const read = vi.fn(async (path: string) => ({ arrayBuffer: async () => new TextEncoder().encode(path).buffer } as Blob));
  const regular = (await loadUiFont(resource, read))!, bold = (await loadUiFont(resource, read, 'fonts/bold.ttf'))!;
  expect(read.mock.calls.map(call => call[0])).toEqual(resource.file_paths);
  expect(regular.family).not.toBe(bold.family);
  expect(regular.keys).toContain('FONT'); expect(bold.keys).not.toContain('FONT');
  const families = Object.fromEntries([regular, bold].flatMap(font => font.keys.map(key => [key, font.family])));
  const node = { id: 'label', role: 'text', text: 'Test', data: { font: { assetRef: 'FONT', member: 'fonts/bold.ttf' } } } as BeeGameUiContentNode;
  expect(families[uiFontKey(node.data!.font)!]).toBe(bold.family);
  expect(uiNodeStyle(node, false, families, [node]).fontFamily).toContain(bold.family);
  expect(uiNodeStyle(node, false, { FONT: regular.family }, [node]).fontFamily).toBeUndefined();
  await expect(loadUiFont(resource, read, 'fonts/missing.ttf')).rejects.toThrow('registered font member');
  expect(read).toHaveBeenCalledTimes(2);
});
