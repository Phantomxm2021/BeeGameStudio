import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { SceneDocument } from '@beegame/scene-editor';
import { SceneEditorOverlay } from './SceneEditorOverlay';

const api = vi.hoisted(() => ({
  getProjectGameContent: vi.fn(),
  getProjectAssets: vi.fn(),
  loadProjectAssetFile: vi.fn(),
  saveProjectGameContentDocument: vi.fn(),
}));

vi.mock('../../services/beeGameAdapter', () => ({ beeGameAdapter: api }));

vi.mock('@beegame/scene-editor', () => ({
  SceneEditor: ({ initialDocument, initialProjection, onSave }: {
    initialDocument: SceneDocument;
    initialProjection: string;
    onSave: (document: SceneDocument) => Promise<void>;
  }) => (
    <div>
      <span>{initialDocument.nodes.background?.name}</span>
      <span>{initialProjection}</span>
      <span>{initialDocument.assets['asset.background']?.uri}</span>
      <span>{initialDocument.nodes.background?.material?.textureRegion?.width}</span>
      <button type="button" onClick={() => void onSave(initialDocument)}>Save project scene</button>
    </div>
  ),
}));

const revision = 'a'.repeat(64);
const assetRevision = 'b'.repeat(64);
const canonicalScene = {
  schema: 'beegame-content.v1' as const,
  id: 'scene.main',
  kind: 'scene-2d' as const,
  irRefs: ['world.main'],
  assetRefs: ['asset.background'],
  data: {
    nodes: [
      { id: 'world', kind: 'group' },
      { id: 'background', parentId: 'world', name: 'Project Background', kind: 'sprite', assetRef: 'asset.background', frameRef: 'background.full' },
    ],
  },
};

describe('SceneEditorOverlay project connection', () => {
  beforeEach(() => {
    api.getProjectGameContent.mockReset();
    api.getProjectAssets.mockReset();
    api.loadProjectAssetFile.mockReset();
    api.saveProjectGameContentDocument.mockReset();
    api.getProjectGameContent.mockResolvedValue({
      state: 'ready',
      contentRevision: revision,
      index: {
        schema: 'beegame-content-package.v1',
        id: 'game-content',
        dimension: '2d',
        irRevision: revision,
        assetManifestRevision: assetRevision,
        entryScene: 'scene.main',
        files: ['scenes/main.scene.json'],
      },
      documents: [{
        path: 'scenes/main.scene.json',
        revision,
        document: canonicalScene,
      }],
    });
    api.getProjectAssets.mockResolvedValue({
      version: 9,
      requirements: [],
      resources: [{
        id: 'asset.background',
        status: 'verified',
        root_path: 'assets/runtime/background.png',
        file_paths: ['assets/runtime/background.png'],
        content_profile: {
          components: [{
            id: 'background.full',
            kind: 'sprite-frame',
            specs: { x: 0, y: 0, width: 320, height: 180 },
          }],
        },
      }],
    });
    api.loadProjectAssetFile.mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:project-background'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    api.saveProjectGameContentDocument.mockResolvedValue({
      path: 'scenes/main.scene.json',
      revision: assetRevision,
      contentRevision: assetRevision,
      document: canonicalScene,
    });
  });

  it('loads the project entry scene and saves it through the revision-checked API', async () => {
    const user = userEvent.setup();
    render(<SceneEditorOverlay projectId="project-1" onClose={vi.fn()} />);

    expect(await screen.findByText('Project Background')).toBeInTheDocument();
    expect(screen.getByText('orthographic')).toBeInTheDocument();
    expect(screen.getByText('blob:project-background')).toBeInTheDocument();
    expect(screen.getByText('320')).toBeInTheDocument();
    expect(api.getProjectGameContent).toHaveBeenCalledWith('project-1');
    expect(api.loadProjectAssetFile).toHaveBeenCalledWith(
      'project-1',
      'asset.background',
      'assets/runtime/background.png',
    );

    await user.click(screen.getByRole('button', { name: 'Save project scene' }));
    await waitFor(() => expect(api.saveProjectGameContentDocument).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        path: 'scenes/main.scene.json',
        expectedRevision: revision,
        document: canonicalScene,
      }),
    ));
  });
});
