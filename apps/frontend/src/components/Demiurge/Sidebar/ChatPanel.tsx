import type { ModelRequestRetryControl } from './RuntimeErrorNotice';
import { memo, useRef, useState } from 'react';
import { McpElicitationPanel } from './McpElicitationPanel';
import { CornerDownRight, Ellipsis, FileText, ListEnd, Paperclip, Plus, Trash2, X } from 'lucide-react';
import { BeeGameCollaborationFeed } from './BeeGameCollaborationFeed';
import {
    MessageScroller,
} from '../../beui/registry/components/agents/message-scroller';
import type { ChatAttachmentPayload } from '../../../services/api';
import { CHAT_ATTACHMENT_ACCEPT, filesToChatAttachments, isSupportedChatFile } from '../../../services/chatAttachments';
import { formatPermissionSummary, isBeeGamePermission } from './SidebarUtils';
import type { WaitingPermissionState } from '../../../utils/waitingPermission';
import { type ChatDisplayMessage, type PermissionDisplayModel } from '../../../viewModels/displayModels';
import type { Language } from '../AgentsConfig';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';
import { filterPathsForDisplay } from '../../../utils/chatPathDisplay';
import { Button } from '../../beui/project-button';
import { ToolApproval, ToolApprovalCode } from '../../beui/registry/components/agents/tool-approval';
import { PromptInput } from '../../beui/registry/components/agents/prompt-input';
import { UserQuestionPanel } from './UserQuestionPanel';

