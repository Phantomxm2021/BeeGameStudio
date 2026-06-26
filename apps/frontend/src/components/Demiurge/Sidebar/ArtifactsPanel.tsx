import { memo } from 'react';
import { motion } from 'framer-motion';
import { FileArchive, FileText, Eye, Download } from 'lucide-react';

interface ArtifactsPanelProps {
    artifacts: any[];
    isLoading: boolean;
    reviewStatuses: Record<string, any>;
    onPreview: (id: string, name: string) => void;
    onDownload: (id: string, name: string) => void;
}

export const ArtifactsPanel = memo(({ 
    artifacts, 
    isLoading, 
    reviewStatuses, 
    onPreview, 
    onDownload 
}: ArtifactsPanelProps) => {
    if (isLoading && artifacts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 italic space-y-4 text-zinc-500 dark:text-zinc-400 opacity-70">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-900 dark:border-zinc-100"></div>
                <div className="text-sm">Loading artifacts...</div>
            </div>
        );
    }

    if (artifacts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 italic space-y-4 text-zinc-500 dark:text-zinc-400 opacity-70">
                <FileText className="w-12 h-12" />
                <div className="text-sm">No artifacts generated yet...</div>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-8 scrollbar-hide">
            <div className="space-y-4">
            {artifacts.map((art) => {
                const type = art.artifact_type || 'Document';
                const artifactId = String(art.artifact_id || art.id || '').trim();
                const review = reviewStatuses[artifactId];
                const reviewKey = artifactId || art.id;
                const isProjectPackage = Boolean(art.package_download);
                const Icon = isProjectPackage ? FileArchive : FileText;

                return (
                    <motion.div
                        key={reviewKey}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-5 rounded-[1.8rem] border-2 border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-950/30 transition-all hover:border-zinc-300 dark:hover:border-zinc-600"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                                <div className="p-3 bg-zinc-100 dark:bg-zinc-900 rounded-xl text-zinc-900 dark:text-zinc-100">
                                    <Icon className="w-6 h-6" />
                                </div>
                                <div>
                                    <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{art.name || `${type} Doc`}</div>
                                    <div className="flex items-center space-x-2 mt-0.5">
                                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase font-mono tracking-tighter">
                                            {isProjectPackage ? 'Generated on download' : `By @${art.created_by || art.author || art.agent_id || 'unknown'} • ${review ? `Review: ${review.outcome || 'Pending'}` : 'Locked'}`}
                                        </div>
                                        {review && (
                                            <div className="flex -space-x-1">
                                                {review.votes?.map((v: any, i: number) => (
                                                    <div key={i} className={`w-2 h-2 rounded-full border border-white dark:border-zinc-900 ${v.verdict === 'approved' ? 'bg-emerald-500' : 'bg-rose-500'}`} title={`@${v.reviewer_id}: ${v.verdict}`} />
                                                ))}
                                                {[...Array(Math.max(0, (review.assigned_reviewers?.length || 0) - (review.votes?.length || 0)))].map((_, i) => (
                                                    <div key={`p-${i}`} className="w-2 h-2 rounded-full border border-white dark:border-zinc-900 bg-zinc-300 dark:bg-zinc-700" />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center space-x-2">
                                {!isProjectPackage ? (
                                    <button
                                        style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                        onClick={(e) => { e.stopPropagation(); onPreview(reviewKey, art.name || `${type} Doc`); }}
                                        title="Preview"
                                    >
                                        <Eye className="w-5 h-5 opacity-40 hover:opacity-100 text-zinc-900 dark:text-zinc-100 transition-opacity" />
                                    </button>
                                ) : null}
                                <button
                                    style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                    onClick={(e) => { e.stopPropagation(); onDownload(reviewKey, art.name || type); }}
                                    title="Download"
                                >
                                    <Download className="w-5 h-5 opacity-40 hover:opacity-100 text-zinc-900 dark:text-zinc-100 transition-opacity" />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                );
            })}
            </div>
        </div>
    );
});

ArtifactsPanel.displayName = 'ArtifactsPanel';
