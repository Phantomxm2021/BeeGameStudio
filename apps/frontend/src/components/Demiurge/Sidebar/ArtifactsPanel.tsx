import { memo, useState } from 'react';
import { ArrowLeft, Box, ChevronRight, Download, ExternalLink, Eye, FileJson, FileText, FolderOpen, LayoutPanelTop, RefreshCw } from 'lucide-react';
import type { Language } from '../AgentsConfig';
import { useBeeGameText, useCommonText } from '../../../i18n/useBeeGameTranslations';
import { Skeleton } from '../../ui/skeleton';
import { Button } from '../../beui/project-button';
import { buildArtifactViewModel, type ArtifactEditorKind, type ArtifactListItem } from './artifactViewModel';
import { ArtifactEmptyCard } from './ArtifactEmptyCard';

export type ArtifactEditorFile = { path: string; id: string; kind: ArtifactEditorKind };

interface ArtifactsPanelProps {
    artifacts: ArtifactListItem[];
    isLoading: boolean;
    onPreview: (id: string, name: string) => void;
    onDownload: (id: string, name: string) => void;
    canExportProject?: boolean;
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
    artifacts, isLoading, onPreview, onDownload, canExportProject = true, error = null,
    lang = 'en', onOpenAssets, onOpenEditor, editorFiles = [], isEditorFilesLoading = false,
    editorFilesError = null, onLoadEditorFiles,
}: ArtifactsPanelProps) => {
    const [page, setPage] = useState<ArtifactEditorKind | 'documents' | null>(null);
    const text: Record<string, string> = { ...(useBeeGameText(lang) as Record<string, string>), assets: useCommonText(lang).assets };
    const zh = lang === 'zh';
    const view = buildArtifactViewModel(artifacts);
    const labels = { scene: 'Scene', ui: 'UI', documents: text.documentProgress || 'Project documents', assets: text.assets || 'Assets' };
    const files = editorFiles.filter(file => file.kind === page);
    const openCategory = (category: NonNullable<typeof page>) => {
        setPage(category);
        if (category !== 'documents') onLoadEditorFiles?.();
    };
    const packageArtifact = view.projectPackage;
    const packageId = String(packageArtifact?.artifact_id || packageArtifact?.id || '');

    return <div className="h-full min-w-0 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-4">
        <div className="mb-4 flex min-w-0 items-center gap-2">
            {page ? <Button variant="ghost" size="icon" aria-label={zh ? '返回产物' : 'Back to artifacts'} onClick={() => setPage(null)}><ArrowLeft size={16} /></Button> : null}
            <div className="min-w-0 flex-1">
                <h2 className="type-footnote truncate font-medium text-[var(--text-primary)]">{page ? labels[page] : text.artifacts || 'Artifacts'}</h2>
                <p className="type-caption-2 mt-1 text-[var(--text-muted)]">{page === 'documents' ? `${view.documents.length} ${zh ? '个文件' : 'files'}` : page ? (zh ? '选择 JSON 文件，在新标签页中编辑' : 'Select a JSON file to edit in a new tab') : text.deliverables || 'Project outputs'}</p>
            </div>
            {!page && canExportProject ? <Button variant="ghost" size="sm" disabled={!packageId} onClick={() => onDownload(packageId, packageArtifact?.name || 'project.zip')}><Download size={16} /><span>{zh ? '导出' : 'Export'}</span></Button> : null}
            {page && page !== 'documents' && onLoadEditorFiles ? <Button variant="ghost" size="icon" disabled={isEditorFilesLoading} aria-label={zh ? '刷新文件列表' : 'Refresh files'} onClick={onLoadEditorFiles}><RefreshCw size={15} /></Button> : null}
        </div>
        {error ? <p role="alert" className="mb-4 type-caption-1 text-[var(--destructive)]">{error}</p> : null}
        {!page ? <>
            <section aria-label={text.artifacts || 'Artifacts'} className={listClass}>
                {(['scene', 'ui', 'documents', 'assets'] as const).map(category => {
                    const Icon = category === 'scene' ? Box : category === 'ui' ? LayoutPanelTop : category === 'documents' ? FileText : FolderOpen;
                    return <button key={category} type="button" className={rowClass} onClick={() => category === 'assets' ? onOpenAssets?.() : openCategory(category)}>
                        <Icon className="size-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate type-footnote text-[var(--text-primary)]">{labels[category]}</span>
                        <ChevronRight className="size-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                    </button>;
                })}
            </section>
        </> : page === 'documents' ? <section aria-label={labels.documents} className={view.documents.length ? listClass : undefined}>
            {view.documents.length ? view.documents.map(item => <div key={item.path} className="flex min-h-14 min-w-0 items-center gap-3 border-b border-[var(--border)] px-3 py-2 last:border-b-0">
                <FileText className="size-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block truncate type-footnote text-[var(--text-primary)]">{item.name}</span><span className="block truncate type-caption-2 text-[var(--text-muted)]">{item.path}</span></span>
                <Button variant="ghost" size="icon" aria-label={`${zh ? '查看' : 'View'} ${item.name}`} title={zh ? '查看' : 'View'} onClick={() => onPreview(item.id, item.name)}><Eye size={15} /></Button>
            </div>) : !isLoading && !error ? <ArtifactEmptyCard icon={FileText} message={zh ? '暂无项目文档' : 'No project documents yet'} /> : null}
        </section> : <section aria-label={`${labels[page]} files`}>
            {editorFilesError ? <p role="alert" className="mb-3 type-caption-1 text-[var(--destructive)]">{editorFilesError}</p> : null}
            {isEditorFilesLoading ? <div aria-label={zh ? '正在加载文件' : 'Loading files'} className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div> : files.length ? <div className={listClass}>
                {files.map(file => <button key={file.path} type="button" className={rowClass} onClick={() => onOpenEditor?.(file.kind, file.path)}>
                    <FileJson size={16} className="shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                    <span className="min-w-0 flex-1"><span className="block truncate type-footnote text-[var(--text-primary)]">{file.path.split('/').at(-1)}</span><span className="block truncate type-caption-2 text-[var(--text-muted)]" title={file.id}>{file.path}</span></span>
                    <ExternalLink size={14} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                </button>)}
            </div> : !editorFilesError ? <ArtifactEmptyCard icon={page === 'scene' ? Box : LayoutPanelTop} message={zh ? '暂无可编辑的 JSON 文件' : 'No editable JSON files yet'} /> : null}
        </section>}
    </div>;
});
ArtifactsPanel.displayName = 'ArtifactsPanel';
