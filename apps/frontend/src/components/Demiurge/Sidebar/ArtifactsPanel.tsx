import { memo } from 'react';
import {
    AlertCircle,
    Box,
    CheckCircle2,
    ChevronRight,
    Circle,
    Download,
    Eye,
    FileArchive,
    FileText,
    FolderOpen,
    LayoutPanelTop,
    LoaderCircle,
} from 'lucide-react';
import type { Language } from '../AgentsConfig';
import { useBeeGameText, useCommonText } from '../../../i18n/useBeeGameTranslations';
import { Skeleton } from '../../ui/skeleton';
import type { DocumentProgressItem } from '../../../utils/documentProgress';
import { Button } from '../../beui/project-button';
import {
    buildArtifactViewModel,
    type ArtifactEditorKind,
    type ArtifactListItem,
} from './artifactViewModel';

interface ArtifactsPanelProps {
    artifacts: ArtifactListItem[];
    isLoading: boolean;
    onPreview: (id: string, name: string) => void;
    onDownload: (id: string, name: string) => void;
    canExportProject?: boolean;
    documentProgress?: DocumentProgressItem[];
    error?: string | null;
    lang?: Language;
    onOpenAssets?: () => void;
    onOpenEditor?: (kind: ArtifactEditorKind) => void;
}

