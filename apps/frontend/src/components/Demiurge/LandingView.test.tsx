import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LandingView } from './LandingView';

const { analyzeIdeaIntake } = vi.hoisted(() => ({
    analyzeIdeaIntake: vi.fn(),
}));
const { generateIntakeOptions } = vi.hoisted(() => ({
    generateIntakeOptions: vi.fn(),
}));
const { runIdeaIntake } = vi.hoisted(() => ({
    runIdeaIntake: vi.fn(),
}));
const { getCreditBalance, getCreditLedger, getCreditQuote } = vi.hoisted(() => ({
    getCreditBalance: vi.fn(),
    getCreditLedger: vi.fn(),
    getCreditQuote: vi.fn(),
}));
const { deleteCurrentUser } = vi.hoisted(() => ({
    deleteCurrentUser: vi.fn(),
}));
const {
    clearSupabaseSession,
    isSupabaseAuthConfigured,
    sendSupabasePasswordReset,
    signInWithSupabaseOAuth,
    signInWithSupabasePassword,
    signUpWithSupabasePassword,
    updateSupabaseAvatarUrl,
} = vi.hoisted(() => ({
    clearSupabaseSession: vi.fn(),
    isSupabaseAuthConfigured: vi.fn(),
    sendSupabasePasswordReset: vi.fn(),
    signInWithSupabaseOAuth: vi.fn(),
    signInWithSupabasePassword: vi.fn(),
    signUpWithSupabasePassword: vi.fn(),
    updateSupabaseAvatarUrl: vi.fn(),
}));
const mockDeleteProject = vi.fn();
const mockSetActiveProject = vi.fn();
const mockLoadCurrentUser = vi.fn();
let mockCurrentUser: {
    id: string;
    email?: string;
    displayName?: string;
    avatarUrl?: string;
    role: 'owner' | 'developer' | 'reviewer' | 'viewer';
    permissions: string[];
} | null = {
    id: 'alice',
    role: 'owner',
    permissions: ['project.create', 'project.delete'],
};
let mockProjects: Array<{ id: string; name: string; created_at: string }> = [];
const terminalRenderState = vi.hoisted(() => ({ renderCount: 0 }));

vi.mock('../../store/projectStore', () => ({
    useProjectStore: (selector?: (state: {
        projects: typeof mockProjects;
        deleteProject: typeof mockDeleteProject;
        setActiveProject: typeof mockSetActiveProject;
    }) => unknown) => {
        const state = {
            projects: mockProjects,
            deleteProject: mockDeleteProject,
            setActiveProject: mockSetActiveProject,
        };
        return selector ? selector(state) : state;
    },
}));

vi.mock('../../store/systemStore', () => {
    const useSystemStore = (selector?: (state: {
        currentUser: typeof mockCurrentUser;
        loadCurrentUser: typeof mockLoadCurrentUser;
        hasPermission: (permission: string) => boolean;
    }) => unknown) => {
        const state = {
            currentUser: mockCurrentUser,
            loadCurrentUser: mockLoadCurrentUser,
            hasPermission: (permission: string) => Boolean(mockCurrentUser?.permissions.includes(permission)),
        };
        return selector ? selector(state) : state;
    };
    useSystemStore.getState = () => ({
        currentUser: mockCurrentUser,
        loadCurrentUser: mockLoadCurrentUser,
        hasPermission: (permission: string) => Boolean(mockCurrentUser?.permissions.includes(permission)),
    });
    return { useSystemStore };
});

vi.mock('../../services/api', () => ({
    api: {
        analyzeIdeaIntake,
    },
}));

vi.mock('../../services/beeGameAdapter', () => ({
    beeGameAdapter: {
        generateIntakeOptions,
        runIdeaIntake,
    },
    getBeeGameWorkspaceSettings: vi.fn().mockResolvedValue({
        workspacePath: '/tmp/beegame-projects',
        isDefault: true,
    }),
    getBeeGameSubagentsEnabled: vi.fn().mockReturnValue(true),
    resetBeeGameWorkspaceRoot: vi.fn().mockResolvedValue({
        workspacePath: '/tmp/beegame-projects',
        isDefault: true,
    }),
    setBeeGameSubagentsEnabled: vi.fn((enabled: boolean) => enabled),
    setBeeGameWorkspaceRoot: vi.fn().mockReturnValue({
        workspacePath: '/tmp/beegame-projects',
        isDefault: false,
    }),
}));

vi.mock('../../services/modelConfigApi', () => ({
    createModelConfig: vi.fn(),
    listModelConfigs: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/creditsApi', () => ({
    getCreditBalance,
    getCreditLedger,
    getCreditQuote,
}));

vi.mock('../../services/currentUserApi', () => ({
    deleteCurrentUser,
}));

