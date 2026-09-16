import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { Language } from './AgentsConfig';
import { useBeeGameText } from '../../i18n/useBeeGameTranslations';
import { api, type BeeGameAssetManifestPayload } from '../../services/api';
import type { ChatAttachmentPayload } from '../../services/api';
import { isBeeGameProjectPackageArtifactId } from '../../services/beeGameAdapter';
import { artifactProcessor } from '../../utils/artifactProcessor';
import { deriveDocumentProgress, isBaselineDocumentPath } from '../../utils/documentProgress';
import { isBeeGamePermission } from './Sidebar/SidebarUtils';
import type { WaitingPermissionState } from '../../utils/waitingPermission';
import type { ChatDisplayMessage, ProjectRuntimeDisplayModel, PermissionDisplayModel } from '../../viewModels/displayModels';
import { useChatStore } from '../../store/chatStore';
import { normalizeChatHistory } from '../../utils/chatHistory';

// Modular Panels
import { ChatPanel } from './Sidebar/ChatPanel';
import { ArtifactsPanel } from './Sidebar/ArtifactsPanel';
import { AssetsPanel } from './Sidebar/AssetsPanel';
import { ArtifactPreviewModal } from './Sidebar/ArtifactPreviewModal';
import { buildArtifactViewModel, type ArtifactEditorKind } from './Sidebar/artifactViewModel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../beui/motion/tabs';
import { SceneEditorOverlay } from '../Workspace/SceneEditorOverlay';
import { UiEditorOverlay } from '../Workspace/UiEditorOverlay';
import { TodoPanel } from './Sidebar/TodoPanel';
import { deriveCurrentProjectTodos } from '../../utils/projectTodos';

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
    isStopping?: boolean;
    isRuntimeBusy?: boolean;
    onResolveToolPermission?: (
        permission: { gate_id: string },
        decision?: 'allow' | 'deny',
        scope?: 'once' | 'session'
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
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [attachments, setAttachments] = useState<ChatAttachmentPayload[]>([]);
    const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
    const [isArtifactsLoading, setIsArtifactsLoading] = useState(false);
    const [artifactsError, setArtifactsError] = useState(false);
    const [assetManifest, setAssetManifest] = useState<BeeGameAssetManifestPayload | null>(null);
    const [isAssetsLoading, setIsAssetsLoading] = useState(false);
    const [isUploadingProjectResource, setIsUploadingProjectResource] = useState(false);
    const [isComposing, setIsComposing] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [previewContent, setPreviewContent] = useState('');
    const [previewTitle, setPreviewTitle] = useState('');
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [isSceneEditorOpen, setIsSceneEditorOpen] = useState(false);
    const [isUiEditorOpen, setIsUiEditorOpen] = useState(false);
    const [hasOlderHistory, setHasOlderHistory] = useState(false);
    const [isLoadingOlderHistory, setIsLoadingOlderHistory] = useState(false);
    const submittedDraftRef = useRef<{ projectId: string; content: string; attachments: ChatAttachmentPayload[]; supersedesMessageId?: string } | null>(null);
    const sendInFlightRef = useRef(false);
    const sendRequestIdRef = useRef(0);
    const currentDraftRef = useRef<{ projectId: string; content: string; attachments: ChatAttachmentPayload[]; supersedesMessageId?: string }>({
        projectId,
        content: '',
        attachments: [],
    });
    const loadHistory = useChatStore(state => state.loadHistory);
    const streamingMessageId = useChatStore(state => state.streamingMessageId);
    
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const activeProjectRef = useRef(projectId);
    const historyRequestRef = useRef(0);
    const artifactRequestRef = useRef(0);
    const artifactContentRequestRef = useRef(0);
    const assetLoadRequestRef = useRef(0);
    const assetUploadRequestRef = useRef(0);

    const uiText = useBeeGameText(lang);

    useEffect(() => {
        activeProjectRef.current = projectId;
        historyRequestRef.current += 1;
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
        setAttachments([]);
        setEditingMessageId(null);
        setHasOlderHistory(false);
        setIsLoadingOlderHistory(false);
        setShowAssets(false);
    }, [projectId]);

    useEffect(() => {
        currentDraftRef.current = {
            projectId,
            content: chatInput,
            attachments,
            supersedesMessageId: editingMessageId || undefined,
        };
    }, [attachments, chatInput, editingMessageId, projectId]);

    useEffect(() => {
        if (messages.length === 0) return;
        const pagination = api.getChatHistoryPaginationState(projectId);
        if (pagination.initialized) {
            // Pagination is an external store projection keyed by the active project.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setHasOlderHistory(pagination.hasMore);
        }
    }, [messages, projectId]);

    const handleLoadOlderHistory = useCallback(async () => {
        if (isLoadingOlderHistory || !hasOlderHistory || messages.length === 0) return;
        const viewport = scrollContainerRef.current;
        const previousHeight = viewport?.scrollHeight ?? 0;
        const previousTop = viewport?.scrollTop ?? 0;
        const requestProjectId = projectId;
        const requestId = ++historyRequestRef.current;
        setIsLoadingOlderHistory(true);
        try {
            const page = await api.getOlderChatHistory(requestProjectId);
            if (activeProjectRef.current !== requestProjectId || historyRequestRef.current !== requestId) return;
            const olderMessages = normalizeChatHistory(page.messages);
            if (olderMessages.length > 0) loadHistory(olderMessages);
            setHasOlderHistory(page.hasMore);
            if (viewport && olderMessages.length > 0) {
                requestAnimationFrame(() => {
                    viewport.scrollTop = previousTop + Math.max(0, viewport.scrollHeight - previousHeight);
                });
            }
        } catch (error) {
            console.error('[RightSidebar] Failed to load older chat history:', error);
        } finally {
            if (activeProjectRef.current === requestProjectId && historyRequestRef.current === requestId) {
                setIsLoadingOlderHistory(false);
            }
        }
    }, [hasOlderHistory, isLoadingOlderHistory, loadHistory, messages.length, projectId]);
    const isComposerLocked = isLoading || isRuntimeBusy;
    const canMutateAssets = canUploadAssets && !isRuntimeBusy;
    const documentProgress = useMemo(
        () => deriveDocumentProgress(messages, artifacts, projectStatus?.workflow),
        [artifacts, messages, projectStatus?.workflow],
    );
    const artifactView = useMemo(
        () => buildArtifactViewModel(artifacts, documentProgress),
        [artifacts, documentProgress],
    );
    const currentTodos = useMemo(() => deriveCurrentProjectTodos(messages), [messages]);
    const documentEventRevision = useMemo(
        () => [
            ...messages
                .filter(message => isBaselineDocumentPath(message.artifactPath))
                .map(message => `${message.id}:${message.toolStatus || ''}:${message.timestamp}`),
            ...(projectStatus?.workflow?.tasks || [])
                .map(task => `${task.title || task.id}:${task.status || ''}`)
                .filter(entry => isBaselineDocumentPath(entry.split(':', 1)[0])),
            ...(projectStatus?.workflow?.foundationDocuments || [])
                .map(document => `${document.path}:${document.status}`),
        ].join('|'),
        [messages, projectStatus?.workflow?.tasks, projectStatus?.workflow?.foundationDocuments],
    );

    useEffect(() => {
        // Clear resource data at the project boundary before loading its replacement.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAssetManifest(null);
        setArtifacts([]);
        setArtifactsError(false);
        setIsUploadingProjectResource(false);
        setIsAssetsLoading(false);
    }, [projectId]);

    // Derived Data
    const beeGamePermissionReview = useMemo(() =>
        pendingPermissions.find((permission: PermissionDisplayModel) => isBeeGamePermission(permission) &&
            Boolean(permission?.gate_id)
        ),
    [pendingPermissions]);

    // Handlers
    const handleSend = async () => {
        if (sendInFlightRef.current || !canSendMessage || (!chatInput.trim() && attachments.length === 0) || isComposerLocked || waitingPermission.isBlockingChat) return;
        const content = chatInput;
        const requestProjectId = projectId;
        const requestAttachments = [...attachments];
        const requestSupersedesMessageId = editingMessageId || undefined;
        const submittedDraft = { projectId: requestProjectId, content, attachments: requestAttachments, supersedesMessageId: requestSupersedesMessageId };
        submittedDraftRef.current = submittedDraft;
        const requestId = ++sendRequestIdRef.current;
        sendInFlightRef.current = true;
        try {
            const accepted = await onSendMessage(content, requestAttachments, requestSupersedesMessageId);
            const currentDraft = currentDraftRef.current;
            const sameAttachments = currentDraft.attachments.length === submittedDraft.attachments.length
                && currentDraft.attachments.every((attachment, index) => attachment.data === submittedDraft.attachments[index]?.data && attachment.filename === submittedDraft.attachments[index]?.filename);
            const sameDraft = currentDraft.projectId === submittedDraft.projectId
                && currentDraft.content === submittedDraft.content
                && currentDraft.supersedesMessageId === submittedDraft.supersedesMessageId
                && sameAttachments;
            if (activeProjectRef.current !== requestProjectId || sendRequestIdRef.current !== requestId || submittedDraftRef.current !== submittedDraft || !sameDraft || !accepted) return;
            setChatInput('');
            setAttachments([]);
            setEditingMessageId(null);
            submittedDraftRef.current = null;
        } catch {
            // Keep the exact draft available for retry when the transport rejects.
        } finally {
            if (activeProjectRef.current === requestProjectId && sendRequestIdRef.current === requestId) sendInFlightRef.current = false;
        }
    };

    const handleEditMessage = (message: ChatDisplayMessage) => {
        if (isComposerLocked || !canSendMessage) return;
        setChatInput(message.content);
        setEditingMessageId(message.id);
        requestAnimationFrame(() => textareaRef.current?.focus());
    };

    const handleCancelEdit = () => {
        setEditingMessageId(null);
        setChatInput('');
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
            alert(uiText.artifactDownloadFailed);
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

    const handleOpenEditor = (kind: ArtifactEditorKind) => {
        if (kind === 'scene') {
            setIsSceneEditorOpen(true);
            return;
        }
        setIsUiEditorOpen(true);
    };

    const handleUploadAsset = async (file: File) => {
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
                    <TabsContent value={activeTab} className="relative min-h-0 min-w-0 flex-1 overflow-hidden pointer-events-auto">
                        {activeTab === 'chat' ? (
                            <ChatPanel 
                                messages={messages}
                                isLoading={isLoading}
                                streamingMessageId={streamingMessageId}
                                onStop={onStopTask}
                                isStopping={isStopping}
                                isComposerLocked={isComposerLocked}
                                chatInput={chatInput}
                                onChatInputChange={setChatInput}
                                onSend={handleSend}
                                onSendMessage={onSendMessage}
                                onEditMessage={!isLoading ? handleEditMessage : undefined}
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
                                projectStatus={projectStatus}
                                canSendMessage={canSendMessage}
                                lang={lang}
                                currentUserDisplayName={currentUserDisplayName}
                                currentUserEmail={currentUserEmail}
                                currentUserAvatarUrl={currentUserAvatarUrl}
                                hasOlderHistory={hasOlderHistory}
                                isLoadingOlderHistory={isLoadingOlderHistory}
                                onLoadOlderHistory={handleLoadOlderHistory}
                            />
                        ) : activeTab === 'todo' ? (
                            <TodoPanel items={currentTodos} />
                        ) : (
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
                                        artifacts={artifacts}
                                        isLoading={isArtifactsLoading}
                                        onPreview={handlePreviewArtifact}
                                        onDownload={handleDownloadArtifact}
                                        canExportProject={canExportProject}
                                        documentProgress={documentProgress}
                                        onOpenEditor={handleOpenEditor}
                                        error={artifactsError ? (uiText.artifactLoadFailed || 'Failed to load deliverables. Please try again.') : null}
                                        lang={lang}
                                        onOpenAssets={() => setShowAssets(true)}
                                    />
                                )}
                            </div>
                        )}
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
                    onClose={() => setIsSceneEditorOpen(false)}
                />
            ) : null}
            {isUiEditorOpen ? (
                <UiEditorOverlay
                    projectId={projectId}
                    onClose={() => setIsUiEditorOpen(false)}
                />
            ) : null}
        </>
    );
}
