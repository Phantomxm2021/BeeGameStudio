import { memo } from 'react';
import { MessageSquare, AlertCircle, Send, ImagePlus, X } from 'lucide-react';
import { MessageItem } from './ChatComponents';
import { BeeGameCollaborationFeed, BeeGameConversationOverviewRuler } from './BeeGameCollaborationFeed';
import type { ReviewBindingPayload } from '../../../services/api';
import type { ChatImageAttachmentPayload } from '../../../services/api';
import { formatReviewSummary, isBeeGamePermissionReview, isReviewAwaitingUserAction } from './SidebarUtils';
import type { WaitingApprovalState } from '../../../utils/waitingApproval';
import { ApprovalActionCard, isApprovalActionPending } from './ApprovalActionCard';
import type { ChatDisplayMessage, ProjectRuntimeDisplayModel, ReviewDisplayModel } from '../../../viewModels/displayModels';
import type { Language } from '../AgentsConfig';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';

interface ChatPanelProps {
    messages: ChatDisplayMessage[];
    isLoading: boolean;
    chatInput: string;
    onChatInputChange: (val: string) => void;
    onSend: () => void;
    onSendMessage?: (message: string) => void;
    imageAttachments?: ChatImageAttachmentPayload[];
    onAddImageAttachments?: (attachments: ChatImageAttachmentPayload[]) => void;
    onRemoveImageAttachment?: (index: number) => void;
    onPreviewArtifact: (id: string, title: string, content?: string) => void;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    scrollContainerRef: React.RefObject<HTMLDivElement | null>;
    isComposing: boolean;
    setIsComposing: (val: boolean) => void;

    // Approval Props
    onApprovePlan?: (
        review: ReviewBindingPayload & { gate_id: string },
        feedback?: string,
        action?: 'approve' | 'revise' | 'reject'
    ) => Promise<void>;
    approvalState: {
        gateId: string | null;
        action: 'approve' | 'revise' | 'reject' | null;
        phase: 'idle' | 'submitting' | 'awaiting_runtime' | 'failed';
        message: string;
    };
    actionReview?: ReviewDisplayModel;
    pendingReviews: ReviewDisplayModel[];
    onUploadManifestCsv?: (gateId: string, csvContent: string, autoApprove?: boolean) => Promise<void>;
    onApproveManifest?: (review: ReviewBindingPayload & { gate_id: string }, feedback?: string) => Promise<void>;
    waitingApproval: WaitingApprovalState;
    projectStatus?: ProjectRuntimeDisplayModel | null;
    isComposerLocked?: boolean;
    canSendMessage?: boolean;
    variant?: 'legacy' | 'beegame';
    lang?: Language;
    currentUserDisplayName?: string;
    currentUserEmail?: string;
    currentUserAvatarUrl?: string;
}

const toApprovalPayload = (review: ReviewDisplayModel): ReviewBindingPayload & { gate_id: string } => {
    if (review.raw) {
        return review.raw;
    }
    return review as unknown as ReviewBindingPayload & { gate_id: string };
};

const SUPPORTED_IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
]);

const fileToImageAttachment = (file: File): Promise<ChatImageAttachmentPayload | null> => {
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) return Promise.resolve(null);
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const commaIndex = result.indexOf(',');
            const data = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
            resolve(data ? {
                type: 'image',
                mediaType: file.type as ChatImageAttachmentPayload['mediaType'],
                data,
                filename: file.name || undefined,
            } : null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
};

const filesToImageAttachments = async (files: File[]): Promise<ChatImageAttachmentPayload[]> => {
    const attachments = await Promise.all(files.map(fileToImageAttachment));
    return attachments.filter((item): item is ChatImageAttachmentPayload => Boolean(item));
};

const dedupeImageFiles = (files: File[]): File[] => {
    const seen = new Set<string>();
    const uniqueFiles: File[] = [];
    for (const file of files) {
        const key = [file.name, file.type, file.size, file.lastModified].join('\u0000');
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueFiles.push(file);
    }
    return uniqueFiles;
};

const clipboardDataToImageFiles = (clipboardData: DataTransfer | null): File[] => {
    if (!clipboardData) return [];
    const files = Array.from(clipboardData.files || []).filter(file => file.type.startsWith('image/'));
    const itemFiles = Array.from(clipboardData.items || [])
        .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter((file): file is File => Boolean(file));
    return dedupeImageFiles([...files, ...itemFiles]);
};

