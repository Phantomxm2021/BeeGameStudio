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
import type { BeeGameDeploymentPayload, ChatAttachmentPayload, PendingUserReviewItem } from '../../services/api';
import { api } from '../../services/api';
import { deriveDashboardStatus, getWaitingApprovalState } from '../../utils/waitingApproval';
import { deriveGlobalWorkflowProgress } from '../../utils/workflowProgress';
import { toChatDisplayMessages, toProjectRuntimeDisplayModel, toReviewDisplayModels } from '../../viewModels/displayModels';
import { isBeeGameAdapterEnabled, type BeeGameThinkingMode } from '../../services/beeGameAdapter';
import {
    getCreditBalance,
    getCreditSummary,
    type BeeGameCreditBalance,
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

const upsertDeploymentHistory = (
    current: BeeGameDeploymentPayload[],
    deployment: BeeGameDeploymentPayload,
): BeeGameDeploymentPayload[] => [
    deployment,
    ...current.filter((item) => item.id !== deployment.id),
];

const createBuildErrorFixPrompt = (template: string, errorLog: string): string => (
    template.replace('{{errorLog}}', errorLog)
);

const PROJECT_SYNC_TIMEOUT_MS = 10_000;

const getErrorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.trim()) return error;
    return fallback;
};

const withProjectSyncTimeout = async <T,>(operation: Promise<T>, message: string): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(message)), PROJECT_SYNC_TIMEOUT_MS);
            }),
        ]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
};

