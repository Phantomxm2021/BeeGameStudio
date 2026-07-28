import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { Language } from './AgentsConfig';
import { useBeeGameText, useCommonText } from '../../i18n/useBeeGameTranslations';
import { api, type BeeGameAssetManifestPayload, type ReviewBindingPayload } from '../../services/api';
import type { ChatAttachmentPayload } from '../../services/api';
import { isBeeGameProjectPackageArtifactId } from '../../services/beeGameAdapter';
import { artifactProcessor } from '../../utils/artifactProcessor';
import { deriveDocumentProgress, isBaselineDocumentPath } from '../../utils/documentProgress';
import { isBeeGamePermissionReview, isReviewAwaitingUserAction, isStructuredDocumentApprovalReview } from './Sidebar/SidebarUtils';
import type { WaitingApprovalState } from '../../utils/waitingApproval';
import type { ChatDisplayMessage, ProjectRuntimeDisplayModel, ReviewDisplayModel } from '../../viewModels/displayModels';
import { useChatStore } from '../../store/chatStore';
import { normalizeChatHistory } from '../../utils/chatHistory';

// Modular Panels
import { ChatPanel } from './Sidebar/ChatPanel';
import { ArtifactsPanel } from './Sidebar/ArtifactsPanel';
import { AssetsPanel } from './Sidebar/AssetsPanel';
import { ArtifactPreviewModal } from './Sidebar/ArtifactPreviewModal';

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
    ) => void;
    isLoading: boolean;
    onStopTask?: () => void | Promise<void>;
    onWorkflowAction?: (action: 'resume' | 'retry') => Promise<void> | void;
    isStopping?: boolean;
    isRuntimeBusy?: boolean;
    onApprovePlan?: (
        review: ReviewBindingPayload & { gate_id: string },
        feedback?: string,
        action?: 'approve' | 'revise' | 'reject'
    ) => Promise<void>;
    approvalState?: {
        gateId: string | null;
        action: 'approve' | 'revise' | 'reject' | null;
        phase: 'idle' | 'submitting' | 'awaiting_runtime' | 'failed';
        message: string;
    };
    pendingReviews?: ReviewDisplayModel[];
    projectStatus?: ProjectRuntimeDisplayModel | null;
    onUploadManifestCsv?: (gateId: string, csvContent: string, autoApprove?: boolean) => Promise<void>;
    onApproveManifest?: (review: ReviewBindingPayload & { gate_id: string }, feedback?: string) => Promise<void>;
    waitingApproval: WaitingApprovalState;
    canSendMessage?: boolean;
    canApproveTool?: boolean;
    canUploadAssets?: boolean;
    canExportProject?: boolean;
    currentUserDisplayName?: string;
    currentUserEmail?: string;
    currentUserAvatarUrl?: string;
}

