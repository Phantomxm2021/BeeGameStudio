import { useState, useEffect, useRef, useMemo } from 'react';
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
import type { PendingUserReviewItem } from '../../services/api';
import { api } from '../../services/api';
import { deriveDashboardStatus, getWaitingApprovalState } from '../../utils/waitingApproval';
import { deriveGlobalWorkflowProgress } from '../../utils/workflowProgress';
import { toChatDisplayMessages, toProjectRuntimeDisplayModel, toReviewDisplayModels } from '../../viewModels/displayModels';
import { isBeeGameAdapterEnabled } from '../../services/beeGameAdapter';
import { listModelConfigs, type ModelConfig } from '../../services/modelConfigApi';

interface DashboardViewProps {
    projectId: string;
    projectName: string;
    lang: Language;
    onSetLang: (lang: Language) => void;
    onBack?: () => void;
    initialPrompt?: string;
}

const BEEGAME_PHASE_LABELS: Record<Language, Record<string, string>> = {
    zh: {
        idea_intake: '需求理解',
        brief: '构建方案',
        gdd: '可玩规格',
        architecture: '技术架构',
        art_direction: '美术方向',
        ui: '交互界面',
        asset: '资源准备',
        implementation: '实现构建',
        qa: '可玩性检查',
        polish: '打磨优化',
        build: '构建预览',
    },
    'zh-TW': {
        idea_intake: '需求理解',
        brief: '建構方案',
        gdd: '可玩規格',
        architecture: '技術架構',
        art_direction: '美術方向',
        ui: '互動介面',
        asset: '資源準備',
        implementation: '實作建構',
        qa: '可玩性檢查',
        polish: '打磨優化',
        build: '建構預覽',
    },
    en: {
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
        build: 'Build Preview',
    },
    ja: {
        idea_intake: '要件整理',
        brief: '制作概要',
        gdd: 'プレイ仕様',
        architecture: '技術設計',
        art_direction: 'アート方針',
        ui: 'UI',
        asset: 'アセット準備',
        implementation: '実装',
        qa: 'プレイ確認',
        polish: '仕上げ',
        build: 'ビルド確認',
    },
    ko: {
        idea_intake: '요구 이해',
        brief: '제작 개요',
        gdd: '플레이 사양',
        architecture: '기술 설계',
        art_direction: '아트 방향',
        ui: 'UI',
        asset: '에셋 준비',
        implementation: '구현',
        qa: '플레이 검수',
        polish: '마무리',
        build: '빌드 미리보기',
    },
    fr: {
        idea_intake: 'Cadrage',
        brief: 'Brief de création',
        gdd: 'Spécification jouable',
        architecture: 'Architecture',
        art_direction: 'Direction artistique',
        ui: 'Interface',
        asset: 'Ressources',
        implementation: 'Implémentation',
        qa: 'Revue jouable',
        polish: 'Finition',
        build: 'Build aperçu',
    },
    de: {
        idea_intake: 'Ideenklärung',
        brief: 'Build-Brief',
        gdd: 'Spielbare Spezifikation',
        architecture: 'Architektur',
        art_direction: 'Art Direction',
        ui: 'UI',
        asset: 'Assets',
        implementation: 'Implementierung',
        qa: 'Spielbarkeitsprüfung',
        polish: 'Feinschliff',
        build: 'Build-Vorschau',
    },
    es: {
        idea_intake: 'Definición',
        brief: 'Brief de construcción',
        gdd: 'Especificación jugable',
        architecture: 'Arquitectura',
        art_direction: 'Dirección artística',
        ui: 'Interfaz',
        asset: 'Recursos',
        implementation: 'Implementación',
        qa: 'Revisión jugable',
        polish: 'Pulido',
        build: 'Vista previa',
    },
    it: {
        idea_intake: 'Definizione',
        brief: 'Brief di costruzione',
        gdd: 'Specifica giocabile',
        architecture: 'Architettura',
        art_direction: 'Direzione artistica',
        ui: 'Interfaccia',
        asset: 'Asset',
        implementation: 'Implementazione',
        qa: 'Revisione giocabilità',
        polish: 'Rifinitura',
        build: 'Anteprima build',
    },
    pt: {
        idea_intake: 'Entendimento',
        brief: 'Brief de construção',
        gdd: 'Especificação jogável',
        architecture: 'Arquitetura',
        art_direction: 'Direção de arte',
        ui: 'Interface',
        asset: 'Recursos',
        implementation: 'Implementação',
        qa: 'Revisão jogável',
        polish: 'Polimento',
        build: 'Prévia da build',
    },
};

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

