import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Minus, MessageSquare } from 'lucide-react';
import { type Language, translations } from './AgentsConfig';
import { getBeeGameText } from './BeeGameI18n';
import { api, type BeeGameAssetManifestPayload, type BeeGameAssetSlotPayload, type ReviewBindingPayload } from '../../services/api';
import { isBeeGameProjectPackageArtifactId } from '../../services/beeGameAdapter';
import { artifactProcessor } from '../../utils/artifactProcessor';
import { isBeeGamePermissionReview, isReviewAwaitingUserAction, isStructuredDocumentApprovalReview } from './Sidebar/SidebarUtils';
import type { WaitingApprovalState } from '../../utils/waitingApproval';
import type { ProductReadinessView } from '../../types/message';
import type { ChatDisplayMessage, ProjectRuntimeDisplayModel, ReviewDisplayModel } from '../../viewModels/displayModels';

// Modular Panels
import { ChatPanel } from './Sidebar/ChatPanel';
import { ArtifactsPanel } from './Sidebar/ArtifactsPanel';
import { AssetsPanel } from './Sidebar/AssetsPanel';
import { ArtifactPreviewModal } from './Sidebar/ArtifactPreviewModal';

interface RightSidebarProps {
    projectId: string;
    lang: Language;
    messages: ChatDisplayMessage[];
    progress: number;
    onSendMessage: (msg: string) => void;
    isLoading: boolean;
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
    runtimeReadiness?: ProductReadinessView | null;
    onUploadManifestCsv?: (gateId: string, csvContent: string, autoApprove?: boolean) => Promise<void>;
    onApproveManifest?: (review: ReviewBindingPayload & { gate_id: string }, feedback?: string) => Promise<void>;
    waitingApproval: WaitingApprovalState;
    canSendMessage?: boolean;
    canApproveTool?: boolean;
    canUploadAssets?: boolean;
    canIntegrateAssets?: boolean;
    variant?: 'legacy' | 'beegame';
}