export function RightSidebar({
    projectId,
    lang,
    messages,
    onSendMessage,
    isLoading,
    onStopTask,
    onWorkflowAction,
    isStopping = false,
    isRuntimeBusy = false,
    onApprovePlan,
    approvalState = { gateId: null, action: null, phase: 'idle', message: '' },
    pendingReviews = [],
    projectStatus,
    onUploadManifestCsv,
    onApproveManifest,
    waitingApproval,
    canSendMessage = true,
    canApproveTool = true,
    canUploadAssets = true,
    canExportProject = true,
    currentUserDisplayName,
    currentUserEmail,
    currentUserAvatarUrl,
}: RightSidebarProps) {

    const [activeTab, setActiveTab] = useState<'chat' | 'artifacts' | 'assets'>('chat');
    const [chatInput, setChatInput] = useState('');
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [attachments, setAttachments] = useState<ChatAttachmentPayload[]>([]);
    const [artifacts, setArtifacts] = useState<any[]>([]);
    const [isArtifactsLoading, setIsArtifactsLoading] = useState(false);
    const [assetManifest, setAssetManifest] = useState<BeeGameAssetManifestPayload | null>(null);
    const [isAssetsLoading, setIsAssetsLoading] = useState(false);
    const [uploadingAssetRequirementId, setUploadingAssetRequirementId] = useState<string | null>(null);
    const [isComposing, setIsComposing] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [previewContent, setPreviewContent] = useState('');
    const [previewTitle, setPreviewTitle] = useState('');
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [hasOlderHistory, setHasOlderHistory] = useState(false);
    const [isLoadingOlderHistory, setIsLoadingOlderHistory] = useState(false);
    const loadHistory = useChatStore(state => state.loadHistory);
    
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const t = useCommonText(lang);
    const uiText = useBeeGameText(lang);

    useEffect(() => {
        setHasOlderHistory(false);
        setIsLoadingOlderHistory(false);
    }, [projectId]);

    useEffect(() => {
        if (messages.length === 0) return;
        const pagination = api.getChatHistoryPaginationState(projectId);
        if (pagination.initialized) setHasOlderHistory(pagination.hasMore);
    }, [messages, projectId]);

    const handleLoadOlderHistory = useCallback(async () => {
        if (isLoadingOlderHistory || !hasOlderHistory || messages.length === 0) return;
        const viewport = scrollContainerRef.current;
        const previousHeight = viewport?.scrollHeight ?? 0;
        const previousTop = viewport?.scrollTop ?? 0;
        setIsLoadingOlderHistory(true);
        try {
            const page = await api.getOlderChatHistory(projectId);
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
            setIsLoadingOlderHistory(false);
        }
    }, [hasOlderHistory, isLoadingOlderHistory, loadHistory, messages.length, projectId]);
    const isComposerLocked = isLoading || isRuntimeBusy;
    const canMutateAssets = canUploadAssets && !isRuntimeBusy;
    const documentProgress = useMemo(
        () => deriveDocumentProgress(messages, artifacts),
        [artifacts, messages],
    );
    const documentEventRevision = useMemo(
        () => messages
            .filter(message => isBaselineDocumentPath(message.artifactPath))
            .map(message => `${message.id}:${message.toolStatus || ''}:${message.timestamp}`)
            .join('|'),
        [messages],
    );

    useEffect(() => {
        setAssetManifest(null);
        setUploadingAssetRequirementId(null);
        setIsAssetsLoading(false);
    }, [projectId]);

    // Derived Data
    const structuredApprovalReview = useMemo(() =>
        pendingReviews.find((review: ReviewDisplayModel) => (
            isStructuredDocumentApprovalReview(review) &&
            isReviewAwaitingUserAction(review) &&
            Boolean(review?.gate_id) &&
            !review?.history_only
        )),
    [pendingReviews]);
    const beeGamePermissionReview = useMemo(() =>
        pendingReviews.find((review: ReviewDisplayModel) => (
            isBeeGamePermissionReview(review) &&
            isReviewAwaitingUserAction(review) &&
            Boolean(review?.gate_id) &&
            !review?.history_only
        )),
    [pendingReviews]);

    // Handlers
    const handleSend = () => {
        if (!canSendMessage || (!chatInput.trim() && attachments.length === 0) || isComposerLocked || waitingApproval.isBlockingChat) return;
        onSendMessage(chatInput, attachments, editingMessageId || undefined);
        setChatInput('');
        setAttachments([]);
        setEditingMessageId(null);
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
        try {
            if (isBeeGameProjectPackageArtifactId(artifactId)) {
                const { blob, filename } = await api.downloadProjectPackage(projectId);
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
        try {
            setPreviewTitle(title);
            setIsPreviewLoading(true);
            setIsPreviewOpen(true);

            if (directContent) {
                const processed = artifactProcessor.stripMarkers(directContent);
                setPreviewContent(processed);
                setIsPreviewLoading(false);
                return;
            }

            const content = await api.getArtifactContent(artifactId);
            const processed = artifactProcessor.stripMarkers(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
            setPreviewContent(processed);
        } catch (error) {
            console.error('Artifact preview failed:', error);
            setPreviewContent(uiText.artifactPreviewFailed);
        } finally {
            setIsPreviewLoading(false);
        }
    };

    const handleUploadAsset = async (requirementId: string, file: File) => {
        if (!canMutateAssets) return;
        setUploadingAssetRequirementId(requirementId);
        try {
            const result = await api.uploadProjectAsset(projectId, requirementId, file);
            setAssetManifest(result.manifest);
        } finally {
            setUploadingAssetRequirementId(null);
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
    // runtime state; there is no second per-artifact review transport.
    useEffect(() => {
        if (activeTab === 'artifacts') {
            const fetchData = async () => {
                try {
                    setIsArtifactsLoading(artifacts.length === 0);
                    const fetchedArtifacts = (await api.getArtifacts(projectId)) as unknown as any[];
                    setArtifacts(fetchedArtifacts);
                    setIsArtifactsLoading(false);
                } catch (err) {
                    console.error('Failed to load artifacts/reviews:', err);
                    setIsArtifactsLoading(false);
                }
            };
            void fetchData();
        }
    }, [activeTab, projectId, documentEventRevision]);

    useEffect(() => {
        if (activeTab === 'assets') {
            const fetchAssets = async () => {
                try {
                    setIsAssetsLoading(current => current || !assetManifest);
                    setAssetManifest(await api.getProjectAssets(projectId));
                } catch (err) {
                    console.error('Failed to load project assets:', err);
                } finally {
                    setIsAssetsLoading(false);
                }
            };
            fetchAssets();
            const interval = setInterval(fetchAssets, 5000);
            return () => clearInterval(interval);
        }
    }, [activeTab, projectId]);

    const dockClassName = 'absolute right-4 top-24 bottom-4 w-[420px] z-40 pointer-events-auto';
    const panelClassName = 'flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80 shadow-[0_32px_80px_-40px_rgba(0,0,0,0.75)] backdrop-blur-2xl';
    const headerClassName = 'flex h-14 items-center justify-between border-b border-zinc-800 px-4';
    const tabButtonClassName = (isActive: boolean) => `type-button relative pb-3 transition-all ${isActive ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`;
    const tabLabel = (tab: 'chat' | 'artifacts' | 'assets') => {
        if (tab === 'chat') return uiText.collabFlow;
        if (tab === 'assets') return t.assets;
        return uiText.deliverables;
    };
    const sidebarTabs = ['chat', 'artifacts', 'assets'] as const;

    return (
        <>
            <div
                className={dockClassName}
            >
                <div className={panelClassName}>
                    
                    {/* Header Tabs */}
                    <div className={headerClassName}>
                        <div className="flex items-center gap-6">
                            {sidebarTabs.map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={tabButtonClassName(activeTab === tab)}
                            >
                                {tabLabel(tab)}
                                {tab === 'artifacts' ? (
                                        <span className="type-caption-2 ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-400">
                                            {documentProgress.filter(item => item.status === 'ready').length}/{documentProgress.length}
                                        </span>
                                    ) : null}
                                    {tab === 'assets' && assetManifest?.requirements.length ? (
                                        <span className="type-caption-2 ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-400">{assetManifest.requirements.length}</span>
                                    ) : null}
                                    {activeTab === tab && (
                                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-300" />
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Content Area */}
                    <div
                        className="relative min-h-0 min-w-0 flex-1 overflow-hidden pointer-events-auto"
                    >
                        {activeTab === 'chat' ? (
                            <ChatPanel 
                                messages={messages}
                                isLoading={isLoading}
                                onStop={onStopTask}
                                onWorkflowAction={onWorkflowAction}
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
                                onApprovePlan={canApproveTool ? onApprovePlan : undefined}
                approvalState={approvalState}
                actionReview={beeGamePermissionReview || structuredApprovalReview}
                            pendingReviews={pendingReviews}
                            onUploadManifestCsv={onUploadManifestCsv}
                            onApproveManifest={onApproveManifest}
                                waitingApproval={waitingApproval}
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
                        ) : activeTab === 'artifacts' ? (
                            <ArtifactsPanel 
                                artifacts={artifacts}
                                isLoading={isArtifactsLoading}
                                onPreview={handlePreviewArtifact}
                                onDownload={handleDownloadArtifact}
                                canExportProject={canExportProject}
                                documentProgress={documentProgress}
                                lang={lang}
                            />
                        ) : (
                            <AssetsPanel
                                manifest={assetManifest}
                                isLoading={isAssetsLoading}
                                isUploadingRequirementId={uploadingAssetRequirementId}
                                onUpload={canMutateAssets ? handleUploadAsset : undefined}
                                acceptance={projectStatus?.acceptance}
                                lang={lang}
                            />
                        )}
                    </div>
                </div>
            </div>

            <ArtifactPreviewModal 
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                title={previewTitle}
                content={previewContent}
                isLoading={isPreviewLoading}
                lang={lang}
            />
        </>
    );
}
