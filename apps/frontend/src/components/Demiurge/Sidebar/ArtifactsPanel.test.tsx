import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ArtifactsPanel } from './ArtifactsPanel';
import { BEEGAME_DOCUMENT_BASELINE } from '../../../utils/documentProgress';

describe('ArtifactsPanel', () => {
    it('shows the Scene & UI entries and routes both through one editor callback', async () => {
        const user = userEvent.setup();
        const onOpenEditor = vi.fn();
        render(
            <ArtifactsPanel
                artifacts={[]}
                isLoading={false}
                documentProgress={BEEGAME_DOCUMENT_BASELINE.map(document => ({ ...document, status: 'pending' }))}
                onPreview={vi.fn()}
                onDownload={vi.fn()}
                onOpenEditor={onOpenEditor}
            />
        );

        expect(screen.getByRole('region', { name: 'Scene & UI' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Scene' }));
        await user.click(screen.getByRole('button', { name: 'UI' }));
        expect(onOpenEditor).toHaveBeenNthCalledWith(1, 'scene');
        expect(onOpenEditor).toHaveBeenNthCalledWith(2, 'ui');
    });

    it('renders all eight canonical documents with pending rows disabled by status', () => {
        render(
            <ArtifactsPanel
                artifacts={[]}
                isLoading={false}
                documentProgress={BEEGAME_DOCUMENT_BASELINE.map(document => ({ ...document, status: 'pending' }))}
                onPreview={vi.fn()}
                onDownload={vi.fn()}
            />
        );

        const rows = screen.getByRole('region', { name: 'Project documents' }).querySelectorAll('[data-status="pending"]');
        expect(rows).toHaveLength(8);
        expect(screen.getByText('0/8')).toBeInTheDocument();
        expect([...rows].map(row => row.querySelector('.type-footnote')?.textContent)).toEqual([
            'GDD', 'Level / Scene Design', 'Balance Design', 'Technical Design',
            'Art Direction', 'UI / UX', 'Audio Design', 'Asset Plan',
        ]);
    });

    it('uses semantic skeletons while artifact data loads', () => {
        render(
            <ArtifactsPanel
                artifacts={[]}
                isLoading
                reviewStatuses={{}}
                onPreview={vi.fn()}
                onDownload={vi.fn()}
            />
        );

        expect(screen.getByLabelText('Loading artifacts...')).toBeInTheDocument();
        expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    });

    it('uses artifact_id for review status lookup and preview/download callbacks', async () => {
        const user = userEvent.setup();
        const onPreview = vi.fn();
        const onDownload = vi.fn();

        render(
            <ArtifactsPanel
                artifacts={[
                    {
                        id: 'legacy-id',
                        artifact_id: 'art_1',
                        name: 'Review notes.md',
                        artifact_type: 'GDD',
                        author: 'metis',
                    },
                ]}
                isLoading={false}
                reviewStatuses={{
                    art_1: {
                        outcome: 'approved',
                        votes: [
                            {
                                reviewer_id: 'logos',
                                verdict: 'approved',
                            },
                        ],
                        assigned_reviewers: ['logos'],
                    },
                }}
                onPreview={onPreview}
                onDownload={onDownload}
            />
        );

        const table = screen.getByRole('table');
        expect(table).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'Type' })).not.toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument();
        expect(screen.queryByText(/review: approved/i)).not.toBeInTheDocument();
        const scrollRegion = screen.getByText('Review notes.md').closest('.overflow-y-auto');
        expect(scrollRegion).toHaveClass('overflow-y-auto');
        expect(scrollRegion).not.toHaveClass('scrollbar-hide');

        await user.click(screen.getByTitle('Preview'));
        await user.click(screen.getByTitle('Download'));

        expect(onPreview).toHaveBeenCalledWith('art_1', 'Review notes.md');
        expect(onDownload).toHaveBeenCalledWith('art_1', 'Review notes.md');
    });

    it('shows dependency-ordered document progress before files are all available', () => {
        render(
            <ArtifactsPanel
                artifacts={[]}
                isLoading={false}
                reviewStatuses={{}}
                documentProgress={[
                    { path: 'docs/GDD.md', name: 'GDD', stage: 1, status: 'ready' },
                    { path: 'docs/ART_DIRECTION.md', name: 'Art Direction', stage: 2, status: 'writing' },
                    { path: 'docs/TECHNICAL_DESIGN.md', name: 'Technical Design', stage: 3, status: 'pending' },
                ]}
                onPreview={vi.fn()}
                onDownload={vi.fn()}
            />
        );

        expect(screen.getByRole('region', { name: 'Project documents' })).toBeInTheDocument();
        expect(screen.getByText('1/8')).toBeInTheDocument();
        expect(screen.getByText('Writing')).toBeInTheDocument();
        expect(screen.queryByText('No artifacts yet')).not.toBeInTheDocument();
    });

    it('shows artifact loading failures in the panel', () => {
        render(
            <ArtifactsPanel
                artifacts={[]}
                isLoading={false}
                reviewStatuses={{}}
                documentProgress={[]}
                error="无法加载交付物，请稍后重试。"
                onPreview={vi.fn()}
                onDownload={vi.fn()}
            />
        );

        expect(screen.getByRole('alert')).toHaveTextContent('无法加载交付物');
    });

    it('falls back to id when artifact_id is absent', async () => {
        const user = userEvent.setup();
        const onPreview = vi.fn();
        const onDownload = vi.fn();

        render(
            <ArtifactsPanel
                artifacts={[
                    {
                        id: 'art_legacy',
                        name: 'Legacy.md',
                        artifact_type: 'Document',
                    },
                ]}
                isLoading={false}
                reviewStatuses={{}}
                onPreview={onPreview}
                onDownload={onDownload}
            />
        );

        await user.click(screen.getByTitle('Preview'));
        await user.click(screen.getByTitle('Download'));

        expect(onPreview).toHaveBeenCalledWith('art_legacy', 'Legacy.md');
        expect(onDownload).toHaveBeenCalledWith('art_legacy', 'Legacy.md');
    });

    it('shows project packages as download-only artifacts', async () => {
        const user = userEvent.setup();
        const onPreview = vi.fn();
        const onDownload = vi.fn();

        render(
            <ArtifactsPanel
                artifacts={[
                    {
                        id: 'beegame-project-package:proj_1',
                        artifact_id: 'beegame-project-package:proj_1',
                        name: 'sample-game.zip',
                        artifact_type: 'Project Package',
                        package_download: true,
                    },
                ]}
                isLoading={false}
                reviewStatuses={{}}
                onPreview={onPreview}
                onDownload={onDownload}
            />
        );

        expect(screen.queryByTitle('Preview')).not.toBeInTheDocument();
        expect(screen.queryByText('Generated on download')).not.toBeInTheDocument();

        await user.click(screen.getByTitle('Download'));

        expect(onPreview).not.toHaveBeenCalled();
        expect(onDownload).toHaveBeenCalledWith('beegame-project-package:proj_1', 'sample-game.zip');
    });

    it('hides project package downloads when export permission is missing', () => {
        render(
            <ArtifactsPanel
                artifacts={[
                    {
                        id: 'beegame-project-package:proj_1',
                        artifact_id: 'beegame-project-package:proj_1',
                        name: 'sample-game.zip',
                        artifact_type: 'Project Package',
                        package_download: true,
                    },
                ]}
                isLoading={false}
                reviewStatuses={{}}
                onPreview={vi.fn()}
                onDownload={vi.fn()}
                canExportProject={false}
            />
        );

        expect(screen.queryByTitle('Preview')).not.toBeInTheDocument();
        expect(screen.queryByTitle('Download')).not.toBeInTheDocument();
        expect(screen.queryByText('Generated on download')).not.toBeInTheDocument();
        expect(screen.getByText('sample-game.zip')).toBeInTheDocument();
    });
});