export function RightSidebar({
    projectId,
    lang,
    messages,
    onSendMessage,
    isLoading,
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
    variant = 'legacy',
}: RightSidebarProps) {

    const [activeTab, setActiveTab] = useState<'chat' | 'artifacts' | 'assets'>('chat');
    const [isChatMinimized, setIsChatMinimized] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [reviewStatuses, setReviewStatuses] = useState<Record<string, any>>({});
    const [artifacts, setArtifacts] = useState<any[]>([]);
    const [isArtifactsLoading, setIsArtifactsLoading] = useState(false);
    const [assetManifest, setAssetManifest] = useState<BeeGameAssetManifestPayload | null>(null);
    const [isAssetsLoading, setIsAssetsLoading] = useState(false);
    const [uploadingAssetSlotId, setUploadingAssetSlotId] = useState<string | null>(null);
    const [assetIntegrationMessages, setAssetIntegrationMessages] = useState<Record<string, string>>({});
    const [isComposing, setIsComposing] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [previewContent, setPreviewContent] = useState('');
    const [previewTitle, setPreviewTitle] = useState('');
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const lastMessageCountRef = useRef(messages.length);

    const t = translations[lang];
    const uiText = getBeeGameText(lang);
    const springTransition = { type: "spring" as const, stiffness: 260, damping: 26 };
    const isComposerLocked = isLoading || isRuntimeBusy;

    // Derived Data
    const structuredDocumentReview = useMemo(() =>
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
        if (!canSendMessage || !chatInput.trim() || isComposerLocked || waitingApproval.isBlockingChat) return;
        onSendMessage(chatInput);
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
        if (!canUploadAssets) return;
        setUploadingAssetSlotId(slotId);
        try {
            const result = await api.uploadProjectAsset(projectId, slotId, file);
            setAssetManifest(result.manifest);
            setAssetIntegrationMessages(current => ({
                ...current,
                [slotId]: result.message,
            }));
        } finally {
            setUploadingAssetSlotId(null);
        }
    };

    const handleRequestAssetIntegration = (slot: BeeGameAssetSlotPayload) => {
        if (!canSendMessage || !canIntegrateAssets) return;
        const fallbackMessage = buildAssetIntegrationMessage(slot, lang);
        onSendMessage(assetIntegrationMessages[slot.id] || fallbackMessage);
    };

    const handleRequestAllAssetIntegration = (slots: BeeGameAssetSlotPayload[]) => {
        if (!canSendMessage || !canIntegrateAssets) return;
        onSendMessage(buildAllAssetIntegrationMessage(slots, assetIntegrationMessages, lang));
    };

    // Auto-resize search input
    useEffect(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            const scrollHeight = textarea.scrollHeight;
            textarea.style.height = Math.min(Math.max(scrollHeight, 52), 160) + 'px';
        }
    }, [chatInput]);

    // Auto-scroll to bottom logic
    useEffect(() => {
        if (activeTab === 'chat' && scrollContainerRef.current) {
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
    }, [messages, activeTab]);

    // Load artifacts and review statuses
    useEffect(() => {
        if (activeTab === 'artifacts') {
            const fetchData = async () => {
                try {
                    setIsArtifactsLoading(artifacts.length === 0);
                    const fetchedArtifacts = (await api.getArtifacts(projectId)) as unknown as any[];
                    setArtifacts(fetchedArtifacts);
                    setIsArtifactsLoading(false);

                    const pendingArtifacts = fetchedArtifacts.filter(a => a.status === 'active');
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
            fetchData();
            const interval = setInterval(fetchData, 5000);
            return () => clearInterval(interval);
        }
    }, [activeTab, projectId, artifacts.length]);

    useEffect(() => {
        if (activeTab === 'assets') {
            const fetchAssets = async () => {
                try {
                    setIsAssetsLoading(current => current || !assetManifest);
                    setAssetManifest(await api.getProjectAssets(projectId));
                } catch (err) {
                    console.error('Failed to load project assets:', err);
                    setAssetManifest({ version: 1, slots: [] });
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
        ? `relative pb-3 text-sm font-bold transition-all ${isActive ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`
        : `text-xs font-black uppercase tracking-[0.2em] transition-all relative pb-2 ${isActive
            ? 'text-zinc-900 dark:text-zinc-100'
            : 'text-zinc-300 dark:text-zinc-600 hover:text-zinc-500'
        }`;
    const tabLabel = (tab: 'chat' | 'artifacts' | 'assets') => {
        if (variant !== 'beegame') return tab === 'chat' ? t.chat : t.artifacts;
        if (tab === 'chat') return uiText.collabFlow;
        if (tab === 'assets') return lang === 'zh' || lang === 'zh-TW' ? '资源' : 'Assets';
        return uiText.deliverables;
    };
    const sidebarTabs = variant === 'beegame'
        ? (['chat', 'artifacts', 'assets'] as const)
        : (['chat', 'artifacts'] as const);

    return (
        <>
            <motion.div
                animate={{
                    y: isChatMinimized ? 840 : 0,
                    opacity: isChatMinimized ? 0 : 1,
                    pointerEvents: isChatMinimized ? 'none' : 'auto'
                }}
                transition={springTransition}
                className={dockClassName}
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
                                        <span className="ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{artifacts.length}</span>
                                    ) : null}
                                    {variant === 'beegame' && tab === 'assets' && assetManifest?.slots.length ? (
                                        <span className="ml-2 rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{assetManifest.slots.length}</span>
                                    ) : null}
                                    {activeTab === tab && (
                                        <motion.div layoutId="tabUnderline" className={variant === 'beegame' ? 'absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500' : 'absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900 dark:bg-zinc-100'} />
                                    )}
                                </button>
                            ))}
                        </div>
	                        {variant !== 'beegame' ? (
	                            <button
	                                type="button"
	                                aria-label="最小化聊天"
	                                onClick={() => setIsChatMinimized(true)}
	                                className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full transition-colors text-zinc-900 dark:text-zinc-100"
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
                                isComposerLocked={isComposerLocked}
                                chatInput={chatInput}
                                onChatInputChange={setChatInput}
                                onSend={handleSend}
                                onSendMessage={onSendMessage}
                                onPreviewArtifact={handlePreviewArtifact}
                                textareaRef={textareaRef}
                                scrollContainerRef={scrollContainerRef}
                                isComposing={isComposing}
                                setIsComposing={setIsComposing}
                                onApprovePlan={canApproveTool ? onApprovePlan : undefined}
                approvalState={approvalState}
                gddReview={beeGamePermissionReview || structuredDocumentReview}
                            pendingReviews={pendingReviews}
                            onUploadManifestCsv={onUploadManifestCsv}
                            onApproveManifest={onApproveManifest}
                                waitingApproval={waitingApproval}
                                projectStatus={projectStatus}
                                canSendMessage={canSendMessage}
                                variant={variant}
                                lang={lang}
                            />
                        ) : activeTab === 'artifacts' ? (
                            <ArtifactsPanel 
                                artifacts={artifacts}
                                isLoading={isArtifactsLoading}
                                reviewStatuses={reviewStatuses}
                                onPreview={handlePreviewArtifact}
                                onDownload={handleDownloadArtifact}
                                lang={lang}
                            />
                        ) : (
                            <AssetsPanel
                                manifest={assetManifest}
                                isLoading={isAssetsLoading}
                                isUploadingSlotId={uploadingAssetSlotId}
                                onUpload={canUploadAssets ? handleUploadAsset : undefined}
                                onRequestIntegration={canSendMessage && canIntegrateAssets ? handleRequestAssetIntegration : undefined}
                                onRequestAllIntegration={canSendMessage && canIntegrateAssets ? handleRequestAllAssetIntegration : undefined}
                                lang={lang}
                            />
                        )}
                    </div>
                </div>
            </motion.div>

	            <AnimatePresence>
	                {variant !== 'beegame' && isChatMinimized && (
                    <motion.button
                        initial={{ y: 40, opacity: 0, scale: 0.8 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 40, opacity: 0, scale: 0.8 }}
                        whileHover={{ 
                            scale: 1.05,
                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                        }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setIsChatMinimized(false)}
                        className="absolute bottom-12 right-12 w-20 h-20 bg-zinc-900/95 dark:bg-zinc-100/95 backdrop-blur-2xl text-white dark:text-zinc-900 rounded-[2.2rem] shadow-[0_20px_40px_-10px_rgba(0,0,0,0.4)] flex items-center justify-center z-50 transition-all group overflow-hidden"
                    >
                        {/* Dynamic Background Glow when streaming */}
                        {isLoading && (
                            <motion.div 
                                animate={{ 
                                    opacity: [0.3, 0.6, 0.3],
                                    scale: [1, 1.2, 1]
                                }}
                                transition={{ duration: 3, repeat: Infinity }}
                                className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 via-purple-500/20 to-pink-500/20 blur-xl"
                            />
                        )}

                        <div className="relative">
                            <MessageSquare className="w-7 h-7 transition-transform duration-500 group-hover:scale-110 group-active:scale-90" />
                            
                            {/* Activity Indicator Pulse */}
                            {isLoading && (
                                <motion.div 
                                    className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full border-2 border-white dark:border-zinc-100 shadow-[0_0_10px_rgba(59,130,246,0.8)]"
                                    animate={{ scale: [1, 1.4, 1] }}
                                    transition={{ duration: 2, repeat: Infinity }}
                                />
                            )}
                        </div>

                        {/* Subtle Border Light Leak */}
                        <div className="absolute inset-0 rounded-[2.2rem] border border-white/10 dark:border-black/5 pointer-events-none" />
                    </motion.button>
                )}
            </AnimatePresence>

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

function buildAllAssetIntegrationMessage(
    slots: BeeGameAssetSlotPayload[],
    uploadedMessages: Record<string, string>,
    lang: Language
): string {
    const directMessages = slots
        .map(slot => uploadedMessages[slot.id])
        .filter((message): message is string => Boolean(message));
    if (directMessages.length === slots.length) {
        return directMessages.join('\n\n');
    }

    const lines = slots.map(slot => {
        const files = slot.uploaded_files?.length
            ? slot.uploaded_files.join(', ')
            : slot.target?.path || '';
        if (lang === 'zh' || lang === 'zh-TW') {
            return `- ${slot.id}${slot.purpose ? `：${slot.purpose}` : ''}${files ? `；文件：${files}` : ''}`;
        }
        return `- ${slot.id}${slot.purpose ? `: ${slot.purpose}` : ''}${files ? `; files: ${files}` : ''}`;
    });

    if (lang === 'zh' || lang === 'zh-TW') {
        return [
            '请统一集成以下已上传资源。',
            ...lines,
            '请更新项目引用，运行适合当前项目的检查或预览，并在 assets/asset-manifest.json 中记录每个资源的真实集成状态。',
        ].join('\n');
    }
    return [
        'Please integrate the following uploaded assets together.',
        ...lines,
        'Update project references, run the relevant checks or preview for this project, and record each asset\'s real integration status in assets/asset-manifest.json.',
    ].join('\n');
}

function buildAssetIntegrationMessage(slot: BeeGameAssetSlotPayload, lang: Language): string {
    const files = slot.uploaded_files?.length
        ? slot.uploaded_files.join(', ')
        : slot.target?.path || '';
    if (lang === 'zh' || lang === 'zh-TW') {
        return [
            `请集成资源槽 "${slot.id}"。`,
            files ? `已上传文件：${files}。` : '',
            slot.purpose ? `用途：${slot.purpose}。` : '',
            slot.target?.integration_notes ? `集成说明：${slot.target.integration_notes}。` : '',
            '请更新项目引用，运行适合当前项目的检查或预览，并在 assets/asset-manifest.json 中记录真实集成状态。',
        ].filter(Boolean).join(' ');
    }
    return [
        `Please integrate asset slot "${slot.id}".`,
        files ? `Uploaded file: ${files}.` : '',
        slot.purpose ? `Purpose: ${slot.purpose}.` : '',
        slot.target?.integration_notes ? `Integration notes: ${slot.target.integration_notes}.` : '',
        'Update project references, run the relevant checks or preview for this project, and record the real integration status in assets/asset-manifest.json.',
    ].filter(Boolean).join(' ');
}
