import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AssetsPanel } from './AssetsPanel';

describe('AssetsPanel', () => {
    it('shows Resource Library elements as independent project imports', () => {
        render(<AssetsPanel manifest={{
            version: 5,
            requirements: [{ id: 'forest-scene', purpose: 'A navigable forest' }],
            imports: [{
                id: 'oak-variant-a',
                source: { type: 'resource-library', pack_id: 'fantasy-pack', pack_version: '1.2.0', element_id: 'oak-glb' },
                status: 'available', root_path: 'assets/library/oak/oak.glb', local_files: ['assets/library/oak/oak.glb'],
                selected_at: '2026-07-11T00:00:00.000Z', selection_reason: ['explicit-selection'],
            }],
        }} isLoading={false} />);

        expect(screen.getByText('oak-variant-a')).toBeInTheDocument();
        expect(screen.getAllByText('assets/library/oak/oak.glb')).toHaveLength(2);
        expect(screen.getByText(/fantasy-pack · v1\.2\.0/)).toBeInTheDocument();
        expect(screen.getByText('A navigable forest')).toBeInTheDocument();
    });

    it('uses shadcn skeletons while asset data loads', () => {
        render(<AssetsPanel manifest={null} isLoading onUpload={vi.fn()} />);
        expect(screen.getByLabelText(/Loading asset/i)).toBeInTheDocument();
        expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    });

    it('shows authored compositions separately from imports and requirements', () => {
        render(<AssetsPanel manifest={{
            version: 5,
            project_target: { platform: 'portable', runtime: 'custom-runtime' },
            requirements: [{ id: 'play-space', name: 'Playable space' }],
            imports: [{
                id: 'tower-kit', source: { type: 'resource-library', pack_id: 'kit', pack_version: '2', element_id: 'tower' },
                status: 'referenced', root_path: 'assets/library/tower.glb', local_files: ['assets/library/tower.glb'], selected_at: 'now', selection_reason: [],
            }],
            compositions: [{ id: 'level-one', kind: 'scene', status: 'assembled', members: [{ import_id: 'tower-kit', role: 'tower-variants' }], recipe: { path: 'game/level-one.scene' } }],
        }} isLoading={false} />);

        expect(screen.getByText('custom-runtime · File integration')).toBeInTheDocument();
        expect(screen.getByText('scene · 1 members')).toBeInTheDocument();
        expect(screen.getByText('game/level-one.scene')).toBeInTheDocument();
        expect(screen.getByText('tower-kit')).toBeInTheDocument();
        expect(screen.getByText('Playable space')).toBeInTheDocument();
    });

    it('keeps target integration metadata at project level instead of binding a requirement to a Pack element', () => {
        render(<AssetsPanel manifest={{
            version: 5,
            project_target: { platform: 'native', runtime: 'custom-engine', integration_mode: 'mcp', mcp_server: 'engine-mcp' },
            requirements: [{ id: 'player-character', name: 'Player character', purpose: 'Playable character', required: true }],
        }} isLoading={false} />);

        expect(screen.getByText('custom-engine · MCP integration')).toBeInTheDocument();
        expect(screen.getByText('Player character')).toBeInTheDocument();
        expect(screen.getByText('Playable character')).toBeInTheDocument();
        expect(screen.queryByText(/pack-/i)).not.toBeInTheDocument();
    });

    it('allows a user-provided file for one requirement without presenting legacy library binding actions', async () => {
        const user = userEvent.setup();
        const onUpload = vi.fn(async () => undefined);
        render(<AssetsPanel manifest={{ version: 5, requirements: [{ id: 'main-logo', name: 'Main logo' }] }} isLoading={false} onUpload={onUpload} />);

        const file = new File(['logo'], 'logo.png', { type: 'image/png' });
        await user.upload(screen.getByLabelText('Upload replacement'), file);
        expect(onUpload).toHaveBeenCalledWith('main-logo', file);
        expect(screen.queryByRole('button', { name: 'More asset actions' })).not.toBeInTheDocument();
    });

    it('shows native current-revision acceptance separately from manifest completion claims', () => {
        const { rerender } = render(
            <AssetsPanel
                manifest={{ version: 5, requirements: [{ id: 'level-art' }], imports: [], compositions: [] }}
                isLoading={false}
                acceptance={{ status: 'not_run' }}
                lang="zh"
            />,
        );
        expect(screen.getByTestId('asset-acceptance-status')).toHaveTextContent('尚未运行时验收');

        rerender(
            <AssetsPanel
                manifest={{ version: 5, requirements: [{ id: 'level-art' }], imports: [], compositions: [] }}
                isLoading={false}
                acceptance={{ status: 'stale', summary: 'Project files changed after validation.' }}
                lang="zh"
            />,
        );
        expect(screen.getByTestId('asset-acceptance-status')).toHaveTextContent('修改后待重新验收');
        expect(screen.getByTestId('asset-acceptance-status')).toHaveAttribute('title', 'Project files changed after validation.');
    });
});
