import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ArtifactsPanel } from './ArtifactsPanel';

const callbacks = () => ({ onPreview: vi.fn(), onDownload: vi.fn(), onOpenEditor: vi.fn(), onLoadEditorFiles: vi.fn(), onOpenAssets: vi.fn() });

describe('ArtifactsPanel', () => {
    it('puts resources beside Scene, UI and project documents', () => {
        const actions = callbacks();
        render(<ArtifactsPanel artifacts={[]} isLoading={false} {...actions} editorFiles={[
            { kind: 'scene', id: 'scene.a', path: 'scenes/a.json' },
            { kind: 'ui', id: 'menu', path: 'ui/menu.json' },
        ]} />);
        const list = screen.getByRole('region', { name: 'Artifacts' });
        expect(within(list).getAllByRole('button').map(button => button.textContent)).toEqual(['Scene', 'UI', 'Project documents', 'Assets']);
        fireEvent.click(within(list).getByRole('button', { name: 'Assets' }));
        expect(actions.onOpenAssets).toHaveBeenCalledOnce();
        fireEvent.click(within(list).getByRole('button', { name: 'Scene' }));
        expect(actions.onLoadEditorFiles).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: /a.json/ }));
        expect(actions.onOpenEditor).toHaveBeenCalledWith('scene', 'scenes/a.json');
        fireEvent.click(screen.getByRole('button', { name: 'Back to artifacts' }));
        fireEvent.click(within(screen.getByRole('region', { name: 'Artifacts' })).getByRole('button', { name: 'UI' }));
        fireEvent.click(screen.getByRole('button', { name: /menu.json/ }));
        expect(actions.onOpenEditor).toHaveBeenLastCalledWith('ui', 'ui/menu.json');
    });

    it('shows only discovered documents with one View action each', () => {
        const actions = callbacks();
        render(<ArtifactsPanel artifacts={[
            { id: 'old-id', artifact_id: 'gdd', path: 'docs/GDD.md', name: 'GDD.md' },
            { id: 'review', path: 'docs/review/notes.md', name: 'Review notes.md' },
            { id: 'manifest', path: 'assets/asset-manifest.json', name: 'asset-manifest.json' },
        ]} isLoading={false} {...actions} />);
        fireEvent.click(screen.getByRole('button', { name: 'Project documents' }));
        const docs = screen.getByRole('region', { name: 'Project documents' });
        expect(within(docs).getAllByRole('button')).toHaveLength(2);
        expect(within(docs).getByText('docs/GDD.md')).toBeInTheDocument();
        expect(within(docs).queryByText('asset-manifest.json')).not.toBeInTheDocument();
        expect(within(docs).queryByText('Ready')).not.toBeInTheDocument();
        fireEvent.click(within(docs).getByRole('button', { name: 'View GDD.md' }));
        expect(actions.onPreview).toHaveBeenCalledWith('gdd', 'GDD.md');
        fireEvent.click(within(docs).getByRole('button', { name: 'View Review notes.md' }));
        expect(actions.onPreview).toHaveBeenLastCalledWith('review', 'Review notes.md');
    });

    it.each(['Scene', 'UI', 'Project documents'])('shows the shared empty card in %s', category => {
        render(<ArtifactsPanel artifacts={[]} isLoading={false} {...callbacks()} />);
        fireEvent.click(screen.getByRole('button', { name: category }));
        expect(screen.getByTestId('artifact-empty-card')).toBeInTheDocument();
    });

    it('distinguishes loading, failure and empty editor file lists', () => {
        const actions = callbacks();
        const props = { artifacts: [], isLoading: false, ...actions };
        const { rerender } = render(<ArtifactsPanel {...props} isEditorFilesLoading />);
        fireEvent.click(screen.getByRole('button', { name: 'Scene' }));
        expect(screen.getByLabelText('Loading files')).toBeInTheDocument();
        expect(screen.queryByTestId('artifact-empty-card')).not.toBeInTheDocument();
        rerender(<ArtifactsPanel {...props} editorFilesError="Network unavailable" />);
        expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable');
        expect(screen.queryByTestId('artifact-empty-card')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh files' }));
        expect(actions.onLoadEditorFiles).toHaveBeenCalledTimes(2);
        rerender(<ArtifactsPanel {...props} />);
        expect(screen.getByTestId('artifact-empty-card')).toHaveTextContent('No editable JSON files yet');
    });

    it('shows fixed categories immediately while artifacts load and retains fetch errors', () => {
        render(<ArtifactsPanel artifacts={[]} isLoading error="Unable to load deliverables" {...callbacks()} />);
        const list = screen.getByRole('region', { name: 'Artifacts' });
        expect(within(list).getAllByRole('button').map(button => button.textContent)).toEqual(['Scene', 'UI', 'Project documents', 'Assets']);
        expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
        expect(screen.getByRole('alert')).toHaveTextContent('Unable to load deliverables');
    });

    it.each(['scene', 'ui'] as const)('keeps the %s list visible with the exact error on its affected file', kind => {
        const actions = callbacks();
        const error = 'data.nodes.5.responsive.compact.layout: Unrecognized key: "gap"';
        render(<ArtifactsPanel artifacts={[]} isLoading={false} {...actions} lang="zh" editorFiles={[
            { kind, id: 'healthy', path: `${kind}/healthy.json` },
            { kind, id: 'invalid', path: `${kind}/invalid.json`, error },
        ]} />);
        fireEvent.click(screen.getByRole('button', { name: kind === 'scene' ? 'Scene' : 'UI', exact: true }));
        const list = screen.getByRole('region', { name: `${kind === 'scene' ? 'Scene' : 'UI'} files` });
        const invalid = within(list).getByRole('button', { name: /invalid.json/ });
        expect(invalid).toBeDisabled();
        expect(within(invalid).getByRole('alert')).toHaveTextContent(`文件校验错误：${error}`);
        expect(within(list).queryByTestId('artifact-empty-card')).not.toBeInTheDocument();
        fireEvent.click(invalid);
        expect(actions.onOpenEditor).not.toHaveBeenCalled();
        fireEvent.click(within(list).getByRole('button', { name: /healthy.json/ }));
        expect(actions.onOpenEditor).toHaveBeenCalledWith(kind, `${kind}/healthy.json`);
    });

    it.each([true, false])('moves project package download to Export (%s)', canExportProject => {
        const actions = callbacks();
        render(<ArtifactsPanel artifacts={[{ id: 'package', name: 'game.zip', package_download: true }]} isLoading={false} {...actions} canExportProject={canExportProject} />);
        expect(screen.queryByText('Other deliverables')).not.toBeInTheDocument();
        expect(screen.queryByText('game.zip')).not.toBeInTheDocument();
        if (canExportProject) {
            fireEvent.click(screen.getByRole('button', { name: 'Export' }));
            expect(actions.onDownload).toHaveBeenCalledWith('package', 'game.zip');
        } else expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
        expect(actions.onPreview).not.toHaveBeenCalled();
    });
});
