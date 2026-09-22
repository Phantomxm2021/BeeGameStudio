import { memo, useState } from 'react';
import { AlertCircle, ArrowLeft, Box, CheckCircle2, ChevronRight, Circle, Download, ExternalLink, Eye, FileArchive, FileJson, FileText, FolderOpen, LayoutPanelTop, LoaderCircle, RefreshCw } from 'lucide-react';
import type { Language } from '../AgentsConfig';
import { useBeeGameText, useCommonText } from '../../../i18n/useBeeGameTranslations';
import { Skeleton } from '../../ui/skeleton';
import type { DocumentProgressItem } from '../../../utils/documentProgress';
import { Button } from '../../beui/project-button';
import { buildArtifactViewModel, type ArtifactEditorKind, type ArtifactListItem } from './artifactViewModel';

export type ArtifactEditorFile = { path: string; id: string; kind: ArtifactEditorKind };

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
    onOpenEditor?: (kind: ArtifactEditorKind, path: string) => void;
    editorFiles?: ArtifactEditorFile[];
    isEditorFilesLoading?: boolean;
    editorFilesError?: string | null;
    onLoadEditorFiles?: () => void;
}

const rowClass = 'flex min-h-14 w-full min-w-0 items-center gap-3 border-b border-[var(--border)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]';
const listClass = 'overflow-hidden rounded-lg border border-[var(--border)]';

