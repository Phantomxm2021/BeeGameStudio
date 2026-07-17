import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DashboardView } from './DashboardView';
import type { ProjectBaselineStatusPayload } from '../../services/api';

const loadPhases = vi.fn().mockResolvedValue(undefined);
const loadTokenUsage = vi.fn().mockResolvedValue(undefined);
const loadAgents = vi.fn().mockResolvedValue(undefined);
const loadTasks = vi.fn().mockResolvedValue(undefined);
const loadPendingReviews = vi.fn().mockResolvedValue(undefined);
const loadProjectStatus = vi.fn().mockResolvedValue(undefined);
const loadSystemReadiness = vi.fn().mockResolvedValue(undefined);
const loadCurrentUser = vi.fn().mockResolvedValue(undefined);
const setIsSyncing = vi.fn();
const setActiveProject = vi.fn().mockResolvedValue(undefined);
const toggleTheme = vi.fn();
const showSuccess = vi.fn();
const showError = vi.fn();
const showWarning = vi.fn();
const stopTask = vi.fn();
const sendMessage = vi.fn();
const apiMocks = vi.hoisted(() => ({
    getProjectPreviewAccess: vi.fn(),
    startProjectPreview: vi.fn().mockResolvedValue({}),
    restartProjectPreview: vi.fn().mockResolvedValue({}),
    stopProjectPreview: vi.fn().mockResolvedValue({}),
    listProjectDeployments: vi.fn().mockResolvedValue([]),
    deployProject: vi.fn().mockResolvedValue({
        id: 'deploy_1',
        sessionId: 'beegame_proj_1',
        workspacePath: '/tmp/Projects/project-one',
        status: 'succeeded',
        url: 'https://games.example.com/project-one/',
        buildCommand: 'deploy',
        createdAt: '2026-06-21T00:00:00.000Z',
        updatedAt: '2026-06-21T00:00:00.000Z',
        deployedAt: '2026-06-21T00:00:00.000Z',
    }),
    rollbackProjectDeployment: vi.fn().mockResolvedValue({
        id: 'deploy_rollback',
        sessionId: 'beegame_proj_1',
        workspacePath: '/tmp/Projects/project-one',
        status: 'succeeded',
        url: 'https://games.example.com/project-one/previous/',
        message: 'Restored from deployment deploy_previous',
        createdAt: '2026-06-21T00:00:00.000Z',
        updatedAt: '2026-06-21T00:00:00.000Z',
        deployedAt: '2026-06-21T00:00:00.000Z',
    }),
    requestProjectAction: vi.fn().mockResolvedValue({ task_id: 'beegame_proj_1', state: 'running' }),
}));
const status = {
    uptime: '1m',
    unity_connected: false,
    active_agents: 0,
    project_progress: 0,
    capabilities: {},
};

let capturedRightSidebarProps: Record<string, any> | null = null;
let capturedTopBarProps: Record<string, any> | null = null;
let capturedSideMenuProps: Record<string, any> | null = null;
let capturedUseChatOptions: Record<string, any> | null = null;
let mockedPhaseInfo = { current_phase: 0, phase_name: 'phase_0', history: [] as Array<{ phase: number; name: string; timestamp: number }> };
let mockedMessages: Array<{ id: string; sender: string; content: string; timestamp: number }> = [];
let mockedTokenUsage: Record<string, { prompt_tokens: number; completion_tokens: number; total_tokens: number }> = {};
let mockedIsSyncing = false;
let mockedIsOpeningProject = false;
let mockedAuthenticationStatus: 'authenticated' | 'anonymous' = 'authenticated';
let mockedProjectStatus: ProjectBaselineStatusPayload = {
    project_id: 'proj_1',
    phase: 'DESIGN_IN_PROGRESS',
    blocked: true,
    approval_required: true,
    project_target: { kind: 'web', engine: 'Web' },
    baseline: {
        artifact_id: 'art_1',
    },
};
let mockedProjects: Array<{ id: string; name: string; root_path?: string; created_at: number }> = [];
let mockedHasPermission = vi.fn(() => true);
let mockedCurrentUser: Record<string, any> | null = {
    id: 'user_1',
    displayName: 'Nova Player',
    email: 'nova@example.com',
    avatarUrl: '',
    permissions: [],
};

vi.mock('../../store/systemStore', () => ({
    useSystemStore: (selector?: (state: Record<string, any>) => unknown) => {
        const state = {
            status,
            tokenUsage: mockedTokenUsage,
            phaseInfo: mockedPhaseInfo,
            loadPhases,
            loadTokenUsage,
            agents: [],
            loadAgents,
            tasks: [],
            loadTasks,
            lastP2PRoute: null,
            isSyncing: mockedIsSyncing,
            isDark: true,
            toggleTheme,
            hasPermission: mockedHasPermission,
            currentUser: mockedCurrentUser,
            authenticationStatus: mockedAuthenticationStatus,
            loadCurrentUser,
            setIsSyncing,
        };
        return selector ? selector(state) : state;
    },
}));

vi.mock('../../contexts/ToastContext', () => ({
    useToastContext: () => ({
        showSuccess: showSuccess,
        showError: showError,
        showInfo: vi.fn(),
        showWarning,
        dismissToast: vi.fn(),
        clearToasts: vi.fn(),
    }),
}));

vi.mock('../../store/projectStore', () => ({
    useProjectStore: Object.assign(
        () => ({
            projects: mockedProjects,
            pendingReviews: [
                {
                    gate_id: 'gate_human_review',
                    type: 'DOCUMENT_APPROVAL_REVIEW',
                    review_status: {
                        workflow_id: 'review_flow',
                    },
                },
            ],
            projectStatus: mockedProjectStatus,
            runtimeReadiness: null,
            isOpeningProject: mockedIsOpeningProject,
            loadPendingReviews,
            loadProjectStatus,
            loadProjectRuntimeState: async (projectId: string) => {
                await Promise.all([loadPendingReviews(projectId), loadProjectStatus(projectId)]);
            },
            loadSystemReadiness,
        }),
        {
            getState: () => ({
                setActiveProject,
            }),
        },
    ),
}));

