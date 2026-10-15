import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { useSystemStore } from '../../store/systemStore';
import { useProjectStore } from '../../store/projectStore';
import { useChatStore } from '../../store/chatStore';
import { useChat } from '../../hooks/useChat';
import { useProjectRuntimeRefresh } from '../../hooks/useProjectRuntimeRefresh';
import { useToastContext } from '../../contexts/ToastContext';
import type { Language } from './AgentsConfig';

import { BeeGameLivePreviewPage, type DashboardStatus } from './BeeGameLivePreviewPage';
import { RightSidebar } from './RightSidebar';
import type { BeeGameDeploymentDiscussionConfirmation, BeeGameDeploymentPayload, ChatAttachmentPayload, PendingToolPermissionItem } from '../../services/api';
import { api } from '../../services/api';
import { deriveDashboardStatus, getWaitingPermissionState } from '../../utils/waitingPermission';
import {
  toChatDisplayMessages,
  toProjectRuntimeDisplayModel,
  toPermissionDisplayModels,
} from '../../viewModels/displayModels';
import { useCredits } from '../../hooks/useCredits';
import { normalizeI18nLanguage } from '../../i18n/useBeeGameTranslations';
import { countPendingToolPermissions, usePermissionTabAttention } from '../../hooks/usePermissionTabAttention';
import { getProjectDisplayName } from '../../utils/projectDisplayName';
import { isProjectExecutionActive } from '../../utils/chatActivity';
import { filterPathsForDisplay } from '../../utils/chatPathDisplay';

interface DashboardViewProps {
  projectId: string;
  projectName: string;
  lang: Language;
  onSetLang: (lang: Language) => void;
  onBack?: () => void;
}

const upsertDeploymentHistory = (
  current: BeeGameDeploymentPayload[],
  deployment: BeeGameDeploymentPayload,
): BeeGameDeploymentPayload[] => [deployment, ...current.filter(item => item.id !== deployment.id)];

