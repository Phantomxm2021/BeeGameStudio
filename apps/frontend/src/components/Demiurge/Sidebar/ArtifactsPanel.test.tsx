import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ArtifactsPanel } from './ArtifactsPanel';
import { BEEGAME_DOCUMENT_BASELINE } from '../../../utils/documentProgress';

const callbacks = () => ({ onPreview: vi.fn(), onDownload: vi.fn(), onOpenEditor: vi.fn(), onLoadEditorFiles: vi.fn() });

describe('ArtifactsPanel', () => {
    it('opens categories first, then the exact JSON file, and returns without opening an editor', () => {
        const actions = callbacks();
        render(<ArtifactsPanel artifacts={[]} isLoading={false} {...actions} editorFiles={[
            { kind: 'scene', id: 'scene.a', path: 'scenes/a.json' },
            { kind: 'scene', id: 'scene.b', path: 'scenes/nested/b.json' },
            { kind: 'ui', id: 'menu', path: 'ui/menu.json' },
        ]} />);
        expect(screen.queryByText('a.json')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Scene', exact: true }));
        expect(actions.onLoadEditorFiles).toHaveBeenCalledTimes(1);
        expect(actions.onOpenEditor).not.toHaveBeenCalled();
        expect(screen.getByText('a.json')).toBeInTheDocument();
        expect(screen.queryByText('menu.json')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /b.json/ }));
        expect(actions.onOpenEditor).toHaveBeenCalledWith('scene', 'scenes/nested/b.json');
        fireEvent.click(screen.getByRole('button', { name: 'Back to artifacts' }));
        fireEvent.click(screen.getByRole('button', { name: 'UI', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: /menu.json/ }));
        expect(actions.onOpenEditor).toHaveBeenLastCalledWith('ui', 'ui/menu.json');
        expect(screen.queryByText('a.json')).not.toBeInTheDocument();
    });

    it('groups all project documents with pending statuses and preview by artifact_id', () => {
        const actions = callbacks();
        render(<ArtifactsPanel artifacts={[
            { id: 'old-id', artifact_id: 'gdd', path: 'docs/GDD.md', name: 'GDD.md' },
            { id: 'review', path: 'docs/review/notes.md', name: 'Review notes.md' },
        ]} isLoading={false} {...actions} />);
        expect(screen.queryByText('GDD')).not.toBeInTheDocument();
        expect(screen.queryByText('Review notes.md')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Project documents/ }));
        const docs = screen.getByRole('region', { name: 'Project documents' });
        expect(docs.querySelectorAll('[data-status]')).toHaveLength(9);
        expect(docs.querySelectorAll('[data-status="pending"]')).toHaveLength(7);
        const gdd = within(docs).getByText('GDD', { exact: true }).closest('button')!;
        expect(gdd).toBeEnabled();
        fireEvent.click(gdd);
        expect(actions.onPreview).toHaveBeenCalledWith('gdd', 'GDD.md');
        expect(screen.queryByRole('button', { name: 'Download GDD.md' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Preview GDD.md' }));
        expect(actions.onPreview).toHaveBeenLastCalledWith('gdd', 'GDD.md');
        fireEvent.click(within(docs).getByText('Review notes.md', { exact: true }).closest('button')!);
        expect(actions.onPreview).toHaveBeenLastCalledWith('review', 'Review notes.md');
        expect(within(docs).getByRole('button', { name: /Balance Design/ })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Back to artifacts' }));
        expect(screen.queryByText('docs/GDD.md')).not.toBeInTheDocument();
    });

    it('keeps the eight canonical pending documents in their dependency order', () => {
        render(<ArtifactsPanel artifacts={[]} isLoading={false} {...callbacks()} documentProgress={BEEGAME_DOCUMENT_BASELINE.map(document => ({ ...document, status: 'pending' }))} />);
        expect(screen.getByText('0/8')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Project documents/ }));
        const rows = screen.getByRole('region', { name: 'Project documents' }).querySelectorAll('[data-status="pending"]');
        expect(rows).toHaveLength(8);
        expect([...rows].map(row => row.querySelector('.type-footnote')?.textContent)).toEqual(BEEGAME_DOCUMENT_BASELINE.map(doc => doc.name));
    });

    it('never displays manifest files on either level', () => {
        render(<ArtifactsPanel artifacts={[
            { id: 'manifest', path: 'assets/asset-manifest.json', name: 'asset-manifest.json' },
        ]} isLoading={false} {...callbacks()} />);
        expect(screen.queryByText('asset-manifest.json')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Project documents/ }));
        expect(screen.queryByText('asset-manifest.json')).not.toBeInTheDocument();
    });

    it('distinguishes loading, failure and empty file lists and supports refreshing', () => {
        const actions = callbacks();
        const props = { artifacts: [], isLoading: false, ...actions };
        const { rerender } = render(<ArtifactsPanel {...props} isEditorFilesLoading />);
        fireEvent.click(screen.getByRole('button', { name: 'Scene', exact: true }));
        expect(screen.getByLabelText('Loading files')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Refresh files' })).toBeDisabled();
        expect(screen.queryByText('No editable JSON files yet')).not.toBeInTheDocument();
        rerender(<ArtifactsPanel {...props} editorFilesError="Network unavailable" />);
        expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable');
        expect(screen.queryByText('No editable JSON files yet')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh files' }));
        expect(actions.onLoadEditorFiles).toHaveBeenCalledTimes(2);
        rerender(<ArtifactsPanel {...props} />);
        expect(screen.getByText('No editable JSON files yet')).toBeInTheDocument();
    });

    it('shows initial skeletons and artifact fetch errors', () => {
        render(<ArtifactsPanel artifacts={[]} isLoading error="Unable to load deliverables" {...callbacks()} />);
        expect(screen.getByLabelText('Loading artifacts...')).toBeInTheDocument();
        expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
        expect(screen.getByRole('alert')).toHaveTextContent('Unable to load deliverables');
    });

    it.each([true, false])('keeps project packages download-only, respecting export permission (%s)', canExportProject => {
        const actions = callbacks();
        render(<ArtifactsPanel artifacts={[{ id: 'package', name: 'game.zip', package_download: true }]} isLoading={false} {...actions} canExportProject={canExportProject} />);
        expect(screen.getByRole('button', { name: 'game.zip', exact: true })).toBeDisabled();
        if (canExportProject) {
            fireEvent.click(screen.getByRole('button', { name: 'Download game.zip' }));
            expect(actions.onDownload).toHaveBeenCalledWith('package', 'game.zip');
        } else expect(screen.queryByRole('button', { name: 'Download game.zip' })).not.toBeInTheDocument();
        expect(actions.onPreview).not.toHaveBeenCalled();
    });
});
