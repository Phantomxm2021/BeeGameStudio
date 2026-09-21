import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneDocument } from '@beegame/scene-editor';
import { beeGameAdapter, type BeeGameSceneContentDocument } from '../../services/beeGameAdapter';
import { SceneEditorOverlay } from './SceneEditorOverlay';

vi.mock('@beegame/scene-editor', async importOriginal => ({
  ...await importOriginal<typeof import('@beegame/scene-editor')>(),
  SceneEditor: ({ initialDocument }: { initialDocument: SceneDocument }) => (
    <div data-testid="loaded-scene">
      {initialDocument.name}
      {Object.values(initialDocument.assets).map(asset => <span key={asset.id}>{asset.name}{asset.spriteSheet ? ` frame ${('frames' in asset.spriteSheet ? Object.keys(asset.spriteSheet.frames).length : asset.spriteSheet.frameWidth)}` : ''}</span>)}
    </div>
  ),
}));

describe('SceneEditorOverlay loading experience', () => {
  afterEach(() => vi.restoreAllMocks());

  it('Escape cancels pending loads before the editor mounts', () => {
    let requestSignal: AbortSignal | undefined;
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockImplementation((_id, signal) => {
      requestSignal = signal;
      return new Promise(() => {});
    });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockImplementation(() => new Promise(() => {}));
    const close = vi.fn();
    render(<SceneEditorOverlay projectId="cancel-loading" onClose={close} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(requestSignal?.aborted).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(['scene-2d', 'scene-3d'] as const)('opens a valid %s with verified project resources', async kind => {
    const revision = 'a'.repeat(64);
    const document: BeeGameSceneContentDocument = {
      schema: 'beegame-content.v1', id: 'existing-scene', kind, assetRefs: ['RES-AUDIO'],
      data: { nodes: [
        { id: 'root', name: 'Scene Root', components: [] },
        { id: 'audio', parentId: 'root', components: [
          { id: 'audio-source', type: 'audio-source', assetRef: 'RES-AUDIO', data: { volume: 0 } },
        ] },
      ] },
    };
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockResolvedValue({
      state: 'ready',
      index: {
        schema: 'beegame-content-package.v2', id: 'content', dimension: kind === 'scene-2d' ? '2d' : '3d',
        documentRevision: revision, assetManifestRevision: revision, entryScene: document.id,
        sceneModel: 'game-object-v2', files: ['content/scene.json'],
      },
      documents: [{ path: 'content/scene.json', revision, document }],
    });
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockResolvedValue({
      contract_state: 'ready', version: 9, requirements: [],
      resources: [
        { id: 'RES-AUDIO', root_path: 'forest.ogg', file_paths: ['forest.ogg'], status: 'verified' as const },
        { id: 'RES-EXTRA', root_path: 'extra.png', file_paths: ['extra.png', 'extra.json'], status: 'verified' as const },
        { id: 'RES-PENDING', root_path: 'pending.png', file_paths: ['pending.png'], status: 'available' as const },
      ].map(resource => ({
        ...resource, source: { type: 'agent-authored' as const, created_at: '2026-09-19', reason: 'test' },
        provisional: false, selected_at: '2026-09-19', selection_reason: [],
      })),
    });
    const loadAsset = vi.spyOn(beeGameAdapter, 'loadProjectAssetFile').mockImplementation(async (_project, _resource, path) => path.endsWith('.json')
      ? new Blob([JSON.stringify({ frameWidth: 44, frameHeight: 44, states: ['normal', 'hover'] })], { type: 'application/json' })
      : new Blob(['image'], { type: 'image/png' }));
    render(<SceneEditorOverlay projectId="project-1" onClose={vi.fn()} />);
    expect(await screen.findByTestId('loaded-scene')).toHaveTextContent('existing-scene');
    expect(screen.getByTestId('loaded-scene')).toHaveTextContent('forest.ogg');
    expect(screen.getByTestId('loaded-scene')).toHaveTextContent('extra.png frame 44');
    expect(loadAsset).toHaveBeenCalledWith('project-1', 'RES-EXTRA', 'extra.png', expect.any(AbortSignal));
    expect(loadAsset).not.toHaveBeenCalledWith('project-1', 'RES-PENDING', expect.anything(), expect.anything());
    expect(screen.queryByText('Could not open scene')).not.toBeInTheDocument();
  });

  it('shows no navigation chrome and closes after interrupting an in-flight load', () => {
    const signals: AbortSignal[] = [];
    const pending = (_projectId: string, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      if (!signal) return;
      signals.push(signal);
      signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true });
    });
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockImplementation(pending);
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockImplementation(pending);
    const onClose = vi.fn();

    const { container } = render(<SceneEditorOverlay projectId="project-1" onClose={onClose} />);

    expect(container.querySelector('header')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Scene loading progress' })).toHaveAttribute('aria-valuenow', '8');
    expect(screen.queryByRole('button', { name: 'Back to project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close Scene Editor' })).not.toBeInTheDocument();

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveClass('border', 'bg-transparent');
    fireEvent.click(cancel);

    expect(signals).toHaveLength(2);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