export const ArtifactsPanel = memo(({
    artifacts, isLoading, onPreview, onDownload, canExportProject = true, documentProgress, error = null,
    lang = 'en', onOpenAssets, onOpenEditor, editorFiles = [], isEditorFilesLoading = false,
    editorFilesError = null, onLoadEditorFiles,
}: ArtifactsPanelProps) => {
    const [page, setPage] = useState<ArtifactEditorKind | 'documents' | null>(null);
    const text: Record<string, string> = { ...(useBeeGameText(lang) as Record<string, string>), assets: useCommonText(lang).assets };
    const zh = lang === 'zh';
    const view = buildArtifactViewModel(artifacts, documentProgress);
    const isInitialLoading = isLoading && artifacts.length === 0 && !documentProgress;
    const labels = { scene: 'Scene', ui: 'UI', documents: text.documentProgress || 'Project documents' };
    const files = editorFiles.filter(file => file.kind === page);
    const openCategory = (category: NonNullable<typeof page>) => {
        setPage(category);
        if (category !== 'documents') onLoadEditorFiles?.();
    };
    const progressIcon = (status: DocumentProgressItem['status']) => {
        if (status === 'writing') return <LoaderCircle className="size-4 animate-spin text-[var(--warning)]" />;
        if (status === 'ready') return <CheckCircle2 className="size-4 text-[var(--success)]" />;
        if (status === 'failed') return <AlertCircle className="size-4 text-[var(--destructive)]" />;
        return <Circle className="size-4 text-[var(--text-muted)]" />;
    };
    const progressLabel = (status: DocumentProgressItem['status']) =>
        status === 'writing' ? text.documentWriting || 'Writing' : status === 'ready' ? text.documentReady || 'Ready'
            : status === 'failed' ? text.documentFailed || 'Failed' : text.documentPending || 'Pending';

    return <div className="h-full min-w-0 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-4" aria-label={isInitialLoading ? text.loadingArtifacts : undefined}>
        <div className="mb-4 flex min-w-0 items-center gap-2">
            {page ? <Button variant="ghost" size="icon" aria-label={zh ? '返回产物' : 'Back to artifacts'} onClick={() => setPage(null)}><ArrowLeft size={16} /></Button> : null}
            <div className="min-w-0 flex-1">
                <h2 className="type-footnote truncate font-medium text-[var(--text-primary)]">{page ? labels[page] : text.artifacts || 'Artifacts'}</h2>
                <p className="type-caption-2 mt-1 text-[var(--text-muted)]">{page === 'documents' ? `${view.readyDocumentCount}/${view.documents.length} · ${zh ? '文件' : 'files'}` : page ? (zh ? '选择 JSON 文件，在新标签页中编辑' : 'Select a JSON file to edit in a new tab') : text.deliverables || 'Project outputs'}</p>
            </div>
            {!page && onOpenAssets ? <Button variant="ghost" size="sm" onClick={onOpenAssets}><FolderOpen size={16} /><span>{text.assets || 'Assets'}</span></Button> : null}
            {page && page !== 'documents' && onLoadEditorFiles ? <Button variant="ghost" size="icon" disabled={isEditorFilesLoading} aria-label={zh ? '刷新文件列表' : 'Refresh files'} onClick={onLoadEditorFiles}><RefreshCw size={15} /></Button> : null}
        </div>
        {error ? <p role="alert" className="mb-4 type-caption-1 text-[var(--destructive)]">{error}</p> : null}
        {isInitialLoading ? <div className="mb-4 space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-12 w-full" /></div> : null}

        {!page ? <>
            <section aria-label={text.artifacts || 'Artifacts'} className={listClass}>
                {(['scene', 'ui', 'documents'] as const).map(category => {
                    const Icon = category === 'scene' ? Box : category === 'ui' ? LayoutPanelTop : FileText;
                    return <button key={category} type="button" className={rowClass} onClick={() => openCategory(category)}>
                        <Icon className="size-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate type-footnote text-[var(--text-primary)]">{labels[category]}</span>
                        {category === 'documents' ? <span className="type-caption-2 text-[var(--text-muted)]">{view.readyDocumentCount}/{view.documents.length}</span> : null}
                        <ChevronRight className="size-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                    </button>;
                })}
            </section>
            {view.additionalArtifacts.length ? <section className="mt-5" aria-label={text.otherArtifacts || 'Other deliverables'}>
                <h3 className="mb-2 type-footnote text-[var(--text-primary)]">{text.otherArtifacts || 'Other deliverables'}</h3>
                <div className={listClass}>{view.additionalArtifacts.map(artifact => {
                    const id = String(artifact.artifact_id || artifact.id || artifact.path || artifact.name);
                    const name = artifact.name || artifact.path || 'File';
                    const Icon = artifact.package_download ? FileArchive : FileText;
                    return <div key={id} className={rowClass}>
                        <Icon size={16} className="shrink-0 text-[var(--text-muted)]" />
                        <button type="button" className="min-w-0 flex-1 truncate text-left type-footnote text-[var(--text-primary)]" disabled={artifact.package_download} onClick={() => onPreview(id, name)}>{name}</button>
                        {!artifact.package_download || canExportProject ? <Button variant="ghost" size="icon" aria-label={`${text.download || 'Download'} ${name}`} title={text.download} onClick={() => onDownload(id, name)}><Download size={15} /></Button> : null}
                    </div>;
                })}</div>
            </section> : null}
        </> : page === 'documents' ? <section aria-label={labels.documents} className={listClass}>
            {view.documents.map(item => {
                const id = String(item.artifact?.artifact_id || item.artifact?.id || '');
                const name = item.artifact?.name || item.name;
                const ready = item.status === 'ready' && Boolean(id);
                return <div key={item.path} data-status={item.status} className="flex min-w-0 items-center border-b border-[var(--border)] pr-1 last:border-b-0">
                    <button type="button" disabled={!ready} className={`${rowClass} flex-1 border-0 disabled:cursor-default disabled:hover:bg-transparent`} onClick={() => onPreview(id, name)}>
                        <span className="shrink-0" aria-hidden="true">{progressIcon(item.status)}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate type-footnote text-[var(--text-primary)]">{item.name}</span><span className="block truncate type-caption-2 text-[var(--text-muted)]">{item.path}</span></span>
                        <span className="shrink-0 type-caption-2 text-[var(--text-muted)]">{progressLabel(item.status)}</span>
                    </button>
                    {ready ? <Button variant="ghost" size="icon" aria-label={`${text.preview || 'Preview'} ${name}`} title={text.preview} onClick={() => onPreview(id, name)}><Eye size={15} /></Button> : null}
                </div>;
            })}
        </section> : <section aria-label={`${labels[page]} files`}>
            {editorFilesError ? <p role="alert" className="mb-3 type-caption-1 text-[var(--destructive)]">{editorFilesError}</p> : null}
            {isEditorFilesLoading ? <div aria-label={zh ? '正在加载文件' : 'Loading files'} className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div> : files.length ? <div className={listClass}>
                {files.map(file => <button key={file.path} type="button" className={rowClass} onClick={() => onOpenEditor?.(file.kind, file.path)}>
                    <FileJson size={16} className="shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                    <span className="min-w-0 flex-1"><span className="block truncate type-footnote text-[var(--text-primary)]">{file.path.split('/').at(-1)}</span><span className="block truncate type-caption-2 text-[var(--text-muted)]" title={file.id}>{file.path}</span></span>
                    <ExternalLink size={14} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                </button>)}
            </div> : !editorFilesError ? <p className="py-6 text-center type-footnote text-[var(--text-muted)]">{zh ? '暂无可编辑的 JSON 文件' : 'No editable JSON files yet'}</p> : null}
        </section>}
    </div>;
});
ArtifactsPanel.displayName = 'ArtifactsPanel';
