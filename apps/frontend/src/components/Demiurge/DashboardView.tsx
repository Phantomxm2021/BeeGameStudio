import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle } from 'lucide-react';
import { useSystemStore } from '../../store/systemStore';
import { useProjectStore } from '../../store/projectStore';
import { useChatStore } from '../../store/chatStore';
import { useChat } from '../../hooks/useChat';
import { useToast } from '../../hooks/useToast';
import { isAuthenticationServiceUnavailable } from '../../services/apiClient';
import type { Language } from './AgentsConfig';

import { BeeGameLivePreviewPage } from './BeeGameLivePreviewPage';
import { RightSidebar } from './RightSidebar';
import type { BeeGameDeploymentPayload, ChatAttachmentPayload, PendingUserReviewItem } from '../../services/api';
import { api } from '../../services/api';
import { deriveDashboardStatus, getWaitingApprovalState } from '../../utils/waitingApproval';
import {
  toChatDisplayMessages,
  toProjectRuntimeDisplayModel,
  toReviewDisplayModels,
} from '../../viewModels/displayModels';
import {
  getCreditBalance,
  getCreditSummary,
  type BeeGameCreditBalance,
  type BeeGameUsageSummary,
} from '../../services/creditsApi';
import { normalizeI18nLanguage } from '../../i18n/useBeeGameTranslations';
import { countPendingToolPermissions, usePermissionTabAttention } from '../../hooks/usePermissionTabAttention';

interface DashboardViewProps {
  projectId: string;
  projectName: string;
  lang: Language;
  onSetLang: (lang: Language) => void;
  onBack?: () => void;
}

const getWorkspaceFolderName = (rootPath?: string): string => {
  const normalized = String(rootPath || '').replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
};

const upsertDeploymentHistory = (
  current: BeeGameDeploymentPayload[],
  deployment: BeeGameDeploymentPayload,
): BeeGameDeploymentPayload[] => [deployment, ...current.filter(item => item.id !== deployment.id)];

const PROJECT_SYNC_TIMEOUT_MS = 10_000;

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
};