vi.mock('../../services/supabaseAuthApi', () => ({
    clearSupabaseSession,
    isSupabaseAuthConfigured,
    sendSupabasePasswordReset,
    signInWithSupabaseOAuth,
    signInWithSupabasePassword,
    signUpWithSupabasePassword,
    updateSupabaseAvatarUrl,
}));

vi.mock('./DemiurgeLogo', () => ({
    DemiurgeLogo: () => <div data-testid="demiurge-logo" />,
}));

vi.mock('./Landing/FaultyTerminal', () => ({
    FaultyTerminal: () => {
        terminalRenderState.renderCount += 1;
        return <div data-testid="faulty-terminal-canvas" />;
    },
}));

const renderLanding = (props?: Partial<React.ComponentProps<typeof LandingView>>) => render(
    <LandingView
        onStart={vi.fn()}
        lang="zh"
        onSetLang={vi.fn()}
        {...props}
    />,
);

const makeIntakeOptions = () => [
    {
        id: 'llm_mode_a',
        title: 'LLM Mode A',
        pitch: 'LLM generated pitch A.',
        gameplay: 'LLM generated gameplay rules A.',
        coreGameplayHypothesis: 'LLM generated hypothesis A.',
        experienceSnapshot: 'LLM generated snapshot A.',
        playerFirstMinute: 'LLM generated first minute A.',
        whyFitsIdea: 'LLM generated fit A.',
        playablePrototype: 'LLM generated first playable A.',
        validationTarget: 'LLM generated validation target A.',
        coreMechanic: 'LLM generated core mechanic A.',
        firstBuild: 'LLM generated first build A.',
        validationGoal: 'LLM generated validation goal A.',
        risk: 'LLM generated risk A.',
        fit: 'LLM generated fit A.',
        firstPlayableValidation: 'LLM generated validation A.',
        riskComplexity: 'LLM generated complexity A.',
        recommendedPlatform: 'Web',
        recommendedDimension: '2D',
        recommendedGenre: 'Arcade',
        recommendedStyle: 'Pixel',
        recommendedInputs: ['Keyboard/mouse', 'Touch'],
        scope: 'Playable demo',
    },
    {
        id: 'llm_mode_b',
        title: 'LLM Mode B',
        pitch: 'LLM generated pitch B.',
        gameplay: 'LLM generated gameplay rules B.',
        coreGameplayHypothesis: 'LLM generated hypothesis B.',
        experienceSnapshot: 'LLM generated snapshot B.',
        playerFirstMinute: 'LLM generated first minute B.',
        whyFitsIdea: 'LLM generated fit B.',
        playablePrototype: 'LLM generated first playable B.',
        validationTarget: 'LLM generated validation target B.',
        coreMechanic: 'LLM generated core mechanic B.',
        firstBuild: 'LLM generated first build B.',
        validationGoal: 'LLM generated validation goal B.',
        risk: 'LLM generated risk B.',
        fit: 'LLM generated fit B.',
        firstPlayableValidation: 'LLM generated validation B.',
        riskComplexity: 'LLM generated complexity B.',
        recommendedPlatform: 'Web',
        recommendedDimension: '2D',
        recommendedGenre: 'Casual',
        recommendedStyle: 'Cartoon',
        recommendedInputs: ['Keyboard/mouse'],
        scope: 'Vertical slice',
    },
];

