import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
const { listModelConfigs } = vi.hoisted(() => ({
    listModelConfigs: vi.fn(),
}));
const { deleteCurrentUser } = vi.hoisted(() => ({
    deleteCurrentUser: vi.fn(),
}));
const {
    createInvitation,
    deleteInvitation,
    getInvitationPublicSettings,
    listInvitations,
    saveInvitationSettings,
    updateInvitation,
} = vi.hoisted(() => ({
    createInvitation: vi.fn(),
    deleteInvitation: vi.fn(),
    getInvitationPublicSettings: vi.fn(),
    listInvitations: vi.fn(),
    saveInvitationSettings: vi.fn(),
    updateInvitation: vi.fn(),
}));
const {
    SupabaseAuthApiError,
    clearSupabaseSession,
    isSupabaseAuthConfigured,
    sendSupabasePasswordReset,
    signInWithSupabaseOAuth,
    signInWithSupabasePassword,
    signUpWithSupabasePassword,
    updateSupabaseAvatarUrl,
    uploadSupabaseAvatarImage,
} = vi.hoisted(() => ({
    SupabaseAuthApiError: class SupabaseAuthApiError extends Error {
        readonly code: string;
        readonly status: number;

        constructor(message: string, options: { code?: string; status?: number } = {}) {
            super(message);
            this.name = 'SupabaseAuthApiError';
            this.code = options.code ?? '';
            this.status = options.status ?? 0;
        }
    },
    clearSupabaseSession: vi.fn(),
    isSupabaseAuthConfigured: vi.fn(),
    sendSupabasePasswordReset: vi.fn(),
    signInWithSupabaseOAuth: vi.fn(),
    signInWithSupabasePassword: vi.fn(),
    signUpWithSupabasePassword: vi.fn(),
    updateSupabaseAvatarUrl: vi.fn(),
    uploadSupabaseAvatarImage: vi.fn(),
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
    listModelConfigs,
}));

vi.mock('../../services/creditsApi', () => ({
    getCreditBalance,
    getCreditLedger,
    getCreditQuote,
}));

vi.mock('../../services/currentUserApi', () => ({
    deleteCurrentUser,
}));

vi.mock('../../services/invitationApi', () => ({
    createInvitation,
    deleteInvitation,
    getInvitationPublicSettings,
    listInvitations,
    saveInvitationSettings,
    updateInvitation,
}));

