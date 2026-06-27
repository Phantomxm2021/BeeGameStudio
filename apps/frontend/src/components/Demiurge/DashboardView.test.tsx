import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
const toggleTheme = vi.fn();
const showSuccess = vi.fn();
const showError = vi.fn();
const stopTask = vi.fn();
const apiMocks = vi.hoisted(() => ({
    startProjectPreview: vi.fn().mockResolvedValue({}),
    restartProjectPreview: vi.fn().mockResolvedValue({}),
    stopProjectPreview: vi.fn().mockResolvedValue({}),
}));
const status = {
    uptime: '1m',
    unity_connected: false,
    active_agents: 0,
    project_progress: 0,
    capabilities: {
        operator_controls_enabled: true,
        reset_gdd_approval_enabled: true,
    },
};

let capturedRightSidebarProps: Record<string, any> | null = null;
let capturedTopBarProps: Record<string, any> | null = null;
let capturedSideMenuProps: Record<string, any> | null = null;
let mockedPhaseInfo = { current_phase: 0, phase_name: 'phase_0', history: [] as Array<{ phase: number; name: string; timestamp: number }> };
let mockedMessages: Array<{ id: string; sender: string; content: string; timestamp: number }> = [];
let mockedTokenUsage: Record<string, { prompt_tokens: number; completion_tokens: number; total_tokens: number }> = {};
let mockedModelConfigs = [
    {
        id: 'llm_default',
        name: 'Default API',
        provider: 'openai-compatible',
        apiKeyPreview: 'sk-...',
        models: { balanced: 'configured-sonnet-live' },
        isDefault: true,
    },
];
let mockedProjectStatus: ProjectBaselineStatusPayload = {
    project_id: 'proj_1',
    phase: 'DESIGN_IN_PROGRESS',
    blocked: true,
    approval_required: true,
    baseline: {
        artifact_id: 'art_1',
    },
};
let mockedProjects: Array<{ id: string; name: string; root_path?: string; created_at: number }> = [];
let mockedHasPermission = vi.fn(() => true);

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
            isSyncing: false,
            isDark: true,
            toggleTheme,
            hasPermission: mockedHasPermission,
        };
        return selector ? selector(state) : state;
    },
}));

vi.mock('../../store/projectStore', () => ({
    useProjectStore: () => ({
        projects: mockedProjects,
        pendingReviews: [
            {
                gate_id: 'gate_human_gdd',
                type: 'GDD_APPROVAL_REVIEW',
                review_status: {
                    workflow_id: 'gdd_v2',
                },
            },
        ],
        projectStatus: mockedProjectStatus,
        runtimeReadiness: null,
        loadPendingReviews,
        loadProjectStatus,
        loadSystemReadiness,
    }),
}));

vi.mock('../../store/chatStore', () => ({
    useChatStore: () => ({
        messages: mockedMessages,
        currentSender: null,
        isStreaming: false,
    }),
}));

vi.mock('../../hooks/useChat', () => ({
    useChat: () => ({
        sendMessage: vi.fn(),
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
    }),
}));

vi.mock('../../hooks/useToast', () => ({
    useToast: () => ({
        showSuccess,
        showError,
    }),
}));

vi.mock('../../services/api', () => ({
    api: {
        startProjectPreview: apiMocks.startProjectPreview,
        restartProjectPreview: apiMocks.restartProjectPreview,
        stopProjectPreview: apiMocks.stopProjectPreview,
    },
}));

vi.mock('../../services/modelConfigApi', () => ({
    listModelConfigs: vi.fn(() => Promise.resolve(mockedModelConfigs)),
    createModelConfig: vi.fn(() => Promise.resolve(mockedModelConfigs[0])),
}));

