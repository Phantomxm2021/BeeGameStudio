import { canAutomaticallyRetryModelFailure } from '../../utils/modelRequestFailure';
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import type { Language } from './AgentsConfig';
import { useBeeGameText } from '../../i18n/useBeeGameTranslations';
import { api, type BeeGameAssetManifestPayload } from '../../services/api';
import type { ChatAttachmentPayload } from '../../services/api';
import { beeGameAdapter, isBeeGameProjectPackageArtifactId, type BeeGameQueuedMessage } from '../../services/beeGameAdapter';
import { artifactProcessor } from '../../utils/artifactProcessor';
import { isBeeGamePermission } from './Sidebar/SidebarUtils';
import type { WaitingPermissionState } from '../../utils/waitingPermission';
import type { ChatDisplayMessage, ProjectRuntimeDisplayModel, PermissionDisplayModel } from '../../viewModels/displayModels';
import { useChatStore } from '../../store/chatStore';
import { normalizeChatHistory } from '../../utils/chatHistory';
import { useToastContext } from '../../contexts/ToastContext';

// Modular Panels
import { ChatPanel } from './Sidebar/ChatPanel';
import { ArtifactsPanel, type ArtifactEditorFile } from './Sidebar/ArtifactsPanel';
import { AssetsPanel } from './Sidebar/AssetsPanel';
import { ArtifactPreviewModal } from './Sidebar/ArtifactPreviewModal';
import { buildArtifactViewModel, isProjectDocumentPath, type ArtifactEditorKind } from './Sidebar/artifactViewModel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../beui/motion/tabs';
import { SceneEditorOverlay } from '../Workspace/SceneEditorOverlay';
import { UiEditorOverlay } from '../Workspace/UiEditorOverlay';
import { TodoPanel } from './Sidebar/TodoPanel';
import { deriveCurrentProjectTodos } from '../../utils/projectTodos';
import {
    closeProjectEditorRoute,
    getProjectEditorRoute,
    getProjectEditorFileRoute,
    openProjectEditorFileRoute,
    WORKSPACE_ROUTE_CHANGE_EVENT,
} from '../../navigation/workspaceRoute';

const dedupeAttachments = (attachments: ChatAttachmentPayload[]): ChatAttachmentPayload[] => {
    const seen = new Set<string>();
    const uniqueAttachments: ChatAttachmentPayload[] = [];
    for (const attachment of attachments) {
        const key = [attachment.mediaType, attachment.data].join('\u0000');
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueAttachments.push(attachment);
    }
    return uniqueAttachments;
};

interface RightSidebarProps {
    projectId: string;
    lang: Language;
    messages: ChatDisplayMessage[];
    progress: number;
    onSendMessage: (
        msg: string,
        attachments?: ChatAttachmentPayload[],
        supersedesMessageId?: string,
    ) => Promise<boolean>;
    isLoading: boolean;
    onStopTask?: () => void | Promise<void>;
    onContinueTask?: (failedTurnId?: string, automatic?: boolean) => void | Promise<void>;
    autoRetryTurnId?: string | null;
    onCancelRetry?: () => void;
    isStopping?: boolean;
    isRuntimeBusy?: boolean;
    onResolveToolPermission?: (
        permission: { gate_id: string; intent?: 'change' },
        decision?: 'allow' | 'deny',
        scope?: 'once' | 'session',
        answers?: Record<string, string>
    ) => Promise<void>;
    permissionState?: {
        gateId: string | null;
        action: 'allow' | 'deny' | null;
        phase: 'idle' | 'submitting' | 'awaiting_runtime' | 'failed';
        message: string;
    };
    pendingPermissions?: PermissionDisplayModel[];
    projectStatus?: ProjectRuntimeDisplayModel | null;
    waitingPermission: WaitingPermissionState;
    canSendMessage?: boolean;
    canApproveTool?: boolean;
    canUploadAssets?: boolean;
    canExportProject?: boolean;
    currentUserDisplayName?: string;
    currentUserEmail?: string;
    currentUserAvatarUrl?: string;
}

type ArtifactRecord = {
    artifact_id?: string;
    id?: string;
    name?: string;
    path?: string;
    artifact_type?: string;
    package_download?: boolean;
};