beforeEach(() => {
    analyzeIdeaIntake.mockReset();
    analyzeIdeaIntake.mockResolvedValue({
        clarification_required: false,
        answered_slots: {},
        pending_slots: [],
        clarification_questions: [],
        clarification_suggestions: [],
    });
    generateIntakeOptions.mockReset();
    const options = makeIntakeOptions();
    generateIntakeOptions.mockResolvedValue(options);
    runIdeaIntake.mockReset();
    runIdeaIntake.mockResolvedValue({
        maturity: 'vague',
        needsOptions: true,
        needsClarification: false,
        clarificationQuestions: [],
        detectedConstraints: [],
        recommendedNextStep: 'choose_direction',
        options,
    });
    mockProjects = [];
    mockDeleteProject.mockReset();
    mockSetActiveProject.mockReset();
    mockLoadCurrentUser.mockReset();
    mockLoadCurrentUser.mockResolvedValue(undefined);
    deleteCurrentUser.mockReset();
    deleteCurrentUser.mockResolvedValue({ deleted: true });
    mockCurrentUser = {
        id: 'alice',
        role: 'owner',
        permissions: ['project.create', 'project.delete'],
    };
    getCreditBalance.mockReset();
    getCreditBalance.mockResolvedValue({
        userId: 'alice',
        plan: 'free',
        balanceCredits: 300,
        includedCredits: 300,
        consumedCredits: 0,
        reservedCredits: 0,
        creditUnitWeightedTokens: 10000,
        estimates: {
            ideaIntake: { minCredits: 3, maxCredits: 3 },
            planningDocs: { minCredits: 8, maxCredits: 30 },
            smallPlayableGame: { minCredits: 80, maxCredits: 200 },
            standardGame: { minCredits: 200, maxCredits: 600 },
            complexGame: { minCredits: 600, maxCredits: 1500 },
        },
    });
    getCreditLedger.mockReset();
    getCreditLedger.mockResolvedValue([]);
    getCreditQuote.mockReset();
    getCreditQuote.mockResolvedValue({
        taskType: 'full_build',
        reservedCredits: 200,
        displayName: 'Full game build',
        description: 'Create a complete game project from a confirmed brief.',
        balanceCredits: 300,
        canStart: true,
        message: '200 credits reserved before the build starts. Unused credits are refunded after settlement.',
    });
    isSupabaseAuthConfigured.mockReset();
    isSupabaseAuthConfigured.mockReturnValue(true);
    clearSupabaseSession.mockReset();
    sendSupabasePasswordReset.mockReset();
    sendSupabasePasswordReset.mockResolvedValue(undefined);
    signInWithSupabaseOAuth.mockReset();
    signInWithSupabasePassword.mockReset();
    signInWithSupabasePassword.mockResolvedValue({
        accessToken: 'supabase-access-token',
        refreshToken: 'supabase-refresh-token',
        expiresAt: Date.now() + 3600_000,
        user: { id: 'user-1', email: 'player@example.com' },
    });
    signUpWithSupabasePassword.mockReset();
    signUpWithSupabasePassword.mockResolvedValue({
        accessToken: 'signup-access-token',
        refreshToken: 'signup-refresh-token',
        expiresAt: Date.now() + 3600_000,
        user: { id: 'user-2', email: 'new@example.com' },
    });
    updateSupabaseAvatarUrl.mockReset();
    updateSupabaseAvatarUrl.mockResolvedValue({
        accessToken: 'updated-access-token',
        refreshToken: 'updated-refresh-token',
        expiresAt: Date.now() + 3600_000,
        user: {
            id: 'alice',
            email: 'alice@example.com',
            displayName: 'Alice',
            avatarUrl: 'https://cdn.example.com/alice.png',
        },
    });
    terminalRenderState.renderCount = 0;
});

