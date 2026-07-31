import { memo, useMemo } from 'react';
import { FileText, AlertCircle, Send, Square, X } from 'lucide-react';
import { FaPaperclip } from 'react-icons/fa6';
import { BeeGameCollaborationFeed } from './BeeGameCollaborationFeed';
import {
    MessageScroller,
    MessageScrollerButton,
    MessageScrollerContent,
    MessageScrollerOutline,
    MessageScrollerProvider,
    MessageScrollerViewport,
} from '../../ui/message-scroller';
import type { ChatAttachmentPayload } from '../../../services/api';
import { CHAT_ATTACHMENT_ACCEPT, filesToChatAttachments, isSupportedChatFile } from '../../../services/chatAttachments';
import { formatPermissionSummary, isBeeGamePermission } from './SidebarUtils';
import type { WaitingPermissionState } from '../../../utils/waitingPermission';
import { type ChatDisplayMessage, type ProjectRuntimeDisplayModel, type PermissionDisplayModel } from '../../../viewModels/displayModels';
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
    onWorkflowAction?: (action: 'resume' | 'retry') => Promise<void> | void;
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

    // Tool permission controls
    onResolveToolPermission?: (
        permission: { gate_id: string },
        decision?: 'allow' | 'deny',
        scope?: 'once' | 'session'
    ) => Promise<void>;
    permissionState: {
        gateId: string | null;
        action: 'allow' | 'deny' | null;
        phase: 'idle' | 'submitting' | 'awaiting_runtime' | 'failed';
        message: string;
    };
    actionPermission?: PermissionDisplayModel;
    pendingPermissions: PermissionDisplayModel[];
    waitingPermission: WaitingPermissionState;
    projectStatus?: ProjectRuntimeDisplayModel | null;
    isComposerLocked?: boolean;
    canSendMessage?: boolean;
    lang?: Language;
    currentUserDisplayName?: string;
    currentUserEmail?: string;
    currentUserAvatarUrl?: string;
    hasOlderHistory?: boolean;
    isLoadingOlderHistory?: boolean;
    onLoadOlderHistory?: () => void | Promise<void>;
}

const toPermissionPayload = (permission: PermissionDisplayModel): { gate_id: string } => ({
    gate_id: permission.gate_id,
});

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

const getBeeGamePermissionCommand = (permission: PermissionDisplayModel | undefined | null): string => {
    const artifact = getObjectField(permission, 'artifact');
    const input = getObjectField(artifact, 'input');
    const command = getObjectField(input, 'command');
    return typeof command === 'string' ? command.trim() : '';
};