export const ChatPanel = memo(({
    messages,
    isLoading,
    chatInput,
    onChatInputChange,
    onSend,
    onSendMessage,
    imageAttachments = [],
    onAddImageAttachments,
    onRemoveImageAttachment,
    onPreviewArtifact,
    textareaRef,
    scrollContainerRef,
    isComposing,
    setIsComposing,
    onApprovePlan,
    approvalState,
    actionReview,
    pendingReviews,
    onUploadManifestCsv,
    onApproveManifest,
    waitingApproval,
    projectStatus,
    isComposerLocked = false,
    canSendMessage = true,
    variant = 'legacy',
    lang = 'en',
    currentUserDisplayName,
    currentUserEmail,
    currentUserAvatarUrl,
}: ChatPanelProps) => {
    const text = useBeeGameText(lang);
    const reviewActionLabel = (
        review: ReviewDisplayModel,
        action: 'approve' | 'revise' | 'reject',
    ): string => {
        if (!review?.gate_id) {
            if (action === 'approve') return text.approve;
            if (action === 'revise') return text.revise;
            return text.reject;
        }
        if (isApprovalActionPending(approvalState, review.gate_id, action)) {
            if (action === 'approve') {
                return approvalState.phase === 'submitting' ? text.submitting : text.starting;
            }
            return approvalState.phase === 'submitting' ? text.submitting : text.refreshing;
        }
        if (action === 'approve') {
            if (isBeeGamePermissionReview(review)) return text.allow;
            return review?.type === 'INTENT_CLARIFICATION' ? text.continue : text.approve;
        }
        if (action === 'revise') {
            if (isBeeGamePermissionReview(review)) return text.deny;
            return text.revise;
        }
        return text.reject;
    };

    const reviewApproveLabel = (review: ReviewDisplayModel): string => {
        return reviewActionLabel(review, 'approve');
    };

    const reviewReviseLabel = (review: ReviewDisplayModel): string => {
        return reviewActionLabel(review, 'revise');
    };

    const clarificationReview = pendingReviews.find((review: ReviewDisplayModel) => review?.type === 'INTENT_CLARIFICATION' && Boolean(review?.gate_id));
    const reviewReadyForUserApproval = isReviewAwaitingUserAction(actionReview);
    const beeGamePermission = isBeeGamePermissionReview(actionReview);
    const projectFailed = Boolean(projectStatus?.blocked && String(projectStatus?.blocked_reason || '').trim() === 'pipeline_failed');
    const activeComposerReview = projectFailed ? clarificationReview : (clarificationReview || actionReview);
    const shouldShowApprovalBar = Boolean(onApprovePlan && activeComposerReview);
    const shouldShowWaitingBanner = waitingApproval.isBlockingChat && !shouldShowApprovalBar;
    const handleContinueFixing = (message: string) => {
        if (!canSendMessage || isComposerLocked || waitingApproval.isBlockingChat) return;
        onSendMessage?.(message);
    };
    const isComposerDisabled = !canSendMessage || isComposerLocked || isLoading || waitingApproval.isBlockingChat;
    const canSubmitComposer = Boolean(chatInput.trim() || imageAttachments.length > 0);
    const handleImageFiles = async (files: File[]) => {
        if (!files.length || !onAddImageAttachments) return;
        const attachments = await filesToImageAttachments(files);
        if (attachments.length > 0) onAddImageAttachments(attachments);
    };

    const isBeeGameVariant = variant === 'beegame';
    const panelClassName = isBeeGameVariant
        ? 'flex h-full flex-col bg-transparent'
        : 'flex flex-col h-full bg-white/95 dark:bg-zinc-900/95 backdrop-blur-3xl';
    const scrollClassName = isBeeGameVariant
        ? 'flex-1 overflow-y-auto px-4 pt-4 relative pb-4'
        : 'flex-1 overflow-y-auto px-8 pt-8 space-y-8 relative pb-8';
    const composerShellClassName = isBeeGameVariant
        ? 'border-t border-white/10 bg-black/25 px-4 pb-4 pt-4 backdrop-blur-2xl'
        : 'pt-4 bg-transparent border-t border-zinc-100 dark:border-zinc-800 px-8 pb-8';
    const textareaClassName = isBeeGameVariant
        ? 'type-input glass-control w-full rounded-3xl px-4 py-3 pr-14 text-zinc-100 placeholder:text-zinc-500 disabled:opacity-50 min-h-[52px] max-h-[150px] resize-none overflow-y-auto backdrop-blur-2xl'
        : 'type-input w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl px-6 py-4 pr-16 outline-none focus:border-zinc-900 dark:focus:border-zinc-100 transition-all text-zinc-900 dark:text-zinc-100 disabled:opacity-50 min-h-[52px] max-h-[160px] resize-none overflow-y-auto';
    const sendButtonClassName = isBeeGameVariant
        ? 'primary-pill absolute right-3 bottom-2.5 flex h-9 w-9 items-center justify-center shadow-lg transition-transform group-active:scale-95 disabled:cursor-not-allowed disabled:opacity-35'
        : 'absolute right-3 bottom-2 w-10 h-10 flex items-center justify-center bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-full shadow-lg group-active:scale-95 transition-transform disabled:opacity-50 disabled:bg-zinc-400';

    return (
        <div className={panelClassName} data-testid={isBeeGameVariant ? 'beegame-chat-panel' : undefined}>
            <div
                ref={scrollContainerRef}
                className={scrollClassName}
            >
                {isBeeGameVariant ? (
                        <>
                            <BeeGameConversationOverviewRuler
                                messages={messages}
                                lang={lang}
                                scrollContainerRef={scrollContainerRef}
                            />
                            <BeeGameCollaborationFeed
                                messages={messages}
                                projectStatus={projectStatus}
                                onPreviewArtifact={onPreviewArtifact}
                                lang={lang}
                                currentUserDisplayName={currentUserDisplayName}
                                currentUserEmail={currentUserEmail}
                                currentUserAvatarUrl={currentUserAvatarUrl}
                            />
                        </>
                    ) : messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-20 space-y-4 py-20">
                            <div className="animate-pulse">
                                <MessageSquare className="w-16 h-16 text-zinc-400" />
                            </div>
                            <p className="type-callout">{text.noMessages}</p>
                        </div>
                    ) : (
                        messages.map((m) => (
                            <MessageItem
                                key={m.id}
                                m={m}
                                onPreviewArtifact={onPreviewArtifact}
                                onContinueFixing={onSendMessage ? handleContinueFixing : undefined}
                                variant={variant}
                                lang={lang}
                            />
                        ))
                    )}

                    {pendingReviews.map((review: ReviewDisplayModel) => {
                        const isManifestReview = review?.type === 'ASSET_MANIFEST_REVIEW' && Boolean(review?.gate_id);
                        if (!isManifestReview) return null;

                        return (
	                            <div
	                                key={review.gate_id}
	                                className="glass-control w-full space-y-4 rounded-3xl border border-white/15 bg-black/25 p-6 backdrop-blur-2xl"
                            >
                                <div className="flex items-start space-x-3">
	                                    <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-zinc-300" />
                                    <div className="flex-1 min-w-0">
	                                        <div className="type-caption-1 mb-1 text-zinc-100">{text.actionRequired}</div>
	                                        <div className="type-callout mb-2 text-zinc-200 opacity-80">
                                            {text.resourceManifestDescription}
                                        </div>
                                        <div className="flex space-x-3 mt-4">
                                            <button
                                                onClick={() => onApproveManifest && onApproveManifest(toApprovalPayload(review))}
                                                disabled={isLoading}
	                                                className="type-button flex flex-1 items-center justify-center space-x-2 rounded-xl bg-white py-2 text-zinc-950 shadow-sm transition-colors hover:bg-zinc-200 disabled:opacity-50"
                                            >
                                                <span>{text.skip}</span>
                                            </button>

                                            <div className="flex-1">
                                                <input
                                                    type="file"
                                                    accept=".csv"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file && onUploadManifestCsv) {
                                                            const reader = new FileReader();
                                                            reader.onload = (e) => {
                                                                const content = e.target?.result as string;
                                                                onUploadManifestCsv(review.gate_id, content, true);
                                                            };
                                                            reader.readAsText(file);
                                                        }
                                                    }}
                                                    className="hidden"
                                                    id={`upload-csv-${review.gate_id}`}
                                                />
                                                <label
                                                    htmlFor={`upload-csv-${review.gate_id}`}
                                                    className={`type-button w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl transition-colors flex items-center justify-center space-x-2 shadow-sm cursor-pointer ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}
                                                >
                                                    <span>{text.upload}</span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
            </div>

            <div className={composerShellClassName}>
                {shouldShowWaitingBanner && (
                    <div className="glass-control type-footnote mb-3 rounded-2xl border border-white/15 bg-black/25 px-4 py-3 text-zinc-300 backdrop-blur-2xl">
                        {waitingApproval.message}
                    </div>
                )}
                {shouldShowApprovalBar && activeComposerReview ? (
                    <div
                        key={`approval-bar-${activeComposerReview.gate_id}`}
                        className="pointer-events-auto"
                    >
                        <ApprovalActionCard
                            gateId={activeComposerReview.gate_id}
                            title={
                                beeGamePermission
                                    ? text.permissionRequired
                                    : activeComposerReview.type === 'INTENT_CLARIFICATION'
                                        ? text.clarificationRequired
                                        : reviewReadyForUserApproval
                                            ? text.approvalRequired
                                            : text.revisionRequired
                            }
                            description={
                                activeComposerReview.type === 'INTENT_CLARIFICATION'
                                    ? text.clarificationDescription
                                    : formatReviewSummary(activeComposerReview)
                            }
                            tone={
                                beeGamePermission
                                    ? 'clarification'
                                    : activeComposerReview.type === 'INTENT_CLARIFICATION'
                                    ? 'clarification'
                                    : reviewReadyForUserApproval
                                        ? 'approval'
                                        : 'revision'
                            }
                            approvalState={approvalState}
                            layout="bottom-bar"
                            variant={isBeeGameVariant ? 'beegame' : 'legacy'}
                            className={isBeeGameVariant ? 'glass-control rounded-3xl px-3 py-3 text-zinc-100 backdrop-blur-2xl' : undefined}
                            actions={[
                                ...(activeComposerReview.type === 'INTENT_CLARIFICATION'
                                    ? [{
                                        action: 'approve' as const,
                                        label: reviewApproveLabel(activeComposerReview),
                                        onClick: () => onApprovePlan!(toApprovalPayload(activeComposerReview)),
                                    }, {
                                        action: 'reject' as const,
                                        label: reviewActionLabel(activeComposerReview, 'reject'),
                                        onClick: () => onApprovePlan!(toApprovalPayload(activeComposerReview), undefined, 'reject'),
                                    }]
                                    : beeGamePermission
                                        ? [{
                                            action: 'approve' as const,
                                            label: reviewApproveLabel(activeComposerReview),
                                            onClick: () => onApprovePlan!(toApprovalPayload(activeComposerReview)),
                                        }, {
                                            action: 'revise' as const,
                                            label: reviewReviseLabel(activeComposerReview),
                                            tone: 'reject' as const,
                                            onClick: () => onApprovePlan!(toApprovalPayload(activeComposerReview), undefined, 'revise'),
                                        }]
                                    : [...(reviewReadyForUserApproval ? [{
                                        action: 'approve' as const,
                                        label: reviewApproveLabel(activeComposerReview),
                                        onClick: () => onApprovePlan!(toApprovalPayload(activeComposerReview)),
                                    }] : []), {
                                        action: 'revise' as const,
                                        label: reviewReviseLabel(activeComposerReview),
                                        onClick: () => onApprovePlan!(toApprovalPayload(activeComposerReview), undefined, 'revise'),
                                    }]),
                            ]}
                            pendingMessage={approvalState.message}
                            failedMessage={approvalState.message}
                        />
                    </div>
                ) : (
                    <div className="relative group" data-testid={isBeeGameVariant ? 'beegame-chat-composer' : undefined}>
                        {imageAttachments.length > 0 ? (
                            <div className="mb-3 flex gap-2 overflow-x-auto">
                                {imageAttachments.map((attachment, index) => (
                                    <div
                                        key={`${attachment.filename || 'image'}-${index}`}
                                        className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl border border-white/15 bg-black/30"
                                    >
                                        <img
                                            src={`data:${attachment.mediaType};base64,${attachment.data}`}
                                            alt={attachment.filename || `image-${index + 1}`}
                                            className="h-full w-full object-cover"
                                        />
                                        <button
                                            type="button"
                                            aria-label="Remove image"
                                            onClick={() => onRemoveImageAttachment?.(index)}
                                            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        <div className="relative flex items-end">
                            <input
                                id="beegame-chat-image-upload"
                                type="file"
                                accept="image/png,image/jpeg,image/gif,image/webp"
                                multiple
                                className="hidden"
                                onChange={(event) => {
                                    const files = Array.from(event.target.files || []);
                                    event.target.value = '';
                                    void handleImageFiles(files);
                                }}
                                disabled={isComposerDisabled}
                            />
                            <label
                                htmlFor="beegame-chat-image-upload"
                                aria-label="Attach image"
                                title="Attach image"
                                className={`absolute bottom-2.5 left-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-colors ${isComposerDisabled ? 'pointer-events-none opacity-40' : 'cursor-pointer hover:bg-white/10 hover:text-zinc-100'}`}
                            >
                                <ImagePlus className="h-5 w-5" />
                            </label>
                        <textarea
                            ref={textareaRef}
                            className={`${textareaClassName} pl-14`}
                            placeholder={isComposerLocked || isLoading ? text.aiProcessing : waitingApproval.placeholder}
                            value={chatInput}
                            onChange={(e) => onChatInputChange(e.target.value)}
                            onPaste={(e) => {
                                const files = clipboardDataToImageFiles(e.clipboardData);
                                if (files.length === 0) return;
                                e.preventDefault();
                                void handleImageFiles(files);
                            }}
                            onCompositionStart={() => setIsComposing(true)}
                            onCompositionEnd={() => setIsComposing(false)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                                    e.preventDefault();
                                    if (!isComposerDisabled) onSend();
                                }
                            }}
                            disabled={isComposerDisabled}
                        />
                        <button
                            onClick={onSend}
                            aria-label="Send message"
                            disabled={!canSubmitComposer || isComposerDisabled}
                            className={sendButtonClassName}
                        >
                            <Send className="w-5 h-5 -ml-0.5" />
                        </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

ChatPanel.displayName = 'ChatPanel';
