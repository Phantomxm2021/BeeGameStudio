import { memo, useMemo } from 'react';
import { FileText, MessageSquare, AlertCircle, Send, Square, X } from 'lucide-react';
import { FaPaperclip } from 'react-icons/fa6';
import { MessageItem } from './ChatComponents';
import { BeeGameCollaborationFeed } from './BeeGameCollaborationFeed';
import {
    MessageScroller,
    MessageScrollerButton,
    MessageScrollerContent,
    MessageScrollerItem,
    MessageScrollerOutline,
    MessageScrollerProvider,
    MessageScrollerViewport,
} from '../../ui/message-scroller';
import type { ReviewBindingPayload } from '../../../services/api';
import type { ChatAttachmentPayload } from '../../../services/api';
import { CHAT_ATTACHMENT_ACCEPT, filesToChatAttachments, isSupportedChatFile } from '../../../services/chatAttachments';
import { formatReviewSummary, isBeeGamePermissionReview, isReviewAwaitingUserAction } from './SidebarUtils';
import type { WaitingApprovalState } from '../../../utils/waitingApproval';
import { ApprovalActionCard, isApprovalActionPending } from './ApprovalActionCard';
import type { ChatDisplayMessage, ProjectRuntimeDisplayModel, ReviewDisplayModel } from '../../../viewModels/displayModels';
import type { Language } from '../AgentsConfig';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';

interface ChatPanelProps {
    messages: ChatDisplayMessage[];
    isLoading: boolean;
    onStop?: () => void | Promise<void>;
    isStopping?: boolean;
    chatInput: string;
    onChatInputChange: (val: string) => void;
    onSend: () => void;
    onSendMessage?: (message: string) => void;
    onEditMessage?: (message: ChatDisplayMessage) => void;
    editingMessageId?: string | null;
    onCancelEdit?: () => void;
    attachments?: ChatAttachmentPayload[];
    onAddAttachments?: (attachments: ChatAttachmentPayload[]) => void;
    onRemoveAttachment?: (index: number) => void;
    onPreviewArtifact: (id: string, title: string, content?: string) => void;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    scrollContainerRef: React.RefObject<HTMLDivElement | null>;
    isComposing: boolean;
    setIsComposing: (val: boolean) => void;

    // Approval Props
    onApprovePlan?: (
        review: ReviewBindingPayload & { gate_id: string },
        feedback?: string,
        action?: 'approve' | 'revise' | 'reject',
        permissionScope?: 'once' | 'session'
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

const clipboardDataToAttachmentFiles = (clipboardData: DataTransfer | null): File[] => {
    if (!clipboardData) return [];
    const files = Array.from(clipboardData.files || []).filter(isSupportedChatFile);
    const itemFiles = Array.from(clipboardData.items || [])
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter((file): file is File => Boolean(file))
        .filter(isSupportedChatFile);
    return dedupeImageFiles([...files, ...itemFiles]);
};

const getMessageOutlineLabel = (content: string): string => {
    const firstLine = content
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean) || 'Message';
    return firstLine.length > 80 ? `${firstLine.slice(0, 80).trim()}...` : firstLine;
};

const getObjectField = (value: unknown, key: string): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[key];
};

const getBeeGamePermissionCommand = (review: ReviewDisplayModel | undefined | null): string => {
    const artifact = getObjectField(review, 'artifact');
    const input = getObjectField(artifact, 'input');
    const command = getObjectField(input, 'command');
    return typeof command === 'string' ? command.trim() : '';
};

const getBeeGamePermissionTarget = (review: ReviewDisplayModel | undefined | null): string => {
    const artifact = getObjectField(review, 'artifact');
    const input = getObjectField(artifact, 'input');
    if (review?.permission_tool_name === 'SandboxNetworkAccess') {
        const host = getObjectField(input, 'host');
        const port = getObjectField(input, 'port');
        if (typeof host === 'string' && host.trim()) {
            return typeof port === 'number' ? `${host.trim()}:${port}` : host.trim();
        }
    }
    const path = getObjectField(input, 'path') || getObjectField(input, 'file_path') || getObjectField(input, 'notebook_path');
    return typeof path === 'string' ? path.trim() : '';
};