export function DashboardView({ projectId, projectName, lang, onSetLang, onBack, initialPrompt }: DashboardViewProps) {
    const [initialGateStateReady, setInitialGateStateReady] = useState(false);
    const [creditQuote, setCreditQuote] = useState<BeeGameCreditQuote | null>(null);
    const [creditBalance, setCreditBalance] = useState<BeeGameCreditBalance | null>(null);
    const [creditSummary, setCreditSummary] = useState<BeeGameCreditSummary | null>(null);
    const [deploymentHistory, setDeploymentHistory] = useState<BeeGameDeploymentPayload[]>([]);
    const [isDeployingProject, setDeployingProject] = useState(false);
    const [previewRefreshNonce, setPreviewRefreshNonce] = useState(0);
    const hasSentInitialPrompt = useRef(false);
    const creditQuoteResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const previousBeeGameStatusRef = useRef<string | null>(null);
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
    const { projects, pendingReviews, projectStatus, runtimeReadiness, isOpeningProject, loadPendingReviews, loadProjectStatus, loadSystemReadiness } = useProjectStore();
    const { messages } = useChatStore();
    const { showSuccess, showError, showWarning } = useToast();

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

    const refreshCredits = useCallback(async () => {
        if (!isBeeGameMode) return;
        const [summaryResult, balanceResult] = await Promise.allSettled([
            getCreditSummary(projectId),
            getCreditBalance(),
        ]);
        if (summaryResult.status === 'fulfilled') {
            setCreditSummary(summaryResult.value);
        } else {
            console.error('Failed to load credit summary:', summaryResult.reason);
        }
        if (balanceResult.status === 'fulfilled') {
            setCreditBalance(balanceResult.value);
        } else {
            console.error('Failed to load credit balance:', balanceResult.reason);
        }
    }, [isBeeGameMode, projectId]);

    const refreshDeploymentHistory = useCallback(async (): Promise<BeeGameDeploymentPayload[]> => {
        if (!isBeeGameMode) return [];
        try {
            const deployments = await api.listProjectDeployments(projectId);
            setDeploymentHistory(deployments);
            return deployments;
        } catch (error) {
            console.error('Failed to load deployment history:', error);
            return [];
        }
    }, [isBeeGameMode, projectId]);

    // Custom Hook for WebSocket & REST
    const {
        sendMessage, stopTask, continueTask, approvePlan,
        uploadManifestCsv, approveManifest, approvalState,
        isLoading, isStopping, canContinue, wsState
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
                    refreshCredits().catch(console.error);
                    refreshTimerRef.current = null;
                }, 2000);
            }
        }
    });

    useEffect(() => {
        hasSentInitialPrompt.current = false;
        setInitialGateStateReady(false);
        setCreditBalance(null);
        setCreditSummary(null);
        setDeploymentHistory([]);
        void refreshCredits();
        void refreshDeploymentHistory();
    }, [projectId, refreshCredits, refreshDeploymentHistory]);

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
    const isProjectInteractionLocked = isOpeningProject || isSyncing;
    const canSendMessage = hasPermission('agent.send_message') && !isProjectInteractionLocked;
    const canApproveTool = hasPermission('agent.approve_tool') && !isProjectInteractionLocked;
    const canManagePreview = hasPermission('preview.manage') && !isProjectInteractionLocked;
    const canManageDeployment = hasPermission('deployment.manage') && !isProjectInteractionLocked;
    const canUploadAssets = hasPermission('assets.upload') && !isProjectInteractionLocked;
    const canIntegrateAssets = hasPermission('assets.integrate') && !isProjectInteractionLocked;
    const canExportProject = hasPermission('project.export');
    const canDeployAcceptedProject = canManageDeployment && projectStatus?.deployment_gate?.can_deploy === true;
    const projectTargetLabel = String(
        projectStatus?.project_target?.engine || projectStatus?.project_target?.kind || '',
    ).trim();

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
        if (!canManagePreview || isProjectInteractionLocked) return;
        try {
            await withProjectSyncTimeout(
                api.startProjectPreview(projectId),
                translateBeeGame('livePreview.syncTimeoutMessage'),
            );
            setPreviewRefreshNonce(value => value + 1);
            await refreshPreviewStatus();
        } catch (error) {
            showError(error instanceof Error ? error.message : String(error));
        }
    };

    const handleRestartPreview = async () => {
        if (!canManagePreview || isProjectInteractionLocked) return;
        try {
            await api.restartProjectPreview(projectId);
            setPreviewRefreshNonce(value => value + 1);
            await refreshPreviewStatus();
        } catch (error) {
            showError(error instanceof Error ? error.message : String(error));
        }
    };

    const handleStopPreview = async () => {
        if (!canManagePreview || isProjectInteractionLocked) return;
        try {
            await api.stopProjectPreview(projectId);
            setPreviewRefreshNonce(value => value + 1);
            await refreshPreviewStatus();
        } catch (error) {
            showError(error instanceof Error ? error.message : String(error));
        }
    };

    const handleDeployProject = async () => {
        if (!canDeployAcceptedProject || isDeployingProject || isProjectInteractionLocked) return;
        setDeployingProject(true);
        try {
            const deployment = await api.deployProject(projectId);
            setDeploymentHistory((current) => upsertDeploymentHistory(current, deployment));
            const refreshed = await refreshDeploymentHistory();
            if (!refreshed.some((item) => item.id === deployment.id)) {
                setDeploymentHistory((current) => upsertDeploymentHistory(current, deployment));
            }
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
        if (!canManageDeployment || isDeployingProject || isProjectInteractionLocked) return;
        setDeployingProject(true);
        try {
            const deployment = await api.rollbackProjectDeployment(projectId, deploymentId);
            setDeploymentHistory((current) => upsertDeploymentHistory(current, deployment));
            const refreshed = await refreshDeploymentHistory();
            if (!refreshed.some((item) => item.id === deployment.id)) {
                setDeploymentHistory((current) => upsertDeploymentHistory(current, deployment));
            }
        } catch (error) {
            showError(error instanceof Error ? error.message : String(error));
        } finally {
            setDeployingProject(false);
        }
    };

    const runProjectSync = useCallback(async () => {
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
        const results = await withProjectSyncTimeout(
            Promise.allSettled(initialLoads),
            translateBeeGame('livePreview.syncTimeoutMessage'),
        );
        const failedResult = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failedResult) throw failedResult.reason;
    }, [isBeeGameMode, loadAgents, loadPendingReviews, loadPhases, loadProjectStatus, loadSystemReadiness, loadTasks, projectId, translateBeeGame]);

    // Poll live runtime state. BeeGame mode deliberately avoids legacy workflow phase/task telemetry.
    useEffect(() => {
        if (!projectId) return;

        runProjectSync()
            .then(() => setInitialGateStateReady(true))
            .catch((error) => {
                setInitialGateStateReady(false);
                showWarning(getErrorMessage(error, translateBeeGame('livePreview.syncFailedMessage')));
            });
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
    }, [projectId, isBeeGameMode, loadPhases, loadTokenUsage, loadAgents, loadTasks, loadPendingReviews, loadProjectStatus, loadSystemReadiness, currentStatus, hasUnfinishedTasks, isPipelineActive, runProjectSync, showWarning, translateBeeGame]);

    useEffect(() => {
        if (!isOpeningProject && !isSyncing) return undefined;
        const timeoutId = setTimeout(() => {
            showWarning(translateBeeGame('livePreview.syncTimeoutMessage'));
        }, PROJECT_SYNC_TIMEOUT_MS);
        return () => clearTimeout(timeoutId);
    }, [isOpeningProject, isSyncing, showWarning, translateBeeGame]);

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

    useEffect(() => {
        if (!isBeeGameMode) return;
        const previousStatus = previousBeeGameStatusRef.current;
        previousBeeGameStatusRef.current = currentStatus;
        const wasWorking = previousStatus === 'running' || previousStatus === 'waiting_approval';
        const isSettled = currentStatus === 'finished' || currentStatus === 'paused' || currentStatus === 'idle';
        if (wasWorking && isSettled && projectStatus?.build_report?.build_url) {
            setPreviewRefreshNonce(value => value + 1);
        }
    }, [currentStatus, isBeeGameMode, projectStatus?.build_report?.build_url]);

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
                accountCreditBalance={creditBalance}
                isSyncing={isSyncing}
                isInteractionLocked={isProjectInteractionLocked}
                buildReport={projectStatus?.build_report || null}
                deliveryReview={projectStatus?.delivery_review || null}
                projectTarget={projectTargetLabel}
                deployments={deploymentHistory}
                previewRefreshNonce={previewRefreshNonce}
                onStartPreview={canManagePreview ? handleStartPreview : undefined}
                onRestartPreview={canManagePreview ? handleRestartPreview : undefined}
                onStopPreview={canManagePreview ? handleStopPreview : undefined}
                onDeployProject={canDeployAcceptedProject ? handleDeployProject : undefined}
                onRollbackDeployment={canManageDeployment ? handleRollbackDeployment : undefined}
                onFixBuildErrors={(errorLog) => {
                    if (isProjectInteractionLocked) return Promise.resolve();
                    return sendMessage(createBuildErrorFixPrompt(translateBeeGame('livePreview.fixBuildErrorsPrompt'), errorLog));
                }}
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
                    attachments?: ChatAttachmentPayload[],
                    thinkingMode?: BeeGameThinkingMode,
                    supersedesMessageId?: string,
                ) => {
                    if (isProjectInteractionLocked) return Promise.resolve();
                    return sendMessage(message, undefined, taskType, attachments, thinkingMode, supersedesMessageId);
                }}
                isLoading={isLoading}
                onStopTask={stopTask}
                isStopping={isStopping}
                isRuntimeBusy={currentStatus === 'running'}
                onApprovePlan={hasPendingPlanReview && canApproveTool && !isProjectInteractionLocked ? approvePlan : undefined}
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
