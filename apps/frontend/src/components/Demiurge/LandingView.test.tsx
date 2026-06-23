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
const mockDeleteProject = vi.fn();
const mockSetActiveProject = vi.fn();
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
    resetBeeGameWorkspaceRoot: vi.fn().mockResolvedValue({
        workspacePath: '/tmp/beegame-projects',
        isDefault: true,
    }),
    setBeeGameWorkspaceRoot: vi.fn().mockReturnValue({
        workspacePath: '/tmp/beegame-projects',
        isDefault: false,
    }),
}));

vi.mock('../../services/modelConfigApi', () => ({
    createModelConfig: vi.fn(),
    listModelConfigs: vi.fn().mockResolvedValue([]),
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
        isDark={false}
        onToggleTheme={vi.fn()}
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
    terminalRenderState.renderCount = 0;
});

describe('LandingView bootstrap submission', () => {
    it('generates selectable intake options without starting a BeeGame session immediately', async () => {
        const onStart = vi.fn().mockResolvedValue({ status: 'started', projectId: 'proj_1' });

        renderLanding({ onStart });

        const textbox = screen.getByRole('textbox');
        fireEvent.change(textbox, { target: { value: 'LLM generated idea' } });
        fireEvent.submit(textbox.closest('form') as HTMLFormElement);

        expect(textbox).toBeDisabled();
        await screen.findByText('LLM Mode A');
        expect(screen.getByText('LLM Mode B')).toBeInTheDocument();
        expect(runIdeaIntake).toHaveBeenCalledWith({ idea: 'LLM generated idea' });
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

        await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
        const [, clarification, brief] = onStart.mock.calls[0];
        expect(clarification).toBeUndefined();
        expect(brief).toMatchObject({
            idea: 'LLM generated idea',
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

    it('opens the settings overlay with dark mode, language, and system settings', () => {
        renderLanding({ lang: 'en' });

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
        expect(screen.getByText('Dark Mode')).toBeInTheDocument();
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

        fireEvent.click(screen.getByRole('button', { name: '历史项目' }));

        expect(screen.getByRole('dialog', { name: '历史项目' })).toBeInTheDocument();
        expect(screen.getByText('LLM Project')).toBeInTheDocument();
    });

    it('renders the project action menu outside the history dialog to avoid clipping', () => {
        mockProjects = [
            { id: 'project-1', name: 'LLM Project', created_at: '2026-04-20T00:00:00.000Z' },
        ];

        renderLanding({ lang: 'en' });

        fireEvent.click(screen.getByRole('button', { name: 'History Projects' }));
        const dialog = screen.getByRole('dialog', { name: 'History Projects' });

        fireEvent.click(screen.getByRole('button', { name: 'More actions for LLM Project' }));

        const deleteAction = screen.getByRole('button', { name: 'Delete Project' });
        expect(dialog).not.toContainElement(deleteAction);
    });

    it('shows an empty state in the history modal', () => {
        renderLanding({ lang: 'en' });

        fireEvent.click(screen.getByRole('button', { name: 'History Projects' }));

        expect(screen.getByRole('dialog', { name: 'History Projects' })).toBeInTheDocument();
        expect(screen.getByText('No Projects Found')).toBeInTheDocument();
    });
});