interface ChatPanelProps {
    messages: ChatDisplayMessage[];
    retry?: ModelRequestRetryControl;
    isLoading: boolean;
    queuedMessages?: Array<{ id: string; text: string; state: 'pending' | 'dispatching'; attachmentCount?: number }>;
    queueActionId?: string | null;
    queueError?: string | null;
    onSteerQueued?: (id: string) => void;
    onDeleteQueued?: (id: string) => void;
    streamingMessageId?: string | null;
    onStop?: () => void | Promise<void>;
    isStopping?: boolean;
    chatInput: string;
    onChatInputChange: (val: string) => void;
    onSend: () => void;
    onEditMessage?: (message: ChatDisplayMessage) => void;
    editingMessageId?: string | null;
    editDraft: string;
    onEditDraftChange: (value: string) => void;
    onSubmitEdit: () => void;
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
        permission: { gate_id: string; intent?: 'change' },
        decision?: 'allow' | 'deny',
        scope?: 'once' | 'session',
        answers?: Record<string, string>
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

interface BeUiPermissionPanelProps {
    permission: PermissionDisplayModel;
    text: Record<string, string>;
    permissionState: ChatPanelProps['permissionState'];
    onResolveToolPermission?: ChatPanelProps['onResolveToolPermission'];
}

const BeUiPermissionPanel = ({
    permission,
    text,
    permissionState,
    onResolveToolPermission,
}: BeUiPermissionPanelProps) => {
    const command = getBeeGamePermissionCommand(permission);
    const filePath = getBeeGamePermissionTarget(permission);
    const target = command
        || (filePath ? getPermissionFileName(filePath) : '')
        || permission.title
        || formatPermissionSummary(permission);
    const safeTarget = filterPathsForDisplay(target);
    const isAllowPending = permissionState.gateId === permission.gate_id && permissionState.action === 'allow' && permissionState.phase === 'submitting';
    const isDenyPending = permissionState.gateId === permission.gate_id && permissionState.action === 'deny' && permissionState.phase === 'submitting';
    const isNetworkPermission = permission.permission_tool_name === 'SandboxNetworkAccess';
    const supportsSessionPermission = isNetworkPermission || permission.permission_tool_name === 'ResourceLibrary';
    const approvalStatus = isAllowPending || isDenyPending
        ? 'approving'
        : permissionState.gateId === permission.gate_id && permissionState.phase === 'failed'
            ? 'error'
            : 'pending';
    const parameterLabel = command ? text.permissionCommandLabel : text.permissionTargetLabel;
    const toolName = permission.permission_tool_name || (command ? 'terminal.run' : 'workspace.access');
    const toolLabel = /^(Bgs|Codex)(Permissions|Command|FileChange)$/.test(toolName) ? toolName.replace(/^(Bgs|Codex)/, 'BGS') : toolName;

    return (
        <div data-testid="beegame-permission-panel" className="mb-3">
            <ToolApproval
                tool={toolLabel}
                title={command ? text.permissionBashTitle : text.permissionToolTitle}
                status={approvalStatus}
                description={`${text.permissionPanelDescription} ${text.permissionRiskGeneric}`}
                parameters={[{
                    id: command ? 'command' : 'target',
                    label: parameterLabel,
                    value: command ? <ToolApprovalCode code={safeTarget} language="bash" /> : safeTarget,
                }, ...(toolName.startsWith('Bgs') ? [{ id: 'requested-access', label: text.permissionTargetLabel,
                    value: <ToolApprovalCode code={JSON.stringify(permission.artifact?.input, null, 2)} language="json" /> }] : [])]}
                onApprove={() => void onResolveToolPermission?.(toPermissionPayload(permission), 'allow', 'once')}
                onAlwaysAllow={supportsSessionPermission
                    ? () => void onResolveToolPermission?.(toPermissionPayload(permission), 'allow', 'session')
                    : undefined}
                onDeny={() => void onResolveToolPermission?.(toPermissionPayload(permission), 'deny')}
                approveLabel={text.allowOnce || 'Allow once'}
                alwaysAllowLabel={text.allowForSession || 'Allow for this session'}
                denyLabel={text.deny || 'Deny'}
                className="text-[var(--text-primary)]"
            />
        </div>
    );
};

export const ChatPanel = memo(({
    messages,
    retry,
    isLoading,
    queuedMessages = [],
    queueActionId,
    queueError,
    onSteerQueued,
    onDeleteQueued,
    streamingMessageId = null,
    onStop,
    isStopping = false,
    chatInput,
    onChatInputChange,
    onSend,
    onEditMessage,
    editingMessageId = null,
    editDraft,
    onEditDraftChange,
    onSubmitEdit,
    onCancelEdit,
    attachments = [],
    onAddAttachments,
    onRemoveAttachment,
    onPreviewArtifact,
    textareaRef,
    scrollContainerRef,
    setIsComposing,
    onResolveToolPermission,
    permissionState,
    actionPermission,
    pendingPermissions,
    waitingPermission,
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
    const attachmentInputRef = useRef<HTMLInputElement>(null);
    const historyScrollIntentRef = useRef(false);
    const [expandedQueuedId, setExpandedQueuedId] = useState<string | null>(null);
    const composerPlaceholder = text.chatPlaceholder || waitingPermission.placeholder;
    const attachFileLabel = text.attachFile || text.attachImage || 'Attach file';
    const activeBeeGamePermissions = pendingPermissions.filter(isBeeGamePermission).concat(
            actionPermission && isBeeGamePermission(actionPermission) && !pendingPermissions.some(permission => permission.gate_id === actionPermission.gate_id)
                ? [actionPermission]
                : [],
        );
    const activeBeeGamePermission = activeBeeGamePermissions[0];
    const isComposerDisabled = !canSendMessage || isComposerLocked || waitingPermission.isBlockingChat || Boolean(activeBeeGamePermission);
    const handleImageFiles = async (files: File[]) => {
        if (isComposerDisabled || !files.length || !onAddAttachments) return;
        const nextAttachments = await filesToChatAttachments(files);
        if (nextAttachments.length > 0) onAddAttachments(nextAttachments);
    };

    const panelClassName = 'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden';
    const composerShellClassName = 'shrink-0';
    const effectiveComposerPlaceholder = activeBeeGamePermission
        ? text.permissionPendingPlaceholder
        : isComposerLocked
            ? text.aiProcessing
            : composerPlaceholder;

    return (
        <div className={panelClassName} data-testid="beegame-chat-panel">
            <MessageScroller
                data-testid="beegame-message-scroller"
                className="min-w-0 flex-1 overflow-hidden"
                viewportRef={scrollContainerRef}
                navigation="rail"
                smooth={false}
                pauseAutoFollow={isLoadingOlderHistory}
                navigationLabel="Message navigation"
                busy={isLoading}
                viewportClassName="min-h-0 w-full min-w-0 overflow-x-hidden"
                contentClassName="w-full min-w-0 max-w-full py-3"
                viewportProps={{
                    'data-testid': 'beegame-message-scroller-viewport',
                    // Layout changes and the initial jump to the latest message
                    // must never fetch another history page.
                    onWheel: event => { historyScrollIntentRef.current = event.deltaY < 0; },
                    onTouchStart: () => { historyScrollIntentRef.current = true; },
                    onPointerDown: () => { historyScrollIntentRef.current = true; },
                    onKeyDown: event => {
                        historyScrollIntentRef.current = ['ArrowUp', 'PageUp', 'Home'].includes(event.key);
                    },
                    onScroll: (event) => {
                        if (
                            historyScrollIntentRef.current &&
                            event.currentTarget.scrollTop <= 48 &&
                            hasOlderHistory &&
                            !isLoadingOlderHistory
                        ) {
                            historyScrollIntentRef.current = false;
                            void onLoadOlderHistory?.();
                        }
                    },
                }}
                contentProps={{ 'data-testid': 'beegame-message-scroller-content' }}
            >
                {hasOlderHistory ? (
                    <div className="flex justify-center pb-3">
                        <button
                            type="button"
                            onClick={() => void onLoadOlderHistory?.()}
                            disabled={isLoadingOlderHistory}
                            className="type-caption-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-wait disabled:opacity-60"
                        >
                            {isLoadingOlderHistory ? text.loadingEarlierMessages : text.loadEarlierMessages}
                        </button>
                    </div>
                ) : null}
                <BeeGameCollaborationFeed
                    messages={messages}
                    retry={retry}
                    onPreviewArtifact={onPreviewArtifact}
                    lang={lang}
                    currentUserDisplayName={currentUserDisplayName}
                    currentUserEmail={currentUserEmail}
                    currentUserAvatarUrl={currentUserAvatarUrl}
                    onEditMessage={onEditMessage}
                    editingMessageId={editingMessageId}
                    editDraft={editDraft}
                    onEditDraftChange={onEditDraftChange}
                    onSubmitEdit={onSubmitEdit}
                    onCancelEdit={onCancelEdit}
                    editDisabled={isComposerDisabled || isStopping || isLoading}
                    isLoading={isLoading}
                    streamingMessageId={streamingMessageId}
                />
            </MessageScroller>
            <div className={composerShellClassName}>
                {activeBeeGamePermissions.map(permission => (
                    permission.permission_tool_name === 'AskUserQuestion' ? <UserQuestionPanel
                        key={permission.gate_id}
                        input={permission.artifact?.input}
                        lang={lang}
                        busy={permissionState.gateId === permission.gate_id && permissionState.phase === 'submitting'}
                        error={permissionState.gateId === permission.gate_id && permissionState.phase === 'failed' ? permissionState.message : undefined}
                        allowDesignChange={permission.artifact?.designChangeAllowed === true}
                        onSubmit={onResolveToolPermission ? (answers, intent) => onResolveToolPermission({...toPermissionPayload(permission), ...(intent ? {intent} : {})}, 'allow', 'once', answers) : undefined}
                        onDismiss={onResolveToolPermission ? () => onResolveToolPermission(toPermissionPayload(permission), 'deny') : undefined}
                    /> : permission.permission_tool_name === 'McpElicitation' ? <McpElicitationPanel
                        key={permission.gate_id} input={permission.artifact?.input} language={lang}
                        busy={permissionState.gateId === permission.gate_id && permissionState.phase === 'submitting'}
                        error={permissionState.gateId === permission.gate_id && permissionState.phase === 'failed' ? permissionState.message : undefined}
                        onSubmit={onResolveToolPermission ? answers => onResolveToolPermission(toPermissionPayload(permission), 'allow', 'once', answers) : undefined}
                        onDismiss={onResolveToolPermission ? () => onResolveToolPermission(toPermissionPayload(permission), 'deny') : undefined}
                    /> : <BeUiPermissionPanel
                        key={permission.gate_id}
                        permission={permission}
                        text={text}
                        permissionState={permissionState}
                        onResolveToolPermission={onResolveToolPermission}
                    />
                ))}
                {queuedMessages.length > 0 ? (
                    <div className="max-h-40 space-y-1.5 overflow-y-auto overscroll-contain px-2 pb-2" data-testid="beegame-queued-messages">
                        {queuedMessages.map(message => (
                            <div key={message.id} className="flex min-w-0 items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--text-secondary)]">
                                <ListEnd className="h-4 w-4 shrink-0 opacity-65" aria-hidden="true" />
                                <span className={`min-w-0 flex-1 text-sm text-[var(--text-primary)] ${expandedQueuedId === message.id ? 'break-words' : 'truncate'}`} title={filterPathsForDisplay(message.text)}>{filterPathsForDisplay(message.text)}</span>
                                {message.attachmentCount ? <span className="flex shrink-0 items-center gap-1 text-xs" aria-label={`${message.attachmentCount} attachments`}><Paperclip className="h-3.5 w-3.5" />{message.attachmentCount}</span> : null}
                                <button type="button" disabled={Boolean(queueActionId) || message.state !== 'pending'}
                                    onClick={() => onSteerQueued?.(message.id)}
                                    className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
                                    aria-label="Steer queued message"><CornerDownRight className="h-4 w-4" />Steer</button>
                                <button type="button" disabled={Boolean(queueActionId) || message.state !== 'pending'}
                                    onClick={() => onDeleteQueued?.(message.id)}
                                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-40"
                                    aria-label="Delete queued message"><Trash2 className="h-4 w-4" /></button>
                                <button type="button" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors hover:bg-[var(--surface-hover)]"
                                    onClick={() => setExpandedQueuedId(current => current === message.id ? null : message.id)}
                                    aria-label="Expand queued message"><Ellipsis className="h-4 w-4" /></button>
                            </div>
                        ))}
                    </div>
                ) : null}
                {queueError ? <p role="alert" className="px-4 pb-2 text-xs text-[var(--destructive)]">{filterPathsForDisplay(queueError)}</p> : null}
                {(
                    <div className="min-w-0" data-testid="beegame-chat-composer">
                        {attachments.length > 0 ? (
                            <div
                                className="flex justify-start px-1 gap-3 overflow-x-auto pt-4 pb-2"
                                data-testid="beegame-chat-attachments"
                            >
                                {attachments.map((attachment, index) => (
                                    <div
                                        key={`${attachment.filename || attachment.type}-${index}`}
                                        className="chat-attachment-preview relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-3)] transition-[border-color,box-shadow,background-color] hover:border-[var(--ring)] hover:ring-1 hover:ring-[var(--ring)] focus-within:border-[var(--ring)] focus-within:ring-1 focus-within:ring-[var(--ring)]"
                                    >
                                        {attachment.type === 'image' ? (
                                            <img
                                                src={`data:${attachment.mediaType};base64,${attachment.data}`}
                                                alt={attachment.filename || `image-${index + 1}`}
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-[var(--text-secondary)]" title={attachment.filename}>
                                                <FileText className="h-5 w-5" />
                                                <span className="type-caption-2 w-full truncate text-center">{attachment.filename}</span>
                                            </div>
                                        )}
                                        <button
                                            type="button"
                                            aria-label="Remove attachment"
                                            disabled={isComposerDisabled}
                                            onClick={() => onRemoveAttachment?.(index)}
                                            className="chat-attachment-remove absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        <>
                                <input
                                    ref={attachmentInputRef}
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
                                <PromptInput
                                    compact
                                    minRows={1}
                                    textareaRef={textareaRef}
                                    value={chatInput}
                                    onValueChange={onChatInputChange}
                                    onSubmit={() => onSend()}
                                    loading={isLoading}
                                    allowSubmitWhileLoading
                                    stopDisabled={isStopping}
                                    onStop={() => void onStop?.()}
                                    submitLabel="Send message"
                                    stopLabel={isStopping ? 'Stopping task' : 'Stop task'}
                                    allowEmptySubmit={attachments.length > 0}
                                    disabled={isStopping || isComposerDisabled}
                                    readOnly={isComposerLocked}
                                    placeholder={effectiveComposerPlaceholder}
                                    aria-label={text.chatPlaceholder || 'Chat message'}
                                    data-testid="beegame-chat-input"
                                    onPaste={(event) => {
                                        const files = clipboardDataToAttachmentFiles(event.clipboardData);
                                        if (files.length === 0) return;
                                        event.preventDefault();
                                        void handleImageFiles(files);
                                    }}
                                    onCompositionStart={() => setIsComposing(true)}
                                    onCompositionEnd={() => setIsComposing(false)}
                                    textClassName="type-chat-body"
                                    className="border-[var(--border-strong)] bg-[var(--surface-2)] [&_textarea]:transition-opacity [&_textarea:read-only]:opacity-50"
                                    leadingAction={(
                                        <div className="flex items-center gap-1" data-testid="beegame-chat-toolbar">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                aria-label={attachFileLabel}
                                                title={attachFileLabel}
                                                disabled={isComposerDisabled || !onAddAttachments}
                                                onClick={() => attachmentInputRef.current?.click()}
                                                className="h-8 w-8 rounded-full border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                                data-testid="beegame-chat-attach-button"
                                            >
                                                <Plus className="h-4 w-4" aria-hidden="true" />
                                            </Button>
                                        </div>
                                    )}
                                />
                        </>
                    </div>
                )}
            </div>
        </div>
    );
});

ChatPanel.displayName = 'ChatPanel';