export const ArtifactsPanel = memo(({
    artifacts,
    isLoading,
    onPreview,
    onDownload,
    canExportProject = true,
    documentProgress,
    error = null,
    lang = 'en',
    onOpenAssets,
    onOpenEditor = () => undefined,
}: ArtifactsPanelProps) => {
    const text: Record<string, string> = {
        ...(useBeeGameText(lang) as Record<string, string>),
        assets: useCommonText(lang).assets,
    };
    const view = buildArtifactViewModel(artifacts, documentProgress);
    const isInitialLoading = isLoading && artifacts.length === 0 && !documentProgress;

    const progressIcon = (status: DocumentProgressItem['status']) => {
        if (status === 'writing') return <LoaderCircle className="h-4 w-4 animate-spin text-[var(--warning)]" />;
        if (status === 'ready') return <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />;
        if (status === 'failed') return <AlertCircle className="h-4 w-4 text-[var(--destructive)]" />;
        return <Circle className="h-4 w-4 text-[var(--text-muted)]" />;
    };
    const progressLabel = (status: DocumentProgressItem['status']) => {
        if (status === 'writing') return text.documentWriting || 'Writing';
        if (status === 'ready') return text.documentReady || 'Ready';
        if (status === 'failed') return text.documentFailed || 'Failed';
        return text.documentPending || 'Pending';
    };
    const editorLabel = (kind: ArtifactEditorKind) => kind === 'scene' ? 'Scene' : 'UI';

    return (
        <div className="h-full min-w-0 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-4" aria-label={isInitialLoading ? text.loadingArtifacts : undefined}>
            <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="type-footnote font-medium text-[var(--text-primary)]">{text.artifacts || 'Artifacts'}</h2>
                    <p className="type-caption-2 mt-1 truncate text-[var(--text-muted)]">{text.deliverables || 'Project outputs'}</p>
                </div>
                {onOpenAssets ? (
                    <Button type="button" variant="ghost" size="sm" onClick={onOpenAssets} className="shrink-0 gap-2 text-[var(--text-secondary)]">
                        <FolderOpen className="h-4 w-4" aria-hidden="true" />
                        <span>{text.assets || 'Assets'}</span>
                    </Button>
                ) : null}
            </div>
            {error ? (
                <div role="alert" className="mb-4 rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-3 py-2 type-caption-2 text-[var(--destructive)]">
                    {error}
                </div>
            ) : null}
            {isInitialLoading ? (
                <div className="mb-5 space-y-2 border-y border-[var(--border)] py-3">
                    <Skeleton className="h-4 w-28 bg-[var(--surface-3)]" />
                    <Skeleton className="h-8 w-full bg-[var(--surface-3)]" />
                </div>
            ) : null}

            <section aria-label="Scene & UI" className="mb-5 min-w-0">
                <h3 className="mb-2 type-footnote text-[var(--text-primary)]">Scene &amp; UI</h3>
                <div className="overflow-hidden rounded-md border border-[var(--border)]">
                    {view.editorEntries.map((kind) => {
                        const Icon = kind === 'scene' ? Box : LayoutPanelTop;
                        return (
                            <button
                                key={kind}
                                type="button"
                                className="flex min-h-12 w-full min-w-0 items-center gap-3 border-b border-[var(--border)] px-3 text-left transition-colors last:border-b-0 hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-inset"
                                onClick={() => onOpenEditor(kind)}
                            >
                                <Icon className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate type-footnote text-[var(--text-primary)]">{editorLabel(kind)}</span>
                                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                            </button>
                        );
                    })}
                </div>
            </section>

            <section aria-label={text.documentProgress || 'Project documents'} className="mb-5 min-w-0">
                <div className="mb-3 flex min-w-0 items-baseline justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="type-footnote text-[var(--text-primary)]">{text.documentProgress || 'Project documents'}</h3>
                        <p className="type-caption-2 mt-1 truncate text-[var(--text-muted)]">{text.documentProgressHint || 'Produced in dependency order from the confirmed brief.'}</p>
                    </div>
                    <span className="type-caption-2 shrink-0 tabular-nums text-[var(--text-secondary)]">{view.readyDocumentCount}/{view.documents.length}</span>
                </div>
                <div className="overflow-hidden rounded-md border border-[var(--border)]">
                    {view.documents.map((item) => {
                        const artifactId = String(item.artifact?.artifact_id || item.artifact?.id || '').trim();
                        return (
                            <div key={item.path} data-status={item.status} className="flex min-h-12 min-w-0 items-center gap-3 border-b border-[var(--border)] px-3 last:border-b-0">
                                {progressIcon(item.status)}
                                <div className="min-w-0 flex-1">
                                    <div className="type-footnote truncate text-[var(--text-primary)]">{item.name}</div>
                                    <div className="type-caption-2 truncate text-[var(--text-muted)]">{item.path}</div>
                                </div>
                                <span className="type-caption-2 shrink-0 text-[var(--text-muted)]">{progressLabel(item.status)}</span>
                                {item.status === 'ready' && artifactId ? (
                                    <button
                                        type="button"
                                        onClick={() => onPreview(artifactId, item.artifact?.name || item.name)}
                                        title={text.preview}
                                        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                                    >
                                        <Eye className="h-4 w-4" />
                                    </button>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            </section>

            {view.additionalArtifacts.length > 0 ? (
                <section aria-label={text.otherArtifacts || 'Other deliverables'} className="min-w-0">
                    <h3 className="mb-2 type-footnote text-[var(--text-primary)]">{text.otherArtifacts || 'Other deliverables'}</h3>
                    <div className="overflow-x-hidden overflow-y-hidden rounded-md border border-[var(--border)]">
                        <table className="w-full table-fixed border-collapse">
                            <thead>
                                <tr className="border-b border-[var(--border)]">
                                    <th scope="col" className="type-caption-2 px-3 py-2 text-left text-[var(--text-muted)]">{text.artifactName || 'Name'}</th>
                                    <th scope="col" className="type-caption-2 w-20 px-2 py-2 text-right text-[var(--text-muted)]">{text.actions || 'Actions'}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {view.additionalArtifacts.map((artifact) => {
                                    const type = artifact.artifact_type || 'Document';
                                    const artifactId = String(artifact.artifact_id || artifact.id || '').trim();
                                    const isProjectPackage = Boolean(artifact.package_download);
                                    const Icon = isProjectPackage ? FileArchive : FileText;
                                    const artifactName = artifact.name || `${type} Doc`;
                                    const reviewKey = artifactId || artifact.path || artifactName;
                                    return (
                                        <tr key={reviewKey} className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--surface-hover)]">
                                            <td className="max-w-0 px-3 py-3 align-middle">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <Icon className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
                                                    <div className="min-w-0 truncate type-footnote text-[var(--text-primary)]">{artifactName}</div>
                                                </div>
                                            </td>
                                            <td className="px-2 py-3 align-middle">
                                                <div className="flex items-center justify-end gap-1">
                                                    {!isProjectPackage ? (
                                                        <button type="button" onClick={() => onPreview(reviewKey, artifactName)} title={text.preview} className="grid h-8 w-8 place-items-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
                                                            <Eye className="h-4 w-4" />
                                                        </button>
                                                    ) : null}
                                                    {!isProjectPackage || canExportProject ? (
                                                        <button type="button" onClick={() => onDownload(reviewKey, artifactName)} title={text.download} className="grid h-8 w-8 place-items-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
                                                            <Download className="h-4 w-4" />
                                                        </button>
                                                    ) : null}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>
            ) : null}
        </div>
    );
});

ArtifactsPanel.displayName = 'ArtifactsPanel';
