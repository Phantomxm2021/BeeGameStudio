import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, AlertCircle, Send } from 'lucide-react';
import { MessageItem } from './ChatComponents';
import { BeeGameCollaborationFeed } from './BeeGameCollaborationFeed';
import type { ReviewBindingPayload } from '../../../services/api';
import { formatGddReviewSummary, isBlockerResolutionReview, isBeeGamePermissionReview, isReviewAwaitingUserAction } from './SidebarUtils';
import type { WaitingApprovalState } from '../../../utils/waitingApproval';
import { ApprovalActionCard, isApprovalActionPending } from './ApprovalActionCard';
import type { ChatDisplayMessage, ProjectRuntimeDisplayModel, ReviewDisplayModel } from '../../../viewModels/displayModels';
import type { Language } from '../AgentsConfig';
import { getBeeGameText } from '../BeeGameI18n';

interface ChatPanelProps {
    messages: ChatDisplayMessage[];
    isLoading: boolean;
    chatInput: string;
    onChatInputChange: (val: string) => void;
    onSend: () => void;
    onSendMessage?: (message: string) => void;
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
    gddReview?: ReviewDisplayModel;
    pendingReviews: ReviewDisplayModel[];
    onUploadManifestCsv?: (gateId: string, csvContent: string, autoApprove?: boolean) => Promise<void>;
    onApproveManifest?: (review: ReviewBindingPayload & { gate_id: string }, feedback?: string) => Promise<void>;
    waitingApproval: WaitingApprovalState;
    projectStatus?: ProjectRuntimeDisplayModel | null;
    isComposerLocked?: boolean;
    variant?: 'legacy' | 'beegame';
    lang?: Language;
}

const toApprovalPayload = (review: ReviewDisplayModel): ReviewBindingPayload & { gate_id: string } => {
    if (review.raw) {
        return review.raw;
    }
    return review as unknown as ReviewBindingPayload & { gate_id: string };
};

