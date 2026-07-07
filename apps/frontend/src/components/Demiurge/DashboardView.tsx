import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSystemStore } from '../../store/systemStore';
import { useProjectStore } from '../../store/projectStore';
import { useChatStore } from '../../store/chatStore';
import { useChat } from '../../hooks/useChat';
import { useToast } from '../../hooks/useToast';
import type { Language } from './AgentsConfig';

import { TopBar } from './TopBar';
import { SideMenu } from './SideMenu';
import { BeeGameLivePreviewPage } from './BeeGameLivePreviewPage';
import { RightSidebar } from './RightSidebar';
import type { ProjectTask } from '../../store/systemStore';
import type { BeeGameDeploymentPayload, BuildReportPayload, ChatImageAttachmentPayload, PendingUserReviewItem } from '../../services/api';
import { api } from '../../services/api';
import { buildApiUrl } from '../../services/apiClient';
import { deriveDashboardStatus, getWaitingApprovalState } from '../../utils/waitingApproval';
import { deriveGlobalWorkflowProgress } from '../../utils/workflowProgress';
import { toChatDisplayMessages, toProjectRuntimeDisplayModel, toReviewDisplayModels } from '../../viewModels/displayModels';
import { isBeeGameAdapterEnabled, type BeeGameThinkingMode } from '../../services/beeGameAdapter';
import { listModelConfigs, type ModelConfig } from '../../services/modelConfigApi';
import {
    getCreditSummary,
    type BeeGameCreditQuote,
    type BeeGameCreditSummary,
    type BeeGameCreditTaskType,
} from '../../services/creditsApi';
import { normalizeI18nLanguage } from '../../i18n/useBeeGameTranslations';

interface DashboardViewProps {
    projectId: string;
    projectName: string;
    lang: Language;
    onSetLang: (lang: Language) => void;
    onBack?: () => void;
    initialPrompt?: string;
}

