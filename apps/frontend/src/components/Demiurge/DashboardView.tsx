import { useState, useEffect, useRef, useMemo } from 'react';
import { useSystemStore } from '../../store/systemStore';
import { useProjectStore } from '../../store/projectStore';
import { useChatStore } from '../../store/chatStore';
import { useChat } from '../../hooks/useChat';
import { useToast } from '../../hooks/useToast';
import type { Language } from './AgentsConfig';

import { TopBar } from './TopBar';
import { SideMenu } from './SideMenu';
import { CanvasView } from './CanvasView';
import { RightSidebar } from './RightSidebar';
import type { ProjectTask } from '../../store/systemStore';
import type { PendingUserReviewItem } from '../../services/api';
import { deriveDashboardStatus, getWaitingApprovalState } from '../../utils/waitingApproval';
import { deriveGlobalWorkflowProgress, GLOBAL_WORKFLOW_PHASES } from '../../utils/workflowProgress';
import { toChatDisplayMessages, toProjectRuntimeDisplayModel, toReviewDisplayModels } from '../../viewModels/displayModels';
import { isBeeGameAdapterEnabled } from '../../services/beeGameAdapter';

interface DashboardViewProps {
    projectId: string;
    projectName: string;
    lang: Language;
    onSetLang: (lang: Language) => void;
    initialPrompt?: string;
}