export function RightSidebar({
    projectId,
    lang,
    messages,
    onSendMessage,
    isLoading,
    onStopTask,
    onContinueTask,
    autoRetryTurnId,
    onCancelRetry,
    isStopping = false,
    isRuntimeBusy = false,
    onResolveToolPermission,
    permissionState = { gateId: null, action: null, phase: 'idle', message: '' },
    pendingPermissions = [],
    projectStatus,
    waitingPermission,
    canSendMessage = true,
    canApproveTool = true,
    canUploadAssets = true,
    canExportProject = true,
    currentUserDisplayName,
    currentUserEmail,
    currentUserAvatarUrl,
}: RightSidebarProps) {

    const [activeTab, setActiveTab] = useState<'chat' | 'todo' | 'artifacts'>('chat');
    const [showAssets, setShowAssets] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [editDraft, setEditDraft] = useState('');
    const [isSubmittingMessage, setIsSubmittingMessage] = useState(false);
    const [queuedState, setQueuedState] = useState<{ projectId: string; messages: BeeGameQueuedMessage[] }>(
        { projectId, messages: [] },
    );
    const queuedMessages = queuedState.projectId === projectId ? queuedState.messages : [];
    const [queueActionId, setQueueActionId] = useState<string | null>(null);
    const [queueError, setQueueError] = useState<string | null>(null);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [attachments, setAttachments] = useState<ChatAttachmentPayload[]>([]);
    const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
    const [isArtifactsLoading, setIsArtifactsLoading] = useState(false);
    const [artifactsError, setArtifactsError] = useState(false);
    const [editorFiles, setEditorFiles] = useState<ArtifactEditorFile[]>([]);
    const [isEditorFilesLoading, setIsEditorFilesLoading] = useState(false);
    const [editorFilesError, setEditorFilesError] = useState<string | null>(null);
    const editorFilesAbortRef = useRef<AbortController | null>(null);
    const [assetManifest, setAssetManifest] = useState<BeeGameAssetManifestPayload | null>(null);
    const [isAssetsLoading, setIsAssetsLoading] = useState(false);
    const [isUploadingProjectResource, setIsUploadingProjectResource] = useState(false);
    const [isComposing, setIsComposing] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [previewContent, setPreviewContent] = useState('');
    const [previewTitle, setPreviewTitle] = useState('');
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [isSceneEditorOpen, setIsSceneEditorOpen] = useState(() => getProjectEditorRoute(projectId) === 'scene');
    const [isUiEditorOpen, setIsUiEditorOpen] = useState(() => getProjectEditorRoute(projectId) === 'ui');
    const [editorFilePath, setEditorFilePath] = useState(() => getProjectEditorFileRoute(projectId));
    const [hasOlderHistory, setHasOlderHistory] = useState(false);
    const [isLoadingOlderHistory, setIsLoadingOlderHistory] = useState(false);
    type DraftKind = 'composer' | 'edit';
    type ChatDraftSnapshot = { projectId: string; content: string; attachments: ChatAttachmentPayload[]; supersedesMessageId?: string; kind: DraftKind };
    const submittedDraftRef = useRef<ChatDraftSnapshot | null>(null);
    const sendInFlightRef = useRef(false);
    const sendRequestIdRef = useRef(0);
    const currentDraftRef = useRef<Record<DraftKind, ChatDraftSnapshot>>({
        composer: { projectId, content: '', attachments: [], kind: 'composer' },
        edit: { projectId, content: '', attachments: [], kind: 'edit' },
    });
    const loadHistory = useChatStore(state => state.loadHistory);
    const streamingMessageId = useChatStore(state => state.streamingMessageId);
    
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const messagesRef = useRef(messages);
    messagesRef.current = messages;
    const activeProjectRef = useRef(projectId);
    const queueRequestRef = useRef(0);
    const historyRequestRef = useRef(0);
    const stopHistoryAnchorTrackingRef = useRef<(() => void) | null>(null);
    const pendingHistoryScrollRestoreRef = useRef<{
        projectId: string;
        requestId: number;
        messagesBefore: ChatDisplayMessage[];
        previousHeight: number;
        previousTop: number;
        anchors: Array<{ anchorId: string; offsetTop: number }>;
    } | null>(null);
    const artifactRequestRef = useRef(0);
    const artifactContentRequestRef = useRef(0);
    const assetLoadRequestRef = useRef(0);
    const assetUploadRequestRef = useRef(0);

    const uiText = useBeeGameText(lang);
    const { showError } = useToastContext();

    useEffect(() => {
        const syncEditorRoute = () => {
            const editor = getProjectEditorRoute(projectId);
            setIsSceneEditorOpen(editor === 'scene');
            setIsUiEditorOpen(editor === 'ui');
            setEditorFilePath(getProjectEditorFileRoute(projectId));
        };
        syncEditorRoute();
        window.addEventListener('popstate', syncEditorRoute);
        window.addEventListener(WORKSPACE_ROUTE_CHANGE_EVENT, syncEditorRoute);
        return () => {
            window.removeEventListener('popstate', syncEditorRoute);
            window.removeEventListener(WORKSPACE_ROUTE_CHANGE_EVENT, syncEditorRoute);
        };
    }, [projectId]);

    useEffect(() => {
        activeProjectRef.current = projectId;
        queueRequestRef.current += 1;
        historyRequestRef.current += 1;
        stopHistoryAnchorTrackingRef.current?.();
        pendingHistoryScrollRestoreRef.current = null;
        artifactRequestRef.current += 1;
        artifactContentRequestRef.current += 1;
        assetLoadRequestRef.current += 1;
        assetUploadRequestRef.current += 1;
        sendRequestIdRef.current += 1;
        submittedDraftRef.current = null;
        sendInFlightRef.current = false;
        // Project changes reset local composer state before the next render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setChatInput('');
        setEditDraft('');
        setIsSubmittingMessage(false);
        setAttachments([]);
        setEditingMessageId(null);
        setHasOlderHistory(false);
        setIsLoadingOlderHistory(false);
        setShowAssets(false);
        setQueuedState({ projectId, messages: [] });
        setQueueActionId(null);
        setQueueError(null);
    }, [projectId]);

    useEffect(() => {
        currentDraftRef.current = {
            composer: { projectId, content: chatInput, attachments, kind: 'composer' },
            edit: { projectId, content: editDraft, attachments: [], supersedesMessageId: editingMessageId || undefined, kind: 'edit' },
        };
    }, [attachments, chatInput, editDraft, editingMessageId, projectId]);

    useEffect(() => {
        if (messages.length === 0) return;
        const pagination = api.getChatHistoryPaginationState(projectId);
        if (pagination.initialized) {
            // Pagination is an external store projection keyed by the active project.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setHasOlderHistory(pagination.hasMore);
        }
    }, [messages, projectId]);

    useLayoutEffect(() => {
        const pending = pendingHistoryScrollRestoreRef.current;
        if (!pending || pending.projectId !== projectId || messages === pending.messagesBefore) return;

        const viewport = scrollContainerRef.current;
        if (viewport) {
            const restoreAnchor = () => {
                const viewportTop = viewport.getBoundingClientRect().top;
                const rendered = new Map(Array.from(viewport.querySelectorAll<HTMLElement>('[data-slot="message"][data-history-anchor-id]'))
                    .map(element => [element.dataset.historyAnchorId, element]));
                const surviving = pending.anchors
                    .map(anchor => ({ anchor, element: rendered.get(anchor.anchorId) }))
                    .find(candidate => candidate.element);
                if (surviving?.element) {
                    const currentOffset = surviving.element.getBoundingClientRect().top - viewportTop;
                    viewport.scrollTop += currentOffset - surviving.anchor.offsetTop;
                } else {
                    viewport.scrollTop = pending.previousTop + Math.max(0, viewport.scrollHeight - pending.previousHeight);
                }
            };
            stopHistoryAnchorTrackingRef.current?.();
            restoreAnchor();
            // Collapsed activity and media can settle after the first commit.
            // Keep the same visible row fixed while those heights change.
            if (typeof ResizeObserver !== 'undefined' && pending.anchors.length) {
                const observer = new ResizeObserver(restoreAnchor);
                const content = viewport.querySelector<HTMLElement>('[role="log"]');
                if (content) observer.observe(content);
                const cancelTracking = () => stopHistoryAnchorTrackingRef.current?.();
                viewport.addEventListener('wheel', cancelTracking, { once: true });
                viewport.addEventListener('touchstart', cancelTracking, { once: true });
                viewport.addEventListener('keydown', cancelTracking, { once: true });
                const timeout = window.setTimeout(cancelTracking, 1200);
                stopHistoryAnchorTrackingRef.current = () => {
                    window.clearTimeout(timeout);
                    observer.disconnect();
                    viewport.removeEventListener('wheel', cancelTracking);
                    viewport.removeEventListener('touchstart', cancelTracking);
                    viewport.removeEventListener('keydown', cancelTracking);
                    stopHistoryAnchorTrackingRef.current = null;
                };
            }
        }

        pendingHistoryScrollRestoreRef.current = null;
        if (activeProjectRef.current === pending.projectId && historyRequestRef.current === pending.requestId) {
            setIsLoadingOlderHistory(false);
        }
    }, [messages, projectId]);

    useEffect(() => () => stopHistoryAnchorTrackingRef.current?.(), []);

    const handleLoadOlderHistory = useCallback(async () => {
        if (isLoadingOlderHistory || !hasOlderHistory || messages.length === 0) return;
        const viewport = scrollContainerRef.current;
        const previousHeight = viewport?.scrollHeight ?? 0;
        const previousTop = viewport?.scrollTop ?? 0;
        const viewportTop = viewport?.getBoundingClientRect().top ?? 0;
        const anchors = viewport
            ? Array.from(viewport.querySelectorAll<HTMLElement>('[data-slot="message"][data-history-anchor-id]'))
                .map(element => ({ element, rect: element.getBoundingClientRect() }))
                .filter(({ rect }) => rect.bottom > viewportTop && rect.top < viewportTop + (viewport.clientHeight || viewport.getBoundingClientRect().height || Number.POSITIVE_INFINITY))
                .flatMap(({ element, rect }) => element.dataset.historyAnchorId
                    ? [{ anchorId: element.dataset.historyAnchorId, offsetTop: rect.top - viewportTop }] : [])
            : [];
        const requestProjectId = projectId;
        const requestId = ++historyRequestRef.current;
        setIsLoadingOlderHistory(true);
        try {
            const page = await api.getOlderChatHistory(requestProjectId);
            if (activeProjectRef.current !== requestProjectId || historyRequestRef.current !== requestId) return;
            const olderMessages = normalizeChatHistory(page.messages);
            if (olderMessages.length > 0) {
                pendingHistoryScrollRestoreRef.current = {
                    projectId: requestProjectId,
                    requestId,
                    messagesBefore: messagesRef.current,
                    previousHeight,
                    previousTop,
                    anchors,
                };
                loadHistory(olderMessages);
            }
            setHasOlderHistory(page.hasMore);
            if (olderMessages.length === 0) setIsLoadingOlderHistory(false);
        } catch (error) {
            console.error('[RightSidebar] Failed to load older chat history:', error);
            if (pendingHistoryScrollRestoreRef.current?.requestId === requestId) {
                pendingHistoryScrollRestoreRef.current = null;
            }
        } finally {
            if (pendingHistoryScrollRestoreRef.current?.requestId !== requestId && activeProjectRef.current === requestProjectId && historyRequestRef.current === requestId) {
                setIsLoadingOlderHistory(false);
            }
        }
    }, [hasOlderHistory, isLoadingOlderHistory, loadHistory, messages.length, projectId]);
    // Transcript messages are display history, not proof that a child process
    // is still alive. Runtime state carries the live child-task snapshot.
    const isAgentWorking = isLoading || isRuntimeBusy;
    const isComposerLocked = isSubmittingMessage;
    const refreshQueuedMessages = useCallback(async () => {
        const requestedProjectId = projectId;
        const requestId = ++queueRequestRef.current;
        try {
            const messages = await beeGameAdapter.listQueuedMessages(requestedProjectId);
            if (activeProjectRef.current === requestedProjectId && queueRequestRef.current === requestId)
                setQueuedState({ projectId: requestedProjectId, messages });
        } catch {
            // Chat remains usable if queue status is temporarily unavailable.
        }
    }, [projectId]);
    useEffect(() => {
        queueMicrotask(() => { void refreshQueuedMessages(); });
        if (!isAgentWorking && queuedMessages.length === 0) return;
        const timer = window.setInterval(() => { void refreshQueuedMessages(); }, 3000);
        return () => window.clearInterval(timer);
    }, [isAgentWorking, queuedMessages.length, refreshQueuedMessages]);
    const handleQueuedAction = async (messageId: string, action: 'steer' | 'delete') => {
        if (queueActionId) return;
        const requestedProjectId = projectId;
        setQueueActionId(messageId);
        setQueueError(null);
        try {
            if (action === 'steer') await beeGameAdapter.steerQueuedMessage(requestedProjectId, messageId);
            else await beeGameAdapter.deleteQueuedMessage(requestedProjectId, messageId);
            if (activeProjectRef.current === requestedProjectId) await refreshQueuedMessages();
        } catch (error) {
            if (activeProjectRef.current === requestedProjectId)
                setQueueError(error instanceof Error ? error.message : 'Queued message action failed');
        } finally {
            if (activeProjectRef.current === requestedProjectId) setQueueActionId(null);
        }
    };
    const canMutateAssets = canUploadAssets && !isRuntimeBusy;
    const artifactView = useMemo(
        () => buildArtifactViewModel(artifacts),
        [artifacts],
    );
    const currentTodos = useMemo(() => deriveCurrentProjectTodos(messages), [messages]);
    const documentEventRevision = useMemo(
        () => [
            ...messages
                .filter(message => isProjectDocumentPath(message.artifactPath))
                .map(message => `${message.id}:${message.toolStatus || ''}:${message.timestamp}`),
        ].join('|'),
        [messages],
    );

    useEffect(() => {
        // Clear resource data at the project boundary before loading its replacement.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAssetManifest(null);
        setArtifacts([]);
        setArtifactsError(false);
        setEditorFiles([]);
        setEditorFilesError(null);
        setIsEditorFilesLoading(false);
        setIsUploadingProjectResource(false);
        setIsAssetsLoading(false);
        return () => { editorFilesAbortRef.current?.abort(); };
    }, [projectId]);

    // Derived Data
    const beeGamePermissionReview = useMemo(() =>
        pendingPermissions.find((permission: PermissionDisplayModel) => isBeeGamePermission(permission) &&
            Boolean(permission?.gate_id)
        ),
    [pendingPermissions]);

    // Handlers
    const handleSend = async (isEdit = false) => {
        const kind: DraftKind = isEdit ? 'edit' : 'composer';
        const content = isEdit ? editDraft : chatInput;
        const requestAttachments = isEdit ? [] : [...attachments];
        const requestSupersedesMessageId = isEdit ? editingMessageId || undefined : undefined;
        if (sendInFlightRef.current || !canSendMessage || (!content.trim() && requestAttachments.length === 0) || isComposerLocked || waitingPermission.isBlockingChat) return;
        if (isEdit && !requestSupersedesMessageId) return;
        const requestProjectId = projectId;
        const submittedDraft: ChatDraftSnapshot = { projectId: requestProjectId, content, attachments: requestAttachments, supersedesMessageId: requestSupersedesMessageId, kind };
        submittedDraftRef.current = submittedDraft;
        const requestId = ++sendRequestIdRef.current;
        sendInFlightRef.current = true;
        setIsSubmittingMessage(true);
        try {
            const accepted = await onSendMessage(content, requestAttachments, requestSupersedesMessageId);
            if (accepted) void refreshQueuedMessages();
            const currentDraft = currentDraftRef.current[kind];
            const sameAttachments = currentDraft.attachments.length === submittedDraft.attachments.length
                && currentDraft.attachments.every((attachment, index) => attachment.data === submittedDraft.attachments[index]?.data && attachment.filename === submittedDraft.attachments[index]?.filename);
            const sameDraft = currentDraft.projectId === submittedDraft.projectId
                && currentDraft.content === submittedDraft.content
                && currentDraft.supersedesMessageId === submittedDraft.supersedesMessageId
                && sameAttachments;
            if (activeProjectRef.current !== requestProjectId || sendRequestIdRef.current !== requestId || submittedDraftRef.current !== submittedDraft || !sameDraft || !accepted) return;
            if (isEdit) {
                setEditDraft('');
                setEditingMessageId(null);
            } else {
                setChatInput('');
                setAttachments([]);
            }
            submittedDraftRef.current = null;
        } catch {
            // Keep the exact draft available for retry when the transport rejects.
        } finally {
            if (activeProjectRef.current === requestProjectId && sendRequestIdRef.current === requestId) {
                sendInFlightRef.current = false;
                setIsSubmittingMessage(false);
            }
        }
    };

    const handleCancelEdit = () => {
        setEditingMessageId(null);
        setEditDraft('');
    };

    const handleDownloadArtifact = async (artifactId: string, title: string) => {
        const requestProjectId = projectId;
        try {
            if (isBeeGameProjectPackageArtifactId(artifactId)) {
                const { blob, filename } = await api.downloadProjectPackage(requestProjectId);
                if (activeProjectRef.current !== requestProjectId) return;
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename || title || 'project.zip';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                return;
            }
            const rawContent = await api.getArtifactContent(artifactId);
            if (activeProjectRef.current !== requestProjectId) return;
            const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent, null, 2);
            const processedContent = artifactProcessor.stripMarkers(content);
            const blob = new Blob([processedContent], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${title || 'artifact'}.md`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Artifact download failed:', error);
            showError(uiText.artifactDownloadFailed);
        }
    };

    const handlePreviewArtifact = async (artifactId: string, title: string, directContent?: string) => {
        const requestProjectId = projectId;
        const requestId = ++artifactContentRequestRef.current;
        try {
            setPreviewTitle(title);
            setIsPreviewLoading(true);
            setIsPreviewOpen(true);

            if (directContent) {
                if (activeProjectRef.current !== requestProjectId || artifactContentRequestRef.current !== requestId) return;
                const processed = artifactProcessor.stripMarkers(directContent);
                setPreviewContent(processed);
                setIsPreviewLoading(false);
                return;
            }

            const content = await api.getArtifactContent(artifactId);
            if (activeProjectRef.current !== requestProjectId || artifactContentRequestRef.current !== requestId) return;
            const processed = artifactProcessor.stripMarkers(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
            setPreviewContent(processed);
        } catch (error) {
            if (activeProjectRef.current !== requestProjectId || artifactContentRequestRef.current !== requestId) return;
            console.error('Artifact preview failed:', error);
            setPreviewContent(uiText.artifactPreviewFailed);
        } finally {
            if (activeProjectRef.current === requestProjectId && artifactContentRequestRef.current === requestId) {
                setIsPreviewLoading(false);
            }
        }
    };

    const loadEditorFiles = async () => {
        editorFilesAbortRef.current?.abort();
        const controller = new AbortController();
        editorFilesAbortRef.current = controller;
        setIsEditorFilesLoading(true);
        setEditorFilesError(null);
        try {
            const snapshot = await beeGameAdapter.getProjectGameContentFileList(projectId, controller.signal);
            if (controller.signal.aborted || activeProjectRef.current !== projectId) return;
            const files: ArtifactEditorFile[] = [];
            for (const item of snapshot.documents ?? []) {
                const kind = item.kind;
                if (kind === 'scene' || kind === 'ui' || kind === 'scene-2d' || kind === 'scene-3d' || kind === 'ui-screen' || kind === 'ui-hud') {
                    files.push({ path: item.path, id: item.id, kind: kind === 'scene' || kind.startsWith('scene-') ? 'scene' : 'ui', error: item.error });
                }
            }
            setEditorFiles(files);
            if (snapshot.indexIssues?.length) setEditorFilesError([
                lang === 'zh' ? '内容索引有误：以下为安全发现的源文件，不代表内容包合格；修正索引后才能打开编辑。' : 'Invalid content index: safely discovered source files below are not an accepted package. Fix the index before opening the editor.',
                ...snapshot.indexIssues,
            ].join('\n'));
        } catch (error) {
            if (!controller.signal.aborted && activeProjectRef.current === projectId) {
                console.error('Failed to load Scene/UI files:', error);
                setEditorFiles([]);
                const message = lang === 'zh' ? '无法加载文件列表，请重试。' : 'Unable to load files. Please try again.';
                const reason = error instanceof Error ? error.message.trim() : '';
                setEditorFilesError(reason ? `${message} ${reason}` : message);
            }
        } finally {
            if (!controller.signal.aborted && activeProjectRef.current === projectId) setIsEditorFilesLoading(false);
        }
    };

    const handleOpenEditor = (kind: ArtifactEditorKind, path: string) => {
        openProjectEditorFileRoute(projectId, kind, path);
    };

    const handleUploadAsset = async (file: File | readonly File[]) => {
        if (!canMutateAssets) return;
    const requestProjectId = projectId;
    const requestId = ++assetUploadRequestRef.current;
    setIsUploadingProjectResource(true);
        try {
            const resourceId = `user-${crypto.randomUUID()}`;
            const result = await api.uploadProjectAsset(requestProjectId, resourceId, file);
            if (activeProjectRef.current !== requestProjectId || assetUploadRequestRef.current !== requestId) return;
            setAssetManifest(result.manifest);
        } catch (error) {
            if (activeProjectRef.current === requestProjectId && assetUploadRequestRef.current === requestId) {
                console.error('Failed to upload project asset:', error);
                showError(uiText.assets.uploadFailed);
            }
        } finally {
            if (activeProjectRef.current === requestProjectId && assetUploadRequestRef.current === requestId) {
                setIsUploadingProjectResource(false);
            }
        }
    };

    // Auto-resize search input
    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            const minComposerHeight = 56;
            textarea.style.height = 'auto';
            const scrollHeight = textarea.scrollHeight;
            textarea.style.height = Math.min(Math.max(scrollHeight, minComposerHeight), 160) + 'px';
        }
    }, [chatInput]);

    // Load project artifacts. Native Reviewer evidence is part of project
    // runtime state; there is no second per-artifact permission transport.
    useEffect(() => {
        if (activeTab === 'artifacts') {
            let cancelled = false;
            const fetchData = async () => {
                const requestProjectId = projectId;
                const requestId = ++artifactRequestRef.current;
                try {
                    setIsArtifactsLoading(artifacts.length === 0);
                    setArtifactsError(false);
                    const fetchedArtifacts = await api.getArtifacts(requestProjectId) as ArtifactRecord[];
                    if (cancelled || activeProjectRef.current !== requestProjectId || artifactRequestRef.current !== requestId) return;
                    setArtifacts(fetchedArtifacts);
                } catch (err) {
                    if (cancelled || activeProjectRef.current !== requestProjectId || artifactRequestRef.current !== requestId) return;
                    console.error('Failed to load artifacts/permissions:', err);
                    setArtifactsError(true);
                } finally {
                    if (!cancelled && activeProjectRef.current === requestProjectId && artifactRequestRef.current === requestId) {
                        setIsArtifactsLoading(false);
                    }
                }
            };
            void fetchData();
            return () => {
                cancelled = true;
            };
        }
        return undefined;
    // artifacts.length is read only to choose the initial loading affordance;
    // adding it here would restart the request after every response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, projectId, documentEventRevision]);

    useEffect(() => {
        if (activeTab === 'artifacts' && showAssets) {
            let refreshTimer: number | undefined;
            let cancelled = false;
            const fetchAssets = async () => {
                const requestProjectId = projectId;
                const requestId = ++assetLoadRequestRef.current;
                try {
                    setIsAssetsLoading(current => current || !assetManifest);
                    const nextManifest = await api.getProjectAssets(requestProjectId);
                    if (cancelled || activeProjectRef.current !== requestProjectId || assetLoadRequestRef.current !== requestId) return;
                    setAssetManifest(nextManifest);
                } catch (err) {
                    if (cancelled || activeProjectRef.current !== requestProjectId || assetLoadRequestRef.current !== requestId) return;
                    if (
                        !(err instanceof Error) ||
                        (err as Error & { code?: string }).code !== 'invalid_asset_manifest'
                    ) {
                        console.error('Failed to load project assets:', err);
                    } else {
                        setAssetManifest(null);
                        return;
                    }
                } finally {
                    if (activeProjectRef.current === requestProjectId && assetLoadRequestRef.current === requestId) {
                        setIsAssetsLoading(false);
                    }
                }
                if (!cancelled && activeProjectRef.current === requestProjectId && assetLoadRequestRef.current === requestId) {
                    refreshTimer = window.setTimeout(() => void fetchAssets(), 5000);
                }
            };
            void fetchAssets();
            return () => {
                cancelled = true;
                if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
            };
        }
    // assetManifest intentionally stays out of this dependency list: updating it
    // must not restart the polling lifecycle that produced it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, projectId, showAssets]);

    const dockClassName = 'workspace-collaboration-panel pointer-events-auto h-full min-h-0 min-w-0';
    const panelClassName = 'flex h-full min-h-0 min-w-0 flex-col overflow-hidden';
    const tabLabel = (tab: 'chat' | 'todo' | 'artifacts') => {
        if (tab === 'chat') return 'Chat';
        if (tab === 'todo') return 'Todo';
        return 'Artifacts';
    };
    const sidebarTabs = ['chat', 'todo', 'artifacts'] as const;
    const lastError = [...messages].reverse().find(message => message.type === 'error');
    const retryTurnId = lastError?.turnId || lastError?.turn_id;
    const latestTurnMessage = [...messages].reverse().find(message => message.turnId || message.turn_id);
    const latestTurnId = latestTurnMessage?.turnId || latestTurnMessage?.turn_id;
    // Recovery is tied to the stopped turn, not a list of provider error phrases.
    const canRetryTurn = Boolean(lastError && lastError.taskKind !== 'delivery_error' &&
        retryTurnId && retryTurnId === latestTurnId &&
        projectStatus?.project_id === projectId && projectStatus.phase === 'paused' &&
        projectStatus.blocked && !isAgentWorking && onContinueTask);
    const retry = canRetryTurn && lastError && retryTurnId ? {
        messageId: lastError.id,
        autoRetry: autoRetryTurnId === retryTurnId && canAutomaticallyRetryModelFailure(lastError.content),
        disabled: !canSendMessage || isStopping || isComposerLocked || waitingPermission.isBlockingChat,
        onRetry: (automatic: boolean) => onContinueTask?.(retryTurnId, automatic),
        onCancel: () => onCancelRetry?.(),
    } : undefined;

    return (
        <>
            <div
                className={dockClassName}
            >
                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className={panelClassName}>
                    <div className="flex h-11 items-center border-b border-[var(--border)] px-4">
                        <TabsList aria-label={uiText.collabFlow} className="h-full w-full gap-7 border-0">
                            {sidebarTabs.map(tab => (
                                <TabsTrigger
                                    key={tab}
                                    id={`beegame-sidebar-tab-${tab}`}
                                    value={tab}
                                    className="type-button relative h-full rounded-none px-0 pb-0 text-[var(--text-muted)] data-[active]:text-[var(--text-primary)] dark:data-[active]:text-[var(--ring)]"
                                >
                                    {tabLabel(tab)}
                                    {tab === 'artifacts' ? (
                                        <span className="type-caption-2 ml-2 rounded-full bg-[var(--surface-3)] px-2 py-0.5 text-[var(--text-muted)]">
                                            {artifactView.displayCount}
                                        </span>
                                    ) : null}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </div>

                    {/* Content Area */}
                    <TabsContent key={projectId} value="chat" keepMounted className="relative min-h-0 min-w-0 flex-1 overflow-hidden pointer-events-auto data-[hidden]:hidden">
                            <ChatPanel 
                                messages={messages}
                                retry={retry}
                                isLoading={isAgentWorking}
                                streamingMessageId={streamingMessageId}
                                onStop={onStopTask}
                                isStopping={isStopping}
                                isComposerLocked={isComposerLocked}
                                queuedMessages={queuedMessages}
                                queueActionId={queueActionId}
                                queueError={queueError}
                                onSteerQueued={id => { void handleQueuedAction(id, 'steer'); }}
                                onDeleteQueued={id => { void handleQueuedAction(id, 'delete'); }}
                                chatInput={chatInput}
                                onChatInputChange={setChatInput}
                                editDraft={editDraft}
                                onEditDraftChange={setEditDraft}
                                onSend={handleSend}
                                onSubmitEdit={() => handleSend(true)}
                                onEditMessage={undefined}
                                editingMessageId={editingMessageId}
                                onCancelEdit={handleCancelEdit}
                                attachments={attachments}
                                onAddAttachments={(nextAttachments) => {
                                    setAttachments(current => dedupeAttachments([...current, ...nextAttachments]));
                                }}
                                onRemoveAttachment={(index) => {
                                    setAttachments(current => current.filter((_, itemIndex) => itemIndex !== index));
                                }}
                                onPreviewArtifact={handlePreviewArtifact}
                                textareaRef={textareaRef}
                                scrollContainerRef={scrollContainerRef}
                                isComposing={isComposing}
                                setIsComposing={setIsComposing}
                                onResolveToolPermission={canApproveTool ? onResolveToolPermission : undefined}
                permissionState={permissionState}
                actionPermission={beeGamePermissionReview}
                            pendingPermissions={pendingPermissions}
                                waitingPermission={waitingPermission}
                                canSendMessage={canSendMessage}
                                lang={lang}
                                currentUserDisplayName={currentUserDisplayName}
                                currentUserEmail={currentUserEmail}
                                currentUserAvatarUrl={currentUserAvatarUrl}
                                hasOlderHistory={hasOlderHistory}
                                isLoadingOlderHistory={isLoadingOlderHistory}
                                onLoadOlderHistory={handleLoadOlderHistory}
                            />
                    </TabsContent>
                    <TabsContent value="todo" className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
                            <TodoPanel items={currentTodos} lang={lang} />
                    </TabsContent>
                    <TabsContent value="artifacts" className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
                            <div className="h-full min-h-0">
                                {showAssets ? (
                                    <AssetsPanel
                                        manifest={assetManifest}
                                        isLoading={isAssetsLoading}
                                        isUploadingResource={isUploadingProjectResource}
                                        onUpload={canMutateAssets ? handleUploadAsset : undefined}
                                        acceptance={projectStatus?.acceptance}
                                        lang={lang}
                                        onBack={() => setShowAssets(false)}
                                    />
                                ) : (
                                    <ArtifactsPanel
                                        key={projectId}
                                        artifacts={artifacts}
                                        isLoading={isArtifactsLoading}
                                        onPreview={handlePreviewArtifact}
                                        onDownload={handleDownloadArtifact}
                                        canExportProject={canExportProject}
                                        onOpenEditor={handleOpenEditor}
                                        editorFiles={editorFiles}
                                        isEditorFilesLoading={isEditorFilesLoading}
                                        editorFilesError={editorFilesError}
                                        onLoadEditorFiles={() => { void loadEditorFiles(); }}
                                        error={artifactsError ? (uiText.artifactLoadFailed || 'Failed to load deliverables. Please try again.') : null}
                                        lang={lang}
                                        onOpenAssets={() => setShowAssets(true)}
                                    />
                                )}
                            </div>
                    </TabsContent>
                </Tabs>
            </div>

            <ArtifactPreviewModal 
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                title={previewTitle}
                content={previewContent}
                isLoading={isPreviewLoading}
                lang={lang}
            />
            {isSceneEditorOpen ? (
                <SceneEditorOverlay
                    projectId={projectId}
                    initialDocumentPath={editorFilePath}
                    onClose={() => closeProjectEditorRoute(projectId)}
                />
            ) : null}
            {isUiEditorOpen ? (
                <UiEditorOverlay
                    projectId={projectId}
                    initialDocumentPath={editorFilePath}
                    onClose={() => closeProjectEditorRoute(projectId)}
                />
            ) : null}
        </>
    );
}