vi.mock('../../store/chatStore', () => ({
    useChatStore: () => ({
        messages: mockedMessages,
        currentSender: null,
        isStreaming: false,
    }),
}));

vi.mock('../../hooks/useChat', () => ({
    useChat: (options: Record<string, any>) => {
        capturedUseChatOptions = options;
        return ({
        sendMessage,
        stopTask,
        continueTask: vi.fn(),
        approvePlan: vi.fn(),
        uploadManifestCsv: vi.fn(),
        approveManifest: vi.fn(),
        approvalState: {
            gateId: null,
            action: null,
            phase: 'idle',
            message: '',
        },
        isLoading: false,
        canContinue: true,
        wsState: 'connected',
    });
    },
}));

vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({
        showSuccess,
        showError,
        showWarning,
    }),
}));

vi.mock('../../services/api', () => ({
    api: {
        getProjectPreviewAccess: apiMocks.getProjectPreviewAccess,
        startProjectPreview: apiMocks.startProjectPreview,
        restartProjectPreview: apiMocks.restartProjectPreview,
        stopProjectPreview: apiMocks.stopProjectPreview,
        listProjectDeployments: apiMocks.listProjectDeployments,
        deployProject: apiMocks.deployProject,
        rollbackProjectDeployment: apiMocks.rollbackProjectDeployment,
        requestProjectAction: apiMocks.requestProjectAction,
    },
}));

vi.mock('../../services/creditsApi', () => ({
    getCreditBalance: vi.fn(() => Promise.resolve({
        userId: 'user_1',
        plan: 'free',
        balanceCredits: 162,
        includedCredits: 200,
        consumedCredits: 38,
        reservedCredits: 7,
        creditUnitWeightedTokens: 1000,
        estimates: {
            ideaIntake: { minCredits: 1, maxCredits: 2 },
            planningDocs: { minCredits: 2, maxCredits: 4 },
            smallPlayableGame: { minCredits: 4, maxCredits: 8 },
            standardGame: { minCredits: 8, maxCredits: 16 },
            complexGame: { minCredits: 16, maxCredits: 32 },
        },
    })),
    getCreditSummary: vi.fn(() => Promise.resolve({
        entriesCount: 3,
        reservedCredits: 50,
        settledCredits: 12,
        refundedCredits: 38,
        outstandingReservedCredits: 0,
        weightedTokens: 120000,
    })),
    getCreditLedger: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../services/currentUserApi', () => ({
    deleteCurrentUser: vi.fn(() => Promise.resolve({ ok: true })),
}));

vi.mock('../../services/supabaseAuthApi', () => ({
    clearSupabaseSession: vi.fn(),
    getSupabaseAccessToken: vi.fn(() => ''),
    getValidSupabaseAccessToken: vi.fn(() => Promise.resolve(null)),
    isHttpOnlySessionsEnabled: vi.fn(() => false),
    refreshSupabaseSession: vi.fn(() => Promise.resolve(null)),
    updateSupabaseAvatarUrl: vi.fn(() => Promise.resolve({ avatarUrl: 'https://cdn.example.com/avatar.png' })),
    uploadSupabaseAvatarImage: vi.fn(() => Promise.resolve('https://cdn.example.com/avatar.png')),
}));

vi.mock('../../services/beeGameAdapter', () => ({
    isBeeGameAdapterEnabled: vi.fn(() => true),
    getBeeGameWorkspaceSettings: vi.fn(() => Promise.resolve({ workspacePath: '/tmp/Projects', isDefault: true })),
    resetBeeGameWorkspaceRoot: vi.fn(() => Promise.resolve({ workspacePath: '/tmp/Projects', isDefault: true })),
    setBeeGameWorkspaceRoot: vi.fn((workspacePath: string) => ({ workspacePath, isDefault: false })),
}));

vi.mock('./TopBar', () => ({
    TopBar: (props: Record<string, any>) => {
        capturedTopBarProps = props;
        return <div data-testid="top-bar" />;
    },
}));

vi.mock('./SideMenu', () => ({
    SideMenu: (props: Record<string, any>) => {
        capturedSideMenuProps = props;
        return <div data-testid="side-menu" />;
    },
}));

vi.mock('./CanvasView', () => ({
    CanvasView: () => <div data-testid="canvas-view" />,
}));

vi.mock('./RightSidebar', () => ({
    RightSidebar: (props: Record<string, any>) => {
        capturedRightSidebarProps = props;
        return <div data-testid="right-sidebar" />;
    },
}));

