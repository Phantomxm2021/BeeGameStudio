import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ArtifactsPanel } from './ArtifactsPanel';

describe('ArtifactsPanel', () => {
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
                        name: 'GDD.md',
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

        expect(screen.getByText(/review: approved/i)).toBeInTheDocument();

        await user.click(screen.getByTitle('Preview'));
        await user.click(screen.getByTitle('Download'));

        expect(onPreview).toHaveBeenCalledWith('art_1', 'GDD.md');
        expect(onDownload).toHaveBeenCalledWith('art_1', 'GDD.md');
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
        expect(screen.getByText('Generated on download')).toBeInTheDocument();

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
        expect(screen.getByText('Generated on download')).toBeInTheDocument();
    });
});
