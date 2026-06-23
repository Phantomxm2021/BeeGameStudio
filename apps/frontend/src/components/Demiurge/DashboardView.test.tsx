import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

vi.mock('../../store/systemStore', () => ({
    useSystemStore: () => ({
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
    }),
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
        stopTask: vi.fn(),
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

    it('passes global workflow progress instead of the old first-phase twenty percent boost', async () => {
        mockedPhaseInfo = {
            current_phase: 1,
            phase_name: 'brief',
            history: [{ phase: 1, name: 'brief', timestamp: 1_000 }],
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedTopBarProps).not.toBeNull());

        expect(capturedTopBarProps?.progress).toBeLessThan(20);
        expect(capturedRightSidebarProps?.progress).toBe(capturedTopBarProps?.progress);
    });

    it('passes BeeGame pipeline phase labels to the top bar', async () => {
        mockedPhaseInfo = {
            current_phase: 3,
            phase_name: 'implementation',
            history: [
                { phase: 0, name: 'idea_intake', timestamp: 1_000 },
                { phase: 2, name: 'gdd', timestamp: 2_000 },
                { phase: 3, name: 'implementation', timestamp: 3_000 },
            ],
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedTopBarProps).not.toBeNull());

        expect(capturedTopBarProps?.mode).toBe('beegame');
        expect(capturedTopBarProps?.phaseLabel).toBe('实现构建');
        expect(capturedTopBarProps?.progress).toBeGreaterThan(0);
    });

    it('passes localized BeeGame phase labels to the top bar', async () => {
        mockedPhaseInfo = {
            current_phase: 3,
            phase_name: 'implementation',
            history: [{ phase: 3, name: 'implementation', timestamp: 3_000 }],
        };

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedTopBarProps).not.toBeNull());

        expect(capturedTopBarProps?.phaseLabel).toBe('实现构建');
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

        await waitFor(() => expect(capturedTopBarProps).not.toBeNull());

        expect(capturedTopBarProps?.tokens).toBe(150);
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

        await waitFor(() => expect(capturedTopBarProps).not.toBeNull());

        expect(capturedTopBarProps?.projectName).toBe('lightweight-web-challenge');
    });

    it('opens OperatorControls in a new browser tab when test operations are enabled', async () => {
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedSideMenuProps?.canOpenOperatorControls).toBe(true));
        await userEvent.setup().click(screen.getByRole('button', { name: 'OperatorControls' }));

        expect(openSpy).toHaveBeenCalledWith(
            expect.stringContaining('/operator-controls?project_id=proj_1'),
            '_blank',
            'noopener,noreferrer',
        );
        expect(openSpy.mock.calls[0]?.[0]).toContain('project_name=Project+One');
    });

    it('does not expose the OperatorControls entry when test operations are disabled', async () => {
        status.capabilities.operator_controls_enabled = false;
        status.capabilities.stage_control_enabled = false;

        render(<DashboardView projectId="proj_1" projectName="Project One" lang="zh" onSetLang={vi.fn()} />);

        await waitFor(() => expect(capturedSideMenuProps).not.toBeNull());
        expect(capturedSideMenuProps?.canOpenOperatorControls).toBe(false);
        expect(screen.queryByRole('button', { name: 'OperatorControls' })).not.toBeInTheDocument();
    });
});
