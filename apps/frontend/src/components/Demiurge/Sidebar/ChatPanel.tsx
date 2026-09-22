import { memo, useRef } from 'react';
import { FileText, Plus, X } from 'lucide-react';
import { BeeGameCollaborationFeed } from './BeeGameCollaborationFeed';
import {
    MessageScroller,
} from '../../beui/registry/components/agents/message-scroller';
import type { ChatAttachmentPayload } from '../../../services/api';
import { CHAT_ATTACHMENT_ACCEPT, filesToChatAttachments, isSupportedChatFile } from '../../../services/chatAttachments';
import { formatPermissionSummary, isBeeGamePermission } from './SidebarUtils';
import type { WaitingPermissionState } from '../../../utils/waitingPermission';
import { type ChatDisplayMessage, type ProjectRuntimeDisplayModel, type PermissionDisplayModel } from '../../../viewModels/displayModels';
import type { Language } from '../AgentsConfig';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';
import { Button } from '../../beui/project-button';
import { ToolApproval, ToolApprovalCode } from '../../beui/registry/components/agents/tool-approval';
import { PromptInput } from '../../beui/registry/components/agents/prompt-input';
import { UserQuestionPanel } from './UserQuestionPanel';

interface ChatPanelProps {
    messages: ChatDisplayMessage[];
    isLoading: boolean;
    streamingMessageId?: string | null;
    onStop?: () => void | Promise<void>;
    isStopping?: boolean;
    chatInput: string;
    onChatInputChange: (val: string) => void;
    onSend: () => void;
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

    // Tool permission controls
    onResolveToolPermission?: (
        permission: { gate_id: string },
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

    return (
        <div data-testid="beegame-permission-panel" className="mb-3">
            <ToolApproval
                tool={toolName}
                title={command ? text.permissionBashTitle : text.permissionToolTitle}
                status={approvalStatus}
                description={`${text.permissionPanelDescription} ${text.permissionRiskGeneric}`}
                parameters={[{
                    id: command ? 'command' : 'target',
                    label: parameterLabel,
                    value: command ? <ToolApprovalCode code={target} language="bash" /> : target,
                }]}
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
    isLoading,
    streamingMessageId = null,
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
    const attachmentInputRef = useRef<HTMLInputElement>(null);
    const historyScrollIntentRef = useRef(false);
    const composerPlaceholder = text.chatPlaceholder || waitingPermission.placeholder;
    const attachFileLabel = text.attachFile || text.attachImage || 'Attach file';
    const workflowIsTerminal = ['completed', 'failed', 'cancelled', 'stale']
        .includes(String(projectStatus?.workflow?.status || ''));
    const activeBeeGamePermissions = pendingPermissions.filter(isBeeGamePermission).concat(
            !workflowIsTerminal && actionPermission && isBeeGamePermission(actionPermission) && !pendingPermissions.some(permission => permission.gate_id === actionPermission.gate_id)
                ? [actionPermission]
                : [],
        );
    const activeBeeGamePermission = activeBeeGamePermissions[0];
    const isComposerDisabled = !canSendMessage || isComposerLocked || isLoading || waitingPermission.isBlockingChat || Boolean(activeBeeGamePermission);
    const handleImageFiles = async (files: File[]) => {
        if (isComposerDisabled || !files.length || !onAddAttachments) return;
        const nextAttachments = await filesToChatAttachments(files);
        if (nextAttachments.length > 0) onAddAttachments(nextAttachments);
    };

    const panelClassName = 'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden';
    const composerShellClassName = 'shrink-0 pb-3 pt-3';
    const effectiveComposerPlaceholder = activeBeeGamePermission
        ? text.permissionPendingPlaceholder
        : isComposerLocked || isLoading
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
                            className="type-caption-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-wait disabled:opacity-60"
                        >
                            {isLoadingOlderHistory ? text.loadingEarlierMessages : text.loadEarlierMessages}
                        </button>
                    </div>
                ) : null}
                <BeeGameCollaborationFeed
                    messages={messages}
                    onPreviewArtifact={onPreviewArtifact}
                    lang={lang}
                    currentUserDisplayName={currentUserDisplayName}
                    currentUserEmail={currentUserEmail}
                    currentUserAvatarUrl={currentUserAvatarUrl}
                    onEditMessage={onEditMessage}
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
                {(
                    <div className="min-w-0" data-testid="beegame-chat-composer">
                        {attachments.length > 0 ? (
                            <div
                                className="flex gap-3 overflow-x-auto px-4 pt-4 pb-2"
                                data-testid="beegame-chat-attachments"
                            >
                                {attachments.map((attachment, index) => (
                                    <div
                                        key={`${attachment.filename || attachment.type}-${index}`}
                                        className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-3)]"
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
                                            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)]"
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
                                    textareaRef={textareaRef}
                                    value={chatInput}
                                    onValueChange={onChatInputChange}
                                    onSubmit={() => onSend()}
                                    loading={isLoading}
                                    onStop={() => void onStop?.()}
                                    submitLabel="Send message"
                                    stopLabel={isStopping ? 'Stopping task' : 'Stop task'}
                                    allowEmptySubmit={attachments.length > 0}
                                    disabled={isStopping || (!isLoading && isComposerDisabled)}
                                    readOnly={isComposerLocked || isLoading}
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
                                            {editingMessageId ? (
                                                <button
                                                    type="button"
                                                    aria-label="Cancel edit"
                                                    disabled={isComposerDisabled}
                                                    title="Cancel edit"
                                                    onClick={onCancelEdit}
                                                    className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                                                    data-testid="beegame-cancel-edit-button"
                                                >
                                                    <X className="h-4 w-4" aria-hidden="true" />
                                                </button>
                                            ) : null}
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
