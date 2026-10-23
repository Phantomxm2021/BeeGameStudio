import { FileText } from 'lucide-react';
import { MarkdownRenderer } from './ChatMarkdownContent';
import type { Language } from '../AgentsConfig';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';
import { Skeleton } from '../../ui/skeleton';
import { CloseIconButton } from '../../ui/CloseIconButton';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../ui/dialog';

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
    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="flex h-[min(85dvh,900px)] max-w-5xl flex-col overflow-hidden p-0">
                <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 sm:px-6">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[var(--border)] bg-[var(--primary)] text-[var(--primary-foreground)]">
                        <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <DialogTitle className="truncate text-base">{title}</DialogTitle>
                        <DialogDescription>{text.artifactOnlinePreview}</DialogDescription>
                    </div>
                    <CloseIconButton label={text.close || 'Close'} onClick={onClose} />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8">
                            {isLoading ? (
                                <div className="space-y-5" aria-label={text.fetchingContent}>
                                    <div className="space-y-3">
                                        <Skeleton className="h-6 w-1/3 bg-[var(--surface-3)]" />
                                        <Skeleton className="h-4 w-2/3 bg-[var(--surface-3)]" />
                                    </div>
                                    <div className="space-y-3">
                                        <Skeleton className="h-4 w-full bg-[var(--surface-3)]" />
                                        <Skeleton className="h-4 w-11/12 bg-[var(--surface-3)]" />
                                        <Skeleton className="h-4 w-4/5 bg-[var(--surface-3)]" />
                                    </div>
                                    <Skeleton className="h-44 w-full rounded-lg bg-[var(--surface-3)]" />
                                    <div className="space-y-3">
                                        <Skeleton className="h-4 w-5/6 bg-[var(--surface-3)]" />
                                        <Skeleton className="h-4 w-3/4 bg-[var(--surface-3)]" />
                                    </div>
                                </div>
                            ) : (
                                <div className="max-w-none">
                                    <MarkdownRenderer content={content} />
                                </div>
                            )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