export const ChatPanel = memo(({
    messages,
    isLoading,
    chatInput,
    onChatInputChange,
    onSend,
    onSendMessage,
    onPreviewArtifact,
    textareaRef,
    scrollContainerRef,
    isComposing,
    setIsComposing,
    onApprovePlan,
    approvalState,
    gddReview,
    pendingReviews,
    onUploadManifestCsv,
    onApproveManifest,
    waitingApproval,
    projectStatus,
    isComposerLocked = false,
    variant = 'legacy',
    lang = 'en',
}: ChatPanelProps) => {
    const text = getBeeGameText(lang);
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
    const gddReadyForUserApproval = isReviewAwaitingUserAction(gddReview);
    const gddBlockerResolution = isBlockerResolutionReview(gddReview);
    const beeGamePermission = isBeeGamePermissionReview(gddReview);
    const projectFailed = Boolean(projectStatus?.blocked && String(projectStatus?.blocked_reason || '').trim() === 'pipeline_failed');
    const activeComposerReview = projectFailed ? clarificationReview : (clarificationReview || gddReview);
    const shouldShowApprovalBar = Boolean(onApprovePlan && activeComposerReview);
    const shouldShowWaitingBanner = waitingApproval.isBlockingChat && !shouldShowApprovalBar;
    const handleContinueFixing = (message: string) => {
        if (isComposerLocked || waitingApproval.isBlockingChat) return;
        onSendMessage?.(message);
    };

    const isBeeGameVariant = variant === 'beegame';
    const panelClassName = isBeeGameVariant
        ? 'flex h-full flex-col bg-transparent'
        : 'flex flex-col h-full bg-white/95 dark:bg-zinc-900/95 backdrop-blur-3xl';
    const scrollClassName = isBeeGameVariant
        ? 'flex-1 overflow-y-auto px-4 pt-4 relative pb-4'
        : 'flex-1 overflow-y-auto px-8 pt-8 space-y-8 relative pb-8';
    const composerShellClassName = isBeeGameVariant
        ? 'border-t border-zinc-800 bg-zinc-950/70 px-4 pb-4 pt-4'
        : 'pt-4 bg-transparent border-t border-zinc-100 dark:border-zinc-800 px-8 pb-8';
    const textareaClassName = isBeeGameVariant
        ? 'w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-3 pr-14 outline-none focus:border-orange-500/70 transition-all text-sm text-zinc-100 placeholder:text-zinc-600 disabled:opacity-50 min-h-[52px] max-h-[150px] resize-none overflow-y-auto'
        : 'w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl px-6 py-4 pr-16 outline-none focus:border-zinc-900 dark:focus:border-zinc-100 transition-all text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-50 min-h-[52px] max-h-[160px] resize-none overflow-y-auto';
    const sendButtonClassName = isBeeGameVariant
        ? 'absolute right-3 bottom-2.5 flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-700 text-zinc-100 shadow-lg transition-transform group-active:scale-95 disabled:bg-zinc-800 disabled:text-zinc-600'
        : 'absolute right-3 bottom-2 w-10 h-10 flex items-center justify-center bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-full shadow-lg group-active:scale-95 transition-transform disabled:opacity-50 disabled:bg-zinc-400';

    return (
        <div className={panelClassName} data-testid={isBeeGameVariant ? 'beegame-chat-panel' : undefined}>
            <div
                ref={scrollContainerRef}
                className={scrollClassName}
            >
                <AnimatePresence initial={false}>
                    {isBeeGameVariant ? (
                        <BeeGameCollaborationFeed
                            messages={messages}
                            projectStatus={projectStatus}
                            onPreviewArtifact={onPreviewArtifact}
                            lang={lang}
                        />
                    ) : messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-20 space-y-4 py-20">
                            <motion.div
                                animate={{ scale: [1, 1.1, 1] }}
                                transition={{ duration: 4, repeat: Infinity }}
                            >
                                <MessageSquare className="w-16 h-16 text-zinc-400" />
                            </motion.div>
                            <p className="text-sm font-medium">{text.noMessages}</p>
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
                            <motion.div
                                key={review.gate_id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="w-full p-6 rounded-3xl bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/50 space-y-4"
                            >
                                <div className="flex items-start space-x-3">
                                    <AlertCircle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[10px] font-black uppercase tracking-widest text-blue-500 mb-1">{text.actionRequired}</div>
                                        <div className="text-sm text-blue-900 dark:text-blue-100 opacity-80 mb-2">
                                            {text.resourceManifestDescription}
                                        </div>
                                        <div className="flex space-x-3 mt-4">
                                            <button
                                                onClick={() => onApproveManifest && onApproveManifest(toApprovalPayload(review))}
                                                disabled={isLoading}
                                                className="flex-1 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center space-x-2 shadow-sm disabled:opacity-50"
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
                                                    className={`w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center space-x-2 shadow-sm cursor-pointer ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}
                                                >
                                                    <span>{text.upload}</span>
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>

            <div className={composerShellClassName}>
                {shouldShowWaitingBanner && (
                    <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                        {waitingApproval.message}
                    </div>
                )}
                {shouldShowApprovalBar && activeComposerReview ? (
                    <motion.div
                        key={`approval-bar-${activeComposerReview.gate_id}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="pointer-events-auto"
                    >
                        <ApprovalActionCard
                            gateId={activeComposerReview.gate_id}
                            title={
                                beeGamePermission
                                    ? text.permissionRequired
                                    : activeComposerReview.type === 'INTENT_CLARIFICATION'
                                        ? text.clarificationRequired
                                        : gddReadyForUserApproval
                                            ? text.approvalRequired
                                            : text.revisionRequired
                            }
                            description={
                                activeComposerReview.type === 'INTENT_CLARIFICATION'
                                    ? text.clarificationDescription
                                    : formatGddReviewSummary(activeComposerReview)
                            }
                            tone={
                                beeGamePermission
                                    ? 'clarification'
                                    : activeComposerReview.type === 'INTENT_CLARIFICATION'
                                    ? 'clarification'
                                    : gddReadyForUserApproval
                                        ? 'approval'
                                        : 'revision'
                            }
                            approvalState={approvalState}
                            layout="bottom-bar"
                            className={isBeeGameVariant ? 'rounded-xl border-zinc-800 bg-zinc-900/80 px-3 py-3 text-zinc-100' : undefined}
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
                                    : [...(!gddBlockerResolution && gddReadyForUserApproval ? [{
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
                    </motion.div>
                ) : (
                    <div className="relative group flex items-end" data-testid={isBeeGameVariant ? 'beegame-chat-composer' : undefined}>
                        <textarea
                            ref={textareaRef}
                            className={textareaClassName}
                            placeholder={isComposerLocked || isLoading ? text.aiProcessing : waitingApproval.placeholder}
                            value={chatInput}
                            onChange={(e) => onChatInputChange(e.target.value)}
                            onCompositionStart={() => setIsComposing(true)}
                            onCompositionEnd={() => setIsComposing(false)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                                    e.preventDefault();
                                    onSend();
                                }
                            }}
                            disabled={isComposerLocked || isLoading || waitingApproval.isBlockingChat}
                        />
                        <button
                            onClick={onSend}
                            disabled={!chatInput.trim() || isComposerLocked || isLoading || waitingApproval.isBlockingChat}
                            className={sendButtonClassName}
                        >
                            <Send className="w-5 h-5 -ml-0.5" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
});

ChatPanel.displayName = 'ChatPanel';