const getWorkspaceFolderName = (rootPath?: string): string => {
    const normalized = String(rootPath || '').replaceAll('\\', '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
};

const fallbackPhaseLabel = (phaseName: string): string => {
    return phaseName
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
};

const getModelDisplayName = (config?: ModelConfig): string => {
    if (!config) return '';
    return config.models.balanced || config.models.strong || config.models.fast || config.name || '';
};

const deploymentToBuildReport = (deployment: BeeGameDeploymentPayload): BuildReportPayload => {
    const isSucceeded = deployment.status === 'succeeded' && Boolean(deployment.url);
    const failureDetail = deployment.buildLog || deployment.message || 'Deployment failed';
    return {
        status: isSucceeded ? 'passed' : 'failed',
        entrypoint: deployment.entrypoint || '',
        build_url: isSucceeded ? buildApiUrl(deployment.url) : '',
        agents: ['beegame-deployment'],
        checks: [{
            name: deployment.buildCommand || 'deploy',
            status: isSucceeded ? 'passed' : 'failed',
            detail: deployment.message || deployment.buildLog || '',
            path: deployment.outputDir,
        }],
        summary: deployment.message || '',
        failure_reason: isSucceeded ? undefined : failureDetail,
        created_at: deployment.deployedAt || deployment.updatedAt,
    };
};

export function DashboardView({ projectId, projectName, lang, onSetLang, onBack, initialPrompt }: DashboardViewProps) {
    const [initialGateStateReady, setInitialGateStateReady] = useState(false);
    const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);
    const [creditQuote, setCreditQuote] = useState<BeeGameCreditQuote | null>(null);
    const [creditSummary, setCreditSummary] = useState<BeeGameCreditSummary | null>(null);
    const [deploymentHistory, setDeploymentHistory] = useState<BeeGameDeploymentPayload[]>([]);
    const [deploymentBuildReport, setDeploymentBuildReport] = useState<BuildReportPayload | null>(null);
    const [isDeployingProject, setDeployingProject] = useState(false);
    const hasSentInitialPrompt = useRef(false);
    const creditQuoteResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isBeeGameMode = isBeeGameAdapterEnabled();
    const { i18n } = useTranslation('beegame');
    const translateBeeGame = useMemo(
        () => i18n.getFixedT(normalizeI18nLanguage(lang), 'beegame'),
        [i18n, lang],
    );

    // Zustand State
    const {
        tokenUsage,
        phaseInfo,
        loadPhases,
        loadTokenUsage,
        loadAgents,
        tasks,
        loadTasks,
        isSyncing,
        isDark,
        toggleTheme,
        hasPermission,
        currentUser,
    } = useSystemStore();
    const { projects, pendingReviews, projectStatus, runtimeReadiness, loadPendingReviews, loadProjectStatus, loadSystemReadiness } = useProjectStore();
    const { messages } = useChatStore();
    const { showSuccess, showError } = useToast();

    const confirmCreditQuote = useCallback((quote: BeeGameCreditQuote): Promise<boolean> => {
        setCreditQuote(quote);
        return new Promise(resolve => {
            creditQuoteResolverRef.current = resolve;
        });
    }, []);

    const resolveCreditQuote = useCallback((confirmed: boolean) => {
        const resolve = creditQuoteResolverRef.current;
        creditQuoteResolverRef.current = null;
        setCreditQuote(null);
        resolve?.(confirmed);
    }, []);

    const refreshCreditSummary = useCallback(async () => {
        if (!isBeeGameMode) return;
        try {
            setCreditSummary(await getCreditSummary(projectId));
        } catch (error) {
            console.error('Failed to load credit summary:', error);
        }
    }, [isBeeGameMode, projectId]);

    const refreshDeploymentHistory = useCallback(async () => {
        if (!isBeeGameMode) return;
        try {
            setDeploymentHistory(await api.listProjectDeployments(projectId));
        } catch (error) {
            console.error('Failed to load deployment history:', error);
        }
    }, [isBeeGameMode, projectId]);

    // Custom Hook for WebSocket & REST
    const {
        sendMessage, stopTask, continueTask, approvePlan,
        uploadManifestCsv, approveManifest, approvalState,
        isLoading, canContinue, wsState
    } = useChat({
        projectId,
        onError: (err) => console.error(err),
        showToastError: showError,
        showToastSuccess: showSuccess,
        confirmCreditQuote,
        // Trigger data refreshes on significant task events
        onTaskEvent: (type) => {
            if (
                type === 'usage' ||
                type === 'status_finished' ||
                type === 'status_failed' ||
                type === 'tool_start' ||
                type === 'tool_end' ||
                type === 'human_gate' ||
                type === 'error' ||
                type === 'plan_submitted' ||
                type === 'plan_approved' ||
                type === 'manifest_uploaded' ||
                type === 'manifest_auto_approved' ||
                type === 'manifest_approved' ||
                type === 'manifest_revise_requested'
            ) {
                // Debounce refresh to prevent storms during rapid event bursts
                if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
                refreshTimerRef.current = setTimeout(() => {
                    console.log(`[DashboardView] Debounced data refresh triggered by event: ${type}`);
                    loadTokenUsage(projectId).catch(console.error);
                    if (!isBeeGameMode) {
                        loadPhases(projectId);
                        loadTasks(projectId).catch(console.error);
                        loadAgents().catch(console.error);
                    }
                    loadPendingReviews(projectId).catch(console.error);
                    loadProjectStatus(projectId).catch(console.error);
                    refreshCreditSummary().catch(console.error);
                    refreshTimerRef.current = null;
                }, 2000);
            }
        }
    });

    useEffect(() => {
        hasSentInitialPrompt.current = false;
        setInitialGateStateReady(false);
        setCreditSummary(null);
        setDeploymentHistory([]);
        setDeploymentBuildReport(null);
        void refreshCreditSummary();
        void refreshDeploymentHistory();
    }, [projectId, refreshCreditSummary, refreshDeploymentHistory]);

    useEffect(() => {
        if (!isBeeGameMode) return;
        let cancelled = false;
        const loadModelConfigList = async () => {
            try {
                const configs = await listModelConfigs();
                if (!cancelled) setModelConfigs(configs);
            } catch (error) {
                console.error('Failed to load model configs:', error);
            }
        };
        loadModelConfigList();
        const interval = setInterval(loadModelConfigList, 10000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [isBeeGameMode]);

    // Local derived state mapped from backend
    const isOffline = wsState === 'failed' || wsState === 'disconnected';

    const canonicalTaskStatus = (task: Pick<ProjectTask, 'task_status' | 'lifecycle_status'>): string => {
        return String(task.lifecycle_status || task.task_status || '').toLowerCase();
    };

    const hasPendingPlanReview = pendingReviews.some((review: PendingUserReviewItem) => {
        const reviewType = String(review?.type || '');
        return reviewType !== 'ASSET_MANIFEST_REVIEW' && Boolean(review?.gate_id);
    });
    const displayMessages = useMemo(() => toChatDisplayMessages(messages), [messages]);
    const reviewDisplayModels = useMemo(() => toReviewDisplayModels(pendingReviews), [pendingReviews]);
    const projectRuntimeDisplay = useMemo(() => toProjectRuntimeDisplayModel(projectStatus), [projectStatus]);
    const activeProject = useMemo(
        () => projects.find((project) => project.id === projectId),
        [projectId, projects],
    );
    const savedRuntimeSnapshot = activeProject?.runtime_snapshot;
    const waitingApproval = useMemo(
        () => getWaitingApprovalState(projectRuntimeDisplay, reviewDisplayModels),
        [projectRuntimeDisplay, reviewDisplayModels],
    );
    const canSendMessage = hasPermission('agent.send_message');
    const canApproveTool = hasPermission('agent.approve_tool');
    const canManagePreview = hasPermission('preview.manage');
    const canManageDeployment = hasPermission('deployment.manage');
    const canUploadAssets = hasPermission('assets.upload');
    const canIntegrateAssets = hasPermission('assets.integrate');
    const canExportProject = hasPermission('project.export');

    // Auto-Send Initial Prompt
    useEffect(() => {
        if (initialPrompt && !hasSentInitialPrompt.current && projectId && initialGateStateReady && !waitingApproval.isBlockingChat) {
            hasSentInitialPrompt.current = true;
            // Fire the initial prompt as the first message
            sendMessage(initialPrompt).catch(console.error);
        }
    }, [initialPrompt, projectId, sendMessage, initialGateStateReady, waitingApproval.isBlockingChat]);

    const hasUnfinishedTasks = useMemo(() => {
        if (isBeeGameMode) return false;
        return tasks.some((t) => {
            const status = canonicalTaskStatus(t);
            return status !== 'released' && status !== 'failed' && status !== 'invalidated' && status !== 'expired';
        });
    }, [isBeeGameMode, tasks]);
    const isPipelineActive = useMemo(() => {
        const nextAction = String(projectStatus?.next_action || '').toLowerCase();
        const phase = String(projectStatus?.phase || '').toLowerCase();
        return ['pending', 'running', 'clarification_required'].includes(nextAction)
            || phase === 'running'
            || phase === 'waiting_approval';
    }, [projectStatus?.next_action, projectStatus?.phase]);

    // Derived state machine based on Requirements: 4.2
    const currentStatus = useMemo(() => {
        if (isBeeGameMode) {
            const phase = String(projectStatus?.phase || '').toLowerCase();
            if (isOffline) return 'offline';
            if (phase === 'running') return 'running';
            if (phase === 'waiting_approval' || phase === 'awaiting_user') return 'waiting_approval';
            if (phase === 'finished') return 'finished';
            if (phase === 'paused' || phase === 'failed') return 'paused';
        }
        return deriveDashboardStatus({
            isOffline,
            isLoading,
            canContinue,
            hasWaitingApproval: waitingApproval.isWaitingStatus || hasPendingPlanReview,
            messages: displayMessages,
        });
    }, [isBeeGameMode, projectStatus?.phase, isOffline, isLoading, canContinue, waitingApproval.isWaitingStatus, hasPendingPlanReview, displayMessages]);

    const refreshPreviewStatus = async () => {
        await loadProjectStatus(projectId);
    };

    const handleStartPreview = async () => {
        if (!canManagePreview) return;
        try {
            await api.startProjectPreview(projectId);
            await refreshPreviewStatus();
        } catch (error) {
            showError(error instanceof Error ? error.message : String(error));
        }
    };

    const handleRestartPreview = async () => {
        if (!canManagePreview) return;
        try {
            await api.restartProjectPreview(projectId);
            await refreshPreviewStatus();
        } catch (error) {
            showError(error instanceof Error ? error.message : String(error));
        }
    };

    const handleStopPreview = async () => {
        if (!canManagePreview) return;
        try {
            await api.stopProjectPreview(projectId);
            await refreshPreviewStatus();
        } catch (error) {
            showError(error instanceof Error ? error.message : String(error));
        }
    };

    const handleDeployProject = async () => {
        if (!canManageDeployment || isDeployingProject) return;
        setDeployingProject(true);
        try {
            const deployment = await api.deployProject(projectId);
            setDeploymentBuildReport(deploymentToBuildReport(deployment));
            setDeploymentHistory((current) => [
                deployment,
                ...current.filter((item) => item.id !== deployment.id),
            ]);
            await refreshDeploymentHistory();
            if (deployment.status !== 'succeeded' || !deployment.url) {
                throw new Error(deployment.message || 'Deployment failed');
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : String(error));
        } finally {
            setDeployingProject(false);
        }
    };

    const handleRollbackDeployment = async (deploymentId: string) => {
        if (!canManageDeployment || isDeployingProject) return;
        setDeployingProject(true);
        try {
            const deployment = await api.rollbackProjectDeployment(projectId, deploymentId);
            setDeploymentBuildReport(deploymentToBuildReport(deployment));
            setDeploymentHistory((current) => [
                deployment,
                ...current.filter((item) => item.id !== deployment.id),
            ]);
            await refreshDeploymentHistory();
        } catch (error) {
            showError(error instanceof Error ? error.message : String(error));
        } finally {
            setDeployingProject(false);
        }
    };

    // Poll live runtime state. BeeGame mode deliberately avoids legacy workflow phase/task telemetry.
    useEffect(() => {
        if (!projectId) return;

        const initialLoads: Array<Promise<unknown>> = [
            loadPendingReviews(projectId),
            loadProjectStatus(projectId),
            loadSystemReadiness(),
        ];
        if (!isBeeGameMode) {
            initialLoads.push(
                loadPhases(projectId),
                loadAgents(),
                loadTasks(projectId),
            );
        }
        Promise.allSettled(initialLoads).finally(() => setInitialGateStateReady(true));
        loadTokenUsage(projectId).catch(console.error);

        const poll = () => {
            if (document.hidden) return;
            
            if (currentStatus === 'running' || hasUnfinishedTasks || isPipelineActive) {
                loadTokenUsage(projectId).catch(console.error);
                if (!isBeeGameMode) {
                    loadPhases(projectId);
                    loadAgents().catch(console.error);
                    loadTasks(projectId).catch(console.error);
                }
                loadPendingReviews(projectId).catch(console.error);
                loadProjectStatus(projectId).catch(console.error);
            }
        };

        // Setup polling every 10 seconds while project is active
        const interval = setInterval(poll, 10000);
        const tokenInterval = setInterval(() => {
            if (document.hidden) return;
            if (currentStatus === 'running' || hasUnfinishedTasks || isPipelineActive) {
                loadTokenUsage(projectId).catch(console.error);
            }
        }, 2000);

        // Add visibility change listener to trigger immediate poll when returning to tab
        const handleVisibilityChange = () => {
            if (!document.hidden) {
                poll();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            clearInterval(tokenInterval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [projectId, isBeeGameMode, loadPhases, loadTokenUsage, loadAgents, loadTasks, loadPendingReviews, loadProjectStatus, loadSystemReadiness, currentStatus, hasUnfinishedTasks, isPipelineActive]);

    // BeeGame follows the live runtime turn, not the legacy multi-stage workflow.
    const progressPercent = useMemo(() => {
        if (isBeeGameMode) {
            if (currentStatus === 'running' || currentStatus === 'waiting_approval') return 50;
            return 0;
        }
        return deriveGlobalWorkflowProgress({
            phaseInfo,
            currentStatus,
            messages,
        });
    }, [isBeeGameMode, currentStatus, phaseInfo, messages]);

    const phaseLabel = useMemo(() => {
        if (isBeeGameMode) {
            return translateBeeGame(`dashboard.turn.${currentStatus}`, {
                defaultValue: translateBeeGame('dashboard.turn.idle'),
            });
        }
        const phaseName = String(phaseInfo?.phase_name || savedRuntimeSnapshot?.phase_name || '').trim();
        if (!phaseName) return translateBeeGame('dashboard.phase.idea_intake');
        return translateBeeGame(`dashboard.phase.${phaseName}`, {
            defaultValue: fallbackPhaseLabel(phaseName),
        });
    }, [currentStatus, isBeeGameMode, phaseInfo?.phase_name, savedRuntimeSnapshot?.phase_name, translateBeeGame]);

    const displayProjectName = useMemo(() => {
        return getWorkspaceFolderName(activeProject?.root_path) || projectName;
    }, [activeProject?.root_path, projectName]);

    const displayedTokenTotal = useMemo(() => {
        const storedTotal = Number(tokenUsage[projectId]?.total_tokens) || 0;
        const runtimeTotal = Number(projectStatus?.context?.token_budget?.total_tokens) || 0;
        const savedTotal = Number(savedRuntimeSnapshot?.usage?.total_tokens) || 0;
        return Math.max(storedTotal, runtimeTotal, savedTotal);
    }, [projectId, projectStatus?.context?.token_budget?.total_tokens, savedRuntimeSnapshot?.usage?.total_tokens, tokenUsage]);

    const currentModelName = useMemo(() => {
        const currentConfigId = String(projectStatus?.model_config_id || '').trim();
        const sessionConfig = currentConfigId
            ? modelConfigs.find((config) => config.id === currentConfigId)
            : undefined;
        return getModelDisplayName(
            sessionConfig ||
            modelConfigs.find((config) => config.isDefault) ||
            modelConfigs[0],
        ) || savedRuntimeSnapshot?.model_name || '';
    }, [modelConfigs, projectStatus?.model_config_id, savedRuntimeSnapshot?.model_name]);

    const latestDeploymentBuildReport = useMemo(() => {
        const latest = deploymentHistory[0];
        return latest ? deploymentToBuildReport(latest) : null;
    }, [deploymentHistory]);

    // Logging Token Usage and Progress
    useEffect(() => {
        const projectTokenUsage = tokenUsage[projectId] || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        console.log(`[DashboardView] Project: ${projectId} | Token Usage:`, projectTokenUsage);
        console.log(`[DashboardView] Project Progress: ${progressPercent.toFixed(2)}% (Status: ${currentStatus})`);
    }, [projectId, tokenUsage, progressPercent, currentStatus]);

    const handleToggleStatus = async () => {
        if (currentStatus === 'running') {
            await stopTask();
        } else if (
            (currentStatus as string) === 'stopped' ||
            currentStatus === 'paused' ||
            (currentStatus as string) === 'failed' ||
            ((currentStatus === 'finished' || currentStatus === 'idle') && hasUnfinishedTasks)
        ) {
            await continueTask();
        } else if (currentStatus === 'waiting_approval') {
            showError(waitingApproval.message || translateBeeGame('dashboard.approvalWaiting'));
            return;
        } else {
            await sendMessage("Please continue analyzing the project.");
        }
    };

    const handleRename = async (newName: string) => {
        await useProjectStore.getState().updateProject(projectId, { name: newName });
    };

    const handleNewProject = () => {
        useProjectStore.getState().setActiveProject('');
    };

    return (
        <div className={`${isDark ? 'dark' : ''} h-screen w-full flex overflow-hidden font-sans bg-zinc-50 dark:bg-zinc-950 transition-colors duration-700`}>
            {!isBeeGameMode ? (
                <TopBar
                    projectName={displayProjectName}
                    lang={lang}
                    status={currentStatus === 'idle' ? 'idle' : (currentStatus as any)}
                    progress={progressPercent}
                    tokens={displayedTokenTotal}
                    isSyncing={isSyncing}
                    onRename={handleRename}
                />
            ) : null}

            {!isBeeGameMode ? (
                <SideMenu
                    status={currentStatus === 'offline' ? 'stopped' : currentStatus}
                    lang={lang}
                    isDark={isDark}
                    onToggleStatus={handleToggleStatus}
                    onSetLang={onSetLang}
                    onToggleTheme={toggleTheme}
                    onNewProject={handleNewProject}
                />
            ) : null}

            <BeeGameLivePreviewPage
                lang={lang}
                projectName={displayProjectName}
                status={currentStatus === 'idle' ? 'idle' : (currentStatus as any)}
                phaseLabel={phaseLabel}
                tokens={displayedTokenTotal}
                credits={creditSummary}
                modelName={currentModelName}
                isSyncing={isSyncing}
                buildReport={deploymentBuildReport || latestDeploymentBuildReport || projectStatus?.build_report || null}
                deployments={deploymentHistory}
                onStartPreview={canManagePreview ? handleStartPreview : undefined}
                onRestartPreview={canManagePreview ? handleRestartPreview : undefined}
                onStopPreview={canManagePreview ? handleStopPreview : undefined}
                onDeployProject={canManageDeployment ? handleDeployProject : undefined}
                onRollbackDeployment={canManageDeployment ? handleRollbackDeployment : undefined}
                isDeploying={isDeployingProject}
                onOpenExternal={(url) => window.open(url, '_blank', 'noopener,noreferrer')}
                onBack={onBack}
                onSetLang={onSetLang}
            />

            <RightSidebar
                projectId={projectId}
                lang={lang}
                messages={displayMessages}
                progress={progressPercent}
                onSendMessage={(
                    message,
                    taskType?: BeeGameCreditTaskType,
                    attachments?: ChatImageAttachmentPayload[],
                    thinkingMode?: BeeGameThinkingMode,
                ) =>
                    sendMessage(message, undefined, taskType, attachments, thinkingMode)
                }
                isLoading={isLoading}
                isRuntimeBusy={currentStatus === 'running'}
                onApprovePlan={hasPendingPlanReview && canApproveTool ? approvePlan : undefined}
                approvalState={approvalState}
                pendingReviews={reviewDisplayModels}
                projectStatus={projectRuntimeDisplay}
                runtimeReadiness={runtimeReadiness}
                onUploadManifestCsv={uploadManifestCsv}
                onApproveManifest={approveManifest}
                waitingApproval={waitingApproval}
                canSendMessage={canSendMessage}
                canApproveTool={canApproveTool}
                canUploadAssets={canUploadAssets}
                canIntegrateAssets={canIntegrateAssets}
                canExportProject={canExportProject}
                variant={isBeeGameMode ? 'beegame' : 'legacy'}
                currentUserDisplayName={currentUser?.displayName}
                currentUserEmail={currentUser?.email}
                currentUserAvatarUrl={currentUser?.avatarUrl}
            />
            {creditQuote ? (
                <CreditQuoteDialog
                    quote={creditQuote}
                    lang={lang}
                    onCancel={() => resolveCreditQuote(false)}
                    onConfirm={() => resolveCreditQuote(true)}
                />
            ) : null}
        </div>
    );
}

function CreditQuoteDialog({
    quote,
    lang,
    onCancel,
    onConfirm,
}: {
    quote: BeeGameCreditQuote;
    lang: Language;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const { i18n } = useTranslation('beegame');
    const t = i18n.getFixedT(normalizeI18nLanguage(lang), 'beegame', 'dashboard.creditQuote');
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="beegame-credit-quote-title"
                data-surface="frosted-glass"
                className="input-surface glass-panel w-full max-w-[520px] rounded-[30px] p-6 text-white shadow-[0_28px_90px_rgba(0,0,0,0.55)] sm:p-7"
            >
                <h2 id="beegame-credit-quote-title" className="type-title-2 text-white">
                    {t('title')}
                </h2>
                <div className="credit-ticket-shell mt-6">
                    <div className="credit-ticket">
                        <div className="grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-stretch px-10 py-5">
                            <div className="min-w-0 pr-5">
                                <div className="type-caption-1 text-zinc-500">
                                    {t('balance')}
                                </div>
                                <div className="type-title-3 mt-2 text-emerald-200">
                                    {quote.balanceCredits} credits
                                </div>
                            </div>
                            <div className="credit-ticket-divider" aria-hidden="true" />
                            <div className="min-w-0 pl-5 text-right">
                                <div className="type-caption-1 text-zinc-500">
                                    {t('reserved')}
                                </div>
                                <div className="type-title-3 mt-2 text-white">
                                    {quote.reservedCredits} credits
                                </div>
                            </div>
                        </div>
                        <div className="border-t border-white/10 px-7 py-3">
                            <p className="type-caption-2 truncate text-zinc-400">
                                {t('settlementNote')}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="secondary-pill type-button px-6 py-3 text-zinc-200 hover:text-white"
                    >
                        {t('cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="primary-pill type-button px-7 py-3"
                    >
                        {t('confirm')}
                    </button>
                </div>
            </div>
        </div>
    );
}
