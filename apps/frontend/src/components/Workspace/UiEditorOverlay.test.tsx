import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { UiEditorOverlay } from './UiEditorOverlay';

const api = vi.hoisted(() => ({
  getProjectGameContent: vi.fn(),
  getProjectAssets: vi.fn(),
  loadProjectAssetFile: vi.fn(),
  saveProjectGameContentDocument: vi.fn(),
}));

vi.mock('../../services/beeGameAdapter', () => ({ beeGameAdapter: api }));

const revision = 'a'.repeat(64);
const document = {
  schema: 'beegame-content.v1' as const,
  id: 'ui.hud',
  kind: 'ui-hud' as const,
  irRefs: ['presentation.hud'],
  assetRefs: ['asset.icon'],
  data: {
    rootId: 'hud.root',
    nodes: [
      { id: 'hud.root', role: 'hud', name: 'HUD' },
      {
        id: 'score',
        parentId: 'hud.root',
        role: 'status-text',
        name: 'Score',
        text: '0',
        assetRef: 'asset.icon',
        layout: { anchor: 'top-left', position: [24, 24] as [number, number], size: [160, 40] as [number, number] },
      },
    ],
  },
};

describe('UiEditorOverlay project connection', () => {
  beforeEach(() => {
    api.getProjectGameContent.mockResolvedValue({
      state: 'ready',
      documents: [{ path: 'ui/hud.ui.json', revision, document }],
    });
    api.getProjectAssets.mockResolvedValue({
      version: 9,
      requirements: [],
      resources: [{
        id: 'asset.icon', status: 'verified', root_path: 'assets/runtime/icon.png', file_paths: ['assets/runtime/icon.png'],
      }],
    });
    api.loadProjectAssetFile.mockResolvedValue(new Blob(['icon'], { type: 'image/png' }));
    api.saveProjectGameContentDocument.mockImplementation(async (_projectId, input) => ({
      path: input.path,
      revision: 'b'.repeat(64),
      contentRevision: 'c'.repeat(64),
      document: input.document,
    }));
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:ui-icon') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  it('loads, edits and revision-saves the canonical UI document', async () => {
    const user = userEvent.setup();
    render(<UiEditorOverlay projectId="project-1" onClose={vi.fn()} />);

    expect(await screen.findByRole('dialog', { name: 'UI Editor' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Score/ }));
    const text = screen.getByLabelText('Text');
    await user.clear(text);
    await user.type(text, '42');
    const x = screen.getByLabelText('Position X');
    await user.clear(x);
    await user.type(x, '80');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveProjectGameContentDocument).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        path: 'ui/hud.ui.json',
        expectedRevision: revision,
        document: expect.objectContaining({
          data: expect.objectContaining({
            nodes: expect.arrayContaining([
              expect.objectContaining({ id: 'score', text: '42', layout: expect.objectContaining({ position: [80, 24] }) }),
            ]),
          }),
        }),
      }),
    ));
    expect(api.loadProjectAssetFile).toHaveBeenCalledWith('project-1', 'asset.icon', 'assets/runtime/icon.png');
  });
});