const PROJECT_SYNC_TIMEOUT_MS = 10_000;

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
  const [deploymentHistory, setDeploymentHistory] = useState<BeeGameDeploymentPayload[]>([]);
  const deploymentInProgress = deploymentHistory.some(item => ['queued', 'building', 'publishing'].includes(item.status));
  const [isDeployingProject, setDeployingProject] = useState(false);
  const [previewRefreshNonce, setPreviewRefreshNonce] = useState(0);
  const previousBeeGameStatusRef = useRef<string | null>(null);
  const { i18n } = useTranslation('beegame');
  const translateBeeGame = useMemo(() => i18n.getFixedT(normalizeI18nLanguage(lang), 'beegame'), [i18n, lang]);

  // Zustand State
  const { isSyncing, isDark, hasPermission, currentUser, authenticationStatus } = useSystemStore(
    useShallow(state => ({
      isSyncing: state.isSyncing,
      isDark: state.isDark,
      hasPermission: state.hasPermission,
      currentUser: state.currentUser,
      authenticationStatus: state.authenticationStatus,
    })),
  );
  const { projects, pendingPermissions, projectStatus, isOpeningProject, loadProjectRuntimeState } = useProjectStore(
    useShallow(state => ({
      projects: state.projects,
      pendingPermissions: state.pendingPermissions,
      projectStatus: state.projectStatus,
      isOpeningProject: state.isOpeningProject,
      loadProjectRuntimeState: state.loadProjectRuntimeState,
    })),
  );
  const { messages } = useChatStore(useShallow(state => ({ messages: state.messages })));
  const { showSuccess, showError, showWarning } = useToastContext();

  const { creditBalance, creditSummary, refreshCredits } = useCredits(
    projectId, authenticationStatus === 'authenticated', currentUser?.id,
  );

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
  useEffect(() => {
    if (!deploymentInProgress || authenticationStatus !== 'authenticated') return;
    let cancelled = false;
    let warned = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const records = await api.listProjectDeployments(projectId);
        if (!cancelled) { setDeploymentHistory(records); warned = false; }
      } catch (error) {
        if (!cancelled && !warned) { warned = true; showWarning(error instanceof Error ? error.message : String(error)); }
      } finally {
        if (!cancelled) timer = setTimeout(poll, 2500);
      }
    };
    timer = setTimeout(poll, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [projectId, deploymentInProgress, authenticationStatus, showWarning]);

  const { sendMessage, stopTask, resolveToolPermission, permissionState, isLoading, isStopping, canContinue, wsState } = useChat({
    projectId,
    onError: err => console.error(err),
    showToastError: showError,
    showToastSuccess: showSuccess,
    // Trigger data refreshes on significant task events
    onTaskEvent: type => {
      if (type === 'billing_update') void refreshCredits();
      scheduleRuntimeRefresh(type);
    },
  });

  useEffect(() => {
    // Deployment summaries belong to the selected project.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeploymentHistory([]);
    if (authenticationStatus === 'authenticated') void refreshDeploymentHistory();
  }, [projectId, authenticationStatus, refreshDeploymentHistory]);

  // Local derived state mapped from backend
  const isOffline = wsState === 'failed' || wsState === 'disconnected';

  const hasPendingToolPermission = pendingPermissions.some(
    (permission: PendingToolPermissionItem) =>
      permission.type === 'BEEGAME_PERMISSION' && Boolean(permission.gate_id),
  );
  const pendingToolPermissionCount = countPendingToolPermissions(pendingPermissions);
  usePermissionTabAttention(pendingToolPermissionCount, translateBeeGame('approvalRequestShort'));
  const displayMessages = useMemo(() => toChatDisplayMessages(messages), [messages]);
  const permissionDisplayModels = useMemo(() => toPermissionDisplayModels(pendingPermissions), [pendingPermissions]);
  const projectRuntimeDisplay = useMemo(() => toProjectRuntimeDisplayModel(projectStatus), [projectStatus]);
  const liveSessionTokenUsage = useMemo(() => {
    const live = projectStatus?.project_id === projectId ? projectStatus.context?.token_budget : null;
    if (!live) return null;
    return {
      prompt_tokens: Number(live.input_tokens) || 0,
      input_tokens: Number(live.input_tokens) || 0,
      cached_input_tokens: Number(live.cached_input_tokens) || 0,
      cache_read_tokens: Number(live.cache_read_tokens) || 0,
      cache_creation_tokens: Number(live.cache_creation_tokens) || 0,
      completion_tokens: Number(live.output_tokens) || 0,
      output_tokens: Number(live.output_tokens) || 0,
      total_tokens: Number(live.total_tokens) || 0,
    };
  }, [projectStatus, projectId]);
  const settledProjectTokenUsage = useMemo(() => creditSummary ? {
      prompt_tokens: creditSummary.inputTokens,
      input_tokens: creditSummary.inputTokens,
      cached_input_tokens: creditSummary.cacheReadTokens + creditSummary.cacheCreationTokens,
      cache_read_tokens: creditSummary.cacheReadTokens,
      cache_creation_tokens: creditSummary.cacheCreationTokens,
      completion_tokens: creditSummary.outputTokens,
      output_tokens: creditSummary.outputTokens,
      total_tokens: creditSummary.totalTokens,
    } : null, [creditSummary]);
  const activeProject = useMemo(() => projects.find(project => project.id === projectId), [projectId, projects]);
  const isProjectStarting =
    // A persisted project-list snapshot is stale by definition. Do
    // not turn it into a fullscreen loading gate when the runtime
    // request failed or the Agent already reached a terminal state
    // state; the dashboard must remain available to show diagnostics.
    String(projectStatus?.phase || '').toLowerCase() === 'starting';
  const waitingPermission = useMemo(
    () => getWaitingPermissionState(permissionDisplayModels),
    [permissionDisplayModels],
  );
  const hasCurrentRuntimeSnapshot = projectStatus?.project_id === projectId;
  const isProjectInteractionLocked = isOpeningProject || isSyncing || !hasCurrentRuntimeSnapshot;
  const projectTargetLabel = String(
    projectStatus?.project_target?.runtime || projectStatus?.project_target?.platform || '',
  ).trim();

  const isExecutionBusy = isLoading || isStopping ||
    (hasCurrentRuntimeSnapshot && (isProjectExecutionActive(projectRuntimeDisplay) ||
      Boolean(projectRuntimeDisplay?.active_subagents?.length))) || hasPendingToolPermission;
  const scheduleRuntimeRefresh = useProjectRuntimeRefresh({
    projectId,
    enabled: authenticationStatus === 'authenticated',
    userId: currentUser?.id,
    isBusy: isExecutionBusy,
    loadRuntime: loadProjectRuntimeState,
    showWarning,
    timeoutMessage: translateBeeGame('livePreview.syncTimeoutMessage'),
    failureMessage: translateBeeGame('livePreview.syncFailedMessage'),
  });
  const isProjectWorkspaceMutationLocked = isProjectInteractionLocked || isProjectStarting || isExecutionBusy || deploymentInProgress;
  const canSendMessage = hasPermission('agent.send_message') && !isProjectInteractionLocked &&
    !isProjectStarting && !isStopping && !hasPendingToolPermission && !deploymentInProgress;
  const canApproveTool = hasPermission('agent.approve_tool') && !isProjectInteractionLocked;
  const canManagePreview = hasPermission('preview.manage') && !isProjectWorkspaceMutationLocked;
  const canManageDeployment = hasPermission('deployment.manage') && !isProjectWorkspaceMutationLocked;
  const canUploadAssets = hasPermission('assets.upload') && !isProjectWorkspaceMutationLocked;
  const canExportProject = hasPermission('project.export');

  // Derived state machine based on Requirements: 4.2
  const currentStatus = useMemo(() => {
    const acceptance = projectStatus?.acceptance?.status;
    if (isOffline) return 'offline';
    if (!hasCurrentRuntimeSnapshot) return 'starting';
    if (hasPendingToolPermission || projectRuntimeDisplay?.phase === 'waiting_approval') return 'waiting_approval';
    if (isExecutionBusy) return 'running';
    if (isProjectStarting) return 'starting';
    if (acceptance === 'failed' || acceptance === 'blocked' || acceptance === 'stale') return 'paused';
    return deriveDashboardStatus({
      isOffline,
      isLoading,
      canContinue,
      hasWaitingPermission: waitingPermission.isWaitingStatus || hasPendingToolPermission,
      messages: displayMessages,
    });
  }, [
    projectStatus?.acceptance?.status,
    isOffline,
    hasCurrentRuntimeSnapshot,
    isLoading,
    isExecutionBusy,
    projectRuntimeDisplay?.phase,
    canContinue,
    hasPendingToolPermission,
    waitingPermission.isWaitingStatus,
    displayMessages,
    isProjectStarting,
  ]);

  const refreshPreviewStatus = async () => {
    await loadProjectRuntimeState(projectId);
  };

  const handleStartPreview = async () => {
    if (!canManagePreview || isProjectWorkspaceMutationLocked) return;
    // Let the Preview panel retain rejection details. A transient toast alone
    // made a rejected request look like a successful return to standby.
    await withProjectSyncTimeout(
      api.startProjectPreview(projectId),
      translateBeeGame('livePreview.syncTimeoutMessage'),
    );
    setPreviewRefreshNonce(value => value + 1);
    await refreshPreviewStatus();
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

  const handleDeployProject = async (confirmation?: BeeGameDeploymentDiscussionConfirmation) => {
    if (!canManageDeployment || isDeployingProject || isProjectWorkspaceMutationLocked) return;
    setDeployingProject(true);
    try {
      const deployment = await api.deployProject(projectId, confirmation);
      setDeploymentHistory(current => upsertDeploymentHistory(current, deployment));
      const refreshed = await refreshDeploymentHistory();
      if (!refreshed.some(item => item.id === deployment.id)) {
        setDeploymentHistory(current => upsertDeploymentHistory(current, deployment));
      }
      if (deployment.status === 'failed') {
        throw new Error(deployment.message || 'Deployment failed');
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
      throw error;
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

  useEffect(() => {
    if (!isOpeningProject && !isSyncing) return undefined;
    const timeoutId = setTimeout(() => {
      showWarning(translateBeeGame('livePreview.syncTimeoutMessage'));
    }, PROJECT_SYNC_TIMEOUT_MS);
    return () => clearTimeout(timeoutId);
  }, [isOpeningProject, isSyncing, showWarning, translateBeeGame]);

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
    return getProjectDisplayName({ root_path: activeProject?.root_path, name: projectName }, translateBeeGame('untitledProject'));
  }, [activeProject?.root_path, projectName, translateBeeGame]);

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
    <div className={`${isDark ? 'dark' : ''} page-enter h-full w-full overflow-hidden bg-background font-sans text-foreground`}>
      <BeeGameLivePreviewPage
        projectId={projectId}
        lang={lang}
        projectName={displayProjectName}
        status={currentStatus === 'idle' ? 'idle' : (currentStatus as DashboardStatus)}
        phaseLabel={phaseLabel}
        credits={creditSummary}
        accountCreditBalance={creditBalance}
        isSyncing={isSyncing}
        isInteractionLocked={isProjectInteractionLocked}
        isWorkspaceBusy={isProjectWorkspaceMutationLocked}
        isAgentWorking={isExecutionBusy}
        buildReport={projectStatus?.build_report || null}
        projectTarget={projectTargetLabel}
        tokenUsage={liveSessionTokenUsage ?? settledProjectTokenUsage}
        tokenUsageScope={liveSessionTokenUsage ? 'session' : 'project'}
        settledProjectTokens={liveSessionTokenUsage ? creditSummary?.totalTokens : undefined}
        projectCreatedAt={activeProject?.created_at}
        deployments={deploymentHistory}
        previewRefreshNonce={previewRefreshNonce}
        onStartPreview={canManagePreview ? handleStartPreview : undefined}
        onStopPreview={canManagePreview ? handleStopPreview : undefined}
        onDeployProject={canManageDeployment ? handleDeployProject : undefined}
        onRollbackDeployment={canManageDeployment ? handleRollbackDeployment : undefined}
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
        onFixConsoleError={canSendMessage ? message => {
          const safeMessage = filterPathsForDisplay(message);
          const prompt = translateBeeGame('livePreview.fixConsoleEntryPrompt', { consoleLog: safeMessage });
          return sendMessage(prompt);
        } : undefined}
        isDeploying={isDeployingProject || deploymentInProgress}
        onOpenExternal={url => window.open(url, '_blank', 'noopener,noreferrer')}
        onBack={onBack}
        onSetLang={onSetLang}
        collaboration={
          <RightSidebar

        projectId={projectId}
        lang={lang}
        messages={displayMessages}
        progress={progressPercent}
        onSendMessage={async (message, attachments?: ChatAttachmentPayload[], supersedesMessageId?: string) => {
          if (!canSendMessage) return false;
          return sendMessage(message, undefined, attachments, supersedesMessageId);
        }}
        isLoading={isLoading}
        onStopTask={stopTask}
        isStopping={isStopping}
        isRuntimeBusy={isExecutionBusy}
        onResolveToolPermission={hasPendingToolPermission && canApproveTool && !isProjectInteractionLocked ? resolveToolPermission : undefined}
        permissionState={permissionState}
        pendingPermissions={permissionDisplayModels}
        projectStatus={projectRuntimeDisplay}
        waitingPermission={waitingPermission}
        canSendMessage={canSendMessage}
        canApproveTool={canApproveTool}
        canUploadAssets={canUploadAssets}
        canExportProject={canExportProject}
        currentUserDisplayName={currentUser?.displayName}
        currentUserEmail={currentUser?.email}
        currentUserAvatarUrl={currentUser?.avatarUrl}
          />
        }
      />
    </div>
  );
}
