import { useState, useRef, useEffect, useMemo } from 'react';
import { Minus, MessageSquare } from 'lucide-react';
import type { Language } from './AgentsConfig';
import { useBeeGameText, useCommonText } from '../../i18n/useBeeGameTranslations';
import { api, type BeeGameAssetManifestPayload, type BeeGameAssetSlotPayload, type BeeGameAutoResourceBindingPayload, type ReviewBindingPayload } from '../../services/api';
import type { ChatAttachmentPayload } from '../../services/api';
import { isBeeGameProjectPackageArtifactId } from '../../services/beeGameAdapter';
import { artifactProcessor } from '../../utils/artifactProcessor';
import { deriveDocumentProgress, isBaselineDocumentPath } from '../../utils/documentProgress';
import { isBeeGamePermissionReview, isReviewAwaitingUserAction, isStructuredDocumentApprovalReview } from './Sidebar/SidebarUtils';
import type { WaitingApprovalState } from '../../utils/waitingApproval';
import type { ChatDisplayMessage, ProjectRuntimeDisplayModel, ReviewDisplayModel } from '../../viewModels/displayModels';

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

function formatAssetLibrarySyncFeedback(result: BeeGameAutoResourceBindingPayload, lang: Language): { message: string; tone: 'success' | 'warning' | 'error' } {
    const copied = result.results.filter(item => item.status === 'copied').length;
    const failed = result.results.filter(item => item.status === 'failed').length;
    const repaired = result.repaired_slot_ids?.length ?? 0;
    const unmatched = result.unmatched_slot_ids.length;
    const isZh = lang === 'zh' || lang === 'zh-TW';
    if (failed) {
        return { tone: 'error', message: isZh ? `${failed} 个资源未能同步；请查看对应资源槽。` : `${failed} asset slot(s) could not be synchronized; check the affected slots.` };
    }
    if (copied || repaired) {
        const summary = isZh
            ? `已同步 ${copied} 个资源${repaired ? `，并修复 ${repaired} 个缺失的资源库文件` : ''}。`
            : `Synchronized ${copied} asset(s)${repaired ? ` and repaired ${repaired} missing library asset(s)` : ''}.`;
        return { tone: unmatched ? 'warning' : 'success', message: unmatched ? `${summary} ${isZh ? `${unmatched} 个槽位未找到兼容候选。` : `${unmatched} slot(s) have no compatible candidate.`}` : summary };
    }
    return {
        tone: unmatched ? 'warning' : 'success',
        message: isZh
            ? (unmatched ? `${unmatched} 个槽位未找到兼容候选。` : '没有需要同步的资源。')
            : (unmatched ? `${unmatched} slot(s) have no compatible candidate.` : 'No assets need synchronization.'),
    };
}

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
    canIntegrateAssets?: boolean;
    canExportProject?: boolean;
    variant?: 'legacy' | 'beegame';
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
    canIntegrateAssets = true,
    canExportProject = true,
    variant = 'legacy',
    currentUserDisplayName,
    currentUserEmail,
    currentUserAvatarUrl,
}: RightSidebarProps) {

    const [activeTab, setActiveTab] = useState<'chat' | 'artifacts' | 'assets'>('chat');
    const [isChatMinimized, setIsChatMinimized] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [attachments, setAttachments] = useState<ChatAttachmentPayload[]>([]);
    const [reviewStatuses, setReviewStatuses] = useState<Record<string, any>>({});
    const [artifacts, setArtifacts] = useState<any[]>([]);
    const [isArtifactsLoading, setIsArtifactsLoading] = useState(false);
    const [assetManifest, setAssetManifest] = useState<BeeGameAssetManifestPayload | null>(null);
    const [isAssetsLoading, setIsAssetsLoading] = useState(false);
    const [uploadingAssetSlotId, setUploadingAssetSlotId] = useState<string | null>(null);
    const [reintegratingAssetSlotId, setReintegratingAssetSlotId] = useState<string | null>(null);
    const [isAutoBindingResources, setIsAutoBindingResources] = useState(false);
    const [assetOperationFeedback, setAssetOperationFeedback] = useState<{ message: string; tone: 'success' | 'warning' | 'error' } | null>(null);
    const [isComposing, setIsComposing] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [previewContent, setPreviewContent] = useState('');
    const [previewTitle, setPreviewTitle] = useState('');
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const lastMessageCountRef = useRef(messages.length);

    const t = useCommonText(lang);
    const uiText = useBeeGameText(lang);
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
        setUploadingAssetSlotId(null);
        setIsAssetsLoading(false);
        setAssetOperationFeedback(null);
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

    const handleUploadAsset = async (slotId: string, file: File) => {
        if (!canMutateAssets) return;
        setUploadingAssetSlotId(slotId);
        try {
            const result = await api.uploadProjectAsset(projectId, slotId, file);
            setAssetManifest(result.manifest);
        } finally {
            setUploadingAssetSlotId(null);
        }
    };

    const handleRequestAssetIntegration = (slot: BeeGameAssetSlotPayload) => {
        if (!canSendMessage || !canIntegrateAssets || isRuntimeBusy) return;
        void api.requestProjectAction({
            project_id: projectId,
            kind: 'asset_integrate',
            slotIds: [slot.id],
        });
    };

    const handleReintegrateLibraryResource = async (slotId: string) => {
        if (!canMutateAssets) return;
        setReintegratingAssetSlotId(slotId);
        try {
            const result = await api.integrateProjectResource(projectId, slotId);
            setAssetManifest(result.manifest);
        } finally {
            setReintegratingAssetSlotId(null);
        }
    };

    const handleAutoBindLibraryResources = async () => {
        if (!canMutateAssets) return;
        setIsAutoBindingResources(true);
        try {
            const result = await api.autoBindProjectResources(projectId);
            setAssetManifest(result.manifest);
            setAssetOperationFeedback(formatAssetLibrarySyncFeedback(result, lang));
        } catch (error) {
            setAssetOperationFeedback({ message: error instanceof Error ? error.message : String(error), tone: 'error' });
        } finally {
            setIsAutoBindingResources(false);
        }
    };

    const handleUnbindLibraryResource = async (slotId: string) => {
        if (!canMutateAssets) return;
        const result = await api.unbindProjectResource(projectId, slotId);
        setAssetManifest(result.manifest);
    };
    const handleRemoveLibraryIntegration = async (slotId: string) => {
        if (!canMutateAssets) return;
        const result = await api.removeProjectResourceIntegration(projectId, slotId);
        setAssetManifest(result.manifest);
    };
    const handleResourceCandidates = async (slot: BeeGameAssetSlotPayload) => api.getProjectResourceCandidates(projectId, slot.id);
    const handleBindResourceCandidate = async (slot: BeeGameAssetSlotPayload, candidate: { packId: string; elementId: string }) => {
        if (!canMutateAssets) throw new Error('Project assets cannot be changed while the runtime is active');
        const result = await api.bindProjectResource(projectId, slot.id, slot.resource_requirement || {}, candidate);
        setAssetManifest(result.manifest);
    };


    const handleRequestAllAssetIntegration = (slots: BeeGameAssetSlotPayload[]) => {
        if (!canSendMessage || !canIntegrateAssets || isRuntimeBusy) return;
        void api.requestProjectAction({
            project_id: projectId,
            kind: 'asset_integrate',
            slotIds: slots.map(slot => slot.id),
        });
    };

    const handleRequestSelectionPreparation = (slots: BeeGameAssetSlotPayload[]) => {
        if (!canSendMessage || !canIntegrateAssets || isRuntimeBusy) return;
        void api.requestProjectAction({
            project_id: projectId,
            kind: 'asset_prepare_selection',
            slotIds: slots.map(slot => slot.id),
        });
    };

    // Auto-resize search input
    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            const minComposerHeight = variant === 'beegame' ? 56 : 52;
            textarea.style.height = 'auto';
            const scrollHeight = textarea.scrollHeight;
            textarea.style.height = Math.min(Math.max(scrollHeight, minComposerHeight), 160) + 'px';
        }
    }, [chatInput, variant]);

    // Auto-scroll to bottom logic
    useEffect(() => {
        if (variant !== 'beegame' && activeTab === 'chat' && scrollContainerRef.current) {
            const isNewMessage = messages.length > lastMessageCountRef.current;
            // Use smooth scroll only for new incoming messages, 
            // use instant 'auto' when switching tabs to avoid "scrolling down" visual artifact.
            const behavior = isNewMessage ? 'smooth' : 'auto';
            
            scrollContainerRef.current.scrollTo?.({
                top: scrollContainerRef.current.scrollHeight,
                behavior
            });
            
            lastMessageCountRef.current = messages.length;
        }
    }, [messages, activeTab, variant]);

    // Load artifacts and review statuses
    useEffect(() => {
        if (activeTab === 'artifacts') {
            const fetchData = async () => {
                try {
                    setIsArtifactsLoading(artifacts.length === 0);
                    const fetchedArtifacts = (await api.getArtifacts(projectId)) as unknown as any[];
                    setArtifacts(fetchedArtifacts);
                    setIsArtifactsLoading(false);

                    const pendingArtifacts = variant === 'beegame'
                        ? []
                        : fetchedArtifacts.filter(a => a.status === 'active');
                    const newStatuses: Record<string, any> = {};
                    for (const art of pendingArtifacts) {
                        const artifactId = String(art.artifact_id || art.id || '').trim();
                        if (!artifactId) continue;
                        try {
                            const review = (await api.getArtifactReviewStatus(artifactId)) as any;
                            const normalizedArtifactId = String(review?.artifact_id || artifactId).trim();
                            if (normalizedArtifactId) {
                                newStatuses[normalizedArtifactId] = review;
                            }
                        } catch (e) {
                            const status = typeof e === 'object' && e && 'status' in e ? (e as { status?: number }).status : undefined;
                            if (status === 404) {
                                console.warn(`Artifact review not found for ${artifactId}`);
                                continue;
                            }
                            console.error(`Failed to load artifact review for ${artifactId}:`, e);
                        }
                    }
                    setReviewStatuses(newStatuses);
                } catch (err) {
                    console.error('Failed to load artifacts/reviews:', err);
                    setIsArtifactsLoading(false);
                }
            };
            void fetchData();
        }
    }, [activeTab, projectId, variant, documentEventRevision]);

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

    const dockClassName = variant === 'beegame'
        ? 'absolute right-4 top-24 bottom-4 w-[420px] z-40 pointer-events-auto'
        : 'absolute right-12 top-28 bottom-12 w-[440px] z-40 pointer-events-auto';
    const panelClassName = variant === 'beegame'
        ? 'h-full flex flex-col bg-zinc-950/80 backdrop-blur-2xl border border-zinc-800 rounded-2xl shadow-[0_32px_80px_-40px_rgba(0,0,0,0.75)] overflow-hidden'
        : 'h-full flex flex-col bg-white/95 dark:bg-zinc-900/95 backdrop-blur-3xl border border-zinc-200 dark:border-zinc-800 rounded-[3rem] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.3)] overflow-hidden';
    const headerClassName = variant === 'beegame'
        ? 'flex h-14 items-center justify-between border-b border-zinc-800 px-4'
        : 'flex items-center justify-between px-8 pt-8 pb-4';
    const tabButtonClassName = (isActive: boolean) => variant === 'beegame'
        ? `type-button relative pb-3 transition-all ${isActive ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`
        : `type-caption-1 transition-all relative pb-2 ${isActive
            ? 'text-zinc-900 dark:text-zinc-100'
            : 'text-zinc-300 dark:text-zinc-600 hover:text-zinc-500'
        }`;
    const tabLabel = (tab: 'chat' | 'artifacts' | 'assets') => {
        if (variant !== 'beegame') return tab === 'chat' ? t.chat : t.artifacts;
        if (tab === 'chat') return uiText.collabFlow;
        if (tab === 'assets') return t.assets;
        return uiText.deliverables;
    };
    const sidebarTabs = variant === 'beegame'
        ? (['chat', 'artifacts', 'assets'] as const)
        : (['chat', 'artifacts'] as const);

    return (
        <>
            <div
                className={`${dockClassName} transition-[opacity,transform] duration-200 ${isChatMinimized ? 'translate-y-[840px] opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'}`}
            >
                <div className={panelClassName}>
                    
                    {/* Header Tabs */}
                    <div className={headerClassName}>
                        <div className={variant === 'beegame' ? 'flex items-center gap-6' : 'flex space-x-6'}>
                            {sidebarTabs.map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={tabButtonClassName(activeTab === tab)}
                            >
                                {tabLabel(tab)}
                                {variant === 'beegame' && tab === 'artifacts' ? (
                                        <span className="type-caption-2 ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-400">
                                            {documentProgress.filter(item => item.status === 'ready').length}/{documentProgress.length}
                                        </span>
                                    ) : null}
                                    {variant === 'beegame' && tab === 'assets' && assetManifest?.slots.length ? (
                                        <span className="type-caption-2 ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-400">{assetManifest.slots.length}</span>
                                    ) : null}
                                    {activeTab === tab && (
                                        <div className={variant === 'beegame' ? 'absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-300' : 'absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900 dark:bg-zinc-100'} />
                                    )}
                                </button>
                            ))}
                        </div>
	                        {variant !== 'beegame' ? (
	                            <button
	                                type="button"
	                                aria-label="最小化聊天"
	                                onClick={() => setIsChatMinimized(true)}
	                                className="glass-icon-button h-10 w-10 text-zinc-900 dark:text-zinc-100"
	                            >
	                                <Minus className="w-5 h-5" />
	                            </button>
	                        ) : null}
                    </div>

                    {/* Content Area */}
                    <div
                        className="relative flex-1 overflow-hidden pointer-events-auto"
                    >
                        {activeTab === 'chat' ? (
                            <ChatPanel 
                                messages={messages}
                                isLoading={isLoading}
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
                                onApprovePlan={canApproveTool ? onApprovePlan : undefined}
                approvalState={approvalState}
                actionReview={beeGamePermissionReview || structuredApprovalReview}
                            pendingReviews={pendingReviews}
                            onUploadManifestCsv={onUploadManifestCsv}
                            onApproveManifest={onApproveManifest}
                                waitingApproval={waitingApproval}
                                projectStatus={projectStatus}
                                canSendMessage={canSendMessage}
                                variant={variant}
                                lang={lang}
                                currentUserDisplayName={currentUserDisplayName}
                                currentUserEmail={currentUserEmail}
                                currentUserAvatarUrl={currentUserAvatarUrl}
                            />
                        ) : activeTab === 'artifacts' ? (
                            <ArtifactsPanel 
                                artifacts={artifacts}
                                isLoading={isArtifactsLoading}
                                reviewStatuses={reviewStatuses}
                                onPreview={handlePreviewArtifact}
                                onDownload={handleDownloadArtifact}
                                canExportProject={canExportProject}
                                documentProgress={variant === 'beegame' ? documentProgress : undefined}
                                lang={lang}
                            />
                        ) : (
                            <AssetsPanel
                                manifest={assetManifest}
                                isLoading={isAssetsLoading}
                                isUploadingSlotId={uploadingAssetSlotId}
                                isReintegratingSlotId={reintegratingAssetSlotId}
                                isAutoBinding={isAutoBindingResources}
                                autoBindFeedback={assetOperationFeedback}
                                onUpload={canMutateAssets ? handleUploadAsset : undefined}
                                onReintegrate={canMutateAssets ? handleReintegrateLibraryResource : undefined}
                                onRemoveIntegration={canMutateAssets ? handleRemoveLibraryIntegration : undefined}
                                onAutoBind={canMutateAssets ? handleAutoBindLibraryResources : undefined}
                                onUnbind={canMutateAssets ? handleUnbindLibraryResource : undefined}
                                onCandidates={canUploadAssets ? handleResourceCandidates : undefined}
                                onBindCandidate={canMutateAssets ? handleBindResourceCandidate : undefined}
                                onRequestIntegration={canSendMessage && canIntegrateAssets ? handleRequestAssetIntegration : undefined}
                                onRequestAllIntegration={canSendMessage && canIntegrateAssets ? handleRequestAllAssetIntegration : undefined}
                                onRequestSelectionPreparation={canSendMessage && canIntegrateAssets ? handleRequestSelectionPreparation : undefined}
                                lang={lang}
                            />
                        )}
                    </div>
                </div>
            </div>

            {variant !== 'beegame' && isChatMinimized && (
                    <button
                        onClick={() => setIsChatMinimized(false)}
                        className="glass-panel absolute bottom-12 right-12 z-50 flex h-20 w-20 items-center justify-center overflow-hidden rounded-[2.2rem] text-white transition-all hover:scale-105 active:scale-95 dark:text-zinc-100"
                    >
                        {/* Dynamic Background Glow when streaming */}
                        {isLoading && (
                            <div
                                className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 via-purple-500/20 to-pink-500/20 blur-xl animate-pulse"
                            />
                        )}

                        <div className="relative">
                            <MessageSquare className="w-7 h-7 transition-transform duration-500 group-hover:scale-110 group-active:scale-90" />
                            
                            {/* Activity Indicator Pulse */}
                            {isLoading && (
                                <div
	                                    className="absolute -top-1 -right-1 w-3 h-3 animate-ping rounded-full border-2 border-white bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.65)] dark:border-zinc-100"
                                />
                            )}
                        </div>

                        {/* Subtle Border Light Leak */}
                        <div className="absolute inset-0 rounded-[2.2rem] border border-white/10 dark:border-black/5 pointer-events-none" />
                    </button>
                )}

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