vi.mock('../../services/supabaseAuthApi', () => ({
    SupabaseAuthApiError,
    clearSupabaseSession,
    isSupabaseAuthConfigured,
    sendSupabasePasswordReset,
    signInWithSupabaseOAuth,
    signInWithSupabasePassword,
    signUpWithSupabasePassword,
    updateSupabaseAvatarUrl,
    uploadSupabaseAvatarImage,
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

const submitIdea = (idea: string) => {
    const textbox = screen.getByRole('textbox');
    fireEvent.change(textbox, { target: { value: idea } });
    fireEvent.submit(textbox.closest('form') as HTMLFormElement);
    return textbox;
};

const confirmIntakeCreditQuote = async () => {
    expect(await screen.findByRole('dialog', { name: '确认生成方案' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认生成' }));
};

const submitIdeaAndConfirmIntake = async (idea: string) => {
    const textbox = submitIdea(idea);
    await confirmIntakeCreditQuote();
    return textbox;
};

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
        recommendedEngine: 'React',
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
        recommendedEngine: 'Godot',
        recommendedDimension: '3D',
        recommendedGenre: 'Puzzle',
        recommendedStyle: 'Cartoon',
        recommendedInputs: ['Keyboard/mouse'],
        scope: 'Vertical slice',
    },
];

beforeEach(() => {
    sessionStorage.clear();
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
    listModelConfigs.mockReset();
    listModelConfigs.mockResolvedValue([
        {
            id: 'model_1',
            name: 'Default LLM',
            provider: 'openai-compatible',
            baseUrl: 'https://llm.example.test/v1',
            apiKeyPreview: 'sk-...test',
            models: { balanced: 'balanced-model' },
            isDefault: true,
        },
    ]);
    getCreditQuote.mockReset();
    getCreditQuote.mockImplementation((taskType = 'full_build') => Promise.resolve(
        taskType === 'idea_intake'
            ? {
                taskType: 'idea_intake',
                reservedCredits: 3,
                displayName: 'Idea intake',
                description: 'Generate candidate directions from an idea.',
                balanceCredits: 300,
                canStart: true,
                message: '3 credits reserved before idea generation.',
            }
            : {
                taskType: 'full_build',
                reservedCredits: 200,
                displayName: 'Full game build',
                description: 'Create a complete game project from a confirmed brief.',
                balanceCredits: 300,
                canStart: true,
                message: '200 credits reserved before the build starts. Unused credits are refunded after settlement.',
            },
    ));
    deleteCurrentUser.mockReset();
    deleteCurrentUser.mockResolvedValue({ ok: true });
    getInvitationPublicSettings.mockReset();
    getInvitationPublicSettings.mockResolvedValue({ required: false });
    listInvitations.mockReset();
    listInvitations.mockResolvedValue([]);
    saveInvitationSettings.mockReset();
    saveInvitationSettings.mockImplementation((required: boolean) => Promise.resolve({ required }));
    createInvitation.mockReset();
    createInvitation.mockResolvedValue({ id: 'invite-1', code: 'BEE-ALPHA', label: 'Alpha', enabled: true, usedCount: 0, maxUses: null });
    updateInvitation.mockReset();
    updateInvitation.mockImplementation((input: { id: string; enabled?: boolean }) => Promise.resolve({ id: input.id, code: 'BEE-ALPHA', label: 'Alpha', enabled: input.enabled ?? true, usedCount: 0, maxUses: null }));
    deleteInvitation.mockReset();
    deleteInvitation.mockResolvedValue(true);
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
    uploadSupabaseAvatarImage.mockReset();
    uploadSupabaseAvatarImage.mockResolvedValue('https://cdn.example.com/avatars/alice.png');
    terminalRenderState.renderCount = 0;
});

describe('LandingView bootstrap submission', () => {
    it('asks the user to sign in before generating intake options', async () => {
        mockCurrentUser = null;

        renderLanding();

        submitIdea('LLM generated idea');

        expect(await screen.findByRole('dialog', { name: '登录 / 注册 BeeGame' })).toBeInTheDocument();
        expect(screen.getByText('你的灵感与项目，正在这里等待继续。')).toBeInTheDocument();
        expect(runIdeaIntake).not.toHaveBeenCalled();
        expect(getCreditBalance).not.toHaveBeenCalled();
    });

    it('requires a configured model before showing the intake credit quote', async () => {
        listModelConfigs.mockResolvedValueOnce([]);

        renderLanding();

        submitIdea('LLM generated idea');

        expect(await screen.findByText('平台尚未配置默认模型。请联系管理员在系统设置的平台页配置后再生成。')).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: '确认生成方案' })).not.toBeInTheDocument();
        expect(getCreditQuote).not.toHaveBeenCalled();
        expect(runIdeaIntake).not.toHaveBeenCalled();
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

        expect(await screen.findByRole('dialog', { name: '确认生成方案' })).toBeInTheDocument();
        expect(runIdeaIntake).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: '确认生成' }));

        await screen.findByText('LLM Mode A');
        expect(signInWithSupabasePassword).toHaveBeenCalledWith({
            email: 'player@example.com',
            password: 'secret-password',
        });
        expect(getCreditQuote).toHaveBeenCalledWith('idea_intake');
        expect(runIdeaIntake).toHaveBeenCalledWith({ idea: 'LLM generated idea', language: 'zh' });
    });

    it('shows localized feedback for invalid Supabase login credentials', async () => {
        mockCurrentUser = null;
        signInWithSupabasePassword.mockRejectedValueOnce(
            new SupabaseAuthApiError('Invalid login credentials', {
                code: 'invalid_credentials',
                status: 400,
            }),
        );

        renderLanding();

        fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
        await screen.findByRole('dialog', { name: '登录 / 注册 BeeGame' });
        fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'player@example.com' } });
        fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong-password' } });
        fireEvent.click(screen.getByRole('button', { name: '登录并继续' }));

        const errorDialog = await screen.findByRole('dialog', { name: '错误提示' });
        expect(within(errorDialog).getByText('邮箱或密码不正确，请检查后重试。')).toBeInTheDocument();
        expect(within(errorDialog).queryByText('Invalid login credentials')).not.toBeInTheDocument();
    });

    it('restores the pending idea after an OAuth redirect and continues generation', async () => {
        mockCurrentUser = null;

        const { unmount } = renderLanding();

        submitIdea('OAuth generated idea');

        await screen.findByRole('dialog', { name: '登录 / 注册 BeeGame' });
        fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));

        expect(signInWithSupabaseOAuth).toHaveBeenCalledWith('github');
        expect(getCreditQuote).not.toHaveBeenCalled();
        unmount();

        mockCurrentUser = {
            id: 'oauth-user',
            email: 'oauth@example.com',
            displayName: 'OAuth Player',
            role: 'owner',
            permissions: ['project.create', 'project.delete'],
        };
        renderLanding();

        expect(await screen.findByRole('dialog', { name: '确认生成方案' })).toBeInTheDocument();
        expect(getCreditQuote).toHaveBeenCalledWith('idea_intake');

        fireEvent.click(screen.getByRole('button', { name: '确认生成' }));

        expect(await screen.findByText('LLM Mode A')).toBeInTheDocument();
        expect(runIdeaIntake).toHaveBeenCalledWith({ idea: 'OAuth generated idea', language: 'zh' });
    });

    it('smokes the SaaS entry flow without bypassing login or credit confirmation', async () => {
        mockCurrentUser = null;
        mockLoadCurrentUser.mockImplementation(async () => {
            if (signInWithSupabasePassword.mock.calls.length > 0) {
                mockCurrentUser = {
                    id: 'user-1',
                    email: 'player@example.com',
                    displayName: 'Player',
                    role: 'owner',
                    permissions: ['project.create', 'project.delete'],
                };
            }
        });

        renderLanding();

        submitIdea('LLM generated idea');

        expect(await screen.findByRole('dialog', { name: '登录 / 注册 BeeGame' })).toBeInTheDocument();
        expect(runIdeaIntake).not.toHaveBeenCalled();
        expect(getCreditQuote).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'player@example.com' } });
        fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } });
        fireEvent.click(screen.getByRole('button', { name: '登录并继续' }));

        expect(await screen.findByRole('dialog', { name: '确认生成方案' })).toBeInTheDocument();
        expect(getCreditQuote).toHaveBeenCalledWith('idea_intake');
        expect(runIdeaIntake).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: '取消' }));

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: '确认生成方案' })).not.toBeInTheDocument();
        });
        expect(runIdeaIntake).not.toHaveBeenCalled();

        submitIdea('LLM generated idea');
        fireEvent.click(await screen.findByRole('button', { name: '确认生成' }));

        expect(await screen.findByText('LLM Mode A')).toBeInTheDocument();
        expect(runIdeaIntake).toHaveBeenCalledWith({ idea: 'LLM generated idea', language: 'zh' });
    });

    it('restores a pending intake credit quote after a page refresh', async () => {
        const { unmount } = renderLanding();

        submitIdea('Persistent LLM generated idea');

        expect(await screen.findByRole('dialog', { name: '确认生成方案' })).toBeInTheDocument();
        unmount();
        renderLanding();

        expect(await screen.findByRole('dialog', { name: '确认生成方案' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '确认生成' }));

        expect(await screen.findByText('LLM Mode A')).toBeInTheDocument();
        expect(runIdeaIntake).toHaveBeenCalledWith({ idea: 'Persistent LLM generated idea', language: 'zh' });
    });

    it('restores typed idea text after a page refresh without opening intake', () => {
        const { unmount } = renderLanding();

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft sample idea' } });
        unmount();
        renderLanding();

        expect(screen.getByRole('textbox')).toHaveValue('Draft sample idea');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(runIdeaIntake).not.toHaveBeenCalled();
    });

    it('restores generated intake options after a page refresh without regenerating them', async () => {
        const { unmount } = renderLanding();

        await submitIdeaAndConfirmIntake('Cached options idea');
        expect(await screen.findByRole('dialog', { name: '选择方案' })).toBeInTheDocument();
        expect(runIdeaIntake).toHaveBeenCalledTimes(1);
        unmount();
        renderLanding();

        const dialog = await screen.findByRole('dialog', { name: '选择方案' });
        expect(dialog).toContainElement(screen.getByRole('button', { name: /LLM Mode A/ }));
        expect(dialog).toContainElement(screen.getByRole('button', { name: /LLM Mode B/ }));
        expect(screen.getByRole('textbox')).toHaveValue('Cached options idea');
        expect(runIdeaIntake).toHaveBeenCalledTimes(1);
    });

    it('restores selected intake settings after a page refresh', async () => {
        const { unmount } = renderLanding();

        await submitIdeaAndConfirmIntake('Cached settings idea');
        fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));
        fireEvent.change(screen.getByRole('combobox', { name: '引擎' }), { target: { value: 'Godot' } });
        fireEvent.change(screen.getByRole('textbox', { name: '补充说明' }), { target: { value: 'Keep the selected settings.' } });
        unmount();
        renderLanding();

        expect(await screen.findByRole('dialog', { name: 'LLM Mode A' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: '引擎' })).toHaveValue('Godot');
        expect(screen.getByRole('textbox', { name: '补充说明' })).toHaveValue('Keep the selected settings.');
        expect(screen.queryByTestId('intake-options')).not.toBeInTheDocument();
        expect(runIdeaIntake).toHaveBeenCalledTimes(1);
    });

    it('restores confirmed intake brief after a page refresh', async () => {
        const { unmount } = renderLanding();

        await submitIdeaAndConfirmIntake('Cached brief idea');
        fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));
        fireEvent.change(screen.getByRole('combobox', { name: '平台' }), { target: { value: 'Web' } });
        fireEvent.change(screen.getByRole('combobox', { name: '引擎' }), { target: { value: 'Godot' } });
        fireEvent.change(screen.getByRole('combobox', { name: '表现形式' }), { target: { value: '3D' } });
        fireEvent.change(screen.getByRole('combobox', { name: '游戏类型' }), { target: { value: 'Puzzle' } });
        fireEvent.change(screen.getByRole('combobox', { name: '风格' }), { target: { value: 'Cartoon' } });
        fireEvent.click(screen.getByRole('button', { name: '请选择' }));
        fireEvent.click(screen.getByRole('option', { name: '键鼠' }));
        fireEvent.click(screen.getByRole('button', { name: '确认方案' }));
        expect(screen.getByTestId('confirmed-brief')).toBeInTheDocument();
        unmount();
        renderLanding();

        expect(await screen.findByRole('dialog', { name: 'LLM Mode A' })).toBeInTheDocument();
        expect(screen.getByTestId('confirmed-brief')).not.toHaveTextContent('确认构建方案');
        expect(screen.getByTestId('confirmed-brief')).toHaveTextContent('Godot');
        expect(runIdeaIntake).toHaveBeenCalledTimes(1);
    });

    it('does not show platform settings for a non-owner account even if management permissions are present', async () => {
        mockCurrentUser = {
            id: 'developer-user',
            role: 'developer',
            permissions: [
                'project.create',
                'workspace.manage',
                'model_config.manage',
                'runtime_settings.manage',
                'mcp.manage',
                'secrets.manage',
            ],
        };
        renderLanding();

        fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: '系统设置' }));

        expect(await screen.findByRole('dialog', { name: '系统设置' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: '通用' })).toBeInTheDocument();
        expect(screen.queryByRole('tab', { name: '平台' })).not.toBeInTheDocument();
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

        expect(screen.getByText('账号')).toBeInTheDocument();
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
        await waitFor(() => {
            expect(uploadSupabaseAvatarImage).toHaveBeenCalledWith(avatarFile);
        });
        expect(await screen.findByText('头像已选择，点击完成后保存。')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '完成' }));

        await waitFor(() => {
            expect(updateSupabaseAvatarUrl).toHaveBeenCalledWith('https://cdn.example.com/avatars/alice.png');
        });
        expect(mockLoadCurrentUser).toHaveBeenCalled();
    });

    it('shows only a compact credit summary and opens full ledger history in a detail dialog', async () => {
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
            metadata: {
                taskType: index === 0 ? 'idea_intake' : index === 1 ? 'full_build' : 'edit_turn',
                displayName: `Task ${index + 1}`,
            },
            createdAt: new Date(1710000000000 + index).toISOString(),
        })));

        renderLanding();

        fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: '个人主页' }));

        expect(await screen.findByText('余额')).toBeInTheDocument();
        expect(screen.getByText('已用')).toBeInTheDocument();
        expect(screen.getByText('冻结')).toBeInTheDocument();
        expect(screen.getByText('300')).toBeInTheDocument();
        expect(screen.getAllByText('0')).toHaveLength(2);
        expect(await screen.findByRole('button', { name: /查看 Credit 明细/ })).toBeInTheDocument();
        expect(screen.getByText('6 条')).toBeInTheDocument();
        expect(screen.queryByText('方案生成 · 退回')).not.toBeInTheDocument();
        expect(screen.queryByText('+1')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /查看 Credit 明细/ }));

        const details = await screen.findByRole('dialog', { name: 'Credit 明细' });
        expect(within(details).getByText('-6')).toBeInTheDocument();
        expect(within(details).getAllByText('修改任务 · 预扣')).toHaveLength(4);
        expect(within(details).getByText('按任务环节记录预扣、结算和退回。')).toBeInTheDocument();
        expect(details.querySelector('[data-credit-ledger-scroll="true"]')).toHaveClass('max-h-[52vh]', 'overflow-y-auto');
    });

    it('confirms account deletion before clearing the signed-in session', async () => {
        mockCurrentUser = {
            id: 'alice',
            email: 'alice@example.com',
            displayName: 'Alice',
            role: 'owner',
            permissions: ['project.create', 'project.delete'],
        };
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        renderLanding();

        fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: '个人主页' }));

        fireEvent.click(await screen.findByRole('button', { name: '注销账户' }));

        await waitFor(() => expect(deleteCurrentUser).toHaveBeenCalledTimes(1));
        expect(clearSupabaseSession).toHaveBeenCalled();
        expect(mockLoadCurrentUser).toHaveBeenCalled();
        confirmSpy.mockRestore();
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

    it('keeps the auth dialog size stable when switching between login and registration', async () => {
        mockCurrentUser = null;

        renderLanding();

        fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
        const authDialog = await screen.findByRole('dialog', { name: '登录 / 注册 BeeGame' });
        const authPanel = authDialog.querySelector('form');

        expect(authPanel).toHaveClass('max-w-[520px]');
        expect(authPanel).toHaveClass('h-[min(700px,calc(100vh-2rem))]');

        fireEvent.click(screen.getByRole('button', { name: '注册账号' }));

        expect(authPanel).toHaveClass('max-w-[520px]');
        expect(authPanel).toHaveClass('h-[min(700px,calc(100vh-2rem))]');

        fireEvent.click(screen.getByRole('button', { name: '登录' }));

        expect(authPanel).toHaveClass('max-w-[520px]');
        expect(authPanel).toHaveClass('h-[min(700px,calc(100vh-2rem))]');
    });

    it('does not start generation after account-menu email login without an explicit generate click', async () => {
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

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Typed but not submitted idea' } });
        fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
        await screen.findByRole('dialog', { name: '登录 / 注册 BeeGame' });
        fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'player@example.com' } });
        fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } });
        fireEvent.click(screen.getByRole('button', { name: '登录并继续' }));

        await waitFor(() => expect(signInWithSupabasePassword).toHaveBeenCalled());
        expect(screen.queryByRole('dialog', { name: '确认生成方案' })).not.toBeInTheDocument();
        expect(getCreditQuote).not.toHaveBeenCalled();
        expect(runIdeaIntake).not.toHaveBeenCalled();
    });

    it('does not store an OAuth generation intent from the account menu without an explicit generate click', async () => {
        mockCurrentUser = null;

        const { unmount } = renderLanding();

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Typed but not submitted idea' } });
        fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
        await screen.findByRole('dialog', { name: '登录 / 注册 BeeGame' });
        fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));

        expect(signInWithSupabaseOAuth).toHaveBeenCalledWith('github');
        unmount();

        mockCurrentUser = {
            id: 'oauth-user',
            email: 'oauth@example.com',
            displayName: 'OAuth Player',
            role: 'owner',
            permissions: ['project.create', 'project.delete'],
        };
        renderLanding();

        expect(screen.queryByRole('dialog', { name: '确认生成方案' })).not.toBeInTheDocument();
        expect(getCreditQuote).not.toHaveBeenCalled();
        expect(runIdeaIntake).not.toHaveBeenCalled();
    });

    it('opens a dedicated password reset view before sending reset email', async () => {
        mockCurrentUser = null;

        renderLanding();

        fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
        fireEvent.click(await screen.findByRole('button', { name: '忘记密码？' }));

        expect(await screen.findByText('找回通往创作的钥匙')).toBeInTheDocument();
        expect(screen.queryByLabelText('密码')).not.toBeInTheDocument();
        expect(sendSupabasePasswordReset).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'player@example.com' } });
        fireEvent.click(screen.getByRole('button', { name: '发送重置邮件' }));

        await waitFor(() => expect(sendSupabasePasswordReset).toHaveBeenCalledWith('player@example.com'));
        const successDialog = await screen.findByRole('dialog', { name: '操作成功' });
        expect(within(successDialog).getByText('重置密码邮件已发送，请检查邮箱。')).toBeInTheDocument();
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

    it('allows third-party login without an invitation code when invitations are enabled', async () => {
        mockCurrentUser = null;
        getInvitationPublicSettings.mockResolvedValue({ required: true });

        renderLanding();

        fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
        await screen.findByRole('button', { name: 'GitHub' });

        expect(screen.queryByText('第三方授权邀请码')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));

        expect(signInWithSupabaseOAuth).toHaveBeenCalledWith('github');
        fireEvent.change(screen.getByLabelText('第三方授权邀请码'), { target: { value: 'BEE-ALPHA' } });
        fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));

        expect(signInWithSupabaseOAuth).toHaveBeenCalledWith('github', { invitationCode: 'BEE-ALPHA' });
    });

    it('clears the Supabase session and reloads the current user when signing out', async () => {
        renderLanding();

        fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: '退出登录' }));

        expect(clearSupabaseSession).toHaveBeenCalledTimes(1);
        expect(mockLoadCurrentUser).toHaveBeenCalled();
    });

    it('stops intake generation when the credit quote cannot start', async () => {
        getCreditQuote.mockResolvedValueOnce({
            taskType: 'idea_intake',
            reservedCredits: 3,
            displayName: 'Idea intake',
            description: 'Generate candidate directions from an idea.',
            balanceCredits: 0,
            canStart: false,
            message: 'Insufficient credits.',
        });

        renderLanding();

        submitIdea('LLM generated idea');

        expect(await screen.findByText('Credit 不足。本次方案生成需要预扣 3 credits，你当前有 0 credits。')).toBeInTheDocument();
        expect(runIdeaIntake).not.toHaveBeenCalled();
    });

    it('generates selectable intake options without starting a BeeGame session immediately', async () => {
        const onStart = vi.fn().mockResolvedValue({ status: 'started', projectId: 'proj_1' });

        renderLanding({ onStart });

        const textbox = await submitIdeaAndConfirmIntake('LLM generated idea');

        expect(textbox).toBeDisabled();
        await screen.findByText('LLM Mode A');
        expect(screen.getByText('LLM Mode B')).toBeInTheDocument();
        expect(runIdeaIntake).toHaveBeenCalledWith({ idea: 'LLM generated idea', language: 'zh' });
        expect(onStart).not.toHaveBeenCalled();
        expect(analyzeIdeaIntake).not.toHaveBeenCalled();
    });

    it('shows generated intake options in a modal instead of embedding them into the landing page', async () => {
        renderLanding();

        await submitIdeaAndConfirmIntake('LLM generated idea');

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
        const cards = within(dialog).getAllByTestId('intake-option-card');
        expect(cards[0]).toHaveClass('grid', 'h-[25rem]', 'grid-rows-[5.25rem_1.75rem_minmax(0,1fr)]');
        expect(within(cards[0]).getByTestId('intake-option-title')).toHaveClass('line-clamp-2', 'overflow-hidden');
        expect(within(cards[0]).getByTestId('intake-option-gameplay')).toHaveClass('min-h-0', 'overflow-y-auto');
        expect(within(cards[0]).queryByTestId('intake-option-tags')).not.toBeInTheDocument();
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

        await submitIdeaAndConfirmIntake('LLM generated idea');

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

        const textbox = await submitIdeaAndConfirmIntake('LLM generated idea');

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

        await submitIdeaAndConfirmIntake('LLM concrete idea');

        expect(await screen.findByRole('dialog', { name: 'LLM Concrete Mode' })).toBeInTheDocument();
        expect(screen.getByTestId('intake-settings')).toBeInTheDocument();
        expect(screen.queryByTestId('intake-options')).not.toBeInTheDocument();
    });

    it('requires production settings to be chosen from values returned by the LLM', async () => {
        runIdeaIntake.mockResolvedValueOnce({
            maturity: 'vague',
            needsOptions: true,
            needsClarification: false,
            clarificationQuestions: [],
            detectedConstraints: [],
            recommendedNextStep: 'choose_direction',
            options: [
                {
                    ...makeIntakeOptions()[0],
                    recommendedPlatform: 'Web',
                    recommendedEngine: 'Unity',
                    recommendedDimension: '2D',
                    recommendedGenre: 'Arcade',
                    recommendedStyle: 'Pixel',
                    recommendedInputs: ['Keyboard/mouse'],
                },
                {
                    ...makeIntakeOptions()[1],
                    recommendedPlatform: 'Mobile',
                    recommendedEngine: 'Godot',
                    recommendedDimension: '3D',
                    recommendedGenre: 'Puzzle',
                    recommendedStyle: 'Cartoon',
                    recommendedInputs: ['Touch'],
                },
            ],
        });

        renderLanding();

        await submitIdeaAndConfirmIntake('LLM generated idea');

        fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));

        const platformSelect = screen.getByRole('combobox', { name: '平台' });
        const engineSelect = screen.getByRole('combobox', { name: '引擎' });
        const dimensionSelect = screen.getByRole('combobox', { name: '表现形式' });
        const genreSelect = screen.getByRole('combobox', { name: '游戏类型' });
        const styleSelect = screen.getByRole('combobox', { name: '风格' });

        expect(platformSelect).toHaveValue('');
        expect(engineSelect).toHaveValue('');
        expect(dimensionSelect).toHaveValue('');
        expect(genreSelect).toHaveValue('');
        expect(styleSelect).toHaveValue('');

        expect(within(platformSelect).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
            '',
            'Web',
            'Mobile',
        ]);
        expect(within(engineSelect).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
            '',
            'Unity',
            'Godot',
        ]);
        expect(within(dimensionSelect).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
            '',
            '2D',
            '3D',
        ]);
        expect(within(genreSelect).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
            '',
            'Arcade',
            'Puzzle',
        ]);
        expect(within(styleSelect).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
            '',
            'Pixel',
            'Cartoon',
        ]);
        expect(within(platformSelect).queryByRole('option', { name: 'Desktop' })).not.toBeInTheDocument();
        expect(within(engineSelect).queryByRole('option', { name: 'React' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '确认方案' }));

        expect(screen.getByTestId('intake-settings')).toBeInTheDocument();
        expect(screen.queryByTestId('confirmed-brief')).not.toBeInTheDocument();
        expect(screen.getByText('请选择制作设置。')).toBeInTheDocument();
    });

    it('confirms an intake brief before starting the BeeGame session', async () => {
        const onStart = vi.fn().mockResolvedValue({ status: 'started', projectId: 'proj_1' });

        renderLanding({ onStart });

        await submitIdeaAndConfirmIntake('LLM generated idea');

        fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));
        expect(screen.getByTestId('intake-settings')).toHaveAttribute('data-panel-depth', 'single');
        expect(screen.getByRole('dialog', { name: 'LLM Mode A' })).toBeInTheDocument();
        expect(screen.queryByText('补齐制作设置')).not.toBeInTheDocument();
        expect(screen.queryByText('LLM generated hypothesis A.')).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: '范围' })).not.toBeInTheDocument();
        expect(screen.queryByText('Auto')).not.toBeInTheDocument();

        const engineSelect = screen.getByRole('combobox', { name: '引擎' });
        expect(within(engineSelect).getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
            '',
            'React',
            'Godot',
        ]);
        fireEvent.change(screen.getByRole('combobox', { name: '平台' }), { target: { value: 'Web' } });
        fireEvent.change(engineSelect, { target: { value: 'Godot' } });
        fireEvent.change(screen.getByRole('combobox', { name: '表现形式' }), { target: { value: '3D' } });
        fireEvent.change(screen.getByRole('combobox', { name: '游戏类型' }), { target: { value: 'Puzzle' } });
        fireEvent.change(screen.getByRole('combobox', { name: '风格' }), { target: { value: 'Cartoon' } });
        fireEvent.click(screen.getByRole('button', { name: '请选择' }));
        const inputListbox = screen.getByRole('listbox', { name: '输入方式' });
        expect(inputListbox).toHaveAttribute('data-surface', 'frosted-glass');
        expect(inputListbox).toHaveAttribute('data-glass-density', 'reinforced');
        expect(inputListbox).toHaveAttribute('data-floating-layer', 'true');
        expect(inputListbox).toHaveClass('fixed', 'z-[220]');
        expect(inputListbox).toHaveClass('backdrop-blur-2xl');
        fireEvent.click(screen.getByRole('option', { name: '键鼠' }));
        fireEvent.click(screen.getByRole('option', { name: '触屏' }));
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
                platform: 'Web',
                engine: 'Godot',
                dimension: '3D',
                genre: 'Puzzle',
                visualStyle: 'Cartoon',
                inputs: ['Keyboard/mouse', 'Touch'],
                notes: '优先验证关卡节奏。',
            },
        });
    });

    it('closes the input method dropdown when clicking outside it', async () => {
        renderLanding();

        await submitIdeaAndConfirmIntake('LLM generated idea');
        fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));
        fireEvent.click(screen.getByRole('button', { name: '请选择' }));

        expect(screen.getByRole('listbox', { name: '输入方式' })).toBeInTheDocument();

        fireEvent.pointerDown(document.body);

        await waitFor(() => {
            expect(screen.queryByRole('listbox', { name: '输入方式' })).not.toBeInTheDocument();
        });
    });

    it('renders localized English hero copy and idea placeholder', () => {
        renderLanding({ lang: 'en' });

        expect(screen.getByRole('heading', { name: 'Start with an idea.' })).toBeInTheDocument();
        expect(screen.getByText('A few words are enough to begin.')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('What game do you want to make? e.g. a mobile puzzle game')).toBeInTheDocument();
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
        expect(screen.getByText('No projects for this account yet')).toBeInTheDocument();
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