const getPermissionFileName = (path: string): string => {
    const segments = path.replaceAll('\\', '/').split('/').filter(Boolean);
    return segments.at(-1) || path;
};

interface BeeGamePermissionPanelProps {
    review: ReviewDisplayModel;
    text: Record<string, string>;
    approvalState: ChatPanelProps['approvalState'];
    onApprovePlan?: ChatPanelProps['onApprovePlan'];
}

const BeeGamePermissionPanel = ({
    review,
    text,
    approvalState,
    onApprovePlan,
}: BeeGamePermissionPanelProps) => {
    const command = getBeeGamePermissionCommand(review);
    const filePath = getBeeGamePermissionTarget(review);
    const target = command
        || (filePath ? getPermissionFileName(filePath) : '')
        || review.title
        || formatReviewSummary(review);
    const isAllowPending = isApprovalActionPending(approvalState, review.gate_id, 'approve');
    const isDenyPending = isApprovalActionPending(approvalState, review.gate_id, 'revise');
    const isNetworkPermission = review.permission_tool_name === 'SandboxNetworkAccess';
    const supportsSessionPermission = isNetworkPermission || review.permission_tool_name === 'ResourceLibrary';

    return (
        <section
            aria-label={text.permissionRequired}
            className="glass-control mb-3 overflow-hidden rounded-3xl border border-white/15 bg-zinc-950/75 text-zinc-100 shadow-2xl shadow-black/30 backdrop-blur-2xl"
            data-testid="beegame-permission-panel"
        >
            <div className="flex items-start gap-4 border-b border-white/10 px-5 py-4">
                <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.06] text-amber-300">
                    <AlertCircle className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="type-caption-1 mb-1 text-amber-300">{text.permissionRequired}</div>
                    <h3 className="type-headline text-zinc-100">{command ? text.permissionBashTitle : text.permissionToolTitle}</h3>
                    <p className="type-footnote mt-1 text-zinc-400">{text.permissionPanelDescription}</p>
                </div>
            </div>
            <div className="space-y-4 px-5 py-4">
                <div>
                    <div className="type-caption-2 mb-2 text-zinc-500">{command ? text.permissionCommandLabel : text.permissionTargetLabel}</div>
                    {command ? (
                        <pre className="type-code-sm max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-zinc-100 [overflow-wrap:anywhere]">
                            {target}
                        </pre>
                    ) : (
                        <div className="type-body rounded-2xl border border-white/10 bg-black/25 px-4 py-3 font-medium text-zinc-100">
                            {target}
                        </div>
                    )}
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                    <div className="type-caption-2 mb-1 text-zinc-500">{text.permissionRiskLabel}</div>
                    <div className="type-footnote text-zinc-300">{text.permissionRiskGeneric}</div>
                </div>
            </div>
            <div className={`grid gap-2 border-t border-white/10 px-5 pb-5 pt-1 ${supportsSessionPermission ? 'min-[520px]:grid-cols-3' : 'min-[420px]:grid-cols-2'}`}>
                <button
                    type="button"
                    onClick={() => onApprovePlan?.(toApprovalPayload(review), undefined, 'revise')}
                    disabled={isDenyPending}
                    className="type-button flex min-h-11 items-center justify-center rounded-2xl bg-white text-zinc-950 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-55"
                >
                    {isDenyPending ? text.submitting : text.deny}
                </button>
                <button
                    type="button"
                    onClick={() => onApprovePlan?.(toApprovalPayload(review), undefined, 'approve', 'once')}
                    disabled={isAllowPending}
                    className="type-button flex min-h-11 items-center justify-center rounded-2xl bg-emerald-600 text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-55"
                >
                    {isAllowPending ? text.submitting : text.allowOnce}
                </button>
                {supportsSessionPermission ? (
                    <button
                        type="button"
                        onClick={() => onApprovePlan?.(toApprovalPayload(review), undefined, 'approve', 'session')}
                        disabled={isAllowPending}
                        className="type-button flex min-h-11 items-center justify-center rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-3 text-emerald-200 transition-colors hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                        {isAllowPending ? text.submitting : text.allowForSession}
                    </button>
                ) : null}
            </div>
        </section>
    );
};