describe('LandingView bootstrap submission', () => {
    it('asks the user to sign in before generating intake options', async () => {
        mockCurrentUser = null;

        renderLanding();

        const textbox = screen.getByRole('textbox');
        fireEvent.change(textbox, { target: { value: 'LLM generated idea' } });
        fireEvent.submit(textbox.closest('form') as HTMLFormElement);

        expect(await screen.findByRole('dialog', { name: '登录 / 注册 BeeGame' })).toBeInTheDocument();
        expect(screen.getByText('登录后继续你的项目、模型设置和生成进度。')).toBeInTheDocument();
        expect(runIdeaIntake).not.toHaveBeenCalled();
        expect(getCreditBalance).not.toHaveBeenCalled();
    });

    it('signs in from the login dialog and continues the pending idea generation', async () => {
        mockCurrentUser = null;
        mockLoadCurrentUser.mockImplementation(async () => {
            if (signInWithSupabasePassword.mock.calls.length > 0) {
                mockCurrentUser = {
                    id: 'user-1',
                    role: 'owner',
                    permissions: ['project.create', 'project.delete'],
                };
            }
        });

        renderLanding();

        const textbox = screen.getByRole('textbox');
        fireEvent.change(textbox, { target: { value: 'LLM generated idea' } });
        fireEvent.submit(textbox.closest('form') as HTMLFormElement);

        await screen.findByRole('dialog', { name: '登录 / 注册 BeeGame' });
        fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'player@example.com' } });
        fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } });
        fireEvent.click(screen.getByRole('button', { name: '登录并继续' }));

        await screen.findByText('LLM Mode A');
        expect(signInWithSupabasePassword).toHaveBeenCalledWith({
            email: 'player@example.com',
            password: 'secret-password',
        });
        expect(runIdeaIntake).toHaveBeenCalledWith({ idea: 'LLM generated idea', language: 'zh' });
    });

    it('opens account actions from a circular signed-in user avatar', async () => {
        mockCurrentUser = {
            id: 'alice',
            email: 'alice@example.com',
            displayName: 'Alice',
            role: 'owner',
            permissions: ['project.create', 'project.delete'],
        };
        renderLanding();

        expect(screen.queryByRole('button', { name: '系统设置' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '历史项目' })).not.toBeInTheDocument();

        fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));

        expect(screen.getByText('A')).toBeInTheDocument();
        expect(await screen.findByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('300 credits')).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: '个人主页' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: '系统设置' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: '历史项目' })).toBeInTheDocument();
    });

    it('does not display the raw user id as the signed-in nickname fallback', async () => {
        mockCurrentUser = {
            id: '00000000-0000-0000-0000-000000000001',
            role: 'owner',
            permissions: ['project.create', 'project.delete'],
        };
        renderLanding();

        fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));

        expect(screen.getByText('账号资料同步中')).toBeInTheDocument();
        expect(screen.queryByText('00000000-0000-0000-0000-000000000001')).not.toBeInTheDocument();
    });

    it('opens the profile page and saves an uploaded avatar only when finished', async () => {
        mockCurrentUser = {
            id: 'alice',
            email: 'alice@example.com',
            displayName: 'Alice',
            role: 'owner',
            permissions: ['project.create', 'project.delete'],
        };
        renderLanding();

        fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: '个人主页' }));

        expect(await screen.findByRole('dialog', { name: '个人主页' })).toBeInTheDocument();
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('alice@example.com')).toBeInTheDocument();
        expect(screen.queryByLabelText('昵称')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('个人邮箱')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('头像 URL')).not.toBeInTheDocument();

        const avatarFile = new File(['avatar-bytes'], 'avatar.png', { type: 'image/png' });
        fireEvent.change(screen.getByLabelText('上传头像'), {
            target: { files: [avatarFile] },
        });

        expect(updateSupabaseAvatarUrl).not.toHaveBeenCalled();
        expect(await screen.findByText('头像已选择，点击完成后保存。')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '完成' }));

        await waitFor(() => {
            expect(updateSupabaseAvatarUrl).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/));
        });
        expect(mockLoadCurrentUser).toHaveBeenCalled();
    });

    it('shows recent credit ledger entries and expands to all entries', async () => {
        mockCurrentUser = {
            id: 'alice',
            email: 'alice@example.com',
            displayName: 'Alice',
            role: 'owner',
            permissions: ['project.create', 'project.delete'],
        };
        getCreditLedger.mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({
            id: `ledger-${index}`,
            userId: 'alice',
            kind: index === 0 ? 'refund' : index === 1 ? 'settle' : 'reserve',
            credits: index + 1,
            metadata: { displayName: `Task ${index + 1}` },
            createdAt: new Date(1710000000000 + index).toISOString(),
        })));

        renderLanding();

        fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: '个人主页' }));

        expect(await screen.findByText('Task 1')).toBeInTheDocument();
        expect(screen.getByText('+1')).toBeInTheDocument();
        expect(screen.getByText('-2')).toBeInTheDocument();
        expect(screen.queryByText('Task 6')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '查看全部' }));

        expect(await screen.findByText('Task 6')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '收起' })).toBeInTheDocument();
    });

    it('requires confirmation before deleting the signed-in account', async () => {
        mockCurrentUser = {
            id: 'alice',
            email: 'alice@example.com',
            displayName: 'Alice',
            role: 'owner',
            permissions: ['project.create', 'project.delete'],
        };
        renderLanding();

        fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: '个人主页' }));
        fireEvent.click(await screen.findByRole('button', { name: '注销账户' }));

        expect(screen.getByText('注销账户会删除云端账号和关联数据。')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('注销账户确认'), { target: { value: 'DELETE' } });
        fireEvent.click(screen.getByRole('button', { name: '确认注销' }));

        await waitFor(() => expect(deleteCurrentUser).toHaveBeenCalledTimes(1));
        expect(clearSupabaseSession).toHaveBeenCalledTimes(1);
        expect(mockLoadCurrentUser).toHaveBeenCalled();
    });

    it('closes the account menu when clicking outside it', async () => {
        mockCurrentUser = {
            id: 'alice',
            role: 'owner',
            permissions: ['project.create', 'project.delete'],
        };
        renderLanding();

        fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
        expect(screen.getByRole('menu', { name: '用户菜单' })).toBeInTheDocument();

        fireEvent.pointerDown(document.body);

        await waitFor(() => expect(screen.queryByRole('menu', { name: '用户菜单' })).not.toBeInTheDocument());
    });

    it('uses the frosted input surface style for the account menu without filling the avatar', async () => {
        mockCurrentUser = {
            id: 'alice',
            role: 'owner',
            permissions: ['project.create', 'project.delete'],
        };
        renderLanding();

        const userButton = await screen.findByRole('button', { name: '用户菜单' });
        expect(userButton).toHaveAttribute('data-avatar-surface', 'outline');
        expect(userButton).not.toHaveClass('bg-black/20');

        fireEvent.click(userButton);

        expect(screen.getByRole('menu', { name: '用户菜单' })).toHaveAttribute('data-surface', 'frosted-glass');
    });

    it('opens the login and registration dialog from the anonymous user icon', async () => {
        mockCurrentUser = null;

        renderLanding();

        fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));

        expect(await screen.findByRole('dialog', { name: '登录 / 注册 BeeGame' })).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: '登录 / 注册 BeeGame' })).toHaveAttribute('data-surface', 'frosted-glass');
        expect(screen.getByRole('button', { name: '注册账号' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'GitHub' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Google' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Facebook' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'X' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Discord' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '忘记密码？' })).toBeInTheDocument();
    });

    it('opens a dedicated password reset view before sending reset email', async () => {
        mockCurrentUser = null;

        renderLanding();

        fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
        fireEvent.click(await screen.findByRole('button', { name: '忘记密码？' }));

        expect(await screen.findByText('重置密码')).toBeInTheDocument();
        expect(screen.queryByLabelText('密码')).not.toBeInTheDocument();
        expect(sendSupabasePasswordReset).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'player@example.com' } });
        fireEvent.click(screen.getByRole('button', { name: '发送重置邮件' }));

        await waitFor(() => expect(sendSupabasePasswordReset).toHaveBeenCalledWith('player@example.com'));
        expect(screen.getByText('重置密码邮件已发送，请检查邮箱。')).toBeInTheDocument();
    });

    it('switches to registration and creates a Supabase account', async () => {
        mockCurrentUser = null;
        mockLoadCurrentUser.mockImplementation(async () => {
            if (signUpWithSupabasePassword.mock.calls.length > 0) {
                mockCurrentUser = {
                    id: 'user-2',
                    role: 'owner',
                    permissions: ['project.create', 'project.delete'],
                };
            }
        });

        renderLanding();

        fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
        fireEvent.click(await screen.findByRole('button', { name: '注册账号' }));
        expect(screen.queryByRole('button', { name: 'GitHub' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Google' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Facebook' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'X' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Discord' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '用户协议' }));
        expect(await screen.findByRole('dialog', { name: 'BeeGame 用户协议' })).toBeInTheDocument();
        expect(screen.getByText('账号与安全')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '我已了解' }));
        fireEvent.click(screen.getByRole('button', { name: '隐私条款' }));
        expect(await screen.findByRole('dialog', { name: 'BeeGame 隐私条款' })).toBeInTheDocument();
        expect(screen.getByText('我们收集的数据')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '我已了解' }));
        fireEvent.change(screen.getByLabelText('昵称'), { target: { value: 'New Player' } });
        fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } });
        fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } });
        fireEvent.click(screen.getByLabelText('同意用户协议'));
        fireEvent.click(screen.getByRole('button', { name: '注册并继续' }));

        await waitFor(() => expect(signUpWithSupabasePassword).toHaveBeenCalledWith({
            email: 'new@example.com',
            password: 'secret-password',
            displayName: 'New Player',
        }));
        expect(mockLoadCurrentUser).toHaveBeenCalled();
    });

    it('starts Supabase OAuth from third-party login buttons', async () => {
        mockCurrentUser = null;

        renderLanding();

        fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
        fireEvent.click(await screen.findByRole('button', { name: 'GitHub' }));

        expect(signInWithSupabaseOAuth).toHaveBeenCalledWith('github');

        fireEvent.click(screen.getByRole('button', { name: 'X' }));
        expect(signInWithSupabaseOAuth).toHaveBeenCalledWith('x');

        fireEvent.click(screen.getByRole('button', { name: 'Discord' }));
        expect(signInWithSupabaseOAuth).toHaveBeenCalledWith('discord');
    });

    it('clears the Supabase session and reloads the current user when signing out', async () => {
        renderLanding();

        fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: '退出登录' }));

        expect(clearSupabaseSession).toHaveBeenCalledTimes(1);
        expect(mockLoadCurrentUser).toHaveBeenCalled();
    });

    it('stops intake generation when available credits are below the intake estimate', async () => {
        getCreditBalance.mockResolvedValue({
            userId: 'alice',
            plan: 'free',
            balanceCredits: 0,
            includedCredits: 300,
            consumedCredits: 300,
            reservedCredits: 0,
            creditUnitWeightedTokens: 10000,
            estimates: {
                ideaIntake: { minCredits: 3, maxCredits: 3 },
                planningDocs: { minCredits: 8, maxCredits: 30 },
                smallPlayableGame: { minCredits: 80, maxCredits: 200 },
                standardGame: { minCredits: 200, maxCredits: 600 },
                complexGame: { minCredits: 600, maxCredits: 1500 },
            },
        });

        renderLanding();

        const textbox = screen.getByRole('textbox');
        fireEvent.change(textbox, { target: { value: 'LLM generated idea' } });
        fireEvent.submit(textbox.closest('form') as HTMLFormElement);

        expect(await screen.findByText('Credit 不足，生成方案预计至少需要 3 credit。')).toBeInTheDocument();
        expect(runIdeaIntake).not.toHaveBeenCalled();
    });

    it('generates selectable intake options without starting a BeeGame session immediately', async () => {
        const onStart = vi.fn().mockResolvedValue({ status: 'started', projectId: 'proj_1' });

        renderLanding({ onStart });

        const textbox = screen.getByRole('textbox');
        fireEvent.change(textbox, { target: { value: 'LLM generated idea' } });
        fireEvent.submit(textbox.closest('form') as HTMLFormElement);

        expect(textbox).toBeDisabled();
        await screen.findByText('LLM Mode A');
        expect(screen.getByText('LLM Mode B')).toBeInTheDocument();
        expect(runIdeaIntake).toHaveBeenCalledWith({ idea: 'LLM generated idea', language: 'zh' });
        expect(onStart).not.toHaveBeenCalled();
        expect(analyzeIdeaIntake).not.toHaveBeenCalled();
    });

    it('shows generated intake options in a modal instead of embedding them into the landing page', async () => {
        renderLanding();

        const textbox = screen.getByRole('textbox');
        fireEvent.change(textbox, { target: { value: 'LLM generated idea' } });
        fireEvent.submit(textbox.closest('form') as HTMLFormElement);

        const dialog = await screen.findByRole('dialog', { name: '选择方案' });

        expect(dialog).toContainElement(screen.getByTestId('intake-options'));
        expect(dialog).toContainElement(screen.getByRole('button', { name: /LLM Mode A/ }));
        expect(dialog).toContainElement(screen.getAllByText('游戏模式')[0]);
        expect(dialog).toContainElement(screen.getAllByText('玩法')[0]);
        expect(dialog).toContainElement(screen.getByText('LLM generated gameplay rules A.'));
        expect(dialog).not.toHaveTextContent('AUTO');
        expect(dialog).not.toHaveTextContent('核心假设');
        expect(dialog).not.toHaveTextContent('第一分钟');
        expect(dialog).not.toHaveTextContent('为什么适合');
        expect(dialog).not.toHaveTextContent('首版原型');
        expect(dialog).toHaveAttribute('data-intake-modal', 'true');
        expect(screen.queryByText('BeeGame Idea Intake')).not.toBeInTheDocument();
        expect(screen.queryByText('Choose a direction')).not.toBeInTheDocument();
    });

    it('shows clarification as a neutral prompt and continues intake after an answer', async () => {
        runIdeaIntake
            .mockResolvedValueOnce({
                maturity: 'vague',
                needsOptions: false,
                needsClarification: true,
                clarification: {
                    prompt: 'Which interpretation should BeeGame use?',
                    options: [
                        { id: 'clarify_a', label: 'Interpretation A', description: 'Use the first interpretation.' },
                        { id: 'clarify_b', label: 'Interpretation B', value: 'Use the second interpretation.' },
                    ],
                    freeformLabel: 'Add more detail',
                },
                clarificationQuestions: [],
                detectedConstraints: [],
                recommendedNextStep: 'clarify',
                options: [],
            })
            .mockResolvedValueOnce({
                maturity: 'directional',
                needsOptions: true,
                needsClarification: false,
                clarificationQuestions: [],
                detectedConstraints: [],
                recommendedNextStep: 'choose_direction',
                options: makeIntakeOptions(),
            });

        renderLanding();

        const textbox = screen.getByRole('textbox');
        fireEvent.change(textbox, { target: { value: 'LLM generated idea' } });
        fireEvent.submit(textbox.closest('form') as HTMLFormElement);

        const clarification = await screen.findByTestId('intake-clarification');
        expect(clarification).toHaveTextContent('需求补充');
        expect(clarification).toHaveTextContent('Which interpretation should BeeGame use?');
        expect(clarification).not.toHaveClass('bg-red-950/60');
        expect(screen.queryByText('Which interpretation should BeeGame use? /')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Interpretation B/ }));

        await screen.findByText('LLM Mode A');
        expect(runIdeaIntake).toHaveBeenCalledTimes(2);
        expect(runIdeaIntake.mock.calls[1][0].idea).toContain('Question: Which interpretation should BeeGame use?');
        expect(runIdeaIntake.mock.calls[1][0].idea).toContain('Answer: Use the second interpretation.');
    });

    it('keeps the landing content visible without opening a modal while generating options', async () => {
        let resolveOptions: (value: Awaited<ReturnType<typeof generateIntakeOptions>>) => void = () => undefined;
        runIdeaIntake.mockReturnValue(new Promise((resolve) => {
            resolveOptions = resolve;
        }));
        const onStart = vi.fn();

        renderLanding({ onStart });

        const textbox = screen.getByRole('textbox');
        fireEvent.change(textbox, { target: { value: 'LLM generated idea' } });
        fireEvent.submit(textbox.closest('form') as HTMLFormElement);

        expect(screen.getByRole('heading', { name: '从一个想法开始' })).toBeInTheDocument();
        expect(screen.getByText('寥寥几句，就足以启程。')).toBeInTheDocument();
        expect(screen.queryByText('正在根据你的想法生成可选方案...')).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(textbox).toBeDisabled();

        resolveOptions({
            maturity: 'vague',
            needsOptions: true,
            needsClarification: false,
            clarificationQuestions: [],
            detectedConstraints: [],
            recommendedNextStep: 'choose_direction',
            options: [],
        });
        await waitFor(() => expect(runIdeaIntake).toHaveBeenCalledTimes(1));
        expect(onStart).not.toHaveBeenCalled();
    });

    it('skips direction selection for a concrete idea and opens settings with the recommended brief', async () => {
        runIdeaIntake.mockResolvedValueOnce({
            maturity: 'concrete',
            needsOptions: false,
            needsClarification: false,
            clarificationQuestions: [],
            detectedConstraints: ['LLM concrete constraint'],
            recommendedNextStep: 'configure_details',
            options: [
                {
                    id: 'llm_concrete_mode',
                    title: 'LLM Concrete Mode',
                    pitch: 'LLM concrete pitch.',
                    gameplay: 'LLM concrete gameplay rules.',
                    coreGameplayHypothesis: 'LLM concrete hypothesis.',
                    experienceSnapshot: 'LLM concrete snapshot.',
                    playerFirstMinute: 'LLM concrete first minute.',
                    whyFitsIdea: 'LLM concrete fit.',
                    playablePrototype: 'LLM concrete first playable.',
                    validationTarget: 'LLM concrete validation target.',
                    coreMechanic: 'LLM concrete core mechanic.',
                    firstBuild: 'LLM concrete first build.',
                    validationGoal: 'LLM concrete validation goal.',
                    risk: 'LLM concrete risk.',
                    fit: 'LLM concrete fit.',
                    firstPlayableValidation: 'LLM concrete validation.',
                    riskComplexity: 'LLM concrete complexity.',
                    recommendedPlatform: 'Web',
                    recommendedDimension: '3D',
                    recommendedGenre: 'Action',
                    recommendedStyle: 'Stylized',
                    recommendedInputs: ['Keyboard/mouse'],
                    scope: 'Playable demo',
                },
            ],
        });

        renderLanding();

        const textbox = screen.getByRole('textbox');
        fireEvent.change(textbox, { target: { value: 'LLM concrete idea' } });
        fireEvent.submit(textbox.closest('form') as HTMLFormElement);

        expect(await screen.findByRole('dialog', { name: 'LLM Concrete Mode' })).toBeInTheDocument();
        expect(screen.getByTestId('intake-settings')).toBeInTheDocument();
        expect(screen.queryByTestId('intake-options')).not.toBeInTheDocument();
    });

    it('confirms an intake brief before starting the BeeGame session', async () => {
        const onStart = vi.fn().mockResolvedValue({ status: 'started', projectId: 'proj_1' });

        renderLanding({ onStart });

        const textbox = screen.getByRole('textbox');
        fireEvent.change(textbox, { target: { value: 'LLM generated idea' } });
        fireEvent.submit(textbox.closest('form') as HTMLFormElement);

        fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));
        expect(screen.getByTestId('intake-settings')).toHaveAttribute('data-panel-depth', 'single');
        expect(screen.getByRole('dialog', { name: 'LLM Mode A' })).toBeInTheDocument();
        expect(screen.queryByText('补齐制作设置')).not.toBeInTheDocument();

        fireEvent.change(screen.getByRole('combobox', { name: '平台' }), { target: { value: 'Godot' } });
        fireEvent.change(screen.getByRole('combobox', { name: '表现形式' }), { target: { value: '3D' } });
        fireEvent.change(screen.getByRole('combobox', { name: '游戏类型' }), { target: { value: 'Puzzle' } });
        fireEvent.change(screen.getByRole('combobox', { name: '风格' }), { target: { value: 'Minimal' } });
        fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
        fireEvent.change(screen.getByRole('textbox', { name: '补充说明' }), { target: { value: '优先验证关卡节奏。' } });
        fireEvent.click(screen.getByRole('button', { name: '确认方案' }));

        expect(screen.getByTestId('confirmed-brief')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '开始构建' }));

        expect(await screen.findByRole('button', { name: '确认构建' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '确认构建' }));

        await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
        const [, clarification, brief] = onStart.mock.calls[0];
        expect(clarification).toBeUndefined();
        expect(brief).toMatchObject({
            idea: 'LLM generated idea',
            language: 'zh',
            title: 'LLM Mode A',
            option: { id: 'llm_mode_a', title: 'LLM Mode A' },
            settings: {
                platform: 'Godot',
                dimension: '3D',
                genre: 'Puzzle',
                visualStyle: 'Minimal',
                inputs: ['Keyboard/mouse', 'Touch', 'Voice'],
                notes: '优先验证关卡节奏。',
            },
        });
    });

    it('renders localized English hero copy and idea placeholder', () => {
        renderLanding({ lang: 'en' });

        expect(screen.getByRole('heading', { name: 'Start with an idea.' })).toBeInTheDocument();
        expect(screen.getByText('A few words are enough to begin.')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Describe the game, tool, or interactive experience you want to build')).toBeInTheDocument();
        expect(screen.queryByTestId('demiurge-logo')).not.toBeInTheDocument();
    });

    it('renders the video landing background', () => {
        renderLanding();

        const background = screen.getByTestId('faulty-terminal-background');

        expect(background).toHaveAttribute('data-background', 'video');
        expect(screen.getByTestId('landing-background-video')).toBeInTheDocument();
    });

    it('keeps the video background stable while typing in the prompt', () => {
        renderLanding();

        const video = screen.getByTestId('landing-background-video');

        fireEvent.change(screen.getByRole('textbox'), { target: { value: '像素跑酷游戏' } });

        expect(screen.getByTestId('landing-background-video')).toBe(video);
    });

    it('renders the idea prompt as a frosted glass surface', () => {
        renderLanding();

        expect(screen.getByTestId('idea-prompt-surface')).toHaveAttribute('data-surface', 'frosted-glass');
        expect(screen.getByTestId('idea-prompt-surface')).toHaveAttribute('data-style-source', 'pixelfork');
        expect(screen.getByTestId('idea-prompt-surface')).toHaveAttribute('data-glass-density', 'reinforced');
        expect(screen.queryByTestId('progressive-blur-layer')).not.toBeInTheDocument();
    });

    it('renders the updated Simplified Chinese hero subtitle', () => {
        renderLanding({ lang: 'zh' });

        expect(screen.getByRole('heading', { name: '从一个想法开始' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: '从一个想法开始。' })).not.toBeInTheDocument();
        expect(screen.getByText('寥寥几句，就足以启程。')).toBeInTheDocument();
    });

    it('renders the Traditional Chinese hero title without punctuation', () => {
        renderLanding({ lang: 'zh-TW' });

        expect(screen.getByRole('heading', { name: '從一個想法開始' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: '從一個想法開始。' })).not.toBeInTheDocument();
    });

    it('opens the simplified settings overlay on the general tab', () => {
        renderLanding({ lang: 'en' });

        fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));

        expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
        expect(screen.queryByText('Dark Mode')).not.toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByText('Language')).toBeInTheDocument();
        expect(screen.getByText('System Settings')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '简体中文' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '繁體中文' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '日本語' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '한국어' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Français' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Deutsch' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Español' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Italiano' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Português' })).toBeInTheDocument();
    });

    it('opens a centered history modal with project list content', () => {
        mockProjects = [
            { id: 'project-1', name: 'LLM Project', created_at: '2026-04-20T00:00:00.000Z' },
        ];

        renderLanding({ lang: 'zh' });

        fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
        fireEvent.click(screen.getByRole('menuitem', { name: '历史项目' }));

        expect(screen.getByRole('dialog', { name: '历史项目' })).toBeInTheDocument();
        expect(screen.getByText('LLM Project')).toBeInTheDocument();
    });

    it('renders the project action menu outside the history dialog to avoid clipping', () => {
        mockProjects = [
            { id: 'project-1', name: 'LLM Project', created_at: '2026-04-20T00:00:00.000Z' },
        ];

        renderLanding({ lang: 'en' });

        fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'History Projects' }));
        const dialog = screen.getByRole('dialog', { name: 'History Projects' });

        fireEvent.click(screen.getByRole('button', { name: 'More actions LLM Project' }));

        const deleteAction = screen.getByRole('button', { name: 'Delete Project' });
        expect(dialog).not.toContainElement(deleteAction);
    });

    it('shows an empty state in the history modal', () => {
        renderLanding({ lang: 'en' });

        fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'History Projects' }));

        expect(screen.getByRole('dialog', { name: 'History Projects' })).toBeInTheDocument();
        expect(screen.getByText('No projects found')).toBeInTheDocument();
    });

    it('keeps the history modal content area stable for empty and populated project lists', () => {
        const emptyRender = renderLanding({ lang: 'en' });

        fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'History Projects' }));

        const emptyDialog = screen.getByRole('dialog', { name: 'History Projects' });
        const emptyContent = emptyDialog.querySelector('.scrollbar-premium');
        expect(emptyContent).toHaveClass('min-h-48');

        emptyRender.unmount();

        mockProjects = [
            { id: 'project-1', name: 'LLM Project', created_at: '2026-04-20T00:00:00.000Z' },
        ];
        renderLanding({ lang: 'en' });

        fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'History Projects' }));

        const populatedDialog = screen.getByRole('dialog', { name: 'History Projects' });
        const populatedContent = populatedDialog.querySelector('.scrollbar-premium');
        expect(populatedContent).toHaveClass('min-h-48');
    });
});
