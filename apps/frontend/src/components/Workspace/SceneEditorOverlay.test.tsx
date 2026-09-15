import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { SceneDocument } from '@beegame/scene-editor';
import { SceneEditorOverlay } from './SceneEditorOverlay';

const api = vi.hoisted(() => ({
  getProjectGameContent: vi.fn(),
  saveProjectGameContentDocument: vi.fn(),
}));

vi.mock('../../services/beeGameAdapter', () => ({ beeGameAdapter: api }));

vi.mock('@beegame/scene-editor', () => ({
  SceneEditor: ({ initialDocument, onSave }: {
    initialDocument: SceneDocument;
    onSave: (document: SceneDocument) => Promise<void>;
  }) => (
    <div>
      <span>{initialDocument.nodes.background?.name}</span>
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
  assetRefs: [],
  data: {
    nodes: [
      { id: 'world', kind: 'group' },
      { id: 'background', parentId: 'world', name: 'Project Background', kind: 'sprite' },
    ],
  },
};

describe('SceneEditorOverlay project connection', () => {
  beforeEach(() => {
    api.getProjectGameContent.mockReset();
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
    expect(api.getProjectGameContent).toHaveBeenCalledWith('project-1');

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
