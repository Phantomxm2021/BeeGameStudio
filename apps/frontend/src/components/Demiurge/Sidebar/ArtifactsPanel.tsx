import { memo } from 'react';
import { FileArchive, FileText, Eye, Download } from 'lucide-react';
import type { Language } from '../AgentsConfig';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';
import { Skeleton } from '../../ui/skeleton';

interface ArtifactsPanelProps {
    artifacts: any[];
    isLoading: boolean;
    reviewStatuses: Record<string, any>;
    onPreview: (id: string, name: string) => void;
    onDownload: (id: string, name: string) => void;
    canExportProject?: boolean;
    lang?: Language;
}

export const ArtifactsPanel = memo(({ 
    artifacts, 
    isLoading, 
    onPreview, 
    onDownload,
    canExportProject = true,
    lang = 'en',
}: ArtifactsPanelProps) => {
    const text = useBeeGameText(lang);
    if (isLoading && artifacts.length === 0) {
        return (
            <div className="h-full overflow-y-auto px-6 py-5" aria-label={text.loadingArtifacts}>
                <div className="overflow-hidden border-y border-zinc-200 dark:border-zinc-800">
                    <div className="grid grid-cols-[1fr_6rem] border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
                        <Skeleton className="h-4 w-24 bg-zinc-200 dark:bg-zinc-800" />
                        <Skeleton className="ml-auto h-4 w-16 bg-zinc-200 dark:bg-zinc-800" />
                    </div>
                    {Array.from({ length: 4 }).map((_, index) => (
                        <div key={index} className="grid grid-cols-[1fr_6rem] items-center border-b border-zinc-100 px-3 py-3 last:border-b-0 dark:border-zinc-900">
                            <div className="flex min-w-0 items-center gap-3">
                                <Skeleton className="h-4 w-4 rounded bg-zinc-200 dark:bg-zinc-800" />
                                <Skeleton className="h-4 w-40 bg-zinc-200 dark:bg-zinc-800" />
                            </div>
                            <div className="flex justify-end gap-1.5">
                                <Skeleton className="h-8 w-8 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
                                <Skeleton className="h-8 w-8 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (artifacts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 italic space-y-4 text-zinc-500 dark:text-zinc-400 opacity-70">
                <FileText className="w-12 h-12" />
                <div className="type-callout">{text.noArtifacts}</div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto px-6 py-5">
            <div className="overflow-hidden border-y border-zinc-200 dark:border-zinc-800">
                <table className="w-full table-fixed border-collapse">
                    <thead>
                        <tr className="border-b border-zinc-200 dark:border-zinc-800">
                            <th scope="col" className="type-caption-2 px-3 py-2 text-left text-zinc-500 dark:text-zinc-400">
                                {text.artifactName || 'Name'}
                            </th>
                            <th scope="col" className="type-caption-2 w-24 px-3 py-2 text-right text-zinc-500 dark:text-zinc-400">
                                {text.actions || 'Actions'}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {artifacts.map((art) => {
                            const type = art.artifact_type || 'Document';
                            const artifactId = String(art.artifact_id || art.id || '').trim();
                            const reviewKey = artifactId || art.id;
                            const isProjectPackage = Boolean(art.package_download);
                            const Icon = isProjectPackage ? FileArchive : FileText;
                            const artifactName = art.name || `${type} Doc`;

                            return (
                                <tr
                                    key={reviewKey}
                                    className="border-b border-zinc-100 transition-colors last:border-b-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/45"
                                >
                                    <td className="px-3 py-3 align-middle">
                                        <div className="flex min-w-0 items-center gap-3">
                                            <Icon className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
                                            <div className="min-w-0">
                                                <div className="type-footnote truncate text-zinc-900 dark:text-zinc-100">
                                                    {artifactName}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-3 py-3 align-middle">
                                        <div className="flex items-center justify-end gap-1.5">
                                            {!isProjectPackage ? (
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); onPreview(reviewKey, artifactName); }}
                                                    title={text.preview}
                                                    className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/30 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </button>
                                            ) : null}
                                            {!isProjectPackage || canExportProject ? (
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); onDownload(reviewKey, artifactName); }}
                                                    title={text.download}
                                                    className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/30 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                                                >
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
        </div>
    );
});

ArtifactsPanel.displayName = 'ArtifactsPanel';
