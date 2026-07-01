import { FileText, X } from 'lucide-react';
import { MarkdownRenderer } from './ChatComponents';
import type { Language } from '../AgentsConfig';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';

interface ArtifactPreviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    content: string;
    isLoading: boolean;
    lang?: Language;
}

export function ArtifactPreviewModal({ isOpen, onClose, title, content, isLoading, lang = 'en' }: ArtifactPreviewModalProps) {
    const text = useBeeGameText(lang);
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8 bg-zinc-950/80 backdrop-blur-md"
            onClick={onClose}
        >
                    <div
                        className="bg-white dark:bg-zinc-900 w-full max-w-5xl h-[85vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden border border-zinc-200 dark:border-zinc-800"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="px-8 py-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/50">
                            <div className="flex items-center space-x-4">
                                <div className="p-3 bg-zinc-900 dark:bg-zinc-100 rounded-2xl text-white dark:text-zinc-900">
                                    <FileText className="w-6 h-6" />
                                </div>
                                <div>
                                    <h2 className="type-headline text-zinc-900 dark:text-zinc-100">{title}</h2>
                                    <p className="type-caption-1 text-zinc-500 mt-0.5 opacity-60">{text.artifactOnlinePreview}</p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-2xl transition-colors text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="flex-1 overflow-y-auto p-8 sm:p-12 scrollbar-hide">
                            {isLoading ? (
                                <div className="h-full flex flex-col items-center justify-center space-y-4 opacity-40 italic">
                                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-zinc-900 dark:border-zinc-100"></div>
                                    <p>{text.fetchingContent}</p>
                                </div>
                            ) : (
                                <div className="prose dark:prose-invert max-w-none">
                                    <MarkdownRenderer content={content} isUser={false} />
                                </div>
                            )}
                        </div>
                    </div>
        </div>
    );
}