export const ChatPanel = memo(({
    messages,
    isLoading,
    onStop,
    isStopping = false,
    chatInput,
    onChatInputChange,
    onSend,
    onEditMessage,
    editingMessageId = null,
    onCancelEdit,
    attachments = [],
    onAddAttachments,
    onRemoveAttachment,
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
    const composerPlaceholder = text.chatPlaceholder || waitingApproval.placeholder;
    const attachFileLabel = text.attachFile || text.attachImage || 'Attach file';
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
    const activeBeeGamePermissionReview = activeComposerReview && isBeeGamePermissionReview(activeComposerReview)
        ? activeComposerReview
        : undefined;
    const shouldShowApprovalBar = Boolean(onApprovePlan && activeComposerReview && !activeBeeGamePermissionReview);
    const shouldShowWaitingBanner = waitingApproval.isBlockingChat && !shouldShowApprovalBar;
    const isComposerDisabled = !canSendMessage || isComposerLocked || isLoading || waitingApproval.isBlockingChat || Boolean(activeBeeGamePermissionReview);
    const canSubmitComposer = Boolean(chatInput.trim() || attachments.length > 0);
    const isBeeGameVariant = variant === 'beegame';
    const messageOutlineItems = useMemo(
        () => messages
            .filter((message) => message.sender === 'user')
            .map((message) => ({
                id: message.id,
                label: getMessageOutlineLabel(String(message.content || '')),
            })),
        [messages],
    );
    const handleImageFiles = async (files: File[]) => {
        if (!files.length || !onAddAttachments) return;
        const nextAttachments = await filesToChatAttachments(files);
        if (nextAttachments.length > 0) onAddAttachments(nextAttachments);
    };

    const panelClassName = isBeeGameVariant
        ? 'flex h-full flex-col bg-transparent'
        : 'flex flex-col h-full bg-white/95 dark:bg-zinc-900/95 backdrop-blur-3xl';
    const legacyScrollClassName = 'flex-1 overflow-y-auto px-8 pt-8 space-y-8 relative pb-8';
    const composerShellClassName = isBeeGameVariant
        ? 'border-t border-white/10 bg-black/25 px-4 pb-4 pt-4 backdrop-blur-2xl'
        : 'pt-4 bg-transparent border-t border-zinc-100 dark:border-zinc-800 px-8 pb-8';
    const normalComposerClassName = isBeeGameVariant
        ? 'glass-control group flex min-h-[60px] flex-col overflow-hidden rounded-3xl backdrop-blur-2xl'
        : 'relative group';
    const textareaClassName = isBeeGameVariant
        ? 'type-input scrollbar-hide w-full bg-transparent px-5 py-3 text-zinc-100 placeholder:text-zinc-500 disabled:opacity-50 min-h-[56px] max-h-[150px] resize-none overflow-y-auto outline-none'
        : 'type-input w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl px-6 py-4 pr-16 outline-none focus:border-zinc-900 dark:focus:border-zinc-100 transition-all text-zinc-900 dark:text-zinc-100 disabled:opacity-50 min-h-[52px] max-h-[160px] resize-none overflow-y-auto';
    const textareaInsetClassName = isBeeGameVariant ? '' : 'pl-14';
    const sendButtonClassName = isBeeGameVariant
        ? 'primary-pill flex h-8 w-8 shrink-0 items-center justify-center shadow-lg transition-transform group-active:scale-95 disabled:cursor-not-allowed disabled:opacity-35'
        : 'absolute right-3 bottom-2 w-10 h-10 flex items-center justify-center bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-full shadow-lg group-active:scale-95 transition-transform disabled:opacity-50 disabled:bg-zinc-400';
    const effectiveComposerPlaceholder = activeBeeGamePermissionReview
        ? text.permissionPendingPlaceholder
        : isComposerLocked || isLoading
            ? text.aiProcessing
            : composerPlaceholder;

    return (
        <div className={panelClassName} data-testid={isBeeGameVariant ? 'beegame-chat-panel' : undefined}>
            {isBeeGameVariant ? (
                <MessageScrollerProvider
                    autoScroll
                >
                    <MessageScroller
                        data-testid="beegame-message-scroller"
                    >
                        <MessageScrollerViewport
                            ref={scrollContainerRef}
                            data-testid="beegame-message-scroller-viewport"
                        >
                            <MessageScrollerContent
                                data-testid="beegame-message-scroller-content"
                            >
                                <BeeGameCollaborationFeed
                                    messages={messages}
                                    projectStatus={projectStatus}
                                    onPreviewArtifact={onPreviewArtifact}
                                    lang={lang}
                                    currentUserDisplayName={currentUserDisplayName}
                                    currentUserEmail={currentUserEmail}
                                    currentUserAvatarUrl={currentUserAvatarUrl}
                                    onEditMessage={onEditMessage}
                                />
                                {pendingReviews.map((review: ReviewDisplayModel) => {
                                    const isManifestReview = review?.type === 'ASSET_MANIFEST_REVIEW' && Boolean(review?.gate_id);
                                    if (!isManifestReview) return null;

                                    return (
                                        <MessageScrollerItem
                                            key={review.gate_id}
                                            messageId={`review-${review.gate_id}`}
                                            className="mt-3"
                                        >
                                            <div className="glass-control w-full space-y-4 rounded-3xl border border-white/15 bg-black/25 p-6 backdrop-blur-2xl">
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
                                        </MessageScrollerItem>
                                    );
                                })}
                            </MessageScrollerContent>
                        </MessageScrollerViewport>
                        <MessageScrollerOutline items={messageOutlineItems} />
                        <MessageScrollerButton />
                    </MessageScroller>
                </MessageScrollerProvider>
            ) : (
                <div
                    ref={scrollContainerRef}
                    className={legacyScrollClassName}
                >
                    {messages.length === 0 ? (
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
            )}

            <div className={composerShellClassName}>
                {editingMessageId ? (
                    <div
                        data-testid="beegame-editing-message-banner"
                        className="mb-3 flex items-center justify-between rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.055] px-3 py-2 text-zinc-300"
                    >
                        <span className="type-footnote">Editing message</span>
                        <button
                            type="button"
                            aria-label="Cancel edit"
                            onClick={onCancelEdit}
                            className="type-footnote rounded-lg px-2 py-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
                        >
                            Cancel
                        </button>
                    </div>
                ) : null}
                {shouldShowWaitingBanner && (
                    <div className="glass-control type-footnote mb-3 rounded-2xl border border-white/15 bg-black/25 px-4 py-3 text-zinc-300 backdrop-blur-2xl">
                        {waitingApproval.message}
                    </div>
                )}
                {activeBeeGamePermissionReview ? (
                    <BeeGamePermissionPanel
                        review={activeBeeGamePermissionReview}
                        text={text}
                        approvalState={approvalState}
                        onApprovePlan={onApprovePlan}
                    />
                ) : null}
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
                    <div className={normalComposerClassName} data-testid={isBeeGameVariant ? 'beegame-chat-composer' : undefined}>
                        {attachments.length > 0 ? (
                            <div
                                className={isBeeGameVariant ? 'flex gap-3 overflow-x-auto px-4 pt-4 pb-2' : 'mb-3 flex gap-2 overflow-x-auto'}
                                data-testid={isBeeGameVariant ? 'beegame-chat-attachments' : undefined}
                            >
                                {attachments.map((attachment, index) => (
                                    <div
                                        key={`${attachment.filename || attachment.type}-${index}`}
                                        className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl border border-white/15 bg-black/30"
                                    >
                                        {attachment.type === 'image' ? (
                                            <img
                                                src={`data:${attachment.mediaType};base64,${attachment.data}`}
                                                alt={attachment.filename || `image-${index + 1}`}
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-zinc-300" title={attachment.filename}>
                                                <FileText className="h-5 w-5" />
                                                <span className="type-caption-2 w-full truncate text-center">{attachment.filename}</span>
                                            </div>
                                        )}
                                        <button
                                            type="button"
                                            aria-label="Remove attachment"
                                            onClick={() => onRemoveAttachment?.(index)}
                                            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        {isBeeGameVariant ? (
                            <>
                                <input
                                    id="beegame-chat-attachment-upload"
                                    type="file"
                                    accept={CHAT_ATTACHMENT_ACCEPT}
                                    multiple
                                    className="hidden"
                                    onChange={(event) => {
                                        const files = Array.from(event.target.files || []);
                                        event.target.value = '';
                                        void handleImageFiles(files);
                                    }}
                                    disabled={isComposerDisabled}
                                />
                                <textarea
                                    ref={textareaRef}
                                    className={`${textareaClassName} ${textareaInsetClassName}`}
                                    placeholder={effectiveComposerPlaceholder}
                                    value={chatInput}
                                    onChange={(e) => onChatInputChange(e.target.value)}
                                    onPaste={(e) => {
                                        const files = clipboardDataToAttachmentFiles(e.clipboardData);
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
                                <div
                                    className="flex items-center justify-between px-3 pb-2 pt-0"
                                    data-testid="beegame-chat-toolbar"
                                >
                                    <label
                                        htmlFor="beegame-chat-attachment-upload"
                                        aria-label={attachFileLabel}
                                        title={attachFileLabel}
                                        className={`flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition-colors ${isComposerDisabled ? 'pointer-events-none opacity-40' : 'cursor-pointer hover:bg-white/10 hover:text-zinc-100'}`}
                                        data-testid="beegame-chat-attach-button"
                                    >
                                        <FaPaperclip className="h-4 w-4" />
                                    </label>
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={isLoading ? () => void onStop?.() : onSend}
                                            aria-label={isLoading ? (isStopping ? 'Stopping task' : 'Stop task') : 'Send message'}
                                            disabled={isLoading ? !onStop || isStopping : !canSubmitComposer || isComposerDisabled}
                                            className={sendButtonClassName}
                                        >
                                            {isLoading ? <Square className="h-3.5 w-3.5 fill-current" /> : <Send className="h-4 w-4 -ml-0.5" />}
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="relative flex items-end">
                                <input
                                    id="beegame-chat-attachment-upload"
                                    type="file"
                                    accept={CHAT_ATTACHMENT_ACCEPT}
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
                                    htmlFor="beegame-chat-attachment-upload"
                                    aria-label={attachFileLabel}
                                    title={attachFileLabel}
                                    className={`absolute bottom-3.5 left-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition-colors ${isComposerDisabled ? 'pointer-events-none opacity-40' : 'cursor-pointer hover:bg-white/10 hover:text-zinc-100'}`}
                                >
                                    <FaPaperclip className="h-4 w-4" />
                                </label>
                                <textarea
                                    ref={textareaRef}
                                    className={`${textareaClassName} ${textareaInsetClassName}`}
                                    placeholder={effectiveComposerPlaceholder}
                                    value={chatInput}
                                    onChange={(e) => onChatInputChange(e.target.value)}
                                    onPaste={(e) => {
                                        const files = clipboardDataToAttachmentFiles(e.clipboardData);
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
                                            onClick={isLoading ? () => void onStop?.() : onSend}
                                            aria-label={isLoading ? (isStopping ? 'Stopping task' : 'Stop task') : 'Send message'}
                                            disabled={isLoading ? !onStop || isStopping : !canSubmitComposer || isComposerDisabled}
                                            className={sendButtonClassName}
                                        >
                                            {isLoading ? <Square className="h-3.5 w-3.5 fill-current" /> : <Send className="h-4 w-4 -ml-0.5" />}
                                        </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});

ChatPanel.displayName = 'ChatPanel';