vi.mock('../../services/beeGameAdapter', () => ({
    isBeeGameAdapterEnabled: vi.fn(() => true),
    getBeeGameWorkspaceSettings: vi.fn(() => Promise.resolve({ workspacePath: '/tmp/Projects', isDefault: true })),
    getBeeGameSubagentsEnabled: vi.fn(() => true),
    resetBeeGameWorkspaceRoot: vi.fn(() => Promise.resolve({ workspacePath: '/tmp/Projects', isDefault: true })),
    setBeeGameSubagentsEnabled: vi.fn(),
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
        return (
            <div data-testid="side-menu">
                {props.canOpenOperatorControls ? (
                    <button type="button" onClick={props.onOpenOperatorControls}>OperatorControls</button>
                ) : null}
            </div>
        );
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
        mockedPhaseInfo = { current_phase: 0, phase_name: 'phase_0', history: [] };
        mockedMessages = [];
        mockedTokenUsage = {};
        mockedModelConfigs = [
            {
                id: 'llm_default',
                name: 'Default API',
                provider: 'openai-compatible',
                apiKeyPreview: 'sk-...',
                models: { balanced: 'configured-sonnet-live' },
                isDefault: true,
            },
        ];
        mockedProjectStatus = {
            project_id: 'proj_1',
            phase: 'DESIGN_IN_PROGRESS',
            blocked: true,
            approval_required: true,
            baseline: {
                artifact_id: 'art_1',
            },
        };
        mockedProjects = [];
        mockedHasPermission = vi.fn(() => true);
        status.capabilities.operator_controls_enabled = true;
        status.capabilities.stage_control_enabled = true;
    });

    it('loads runtime status immediately when mounted', async () => {
        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(loadProjectStatus).toHaveBeenCalledWith('proj_1'));

        expect(loadPendingReviews).toHaveBeenCalledWith('proj_1');
        expect(loadPhases).toHaveBeenCalledWith('proj_1');
        expect(loadTasks).toHaveBeenCalledWith('proj_1');
        expect(loadAgents).toHaveBeenCalled();
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
    });

    it('passes global workflow progress instead of the old first-phase twenty percent boost', async () => {
        mockedPhaseInfo = {
            current_phase: 1,
            phase_name: 'brief',
            history: [{ phase: 1, name: 'brief', timestamp: 1_000 }],
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedRightSidebarProps).not.toBeNull());

        expect(capturedRightSidebarProps?.progress).toBeLessThan(20);
        await userEvent.hover(screen.getByTestId('beegame-project-trigger'));
        expect(screen.getByText('构建方案')).toBeInTheDocument();
        expect(screen.queryByText('构建方案 · 0%')).not.toBeInTheDocument();
    });

    it('passes BeeGame pipeline phase labels to the live preview header', async () => {
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
        await userEvent.hover(screen.getByTestId('beegame-project-trigger'));
        expect(screen.getByText('实现构建')).toBeInTheDocument();
        expect(screen.queryByText('实现构建 · 50%')).not.toBeInTheDocument();
    });

    it('passes localized BeeGame phase labels to the live preview header', async () => {
        mockedPhaseInfo = {
            current_phase: 3,
            phase_name: 'implementation',
            history: [{ phase: 3, name: 'implementation', timestamp: 3_000 }],
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedRightSidebarProps).not.toBeNull());

        await userEvent.hover(screen.getByTestId('beegame-project-trigger'));
        expect(screen.getByText('实现构建')).toBeInTheDocument();
        expect(screen.queryByText('实现构建 · 0%')).not.toBeInTheDocument();
    });

    it('uses live runtime token budget when persisted token usage has not caught up', async () => {
        mockedTokenUsage = {
            proj_1: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        };
        mockedProjectStatus = {
            ...mockedProjectStatus,
            context: {
                token_budget: {
                    prompt_tokens: 120,
                    completion_tokens: 30,
                    total_tokens: 150,
                },
            },
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedRightSidebarProps).not.toBeNull());

        expect(screen.queryByText('150')).not.toBeInTheDocument();
        await userEvent.hover(screen.getByTestId('beegame-project-trigger'));
        expect(screen.getByText('150')).toBeInTheDocument();
    });

    it('moves header metrics into the selected project hover hint and removes BeeGame branding chrome', async () => {
        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('beegame-live-preview-page')).toBeInTheDocument());

        expect(screen.queryByText('BeeGame')).not.toBeInTheDocument();
        expect(screen.queryByText('消耗')).not.toBeInTheDocument();
        expect(screen.queryByText('Phase')).not.toBeInTheDocument();
        expect(screen.queryByText('Model')).not.toBeInTheDocument();

        await userEvent.hover(screen.getByTestId('beegame-project-trigger'));

        expect(screen.getByTestId('beegame-project-hint')).toBeInTheDocument();
        expect(screen.getByText('消耗')).toBeInTheDocument();
        expect(screen.getByText('阶段')).toBeInTheDocument();
        expect(screen.getByText('模型')).toBeInTheDocument();
    });

    it('shows the current configured model in the project hover hint instead of a hardcoded mock value', async () => {
        mockedModelConfigs = [
            {
                id: 'llm_live',
                name: 'Live Provider',
                provider: 'openai-compatible',
                apiKeyPreview: 'sk-...',
                models: { fast: 'fast-model', balanced: 'current-balanced-model', strong: 'strong-model' },
                isDefault: true,
            },
        ];
        mockedProjectStatus = {
            ...mockedProjectStatus,
            model_config_id: 'llm_live',
        } as ProjectBaselineStatusPayload;

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await userEvent.hover(await screen.findByTestId('beegame-project-trigger'));

        expect(await screen.findByText('current-balanced-model')).toBeInTheDocument();
        expect(screen.queryByText('Claude Sonnet 4')).not.toBeInTheDocument();
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

    it('keeps live preview controls icon-only and removes the bottom runtime strip', async () => {
        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('beegame-live-preview-page')).toBeInTheDocument());

        expect(screen.getByRole('button', { name: '刷新预览' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: '预览' })).toBeInTheDocument();
        expect(screen.queryByText('实时预览')).not.toBeInTheDocument();
        expect(screen.queryByText('Live Preview')).not.toBeInTheDocument();
        expect(screen.queryByText('刷新预览')).not.toBeInTheDocument();
        expect(screen.queryByText('在新窗口打开')).not.toBeInTheDocument();
        expect(screen.queryByText('停止运行')).not.toBeInTheDocument();
        expect(screen.queryByTestId('beegame-preview-runtime-strip')).not.toBeInTheDocument();
        expect(screen.queryByTestId('beegame-preview-metric-grid')).not.toBeInTheDocument();
    });

    it('wires the top bar back button and opens the homepage settings modal from the user menu', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        const onSetLang = vi.fn();

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={onSetLang} onBack={onBack} />);

        await waitFor(() => expect(screen.getByTestId('beegame-live-preview-page')).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: '返回项目列表' }));
        expect(onBack).toHaveBeenCalledTimes(1);

        expect(screen.queryByRole('combobox', { name: '语言' })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '设置' }));

        const userSettingsMenu = screen.getByTestId('beegame-user-settings-menu');
        expect(userSettingsMenu).toBeInTheDocument();
        expect(within(userSettingsMenu).queryByRole('combobox', { name: '语言' })).not.toBeInTheDocument();

        await user.click(within(userSettingsMenu).getByRole('menuitem', { name: '设置' }));

        const settingsDialog = await screen.findByRole('dialog', { name: '系统设置' });
        expect(screen.queryByTestId('beegame-user-settings-menu')).not.toBeInTheDocument();
        await user.selectOptions(within(settingsDialog).getByRole('combobox', { name: '语言选择' }), 'en');
        expect(onSetLang).toHaveBeenCalledWith('en');
    });

    it('keeps the top bar popover layer above the right-side chat panel', async () => {
        const user = userEvent.setup();

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const topNav = await screen.findByTestId('beegame-shell-top-nav');
        expect(topNav).toHaveClass('z-[90]');

        await user.click(screen.getByRole('button', { name: '设置' }));

        expect(screen.getByTestId('beegame-user-settings-menu')).toHaveClass('z-[80]');
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
        expect(screen.getByRole('button', { name: '停止预览' })).toBeEnabled();
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

        await screen.findByTestId('beegame-live-preview-frame');
        const refreshButton = screen.getByRole('button', { name: '刷新预览' });
        const stopButton = screen.getByRole('button', { name: '停止预览' });
        const openButton = screen.getByRole('button', { name: '在新窗口打开' });
        const controls = refreshButton.parentElement?.parentElement;

        expect(controls?.children[0]).toContainElement(refreshButton);
        expect(controls?.children[1]).toContainElement(stopButton);
        expect(controls?.children[2]).toContainElement(openButton);

        await user.hover(stopButton);
        expect(await screen.findByRole('tooltip')).toHaveTextContent('停止预览');

        await user.click(refreshButton);
        await waitFor(() => expect(apiMocks.restartProjectPreview).toHaveBeenCalledWith('proj_1'));

        await user.click(stopButton);
        await waitFor(() => expect(apiMocks.stopProjectPreview).toHaveBeenCalledWith('proj_1'));
        expect(stopTask).not.toHaveBeenCalled();
    });

    it('starts a managed preview when no preview URL is available yet', async () => {
        const user = userEvent.setup();
        mockedProjectStatus = {
            ...mockedProjectStatus,
            build_report: null,
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        const playButton = screen.getByRole('button', { name: '播放预览' });
        await user.click(playButton);

        await waitFor(() => expect(apiMocks.startProjectPreview).toHaveBeenCalledWith('proj_1'));
        expect(stopTask).not.toHaveBeenCalled();
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

    it('does not mount the legacy SideMenu in BeeGame mode when test operations are enabled', async () => {
        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('beegame-live-preview-page')).toBeInTheDocument());

        expect(capturedSideMenuProps).toBeNull();
        expect(screen.queryByRole('button', { name: 'OperatorControls' })).not.toBeInTheDocument();
    });

    it('keeps the BeeGame shell independent from legacy OperatorControls capability flags', async () => {
        status.capabilities.operator_controls_enabled = false;
        status.capabilities.stage_control_enabled = false;

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(screen.getByTestId('beegame-live-preview-page')).toBeInTheDocument());

        expect(capturedSideMenuProps).toBeNull();
        expect(screen.queryByRole('button', { name: 'OperatorControls' })).not.toBeInTheDocument();
    });
});