describe('DashboardView runtime loading', () => {
    afterEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
        capturedRightSidebarProps = null;
        capturedTopBarProps = null;
        capturedSideMenuProps = null;
        capturedUseChatOptions = null;
        mockedPhaseInfo = { current_phase: 0, phase_name: 'phase_0', history: [] };
        mockedMessages = [];
        mockedTokenUsage = {};
        mockedIsSyncing = false;
        mockedIsOpeningProject = false;
        mockedAuthenticationStatus = 'authenticated';
        mockedProjectStatus = {
            project_id: 'proj_1',
            phase: 'DESIGN_IN_PROGRESS',
            blocked: true,
            approval_required: true,
            project_target: { kind: 'web', engine: 'Web' },
            baseline: {
                artifact_id: 'art_1',
            },
        };
        mockedProjects = [];
        mockedHasPermission = vi.fn(() => true);
        mockedCurrentUser = {
            id: 'user_1',
            displayName: 'Nova Player',
            email: 'nova@example.com',
            avatarUrl: '',
            permissions: [],
        };
        setActiveProject.mockReset();
        setActiveProject.mockResolvedValue(undefined);
        setIsSyncing.mockReset();
        showWarning.mockReset();
        loadPendingReviews.mockResolvedValue(undefined);
        loadProjectStatus.mockResolvedValue(undefined);
        loadSystemReadiness.mockResolvedValue(undefined);
        apiMocks.getProjectPreviewAccess.mockImplementation(async () => ({
            status: 'ready',
            accessUrl: String(mockedProjectStatus.build_report?.build_url || ''),
        }));
    });

    it('does not poll protected runtime state after authentication is lost', async () => {
        mockedAuthenticationStatus = 'anonymous';

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await act(async () => Promise.resolve());
        expect(loadProjectStatus).not.toHaveBeenCalled();
        expect(loadPendingReviews).not.toHaveBeenCalled();
    });

    it('loads runtime status immediately when mounted', async () => {
        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(loadProjectStatus).toHaveBeenCalledWith('proj_1'));

        expect(loadPendingReviews).toHaveBeenCalledWith('proj_1');
        expect(loadPhases).not.toHaveBeenCalled();
        expect(loadTasks).not.toHaveBeenCalled();
        expect(loadAgents).not.toHaveBeenCalled();
    });

    it('covers the dashboard while the server is starting the project runtime', async () => {
        mockedProjectStatus = {
            ...mockedProjectStatus,
            phase: 'starting',
            blocked: false,
            approval_required: false,
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const loadingCover = await screen.findByRole('status', { name: '正在启动项目' });
        expect(loadingCover).toHaveClass('fixed', 'inset-0', 'z-[200]');
        expect(loadingCover).toHaveTextContent('正在准备独立工作区与构建会话，很快就好。');
    });

    it('does not expose internal reset controls through the production sidebar', async () => {
        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedRightSidebarProps).not.toBeNull());

        expect(capturedRightSidebarProps).not.toHaveProperty('canResetGddApproval');
        expect(capturedRightSidebarProps).not.toHaveProperty('onResetGddApproval');
    });

    it('passes current user permissions to sidebar action gates', async () => {
        mockedHasPermission = vi.fn((permission: string) => (
            permission === 'agent.send_message' ||
            permission === 'assets.upload'
        ));

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedRightSidebarProps).not.toBeNull());

        expect(capturedRightSidebarProps?.canSendMessage).toBe(true);
        expect(capturedRightSidebarProps?.canApproveTool).toBe(false);
        expect(capturedRightSidebarProps?.canUploadAssets).toBe(true);
        expect(capturedRightSidebarProps?.canIntegrateAssets).toBe(false);
        expect(capturedRightSidebarProps?.canExportProject).toBe(false);
    });

    it('keeps BeeGame progress detached from legacy workflow phase telemetry', async () => {
        mockedPhaseInfo = {
            current_phase: 1,
            phase_name: 'brief',
            history: [{ phase: 1, name: 'brief', timestamp: 1_000 }],
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedRightSidebarProps).not.toBeNull());

        expect(capturedRightSidebarProps?.progress).toBeLessThan(20);
        await userEvent.hover(screen.getByTestId('beegame-project-info-trigger'));
        expect(screen.getByText('需要处理')).toBeInTheDocument();
        expect(screen.queryByText('构建方案')).not.toBeInTheDocument();
        expect(screen.queryByText('构建方案 · 0%')).not.toBeInTheDocument();
    });

    it('passes BeeGame turn state labels to the live preview header', async () => {
        mockedPhaseInfo = {
            current_phase: 3,
            phase_name: 'implementation',
            history: [
                { phase: 0, name: 'idea_intake', timestamp: 1_000 },
                { phase: 2, name: 'gdd', timestamp: 2_000 },
                { phase: 3, name: 'implementation', timestamp: 3_000 },
            ],
        };
        mockedProjectStatus = {
            ...mockedProjectStatus,
            phase: 'running',
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedRightSidebarProps).not.toBeNull());

        expect(screen.queryByTestId('top-bar')).not.toBeInTheDocument();
        expect(screen.queryByText('实现构建 · 50%')).not.toBeInTheDocument();
        await userEvent.hover(screen.getByTestId('beegame-project-info-trigger'));
        expect(screen.getByText('构建中')).toBeInTheDocument();
        expect(screen.queryByText('实现构建')).not.toBeInTheDocument();
        expect(screen.queryByText('实现构建 · 50%')).not.toBeInTheDocument();
    });

    it('localizes BeeGame turn state labels in the live preview header', async () => {
        mockedPhaseInfo = {
            current_phase: 3,
            phase_name: 'implementation',
            history: [{ phase: 3, name: 'implementation', timestamp: 3_000 }],
        };
        mockedProjectStatus = {
            ...mockedProjectStatus,
            phase: 'running',
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedRightSidebarProps).not.toBeNull());

        await userEvent.hover(screen.getByTestId('beegame-project-info-trigger'));
        expect(screen.getByText('构建中')).toBeInTheDocument();
        expect(screen.queryByText('实现构建')).not.toBeInTheDocument();
        expect(screen.queryByText('实现构建 · 0%')).not.toBeInTheDocument();
    });

    it('uses live runtime token budget when persisted token usage has not caught up', async () => {
        mockedTokenUsage = {
            // Simulates the historical client overcount. A newer runtime
            // snapshot must be allowed to correct this value downward.
            proj_1: { prompt_tokens: 8_000, completion_tokens: 1_999, total_tokens: 9_999 },
        };
        mockedProjectStatus = {
            ...mockedProjectStatus,
            context: {
                token_budget: {
                    prompt_tokens: 120,
                    completion_tokens: 30,
                    cache_read_tokens: 500,
                    cache_creation_tokens: 50,
                    total_tokens: 700,
                },
            },
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedRightSidebarProps).not.toBeNull());

        expect(screen.queryByText('670')).not.toBeInTheDocument();
        expect(screen.queryByText('30')).not.toBeInTheDocument();
        await userEvent.hover(screen.getByTestId('beegame-project-info-trigger'));
        expect(screen.getByText('输入 Tokens')).toBeInTheDocument();
        expect(screen.getByText('120')).toBeInTheDocument();
        expect(screen.getByText('缓存输入 Tokens')).toBeInTheDocument();
        expect(screen.getByText('550')).toBeInTheDocument();
        expect(screen.getByText('输出 Tokens')).toBeInTheDocument();
        expect(screen.getByText('30')).toBeInTheDocument();
    });

    it('recovers cached input from legacy snapshots that only persisted a total', async () => {
        mockedProjectStatus = {
            ...mockedProjectStatus,
            context: {
                token_budget: {
                    prompt_tokens: 254_542,
                    completion_tokens: 81_019,
                    total_tokens: 6_424_792,
                },
            },
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await userEvent.hover(screen.getByTestId('beegame-project-info-trigger'));
        expect(screen.getByText('输入 Tokens')).toBeInTheDocument();
        expect(screen.getByText('254,542')).toBeInTheDocument();
        expect(screen.getByText('缓存输入 Tokens')).toBeInTheDocument();
        expect(screen.getByText('6,089,231')).toBeInTheDocument();
        expect(screen.getByText('输出 Tokens')).toBeInTheDocument();
        expect(screen.getByText('81,019')).toBeInTheDocument();
    });

    it('moves header metrics into the selected project hover hint and removes BeeGame branding chrome', async () => {
        mockedProjectStatus = {
            ...mockedProjectStatus,
            acceptance: {
                status: 'passed',
                summary: 'Native validator observed the current revision.',
            },
        };
        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('beegame-live-preview-page')).toBeInTheDocument());

        expect(screen.queryByText('BeeGame')).not.toBeInTheDocument();
        expect(screen.queryByText('消耗')).not.toBeInTheDocument();
        expect(screen.queryByText('Phase')).not.toBeInTheDocument();
        expect(screen.queryByText('Model')).not.toBeInTheDocument();
        expect(within(screen.getByTestId('beegame-shell-top-nav')).queryByText('等待可运行画面')).not.toBeInTheDocument();
        expect(within(screen.getByTestId('beegame-shell-top-nav')).queryByText('Credits: 0')).not.toBeInTheDocument();
        expect(within(screen.getByTestId('beegame-shell-top-nav')).queryByText('Web')).not.toBeInTheDocument();
        expect(screen.getByTestId('beegame-project-trigger')).not.toHaveAttribute('aria-describedby');

        await userEvent.hover(screen.getByTestId('beegame-project-info-trigger'));

        expect(screen.getByTestId('beegame-project-hint')).toBeInTheDocument();
        expect(screen.getByText('平台')).toBeInTheDocument();
        expect(screen.getByText('Web')).toBeInTheDocument();
        expect(screen.getByText('输入 Tokens')).toBeInTheDocument();
        expect(screen.getByText('缓存输入 Tokens')).toBeInTheDocument();
        expect(screen.getByText('输出 Tokens')).toBeInTheDocument();
        expect(screen.getByText('Agent 状态')).toBeInTheDocument();
        expect(screen.getByText('交付验收')).toBeInTheDocument();
        expect(screen.getByText('已通过')).toBeInTheDocument();
    });

    it('shows the sync state as an icon with text in the live preview header', async () => {
        mockedIsSyncing = true;

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const syncStatus = await screen.findByTestId('beegame-sync-status');

        expect(within(syncStatus).getByText('同步中')).toBeInTheDocument();
        expect(syncStatus.querySelector('svg')).not.toBeNull();
    });

    it('uses deployment permission and project target without a frontend delivery state machine', async () => {
        mockedProjectStatus = {
            ...mockedProjectStatus,
            project_target: { kind: 'native', engine: 'custom-engine' },
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        expect(screen.getByRole('button', { name: '发布游戏' })).toBeEnabled();
        await userEvent.hover(screen.getByTestId('beegame-project-info-trigger'));
        expect(screen.getByText('custom-engine')).toBeInTheDocument();
        expect(screen.queryByText('Web')).not.toBeInTheDocument();
    });

    it('locks project-changing interactions while project sync is active', async () => {
        const user = userEvent.setup();
        mockedIsSyncing = true;
        mockedProjects = [
            {
                id: 'proj_2',
                name: 'Other Project',
                root_path: '/tmp/beegame-workspace/other-project',
                created_at: Date.now(),
            },
        ];

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedRightSidebarProps).not.toBeNull());

        expect(capturedRightSidebarProps?.canSendMessage).toBe(false);
        expect(screen.getByRole('button', { name: '播放预览' })).toBeDisabled();
        expect(screen.getByRole('button', { name: '发布游戏' })).toBeDisabled();

        await user.click(screen.getByRole('button', { name: '用户菜单' }));
        await user.click(within(screen.getByTestId('beegame-user-settings-menu')).getByRole('menuitem', { name: '历史项目' }));
        await user.click(await screen.findByText('other-project'));

        expect(setActiveProject).not.toHaveBeenCalled();
    });

    it('shows a warning toast instead of a blocking dialog when initial project sync fails', async () => {
        loadProjectStatus.mockRejectedValueOnce(new Error('project status unavailable'));

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(showWarning).toHaveBeenCalledWith('project status unavailable'));

        expect(screen.queryByRole('dialog', { name: '项目同步失败' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '重试同步' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '播放预览' })).not.toBeDisabled();
    });

    it('replaces the legacy status-node canvas with the BeeGame live preview surface', async () => {
        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedRightSidebarProps).not.toBeNull());

        expect(screen.queryByTestId('canvas-view')).not.toBeInTheDocument();
        expect(screen.queryByTestId('side-menu')).not.toBeInTheDocument();
        expect(screen.getByTestId('beegame-live-preview-page')).toBeInTheDocument();
        expect(screen.getByTestId('beegame-shell-top-nav')).toBeInTheDocument();
        expect(screen.queryByTestId('beegame-shell-side-nav')).not.toBeInTheDocument();
        expect(capturedRightSidebarProps?.variant).toBe('beegame');
    });

    it('groups live preview controls in a shadcn button group and removes the bottom runtime strip', async () => {
        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('beegame-live-preview-page')).toBeInTheDocument());

        const primaryControls = screen.getByRole('group', { name: '预览操作' });
        const onlineControls = screen.getByRole('group', { name: '打开线上版本' });
        expect(within(primaryControls).getByRole('button', { name: '播放预览' })).toBeInTheDocument();
        expect(within(primaryControls).getByRole('button', { name: '发布游戏' })).toBeEnabled();
        expect(within(onlineControls).getByRole('button', { name: '刷新预览' })).toBeInTheDocument();
        expect(within(onlineControls).getByRole('button', { name: '打开线上版本' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: '预览' })).toBeInTheDocument();
        expect(screen.queryByText('实时预览')).not.toBeInTheDocument();
        expect(screen.queryByText('Live Preview')).not.toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: '刷新预览' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '预览操作' })).not.toBeInTheDocument();
        expect(screen.queryByTestId('beegame-preview-runtime-strip')).not.toBeInTheDocument();
        expect(screen.queryByTestId('beegame-preview-metric-grid')).not.toBeInTheDocument();
    });

    it('wires the top bar back button and opens the homepage settings modal from the user menu', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        const onSetLang = vi.fn();
        mockedHasPermission = vi.fn(() => false);

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={onSetLang} onBack={onBack} />);

        await waitFor(() => expect(screen.getByTestId('beegame-live-preview-page')).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: '返回项目列表' }));
        expect(onBack).toHaveBeenCalledTimes(1);

        expect(screen.queryByRole('combobox', { name: '语言' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '用户菜单' }));

        const userSettingsMenu = screen.getByTestId('beegame-user-settings-menu');
        expect(userSettingsMenu).toBeInTheDocument();
        expect(screen.getByTestId('beegame-shell-top-nav')).not.toContainElement(userSettingsMenu);
        expect(userSettingsMenu).toHaveAttribute('data-surface', 'frosted-glass');
        expect(within(userSettingsMenu).getByText('Nova Player')).toBeInTheDocument();
        expect(within(userSettingsMenu).getByText('nova@example.com')).toBeInTheDocument();
        expect(within(userSettingsMenu).getByText('162 credits')).toBeInTheDocument();
        expect(within(userSettingsMenu).queryByRole('combobox', { name: '语言' })).not.toBeInTheDocument();
        expect(within(userSettingsMenu).getByRole('menuitem', { name: '个人主页' })).toBeInTheDocument();
        expect(within(userSettingsMenu).getByRole('menuitem', { name: 'Credit 商店' })).toBeInTheDocument();
        expect(within(userSettingsMenu).getByRole('menuitem', { name: '系统设置' })).toBeInTheDocument();
        expect(within(userSettingsMenu).getByRole('menuitem', { name: '历史项目' })).toBeInTheDocument();
        expect(within(userSettingsMenu).getByRole('menuitem', { name: '退出登录' })).toBeInTheDocument();

        await user.click(within(userSettingsMenu).getByRole('menuitem', { name: '系统设置' }));

        const settingsDialog = await screen.findByRole('dialog', { name: '系统设置' });
        expect(screen.queryByTestId('beegame-user-settings-menu')).not.toBeInTheDocument();
        expect(within(settingsDialog).getByRole('tab', { name: '技能' })).toBeInTheDocument();
        await user.selectOptions(within(settingsDialog).getByRole('combobox', { name: '语言选择' }), 'en');
        expect(onSetLang).toHaveBeenCalledWith('en');
    });

    it('opens the shared profile modal from the dashboard user menu', async () => {
        const user = userEvent.setup();

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('beegame-live-preview-page')).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: '用户菜单' }));
        await user.click(within(screen.getByTestId('beegame-user-settings-menu')).getByRole('menuitem', { name: '个人主页' }));

        const profileDialog = await screen.findByRole('dialog');
        expect(within(profileDialog).getByText('Nova Player')).toBeInTheDocument();
        expect(within(profileDialog).getByText('nova@example.com')).toBeInTheDocument();
        expect(within(profileDialog).getByText('162 credits')).toBeInTheDocument();
    });

    it('keeps the top bar popover layer above the right-side chat panel', async () => {
        const user = userEvent.setup();

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const topNav = await screen.findByTestId('beegame-shell-top-nav');
        expect(topNav).toHaveClass('z-[90]');

        await user.click(screen.getByRole('button', { name: '用户菜单' }));

        expect(screen.getByTestId('beegame-user-settings-menu')).toHaveClass('z-[140]');
        expect(capturedRightSidebarProps?.variant).toBe('beegame');
    });

    it('renders the built game URL inside the BeeGame live preview frame', async () => {
        mockedProjectStatus = {
            ...mockedProjectStatus,
            build_report: {
                status: 'passed',
                build_url: 'http://127.0.0.1:5178',
                entrypoint: 'dist/index.html',
            },
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const frame = await screen.findByTestId('beegame-live-preview-frame');

        expect(frame).toHaveAttribute('src', 'http://127.0.0.1:5178');
        expect(screen.getByRole('button', { name: '停止预览' })).toBeInTheDocument();
    });

    it('groups online preview actions after the primary preview actions', async () => {
        mockedProjectStatus = {
            ...mockedProjectStatus,
            build_report: {
                status: 'passed',
                build_url: 'http://127.0.0.1:5178',
                entrypoint: 'dist/index.html',
            },
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const actionGroups = await screen.findAllByRole('group');
        expect(actionGroups).toHaveLength(2);
        expect(within(actionGroups[0]).getByRole('button', { name: '停止预览' })).toBeInTheDocument();
        expect(within(actionGroups[0]).getByRole('button', { name: '发布游戏' })).toBeInTheDocument();
        expect(within(actionGroups[1]).getByRole('button', { name: '刷新预览' })).toBeInTheDocument();
        expect(within(actionGroups[1]).getByRole('button', { name: '打开线上版本' })).toBeInTheDocument();
    });

    it('stops the managed preview without stopping the BeeGame runtime', async () => {
        const user = userEvent.setup();
        stopTask.mockResolvedValue(undefined);
        mockedProjectStatus = {
            ...mockedProjectStatus,
            build_report: {
                status: 'passed',
                build_url: 'http://127.0.0.1:5178',
                entrypoint: 'dist/index.html',
            },
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const frame = await screen.findByTestId('beegame-live-preview-frame');
        expect(frame).toHaveAttribute('src', 'http://127.0.0.1:5178');
        await user.click(screen.getByRole('button', { name: '刷新预览' }));
        await waitFor(() => expect(apiMocks.restartProjectPreview).toHaveBeenCalledWith('proj_1'));
        await waitFor(() => {
            expect(screen.getByTestId('beegame-live-preview-frame')).toHaveAttribute(
                'src',
                'http://127.0.0.1:5178/?__beegame_preview_refresh=1',
            );
        });

        const observedPreviewSources: string[] = [];
        const previewSurface = screen.getByTestId('beegame-preview-surface');
        const observer = new MutationObserver((records) => {
            records.forEach((record) => {
                record.addedNodes.forEach((node) => {
                    if (!(node instanceof HTMLElement)) return;
                    if (node.matches('iframe[src]')) {
                        observedPreviewSources.push(node.getAttribute('src') || '');
                    }
                    node.querySelectorAll('iframe[src]').forEach((frameNode) => {
                        observedPreviewSources.push(frameNode.getAttribute('src') || '');
                    });
                });
            });
        });
        observer.observe(previewSurface, { childList: true, subtree: true });
        await user.click(screen.getByRole('button', { name: '停止预览' }));
        await waitFor(() => expect(apiMocks.stopProjectPreview).toHaveBeenCalledWith('proj_1'));
        await waitFor(() => expect(screen.queryByTestId('beegame-live-preview-frame')).not.toBeInTheDocument());
        observer.disconnect();
        expect(observedPreviewSources).not.toContain(
            'http://127.0.0.1:5178/?__beegame_preview_refresh=2',
        );
        expect(stopTask).not.toHaveBeenCalled();
    });

    it('starts a managed preview from the button group when no preview URL is available yet', async () => {
        const user = userEvent.setup();
        mockedProjectStatus = {
            ...mockedProjectStatus,
            phase: 'finished',
            build_report: null,
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const playButton = screen.getByRole('button', { name: '播放预览' });
        expect(playButton).toBeEnabled();
        await user.click(playButton);

        await waitFor(() => expect(apiMocks.startProjectPreview).toHaveBeenCalledWith('proj_1'));
        expect(stopTask).not.toHaveBeenCalled();
    });

    it('does not start a workspace-mutating preview while the agent pipeline is active', async () => {
        mockedProjectStatus = {
            ...mockedProjectStatus,
            phase: 'finished',
            next_action: 'running',
            build_report: null,
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const playButton = screen.getByRole('button', { name: '播放预览' });
        expect(playButton).toBeDisabled();
        fireEvent.click(playButton);
        expect(apiMocks.startProjectPreview).not.toHaveBeenCalled();
    });

    it('shows immediate feedback and prevents duplicate starts while the preview is starting', async () => {
        const user = userEvent.setup();
        let resolveStartPreview: (() => void) | undefined;
        apiMocks.startProjectPreview.mockImplementationOnce(() => new Promise<void>((resolve) => {
            resolveStartPreview = resolve;
        }));
        mockedProjectStatus = {
            ...mockedProjectStatus,
            phase: 'finished',
            build_report: null,
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const playButton = screen.getByRole('button', { name: '播放预览' });
        await user.click(playButton);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: '正在准备预览' })).toBeDisabled();
            expect(screen.getByTestId('beegame-preview-surface')).toHaveTextContent('正在准备预览');
        });
        await user.click(screen.getByRole('button', { name: '正在准备预览' }));
        expect(apiMocks.startProjectPreview).toHaveBeenCalledTimes(1);

        resolveStartPreview?.();
        await waitFor(() => expect(screen.getByRole('button', { name: '播放预览' })).toBeEnabled());
    });

    it('recovers with an error when preview startup times out', async () => {
        vi.useFakeTimers();
        apiMocks.startProjectPreview.mockImplementationOnce(() => new Promise<void>(() => {}));
        mockedProjectStatus = {
            ...mockedProjectStatus,
            phase: 'finished',
            build_report: null,
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: '播放预览' }));
        expect(screen.getByRole('button', { name: '正在准备预览' })).toBeDisabled();

        await act(async () => {
            vi.advanceTimersByTime(10_000);
            await Promise.resolve();
        });

        expect(showError).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: '播放预览' })).toBeEnabled();
        vi.useRealTimers();
    });

    it('does not show stale preview summaries in the empty preview state', async () => {
        mockedProjectStatus = {
            ...mockedProjectStatus,
            phase: 'finished',
            build_report: {
                status: 'stopped',
                summary: 'Preview stopped',
            },
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(screen.getByText('等待预览生成')).toBeInTheDocument());

        expect(screen.queryByText('Preview stopped')).not.toBeInTheDocument();
        expect(screen.queryByText('预览就绪后会显示在这里')).not.toBeInTheDocument();
    });

    it('publishes the project without switching the managed preview to the deployed URL', async () => {
        const user = userEvent.setup();
        mockedProjectStatus = {
            ...mockedProjectStatus,
            phase: 'finished',
            build_report: null,
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: '发布游戏' }));
        const deploymentDialog = await screen.findByRole('dialog', { name: '发布游戏' });
        await user.click(within(deploymentDialog).getByRole('button', { name: '发布游戏' }));

        await waitFor(() => expect(apiMocks.deployProject).toHaveBeenCalledWith('proj_1'));
        await waitFor(() => {
            expect(within(deploymentDialog).getAllByText('https://games.example.com/project-one/').length).toBeGreaterThan(0);
        });
        expect(screen.queryByTestId('beegame-live-preview-frame')).not.toBeInTheDocument();
    });

    it('loads deployment history without using it as the managed preview URL', async () => {
        const user = userEvent.setup();
        apiMocks.listProjectDeployments.mockResolvedValueOnce([
            {
                id: 'deploy_previous',
                sessionId: 'beegame_proj_1',
                workspacePath: '/tmp/Projects/project-one',
                status: 'succeeded',
                url: 'https://games.example.com/project-one/previous/',
                buildCommand: 'npm run build',
                message: 'Published',
                createdAt: '2026-06-21T00:00:00.000Z',
                updatedAt: '2026-06-21T00:00:00.000Z',
                deployedAt: '2026-06-21T00:00:00.000Z',
            },
        ]);
        mockedProjectStatus = {
            ...mockedProjectStatus,
            phase: 'finished',
            build_report: null,
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(apiMocks.listProjectDeployments).toHaveBeenCalledWith('proj_1'));
        expect(screen.queryByTestId('beegame-live-preview-frame')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '发布游戏' }));
        const deploymentDialog = await screen.findByRole('dialog', { name: '发布游戏' });
        expect(within(deploymentDialog).getByText('历史版本')).toBeInTheDocument();
        expect(within(deploymentDialog).getAllByText('https://games.example.com/project-one/previous/').length).toBeGreaterThan(0);

        await user.click(within(deploymentDialog).getByRole('button', { name: '重新发布' }));

        await waitFor(() => expect(apiMocks.deployProject).toHaveBeenCalledWith('proj_1'));
    });

    it('can roll back to a previous successful deployment from the preview surface', async () => {
        const user = userEvent.setup();
        apiMocks.listProjectDeployments.mockResolvedValueOnce([
            {
                id: 'deploy_latest',
                sessionId: 'beegame_proj_1',
                workspacePath: '/tmp/Projects/project-one',
                status: 'succeeded',
                url: 'https://games.example.com/project-one/latest/',
                message: 'Published',
                createdAt: '2026-06-22T00:00:00.000Z',
                updatedAt: '2026-06-22T00:00:00.000Z',
                deployedAt: '2026-06-22T00:00:00.000Z',
            },
            {
                id: 'deploy_previous',
                sessionId: 'beegame_proj_1',
                workspacePath: '/tmp/Projects/project-one',
                status: 'succeeded',
                url: 'https://games.example.com/project-one/previous/',
                message: 'Published',
                createdAt: '2026-06-21T00:00:00.000Z',
                updatedAt: '2026-06-21T00:00:00.000Z',
                deployedAt: '2026-06-21T00:00:00.000Z',
            },
        ]);
        mockedProjectStatus = {
            ...mockedProjectStatus,
            phase: 'finished',
            build_report: null,
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(apiMocks.listProjectDeployments).toHaveBeenCalledWith('proj_1'));
        await user.click(screen.getByRole('button', { name: '发布游戏' }));
        const deploymentDialog = await screen.findByRole('dialog', { name: '发布游戏' });
        expect(within(deploymentDialog).getByText('历史版本')).toBeInTheDocument();

        await user.click(within(deploymentDialog).getByRole('button', { name: /回滚|Rollback/ }));

        await waitFor(() => expect(apiMocks.rollbackProjectDeployment).toHaveBeenCalledWith('proj_1', 'deploy_previous'));
    });

    it('keeps deployment failures visible in the preview surface', async () => {
        const user = userEvent.setup();
        apiMocks.deployProject.mockResolvedValueOnce({
            id: 'deploy_failed',
            sessionId: 'beegame_proj_1',
            workspacePath: '/tmp/Projects/project-one',
            status: 'failed',
            message: 'Build command failed with exit code 1',
            buildLog: "src/components/Canvas.tsx(149,14): error TS18048: 'lastPoint' is possibly 'undefined'.",
            buildCommand: 'deploy',
            createdAt: '2026-06-21T00:00:00.000Z',
            updatedAt: '2026-06-21T00:00:00.000Z',
        });
        mockedProjectStatus = {
            ...mockedProjectStatus,
            phase: 'finished',
            build_report: null,
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await user.click(screen.getByRole('button', { name: '发布游戏' }));
        const deploymentDialog = await screen.findByRole('dialog', { name: '发布游戏' });
        await user.click(within(deploymentDialog).getByRole('button', { name: '发布游戏' }));

        await waitFor(() => expect(apiMocks.deployProject).toHaveBeenCalledWith('proj_1'));
        await waitFor(() => expect(within(deploymentDialog).getAllByText(/lastPoint/).length).toBeGreaterThan(0));
        await user.click(within(deploymentDialog).getByRole('button', { name: '修复' }));

        expect(apiMocks.requestProjectAction).toHaveBeenCalledWith(expect.objectContaining({
            project_id: 'proj_1',
            kind: 'deployment_failure_repair',
        }));
        expect(screen.queryByTestId('beegame-live-preview-frame')).not.toBeInTheDocument();
    });

    it('overlays build errors on the preview surface and sends them to chat from Fix', async () => {
        const user = userEvent.setup();
        mockedProjectStatus = {
            ...mockedProjectStatus,
            build_report: {
                status: 'failed',
                failure_reason: 'Build failed with TypeScript errors.',
                checks: [
                    {
                        name: 'typecheck',
                        status: 'failed',
                        detail: "src/components/Canvas.tsx(149,14): error TS18048: 'lastPoint' is possibly 'undefined'.",
                    },
                ],
            },
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const previewSurface = await screen.findByTestId('beegame-preview-surface');
        const consolePanel = within(previewSurface).getByTestId('beegame-preview-error-overlay');
        expect(consolePanel).toHaveClass('absolute');
        expect(within(consolePanel).getByText('控制台')).toBeInTheDocument();
        expect(within(consolePanel).getByText(/lastPoint/)).toBeInTheDocument();

        await user.click(within(consolePanel).getByRole('button', { name: '修复' }));

        expect(apiMocks.requestProjectAction).toHaveBeenCalledWith(expect.objectContaining({
            project_id: 'proj_1',
            kind: 'build_error_repair',
        }));
    });

    it('overlays runtime console errors reported by the live preview iframe', async () => {
        const user = userEvent.setup();
        mockedProjectStatus = {
            ...mockedProjectStatus,
            build_report: {
                status: 'passed',
                build_url: '/previews/beegame_proj_1',
                checks: [{ name: 'preview', status: 'passed', detail: 'Preview running' }],
            },
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const frame = await screen.findByTestId('beegame-live-preview-frame') as HTMLIFrameElement;
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                origin: window.location.origin,
                source: frame.contentWindow,
                data: {
                    type: 'beegame.preview.console',
                    sessionId: 'beegame_proj_1',
                    level: 'error',
                    message: 'Uncaught TypeError: Cannot read properties of undefined',
                    createdAt: '2026-07-09T12:00:00.000Z',
                },
            }));
        });

        const previewSurface = await screen.findByTestId('beegame-preview-surface');
        const consolePanel = within(previewSurface).getByTestId('beegame-preview-error-overlay');
        expect(within(consolePanel).getByText(/Cannot read properties/)).toBeInTheDocument();

        await user.click(within(consolePanel).getByRole('button', { name: '修复' }));

        expect(apiMocks.requestProjectAction).toHaveBeenCalledWith(expect.objectContaining({
            project_id: 'proj_1',
            kind: 'build_error_repair',
        }));
    });

    it('clears runtime console overlay when the preview is refreshed', async () => {
        const user = userEvent.setup();
        mockedProjectStatus = {
            ...mockedProjectStatus,
            build_report: {
                status: 'passed',
                build_url: '/previews/beegame_proj_1',
                checks: [{ name: 'preview', status: 'passed', detail: 'Preview running' }],
            },
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const frame = await screen.findByTestId('beegame-live-preview-frame') as HTMLIFrameElement;
        act(() => {
            window.dispatchEvent(new MessageEvent('message', {
                origin: window.location.origin,
                source: frame.contentWindow,
                data: {
                    type: 'beegame.preview.console',
                    sessionId: 'beegame_proj_1',
                    level: 'error',
                    message: 'Uncaught Error: stale preview error',
                    createdAt: '2026-07-09T12:00:00.000Z',
                },
            }));
        });

        const previewSurface = await screen.findByTestId('beegame-preview-surface');
        expect(within(previewSurface).getByTestId('beegame-preview-error-overlay')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '刷新预览' }));

        await waitFor(() => expect(apiMocks.restartProjectPreview).toHaveBeenCalledWith('proj_1'));
        await waitFor(() => {
            expect(within(previewSurface).queryByTestId('beegame-preview-error-overlay')).not.toBeInTheDocument();
        });
    });

    it('keeps the preview error overlay hidden when there are no build errors', async () => {
        mockedProjectStatus = {
            ...mockedProjectStatus,
            build_report: {
                status: 'passed',
                build_url: 'http://127.0.0.1:5178',
                checks: [{ name: 'typecheck', status: 'passed', detail: 'ok' }],
            },
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const previewSurface = await screen.findByTestId('beegame-preview-surface');
        expect(within(previewSurface).queryByTestId('beegame-preview-error-overlay')).not.toBeInTheDocument();
        expect(screen.queryByText('暂无错误')).not.toBeInTheDocument();
    });

    it('shows the workspace folder name as the dashboard project title without renaming the project', async () => {
        mockedProjects = [
            {
                id: 'proj_1',
                name: 'RPG 融合模式',
                root_path: '/tmp/beegame-workspace/lightweight-web-challenge',
                created_at: Date.now(),
            },
        ];

        render(<DashboardView projectId="proj_1" projectName="RPG 融合模式" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedRightSidebarProps).not.toBeNull());

        expect(screen.getByText('lightweight-web-challenge')).toBeInTheDocument();
    });

    it('does not mount the legacy SideMenu in BeeGame mode', async () => {
        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('beegame-live-preview-page')).toBeInTheDocument());

        expect(capturedSideMenuProps).toBeNull();
    });

    it('explains edit and continue requests use reserved credits with automatic refund settlement', async () => {
        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedUseChatOptions?.confirmCreditQuote).toEqual(expect.any(Function)));

        await act(async () => {
            void capturedUseChatOptions?.confirmCreditQuote({
                taskType: 'edit_turn',
                reservedCredits: 50,
                displayName: '修改 / 继续任务',
                description: 'User follow-up turn',
                balanceCredits: 300,
                canStart: true,
                message: 'This request reserves credits.',
            });
        });

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent('确认本次请求');
        expect(dialog).not.toHaveTextContent('修改 / 调试');
        expect(dialog).not.toHaveTextContent('修改、调试或继续完善已有游戏项目。');
        expect(dialog).not.toHaveTextContent('修改 / 继续任务');
        expect(dialog).not.toHaveTextContent('User follow-up turn');
        expect(dialog).toHaveClass('input-surface');
        expect(dialog).toHaveClass('rounded-[30px]');
        expect(screen.getByText('当前余额')).toBeInTheDocument();
        expect(screen.getByText('300 credits')).toBeInTheDocument();
        expect(screen.getByText('预扣')).toBeInTheDocument();
        expect(screen.getByText('50 credits')).toBeInTheDocument();
        expect(screen.getByText('修改、继续任务和资源集成也会计费；实际扣费以本轮 token 和工具使用为准，未使用部分自动退回。')).toBeInTheDocument();
    });
});
