import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
import {
    getCreditSummary,
    type BeeGameCreditQuote,
    type BeeGameCreditSummary,
    type BeeGameCreditTaskType,
} from '../../services/creditsApi';

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

const BEEGAME_TURN_LABELS: Record<Language, Record<string, string>> = {
    zh: {
        running: '构建中',
        waiting_approval: '等待确认',
        paused: '需要处理',
        offline: '离线',
        finished: '待复核',
        idle: '就绪',
    },
    'zh-TW': {
        running: '建構中',
        waiting_approval: '等待確認',
        paused: '需要處理',
        offline: '離線',
        finished: '待複核',
        idle: '就緒',
    },
    en: {
        running: 'Working',
        waiting_approval: 'Waiting for approval',
        paused: 'Needs attention',
        offline: 'Offline',
        finished: 'Ready for review',
        idle: 'Ready',
    },
    ja: {
        running: '作業中',
        waiting_approval: '確認待ち',
        paused: '対応が必要',
        offline: 'オフライン',
        finished: 'レビュー待ち',
        idle: '準備完了',
    },
    ko: {
        running: '작업 중',
        waiting_approval: '확인 대기',
        paused: '확인 필요',
        offline: '오프라인',
        finished: '검토 대기',
        idle: '준비됨',
    },
    fr: {
        running: 'En cours',
        waiting_approval: 'En attente',
        paused: 'Action requise',
        offline: 'Hors ligne',
        finished: 'A relire',
        idle: 'Pret',
    },
    de: {
        running: 'In Arbeit',
        waiting_approval: 'Wartet',
        paused: 'Aktion nötig',
        offline: 'Offline',
        finished: 'Zur Prüfung',
        idle: 'Bereit',
    },
    es: {
        running: 'Trabajando',
        waiting_approval: 'Esperando',
        paused: 'Requiere atención',
        offline: 'Sin conexión',
        finished: 'Listo para revisar',
        idle: 'Listo',
    },
    it: {
        running: 'In corso',
        waiting_approval: 'In attesa',
        paused: 'Richiede attenzione',
        offline: 'Offline',
        finished: 'Da rivedere',
        idle: 'Pronto',
    },
    pt: {
        running: 'Trabalhando',
        waiting_approval: 'Aguardando',
        paused: 'Requer atenção',
        offline: 'Offline',
        finished: 'Pronto para revisar',
        idle: 'Pronto',
    },
};

const getBeeGameTurnLabel = (status: string, lang: Language): string => {
    const labels = BEEGAME_TURN_LABELS[lang] || BEEGAME_TURN_LABELS.en;
    return labels[status] || BEEGAME_TURN_LABELS.en[status] || BEEGAME_TURN_LABELS.en.idle;
};

const getModelDisplayName = (config?: ModelConfig): string => {
    if (!config) return '';
    return config.models.balanced || config.models.strong || config.models.fast || config.name || '';
};

export function DashboardView({ projectId, projectName, lang, onSetLang, onBack, initialPrompt }: DashboardViewProps) {
    const [initialGateStateReady, setInitialGateStateReady] = useState(false);
    const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);
    const [creditQuote, setCreditQuote] = useState<BeeGameCreditQuote | null>(null);
    const [creditSummary, setCreditSummary] = useState<BeeGameCreditSummary | null>(null);
    const hasSentInitialPrompt = useRef(false);
    const creditQuoteResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
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
        void refreshCreditSummary();
    }, [projectId, refreshCreditSummary]);

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
            return getBeeGameTurnLabel(currentStatus, lang);
        }
        const phaseName = String(phaseInfo?.phase_name || savedRuntimeSnapshot?.phase_name || '').trim();
        const labels = BEEGAME_PHASE_LABELS[lang] || BEEGAME_PHASE_LABELS.en;
        if (!phaseName) return labels.idea_intake;
        return labels[phaseName] || BEEGAME_PHASE_LABELS.en[phaseName] || fallbackPhaseLabel(phaseName);
    }, [currentStatus, isBeeGameMode, phaseInfo?.phase_name, savedRuntimeSnapshot?.phase_name, lang]);

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
                onSendMessage={(message, taskType?: BeeGameCreditTaskType) =>
                    sendMessage(message, undefined, taskType)
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
    const isZh = lang === 'zh' || lang === 'zh-TW';
    const settlementNote = isZh
        ? '修改、继续任务和资源集成也会计费；实际扣费以本轮 token 和工具使用为准，未使用部分自动退回。'
        : 'Edits, continue requests, and asset integrations also use credits. Final billing is based on this turn’s actual token and tool usage, and unused credits are refunded automatically.';
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-6 backdrop-blur-md">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="beegame-credit-quote-title"
                className="w-full max-w-xl rounded-[36px] border border-white/20 bg-zinc-950/80 p-8 text-white shadow-2xl shadow-black/50 backdrop-blur-2xl"
            >
                <div className="text-xs font-black uppercase tracking-[0.45em] text-amber-300">
                    Credits
                </div>
                <h2 id="beegame-credit-quote-title" className="mt-4 text-3xl font-black">
                    {isZh ? '确认本次请求' : 'Confirm request'}
                </h2>
                <p className="mt-4 text-lg leading-relaxed text-zinc-300">
                    {isZh
                        ? `本次请求将预扣 ${quote.reservedCredits} credits。完成后按实际消耗结算，未使用部分会自动退回。`
                        : `This request will reserve ${quote.reservedCredits} credits. It will settle against actual usage, and unused credits will be refunded.`}
                </p>
                <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-5">
                    <div className="text-sm font-bold uppercase tracking-[0.28em] text-zinc-500">
                        {quote.displayName}
                    </div>
                    {quote.description ? (
                        <div className="mt-2 text-sm leading-relaxed text-zinc-400">
                            {quote.description}
                        </div>
                    ) : null}
                    <div className="mt-3 flex items-end justify-between gap-4">
                        <div>
                            <div className="text-sm text-zinc-500">
                                {isZh ? '当前余额' : 'Balance'}
                            </div>
                            <div className="mt-1 text-2xl font-black text-emerald-200">
                                {quote.balanceCredits} credits
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-sm text-zinc-500">
                                {isZh ? '预扣' : 'Reserved'}
                            </div>
                            <div className="mt-1 text-2xl font-black text-white">
                                {quote.reservedCredits} credits
                            </div>
                        </div>
                    </div>
                </div>
                <p className="mt-5 rounded-3xl border border-amber-300/15 bg-amber-300/[0.06] px-5 py-4 text-sm font-semibold leading-relaxed text-amber-100">
                    {settlementNote}
                </p>
                <div className="mt-8 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="rounded-full border border-white/15 px-6 py-3 text-sm font-black text-zinc-200 transition hover:bg-white/10"
                    >
                        {isZh ? '取消' : 'Cancel'}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="rounded-full bg-white px-7 py-3 text-sm font-black text-zinc-950 transition hover:bg-zinc-200"
                    >
                        {isZh ? '确认并发送' : 'Confirm and send'}
                    </button>
                </div>
            </div>
        </div>
    );
}