export function DashboardView({ projectId, projectName, lang, onSetLang, onBack, initialPrompt }: DashboardViewProps) {
    const [initialGateStateReady, setInitialGateStateReady] = useState(false);
    const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);
    const hasSentInitialPrompt = useRef(false);
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const runtimeSnapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastPersistedRuntimeSnapshotRef = useRef('');
    const isBeeGameMode = isBeeGameAdapterEnabled();

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
        status,
        isDark,
        toggleTheme,
        hasPermission,
    } = useSystemStore();
    const { projects, pendingReviews, projectStatus, runtimeReadiness, loadPendingReviews, loadProjectStatus, loadSystemReadiness } = useProjectStore();
    const { messages } = useChatStore();
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

    const hasUnfinishedTasks = useMemo(() => tasks.some((t) => {
        const status = canonicalTaskStatus(t);
        return status !== 'released' && status !== 'failed' && status !== 'invalidated' && status !== 'expired';
    }), [tasks]);
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
    }, [projectId, loadPhases, loadTokenUsage, loadAgents, loadTasks, loadPendingReviews, loadProjectStatus, loadSystemReadiness, currentStatus, hasUnfinishedTasks, isPipelineActive]);

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
        const phaseName = String(phaseInfo?.phase_name || savedRuntimeSnapshot?.phase_name || '').trim();
        const labels = BEEGAME_PHASE_LABELS[lang] || BEEGAME_PHASE_LABELS.en;
        if (!phaseName) return labels.idea_intake;
        return labels[phaseName] || BEEGAME_PHASE_LABELS.en[phaseName] || fallbackPhaseLabel(phaseName);
    }, [phaseInfo?.phase_name, savedRuntimeSnapshot?.phase_name, lang]);

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

    useEffect(() => {
        if (!isBeeGameMode || !projectId) return;
        const usage = {
            prompt_tokens: Math.max(
                Number(tokenUsage[projectId]?.prompt_tokens) || 0,
                Number(projectStatus?.context?.token_budget?.prompt_tokens) || 0,
                Number(savedRuntimeSnapshot?.usage?.prompt_tokens) || 0,
            ),
            completion_tokens: Math.max(
                Number(tokenUsage[projectId]?.completion_tokens) || 0,
                Number(projectStatus?.context?.token_budget?.completion_tokens) || 0,
                Number(savedRuntimeSnapshot?.usage?.completion_tokens) || 0,
            ),
            total_tokens: displayedTokenTotal,
        };
        const phaseName = String(phaseInfo?.phase_name || savedRuntimeSnapshot?.phase_name || '').trim();
        const modelConfigId = String(projectStatus?.model_config_id || savedRuntimeSnapshot?.model_config_id || '').trim();
        const modelName = String(currentModelName || savedRuntimeSnapshot?.model_name || '').trim();
        if (!phaseName && !modelConfigId && !modelName && usage.total_tokens <= 0) return;

        const snapshot = {
            usage,
            ...(phaseName ? { phase_name: phaseName } : {}),
            ...(modelConfigId ? { model_config_id: modelConfigId } : {}),
            ...(modelName ? { model_name: modelName } : {}),
            updated_at: Date.now(),
        };
        const snapshotKey = JSON.stringify({
            usage,
            phase_name: phaseName,
            model_config_id: modelConfigId,
            model_name: modelName,
        });
        if (snapshotKey === lastPersistedRuntimeSnapshotRef.current) return;
        if (runtimeSnapshotTimerRef.current) clearTimeout(runtimeSnapshotTimerRef.current);
        runtimeSnapshotTimerRef.current = setTimeout(() => {
            lastPersistedRuntimeSnapshotRef.current = snapshotKey;
            useProjectStore.getState().persistProjectRuntimeSnapshot(projectId, snapshot).catch((error) => {
                lastPersistedRuntimeSnapshotRef.current = '';
                console.error('Failed to persist project runtime snapshot:', error);
            });
            runtimeSnapshotTimerRef.current = null;
        }, 1200);
        return () => {
            if (runtimeSnapshotTimerRef.current) {
                clearTimeout(runtimeSnapshotTimerRef.current);
                runtimeSnapshotTimerRef.current = null;
            }
        };
    }, [
        currentModelName,
        displayedTokenTotal,
        isBeeGameMode,
        phaseInfo?.phase_name,
        projectId,
        projectStatus?.context?.token_budget?.completion_tokens,
        projectStatus?.context?.token_budget?.prompt_tokens,
        projectStatus?.model_config_id,
        savedRuntimeSnapshot?.model_config_id,
        savedRuntimeSnapshot?.model_name,
        savedRuntimeSnapshot?.phase_name,
        savedRuntimeSnapshot?.usage?.completion_tokens,
        savedRuntimeSnapshot?.usage?.prompt_tokens,
        tokenUsage,
    ]);

    // Logging Token Usage and Progress
    useEffect(() => {
        const projectTokenUsage = tokenUsage[projectId] || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        console.log(`[DashboardView] Project: ${projectId} | Token Usage:`, projectTokenUsage);
        console.log(`[DashboardView] Project Progress: ${progressPercent.toFixed(2)}% (Phase: ${phaseInfo?.phase_name || 'idle'})`);
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
                    canOpenOperatorControls={canOpenOperatorControls}
                    onOpenOperatorControls={handleOpenOperatorControls}
                />
            ) : null}

            <BeeGameLivePreviewPage
                lang={lang}
                projectName={displayProjectName}
                status={currentStatus === 'idle' ? 'idle' : (currentStatus as any)}
                phaseLabel={phaseLabel}
                tokens={displayedTokenTotal}
                modelName={currentModelName}
                isSyncing={isSyncing}
                buildReport={projectStatus?.build_report || null}
                onStartPreview={canManagePreview ? handleStartPreview : undefined}
                onRestartPreview={canManagePreview ? handleRestartPreview : undefined}
                onStopPreview={canManagePreview ? handleStopPreview : undefined}
                onOpenExternal={(url) => window.open(url, '_blank', 'noopener,noreferrer')}
                onBack={onBack}
                onSetLang={onSetLang}
            />

            <RightSidebar
                projectId={projectId}
                lang={lang}
                messages={displayMessages}
                progress={progressPercent}
                onSendMessage={sendMessage}
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
            />
        </div>
    );
}