const getBeeGamePermissionTarget = (permission: PermissionDisplayModel | undefined | null): string => {
    const artifact = getObjectField(permission, 'artifact');
    const input = getObjectField(artifact, 'input');
    if (permission?.permission_tool_name === 'SandboxNetworkAccess') {
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
    permission: PermissionDisplayModel;
    text: Record<string, string>;
    permissionState: ChatPanelProps['permissionState'];
    onResolveToolPermission?: ChatPanelProps['onResolveToolPermission'];
}

const BeeGamePermissionPanel = ({
    permission,
    text,
    permissionState,
    onResolveToolPermission,
}: BeeGamePermissionPanelProps) => {
    const command = getBeeGamePermissionCommand(permission);
    const filePath = getBeeGamePermissionTarget(permission);
    const target = command
        || (filePath ? getPermissionFileName(filePath) : '')
        || permission.title
        || formatPermissionSummary(permission);
    const isAllowPending = permissionState.gateId === permission.gate_id && permissionState.action === 'allow' && permissionState.phase === 'submitting';
    const isDenyPending = permissionState.gateId === permission.gate_id && permissionState.action === 'deny' && permissionState.phase === 'submitting';
    const isNetworkPermission = permission.permission_tool_name === 'SandboxNetworkAccess';
    const supportsSessionPermission = isNetworkPermission || permission.permission_tool_name === 'ResourceLibrary';

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
                    onClick={() => onResolveToolPermission?.(toPermissionPayload(permission), 'deny')}
                    disabled={isDenyPending}
                    className="type-button flex min-h-11 items-center justify-center rounded-2xl bg-white text-zinc-950 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-55"
                >
                    {isDenyPending ? text.submitting : text.deny}
                </button>
                <button
                    type="button"
                    onClick={() => onResolveToolPermission?.(toPermissionPayload(permission), 'allow', 'once')}
                    disabled={isAllowPending}
                    className="type-button flex min-h-11 items-center justify-center rounded-2xl bg-emerald-600 text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-55"
                >
                    {isAllowPending ? text.submitting : text.allowOnce}
                </button>
                {supportsSessionPermission ? (
                    <button
                        type="button"
                        onClick={() => onResolveToolPermission?.(toPermissionPayload(permission), 'allow', 'session')}
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
    onWorkflowAction,
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
    onResolveToolPermission,
    permissionState,
    actionPermission,
    pendingPermissions,
    waitingPermission,
    projectStatus,
    isComposerLocked = false,
    canSendMessage = true,
    lang = 'en',
    currentUserDisplayName,
    currentUserEmail,
    currentUserAvatarUrl,
    hasOlderHistory = false,
    isLoadingOlderHistory = false,
    onLoadOlderHistory,
}: ChatPanelProps) => {
    const text = useBeeGameText(lang);
    const composerPlaceholder = text.chatPlaceholder || waitingPermission.placeholder;
    const attachFileLabel = text.attachFile || text.attachImage || 'Attach file';
    const workflowIsTerminal = ['completed', 'failed', 'cancelled', 'stale']
        .includes(String(projectStatus?.workflow?.status || ''));
    const activeBeeGamePermission = workflowIsTerminal
        ? undefined
        : pendingPermissions.find(isBeeGamePermission)
            ?? (actionPermission && isBeeGamePermission(actionPermission) ? actionPermission : undefined);
    const isComposerDisabled = !canSendMessage || isComposerLocked || isLoading || waitingPermission.isBlockingChat || Boolean(activeBeeGamePermission);
    const canSubmitComposer = Boolean(chatInput.trim() || attachments.length > 0);
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

    const panelClassName = 'flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-transparent';
    const composerShellClassName = 'border-t border-white/10 bg-black/25 px-4 pb-4 pt-4 backdrop-blur-2xl';
    const normalComposerClassName = 'glass-control group flex min-h-[60px] flex-col overflow-hidden rounded-3xl backdrop-blur-2xl';
    const textareaClassName = 'type-input scrollbar-hide w-full bg-transparent px-5 py-3 text-zinc-100 placeholder:text-zinc-500 disabled:opacity-50 min-h-[56px] max-h-[150px] resize-none overflow-y-auto outline-none';
    const sendButtonClassName = 'primary-pill flex h-8 w-8 shrink-0 items-center justify-center shadow-lg transition-transform group-active:scale-95 disabled:cursor-not-allowed disabled:opacity-35';
    const effectiveComposerPlaceholder = activeBeeGamePermission
        ? text.permissionPendingPlaceholder
        : isComposerLocked || isLoading
            ? text.aiProcessing
            : composerPlaceholder;

    return (
        <div className={panelClassName} data-testid="beegame-chat-panel">
            {
                <MessageScrollerProvider
                    autoScroll
                >
                    <MessageScroller
                        data-testid="beegame-message-scroller"
                        className="min-w-0 overflow-hidden"
                    >
                        <MessageScrollerViewport
                            ref={scrollContainerRef}
                            data-testid="beegame-message-scroller-viewport"
                            className="w-full min-w-0 overflow-x-hidden"
                            onScroll={(event) => {
                                if (
                                    event.currentTarget.scrollTop <= 48 &&
                                    hasOlderHistory &&
                                    !isLoadingOlderHistory
                                ) {
                                    void onLoadOlderHistory?.();
                                }
                            }}
                        >
                            <MessageScrollerContent
                                data-testid="beegame-message-scroller-content"
                                className="w-full min-w-0 max-w-full"
                            >
                                {hasOlderHistory ? (
                                    <div className="flex justify-center pb-3">
                                        <button
                                            type="button"
                                            onClick={() => void onLoadOlderHistory?.()}
                                            disabled={isLoadingOlderHistory}
                                            className="type-caption-1 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-200 disabled:cursor-wait disabled:opacity-60"
                                        >
                                            {isLoadingOlderHistory ? text.loadingEarlierMessages : text.loadEarlierMessages}
                                        </button>
                                    </div>
                                ) : null}
                                <BeeGameCollaborationFeed
                                    messages={messages}
                                    projectStatus={projectStatus}
                                    onPreviewArtifact={onPreviewArtifact}
                                    lang={lang}
                                    currentUserDisplayName={currentUserDisplayName}
                                    currentUserEmail={currentUserEmail}
                                    currentUserAvatarUrl={currentUserAvatarUrl}
                                    onEditMessage={onEditMessage}
                                    onWorkflowAction={onWorkflowAction}
                                />
                            </MessageScrollerContent>
                        </MessageScrollerViewport>
                        <MessageScrollerOutline items={messageOutlineItems} />
                        <MessageScrollerButton />
                    </MessageScroller>
                </MessageScrollerProvider>
            }
            <div className={composerShellClassName}>
                {activeBeeGamePermission ? (
                    <BeeGamePermissionPanel
                        permission={activeBeeGamePermission}
                        text={text}
                        permissionState={permissionState}
                        onResolveToolPermission={onResolveToolPermission}
                    />
                ) : null}
                {(
                    <div className={normalComposerClassName} data-testid="beegame-chat-composer">
                        {attachments.length > 0 ? (
                            <div
                                className="flex gap-3 overflow-x-auto px-4 pt-4 pb-2"
                                data-testid="beegame-chat-attachments"
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
                                    className={textareaClassName}
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
                                    <div className="flex items-center gap-1">
                                        <label
                                            htmlFor="beegame-chat-attachment-upload"
                                            aria-label={attachFileLabel}
                                            title={attachFileLabel}
                                            className={`flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition-colors ${isComposerDisabled ? 'pointer-events-none opacity-40' : 'cursor-pointer hover:bg-white/10 hover:text-zinc-100'}`}
                                            data-testid="beegame-chat-attach-button"
                                        >
                                            <FaPaperclip className="h-4 w-4" />
                                        </label>
                                        {editingMessageId ? (
                                            <button
                                                type="button"
                                                aria-label="Cancel edit"
                                                title="Cancel edit"
                                                onClick={onCancelEdit}
                                                className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-100"
                                                data-testid="beegame-cancel-edit-button"
                                            >
                                                <X className="h-4 w-4" aria-hidden="true" />
                                            </button>
                                        ) : null}
                                    </div>
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
                    </div>
                )}
            </div>
        </div>
    );
});

ChatPanel.displayName = 'ChatPanel';