export function DashboardView({ projectId, projectName, lang, onSetLang, initialPrompt }: DashboardViewProps) {
    const [initialGateStateReady, setInitialGateStateReady] = useState(false);
    const hasSentInitialPrompt = useRef(false);
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isBeeGameMode = isBeeGameAdapterEnabled();

    // Zustand State
    const {
        tokenUsage,
        phaseInfo,
        loadPhases,
        loadTokenUsage,
        agents,
        loadAgents,
        tasks,
        loadTasks,
        lastP2PRoute,
        isSyncing,
        status,
        isDark,
        toggleTheme
    } = useSystemStore();
    const { pendingReviews, projectStatus, runtimeReadiness, loadPendingReviews, loadProjectStatus, loadSystemReadiness } = useProjectStore();
    const { messages, currentSender, isStreaming } = useChatStore();
    const { showSuccess, showError } = useToast();

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
                    loadPhases(projectId);
                    loadTokenUsage(projectId).catch(console.error);
                    loadTasks(projectId).catch(console.error);
                    loadAgents().catch(console.error);
                    loadPendingReviews(projectId).catch(console.error);
                    loadProjectStatus(projectId).catch(console.error);
                    refreshTimerRef.current = null;
                }, 2000);
            }
        }
    });

    useEffect(() => {
        hasSentInitialPrompt.current = false;
        setInitialGateStateReady(false);
    }, [projectId]);

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
    const waitingApproval = useMemo(
        () => getWaitingApprovalState(projectRuntimeDisplay, reviewDisplayModels),
        [projectRuntimeDisplay, reviewDisplayModels],
    );

    // Auto-Send Initial Prompt
    useEffect(() => {
        if (initialPrompt && !hasSentInitialPrompt.current && projectId && initialGateStateReady && !waitingApproval.isBlockingChat) {
            hasSentInitialPrompt.current = true;
            // Fire the initial prompt as the first message
            sendMessage(initialPrompt).catch(console.error);
        }
    }, [initialPrompt, projectId, sendMessage, initialGateStateReady, waitingApproval.isBlockingChat]);

    const hasUnfinishedTasks = useMemo(() => tasks.some((t) => {
        const status = canonicalTaskStatus(t);
        return status !== 'released' && status !== 'failed' && status !== 'invalidated' && status !== 'expired';
    }), [tasks]);
    const isPipelineActive = useMemo(() => {
        const nextAction = String(projectStatus?.next_action || '').toLowerCase();
        const phase = String(projectStatus?.phase || '').toLowerCase();
        return ['pending', 'running', 'clarification_required'].includes(nextAction)
            || nextAction.includes('pipeline_running')
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

    // Poll Telemetry Phases & System Agents & Tasks & Pending Reviews
    useEffect(() => {
        if (!projectId) return;

        // Force initial load of pending reviews
        Promise.allSettled([
            loadPendingReviews(projectId),
            loadProjectStatus(projectId),
            loadSystemReadiness(),
            loadPhases(projectId),
            loadAgents(),
            loadTasks(projectId),
        ]).finally(() => setInitialGateStateReady(true));
        loadTokenUsage(projectId).catch(console.error);

        // Optimized polling: skip when document is hidden OR when task is in terminal state
        const poll = () => {
            if (document.hidden) return;
            
            // Only poll frequently if we are running or have unfinished tasks
            if (currentStatus === 'running' || hasUnfinishedTasks || isPipelineActive) {
                loadPhases(projectId);
                loadTokenUsage(projectId).catch(console.error);
                loadAgents().catch(console.error);
                loadTasks(projectId).catch(console.error);
                loadPendingReviews(projectId).catch(console.error);
                loadProjectStatus(projectId).catch(console.error);
            }
        };

        // Setup polling every 10 seconds while project is active
        const interval = setInterval(poll, 10000);

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
    }, [projectId, loadPhases, loadTokenUsage, loadAgents, loadTasks, loadPendingReviews, loadProjectStatus, loadSystemReadiness, currentStatus, hasUnfinishedTasks, isPipelineActive]);

    // Calculate progress across the full idea-to-playable workflow.
    const progressPercent = useMemo(() => {
        return deriveGlobalWorkflowProgress({
            phaseInfo,
            currentStatus,
            messages,
        });
    }, [phaseInfo, currentStatus, messages]);

    const phaseLabel = useMemo(() => {
        const phaseName = String(phaseInfo?.phase_name || '').trim();
        if (!phaseName) return 'Idea Intake';
        const labels: Record<string, string> = {
            idea_intake: 'Idea Intake',
            brief: 'Build Brief',
            gdd: 'Playable Spec',
            architecture: 'Architecture',
            art_direction: 'Art Direction',
            ui: 'UI',
            asset: 'Assets',
            implementation: 'Implementation',
            qa: 'Playability Review',
            polish: 'Polish',
            build: 'Build/Preview',
        };
        return labels[phaseName] || phaseName.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    }, [phaseInfo?.phase_name]);

    // Derive agent active states
    const agentStatuses = useMemo(() => {
        const statuses: Record<string, string> = {};
        agents.forEach(a => {
            statuses[a.id.toLowerCase()] = a.status;
        });

        const normalizedActiveAgentId = currentSender?.toLowerCase() || null;
        if (normalizedActiveAgentId && isStreaming) {
            statuses[normalizedActiveAgentId] = 'working';
        }
        return statuses;
    }, [agents, currentSender, isStreaming]);

    const normalizedActiveAgentId = currentSender?.toLowerCase() || null;

    const commFlow = useMemo(() => {
        const flow = [];
        if (messages.length > 0 && normalizedActiveAgentId) {
            const lastDifferentMessage = [...messages].reverse().find(m => m.sender.toLowerCase() !== normalizedActiveAgentId);
            const from = lastDifferentMessage ? lastDifferentMessage.sender.toLowerCase() : 'user';

            if (from !== normalizedActiveAgentId) {
                const isP2P = lastP2PRoute &&
                    lastP2PRoute.source_agent.toLowerCase() === from &&
                    lastP2PRoute.target_agent.toLowerCase() === normalizedActiveAgentId;

                flow.push({
                    from,
                    to: normalizedActiveAgentId,
                    id: messages[messages.length - 1].timestamp || Date.now(),
                    isP2P: !!isP2P
                });
            }
        }
        return flow;
    }, [messages, normalizedActiveAgentId, lastP2PRoute]);

    // Logging Token Usage and Progress
    useEffect(() => {
        const projectTokenUsage = tokenUsage[projectId] || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        console.log(`[DashboardView] Project: ${projectId} | Token Usage:`, projectTokenUsage);
        console.log(`[DashboardView] Project Progress: ${progressPercent.toFixed(2)}% (Phase: ${phaseInfo?.phase_name || 'idea_intake'}/${GLOBAL_WORKFLOW_PHASES.length})`);
    }, [projectId, tokenUsage, progressPercent, phaseInfo]);

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
            showError(waitingApproval.message || '当前项目正在等待审批，不能继续执行普通消息。');
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

    const handleOpenOperatorControls = () => {
        const params = new URLSearchParams({
            project_id: projectId,
            project_name: projectName,
            lang,
        });
        window.open(`/operator-controls?${params.toString()}`, '_blank', 'noopener,noreferrer');
    };

    const canOpenOperatorControls = Boolean(status?.capabilities?.operator_controls_enabled && status?.capabilities?.stage_control_enabled);

    return (
        <div className={`${isDark ? 'dark' : ''} h-screen w-full flex overflow-hidden font-sans bg-zinc-50 dark:bg-zinc-950 transition-colors duration-700`}>
            <TopBar
                projectName={projectName}
                lang={lang}
                status={currentStatus === 'idle' ? 'idle' : (currentStatus as any)}
                progress={progressPercent}
                tokens={tokenUsage[projectId]?.total_tokens || 0}
                isSyncing={isSyncing}
                onRename={handleRename}
                mode={isBeeGameMode ? 'beegame' : 'demiurge'}
                phaseLabel={isBeeGameMode ? phaseLabel : undefined}
            />

            <SideMenu
                status={currentStatus === 'offline' ? 'stopped' : currentStatus}
                lang={lang}
                isDark={isDark}
                onToggleStatus={handleToggleStatus}
                onSetLang={onSetLang}
                onToggleTheme={toggleTheme}
                onNewProject={handleNewProject}
                canOpenOperatorControls={canOpenOperatorControls}
                onOpenOperatorControls={handleOpenOperatorControls}
            />

            <CanvasView
                isDark={isDark}
                activeAgentId={normalizedActiveAgentId}
                agentStatuses={agentStatuses}
                commFlow={commFlow}
                mode={isBeeGameMode ? 'beegame' : 'demiurge'}
                status={currentStatus === 'idle' ? 'idle' : (currentStatus as any)}
                hasPendingPermission={hasPendingPlanReview}
            />

            <RightSidebar
                projectId={projectId}
                lang={lang}
                messages={displayMessages}
                progress={progressPercent}
                onSendMessage={sendMessage}
                isLoading={isLoading}
                onApprovePlan={hasPendingPlanReview ? approvePlan : undefined}
                approvalState={approvalState}
                pendingReviews={reviewDisplayModels}
                projectStatus={projectRuntimeDisplay}
                runtimeReadiness={runtimeReadiness}
                onUploadManifestCsv={uploadManifestCsv}
                onApproveManifest={approveManifest}
                waitingApproval={waitingApproval}
            />
        </div>
    );
}