const logDashboardReadError = (label: string, error: unknown): void => {
  if (!isAuthenticationServiceUnavailable(error)) {
    console.error(label, error);
  }
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

export function DashboardView({ projectId, projectName, lang, onSetLang, onBack }: DashboardViewProps) {
  const [creditBalance, setCreditBalance] = useState<BeeGameCreditBalance | null>(null);
  const [creditSummary, setCreditSummary] = useState<BeeGameUsageSummary | null>(null);
  const [deploymentHistory, setDeploymentHistory] = useState<BeeGameDeploymentPayload[]>([]);
  const [isDeployingProject, setDeployingProject] = useState(false);
  const [previewRefreshNonce, setPreviewRefreshNonce] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creditRefreshPromiseRef = useRef<{ projectId: string; promise: Promise<void> } | null>(null);
  const activeCreditProjectRef = useRef(projectId);
  activeCreditProjectRef.current = projectId;
  const previousBeeGameStatusRef = useRef<string | null>(null);
  const { i18n } = useTranslation('beegame');
  const translateBeeGame = useMemo(() => i18n.getFixedT(normalizeI18nLanguage(lang), 'beegame'), [i18n, lang]);

  // Zustand State
  const { isSyncing, isDark, hasPermission, currentUser, authenticationStatus, tokenUsage } = useSystemStore();
  const { projects, pendingReviews, projectStatus, isOpeningProject, loadProjectRuntimeState } = useProjectStore();
  const { messages } = useChatStore();
  const { showSuccess, showError, showWarning } = useToast();

  const refreshCredits = useCallback((): Promise<void> => {
    if (creditRefreshPromiseRef.current?.projectId === projectId) {
      return creditRefreshPromiseRef.current.promise;
    }
    const request = (async () => {
      const [summaryResult, balanceResult] = await Promise.allSettled([
        getCreditSummary(projectId),
        getCreditBalance(),
      ]);
      if (activeCreditProjectRef.current !== projectId) return;
      if (summaryResult.status === 'fulfilled') {
        setCreditSummary(summaryResult.value);
      } else {
        logDashboardReadError('Failed to load credit summary:', summaryResult.reason);
      }
      if (balanceResult.status === 'fulfilled') {
        setCreditBalance(balanceResult.value);
      } else {
        logDashboardReadError('Failed to load credit balance:', balanceResult.reason);
      }
    })().finally(() => {
      if (creditRefreshPromiseRef.current?.promise === request) {
        creditRefreshPromiseRef.current = null;
      }
    });
    creditRefreshPromiseRef.current = { projectId, promise: request };
    return request;
  }, [projectId]);

  const refreshDeploymentHistory = useCallback(async (): Promise<BeeGameDeploymentPayload[]> => {
    try {
      const deployments = await api.listProjectDeployments(projectId);
      setDeploymentHistory(deployments);
      return deployments;
    } catch (error) {
      console.error('Failed to load deployment history:', error);
      return [];
    }
  }, [projectId]);

  // Custom Hook for WebSocket & REST
  const { sendMessage, stopTask, approvePlan, approvalState, isLoading, isStopping, canContinue, wsState } = useChat({
    projectId,
    onError: err => console.error(err),
    showToastError: showError,
    showToastSuccess: showSuccess,
    // Trigger data refreshes on significant task events
    onTaskEvent: type => {
      if (type === 'usage') {
        void refreshCredits();
      }
      if (
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
          if (authenticationStatus === 'authenticated') {
            loadProjectRuntimeState(projectId).catch(error => {
              logDashboardReadError('Failed to refresh project runtime state:', error);
            });
          }
          refreshTimerRef.current = null;
        }, 2000);
      }
    },
  });

  useEffect(() => {
    setCreditBalance(null);
    setCreditSummary(null);
    setDeploymentHistory([]);
    void refreshCredits();
    void refreshDeploymentHistory();
  }, [projectId, refreshCredits, refreshDeploymentHistory]);

  // Local derived state mapped from backend
  const isOffline = wsState === 'failed' || wsState === 'disconnected';

  const hasPendingPlanReview = pendingReviews.some((review: PendingUserReviewItem) => {
    const reviewType = String(review?.type || '');
    return reviewType !== 'ASSET_MANIFEST_REVIEW' && Boolean(review?.gate_id);
  });
  const pendingToolPermissionCount = countPendingToolPermissions(pendingReviews);
  usePermissionTabAttention(pendingToolPermissionCount, translateBeeGame('approvalRequestShort'));
  const displayMessages = useMemo(() => toChatDisplayMessages(messages), [messages]);
  const reviewDisplayModels = useMemo(() => toReviewDisplayModels(pendingReviews), [pendingReviews]);
  const projectRuntimeDisplay = useMemo(() => toProjectRuntimeDisplayModel(projectStatus), [projectStatus]);
  const projectTokenUsage = tokenUsage?.[projectId] ?? null;
  const activeProject = useMemo(() => projects.find(project => project.id === projectId), [projectId, projects]);
  const isProjectStarting =
    !projectRuntimeDisplay?.workflow &&
    // A persisted project-list snapshot is stale by definition. Do
    // not turn it into a fullscreen loading gate when the runtime
    // request failed or the workflow already reached a terminal
    // state; the dashboard must remain available to show diagnostics.
    String(projectStatus?.phase || '').toLowerCase() === 'starting';
  const waitingApproval = useMemo(
    () => getWaitingApprovalState(projectRuntimeDisplay, reviewDisplayModels),
    [projectRuntimeDisplay, reviewDisplayModels],
  );
  const hasCurrentRuntimeSnapshot = projectStatus?.project_id === projectId;
  const isProjectInteractionLocked = isOpeningProject || isSyncing || !hasCurrentRuntimeSnapshot;
  const projectTargetLabel = String(
    projectStatus?.project_target?.runtime || projectStatus?.project_target?.platform || '',
  ).trim();

  const isPipelineActive = useMemo(() => {
    const workflowStatus = projectRuntimeDisplay?.workflow?.status;
    if (workflowStatus) return workflowStatus === 'running';
    const nextAction = String(projectStatus?.next_action || '').toLowerCase();
    const phase = String(projectStatus?.phase || '').toLowerCase();
    return (
      ['pending', 'running', 'clarification_required'].includes(nextAction) ||
      phase === 'running' ||
      phase === 'waiting_approval'
    );
  }, [projectRuntimeDisplay?.workflow?.status, projectStatus?.next_action, projectStatus?.phase]);
  const isProjectWorkspaceMutationLocked = isProjectInteractionLocked || isProjectStarting || isPipelineActive;
  const canSendMessage = hasPermission('agent.send_message') && !isProjectWorkspaceMutationLocked;
  const canApproveTool = hasPermission('agent.approve_tool') && !isProjectInteractionLocked;
  const canManagePreview = hasPermission('preview.manage') && !isProjectInteractionLocked;
  const canManageDeployment = hasPermission('deployment.manage') && !isProjectWorkspaceMutationLocked;
  const canUploadAssets = hasPermission('assets.upload') && !isProjectWorkspaceMutationLocked;
  const canExportProject = hasPermission('project.export');

  // Derived state machine based on Requirements: 4.2
  const currentStatus = useMemo(() => {
    const workflow = projectRuntimeDisplay?.workflow;
    const workflowStatus = String(workflow?.status || '');
    const phase = String(projectStatus?.phase || '').toLowerCase();
    const acceptance = projectStatus?.acceptance?.status;
    if (isOffline) return 'offline';
    if (!hasCurrentRuntimeSnapshot) return 'starting';
    if (
      ['needs_action', 'blocked', 'failed', 'stopped'].includes(workflowStatus)
    )
      return 'paused';
    if (workflowStatus === 'completed') return 'finished';
    if (workflowStatus === 'running') return 'running';
    if (phase === 'starting' || isProjectStarting) return 'starting';
    if (phase === 'running') return 'running';
    if (phase === 'waiting_approval' || phase === 'awaiting_user') return 'waiting_approval';
    if (acceptance === 'failed' || acceptance === 'blocked' || acceptance === 'stale') return 'paused';
    if (phase === 'finished') return 'finished';
    if (phase === 'paused' || phase === 'failed') return 'paused';
    return deriveDashboardStatus({
      isOffline,
      isLoading,
      canContinue,
      hasWaitingApproval: waitingApproval.isWaitingStatus || hasPendingPlanReview,
      messages: displayMessages,
    });
  }, [
    projectRuntimeDisplay?.workflow,
    projectStatus?.phase,
    projectStatus?.acceptance?.status,
    isOffline,
    hasCurrentRuntimeSnapshot,
    isLoading,
    canContinue,
    waitingApproval.isWaitingStatus,
    hasPendingPlanReview,
    displayMessages,
    isProjectStarting,
  ]);

  const refreshPreviewStatus = async () => {
    await loadProjectRuntimeState(projectId);
  };

  const handleStartPreview = async () => {
    if (!canManagePreview || isProjectWorkspaceMutationLocked) return;
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
    if (!canManagePreview || isProjectWorkspaceMutationLocked) return;
    try {
      await api.restartProjectPreview(projectId);
      setPreviewRefreshNonce(value => value + 1);
      await refreshPreviewStatus();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleStopPreview = async () => {
    if (!canManagePreview || isProjectWorkspaceMutationLocked) return;
    try {
      await api.stopProjectPreview(projectId);
      await refreshPreviewStatus();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDeployProject = async () => {
    if (!canManageDeployment || isDeployingProject || isProjectWorkspaceMutationLocked) return;
    setDeployingProject(true);
    try {
      const deployment = await api.deployProject(projectId);
      setDeploymentHistory(current => upsertDeploymentHistory(current, deployment));
      const refreshed = await refreshDeploymentHistory();
      if (!refreshed.some(item => item.id === deployment.id)) {
        setDeploymentHistory(current => upsertDeploymentHistory(current, deployment));
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
    if (!canManageDeployment || isDeployingProject || isProjectWorkspaceMutationLocked) return;
    setDeployingProject(true);
    try {
      const deployment = await api.rollbackProjectDeployment(projectId, deploymentId);
      setDeploymentHistory(current => upsertDeploymentHistory(current, deployment));
      const refreshed = await refreshDeploymentHistory();
      if (!refreshed.some(item => item.id === deployment.id)) {
        setDeploymentHistory(current => upsertDeploymentHistory(current, deployment));
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeployingProject(false);
    }
  };

  const runProjectSync = useCallback(async () => {
    const results = await withProjectSyncTimeout(
      Promise.allSettled([loadProjectRuntimeState(projectId)]),
      translateBeeGame('livePreview.syncTimeoutMessage'),
    );
    const failedResult = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failedResult) throw failedResult.reason;
  }, [loadProjectRuntimeState, projectId, translateBeeGame]);

  // Poll the persisted workflow snapshot as a reconnect-safe fallback.
  useEffect(() => {
    if (!projectId || authenticationStatus !== 'authenticated') return;

    runProjectSync().catch(error => {
      showWarning(getErrorMessage(error, translateBeeGame('livePreview.syncFailedMessage')));
    });
    const poll = () => {
      if (document.hidden) return;

      if (currentStatus === 'running' || isPipelineActive) {
        loadProjectRuntimeState(projectId).catch(error => {
          logDashboardReadError('Failed to poll project runtime state:', error);
        });
      }
    };

    // Workflow state and cumulative usage are persisted server-side and
    // refreshed once per second; the cursor endpoint remains available for
    // reconnect/recovery without making chat text the state model.
    const interval = setInterval(poll, 1000);

    // Add visibility change listener to trigger immediate poll when returning to tab
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        poll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    projectId,
    authenticationStatus,
    loadProjectRuntimeState,
    currentStatus,
    isPipelineActive,
    runProjectSync,
    showWarning,
    translateBeeGame,
  ]);

  useEffect(() => {
    if (!isOpeningProject && !isSyncing) return undefined;
    const timeoutId = setTimeout(() => {
      showWarning(translateBeeGame('livePreview.syncTimeoutMessage'));
    }, PROJECT_SYNC_TIMEOUT_MS);
    return () => clearTimeout(timeoutId);
  }, [isOpeningProject, isSyncing, showWarning, translateBeeGame]);

  // BeeGame displays the server-owned workflow phase while preserving the live turn state.
  const progressPercent = useMemo(() => {
    if (currentStatus === 'running' || currentStatus === 'waiting_approval') return 50;
    return 0;
  }, [currentStatus]);

  const phaseLabel = useMemo(() => {
    return translateBeeGame(`dashboard.turn.${currentStatus}`, {
      defaultValue: translateBeeGame('dashboard.turn.idle'),
    });
  }, [currentStatus, translateBeeGame]);

  const displayProjectName = useMemo(() => {
    return getWorkspaceFolderName(activeProject?.root_path) || projectName;
  }, [activeProject?.root_path, projectName]);

  useEffect(() => {
    const previousStatus = previousBeeGameStatusRef.current;
    previousBeeGameStatusRef.current = currentStatus;
    const wasWorking = previousStatus === 'running' || previousStatus === 'waiting_approval';
    const isSettled = currentStatus === 'finished' || currentStatus === 'paused' || currentStatus === 'idle';
    if (wasWorking && isSettled && projectStatus?.build_report?.build_url) {
      setPreviewRefreshNonce(value => value + 1);
    }
  }, [currentStatus, projectStatus?.build_report?.build_url]);

  return (
    <div
      className={`${isDark ? 'dark' : ''} h-screen w-full flex overflow-hidden font-sans bg-zinc-50 dark:bg-zinc-950 transition-colors duration-700`}
    >
      <BeeGameLivePreviewPage
        lang={lang}
        projectName={displayProjectName}
        status={currentStatus === 'idle' ? 'idle' : (currentStatus as any)}
        phaseLabel={phaseLabel}
        credits={creditSummary}
        accountCreditBalance={creditBalance}
        isSyncing={isSyncing}
        isInteractionLocked={isProjectInteractionLocked}
        isWorkspaceBusy={isProjectWorkspaceMutationLocked}
        buildReport={projectStatus?.build_report || null}
        projectTarget={projectTargetLabel}
        tokenUsage={projectTokenUsage}
        deployments={deploymentHistory}
        previewRefreshNonce={previewRefreshNonce}
        onStartPreview={canManagePreview ? handleStartPreview : undefined}
        onRestartPreview={canManagePreview ? handleRestartPreview : undefined}
        onStopPreview={canManagePreview ? handleStopPreview : undefined}
        onDeployProject={canManageDeployment ? handleDeployProject : undefined}
        onRollbackDeployment={canManageDeployment ? handleRollbackDeployment : undefined}
        onFixBuildErrors={
          canSendMessage
            ? () => {
                if (isProjectWorkspaceMutationLocked) return Promise.resolve();
                return api
                  .requestProjectAction({
                    project_id: projectId,
                    kind: 'build_error_repair',
                  })
                  .then(() => undefined);
              }
            : undefined
        }
        onFixDeploymentFailure={
          canSendMessage
            ? () => {
                if (isProjectWorkspaceMutationLocked) return Promise.resolve();
                return api
                  .requestProjectAction({
                    project_id: projectId,
                    kind: 'deployment_failure_repair',
                  })
                  .then(() => undefined);
              }
            : undefined
        }
        isDeploying={isDeployingProject}
        onOpenExternal={url => window.open(url, '_blank', 'noopener,noreferrer')}
        onBack={onBack}
        onSetLang={onSetLang}
      />

      <RightSidebar
        projectId={projectId}
        lang={lang}
        messages={displayMessages}
        progress={progressPercent}
        onSendMessage={(message, attachments?: ChatAttachmentPayload[], supersedesMessageId?: string) => {
          if (isProjectWorkspaceMutationLocked) return Promise.resolve();
          return sendMessage(message, undefined, attachments, supersedesMessageId);
        }}
        isLoading={isLoading}
        onStopTask={stopTask}
        isStopping={isStopping}
        isRuntimeBusy={currentStatus === 'running'}
        onApprovePlan={hasPendingPlanReview && canApproveTool && !isProjectInteractionLocked ? approvePlan : undefined}
        approvalState={approvalState}
        pendingReviews={reviewDisplayModels}
        projectStatus={projectRuntimeDisplay}
        waitingApproval={waitingApproval}
        canSendMessage={canSendMessage}
        canApproveTool={canApproveTool}
        canUploadAssets={canUploadAssets}
        canExportProject={canExportProject}
        currentUserDisplayName={currentUser?.displayName}
        currentUserEmail={currentUser?.email}
        currentUserAvatarUrl={currentUser?.avatarUrl}
      />
      {isProjectStarting ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden bg-black/95 px-6 backdrop-blur-2xl"
          role="status"
          aria-live="polite"
          aria-label={translateBeeGame('dashboard.starting.title')}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(52,211,153,0.11),transparent_34%)]" />
          <div className="relative flex max-w-md flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] shadow-[0_20px_70px_rgba(16,185,129,0.12)]">
              <LoaderCircle className="h-6 w-6 animate-spin text-emerald-300" aria-hidden="true" />
            </div>
            <h2 className="type-title-2 mt-7 text-white">{translateBeeGame('dashboard.starting.title')}</h2>
            <p className="type-body mt-3 max-w-sm text-zinc-400">
              {translateBeeGame('dashboard.starting.description')}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
