import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LandingView } from './LandingView';

const { analyzeIdeaIntake } = vi.hoisted(() => ({
    analyzeIdeaIntake: vi.fn(),
}));
const { generateIntakeOptions } = vi.hoisted(() => ({
    generateIntakeOptions: vi.fn(),
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
    },
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
    generateIntakeOptions.mockResolvedValue([
        {
            id: 'classic_web',
            title: '经典 Web 版',
            pitch: '先做一个可玩的浏览器版本，突出清晰操作和即时反馈。',
            gameplay: '玩家控制角色收集目标并避开失败条件。',
            recommendedPlatform: 'Web',
            recommendedDimension: '2D',
            recommendedGenre: 'Arcade',
            recommendedStyle: 'Pixel',
            recommendedInputs: ['Keyboard/mouse', 'Touch'],
            scope: 'Playable demo',
        },
        {
            id: 'progression_demo',
            title: '成长演示版',
            pitch: '在基础循环上增加成长和关卡节奏。',
            gameplay: '玩家通过连续完成目标解锁变化。',
            recommendedPlatform: 'Web',
            recommendedDimension: '2D',
            recommendedGenre: 'Casual',
            recommendedStyle: 'Cartoon',
            recommendedInputs: ['Keyboard/mouse'],
            scope: 'Vertical slice',
        },
    ]);
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
        fireEvent.change(textbox, { target: { value: '贪吃蛇 Web 像素风' } });
        fireEvent.submit(textbox.closest('form') as HTMLFormElement);

        expect(textbox).toBeDisabled();
        await screen.findByText('经典 Web 版');
        expect(screen.getByText('成长演示版')).toBeInTheDocument();
        expect(generateIntakeOptions).toHaveBeenCalledWith({ idea: '贪吃蛇 Web 像素风' });
        expect(onStart).not.toHaveBeenCalled();
        expect(analyzeIdeaIntake).not.toHaveBeenCalled();
    });

    it('keeps the landing content visible while generating options', async () => {
        let resolveOptions: (value: Awaited<ReturnType<typeof generateIntakeOptions>>) => void = () => undefined;
        generateIntakeOptions.mockReturnValue(new Promise((resolve) => {
            resolveOptions = resolve;
        }));
        const onStart = vi.fn();

        renderLanding({ onStart });

        const textbox = screen.getByRole('textbox');
        fireEvent.change(textbox, { target: { value: '贪吃蛇 Web 像素风' } });
        fireEvent.submit(textbox.closest('form') as HTMLFormElement);

        expect(screen.getByRole('heading', { name: '从一个想法开始' })).toBeInTheDocument();
        expect(screen.getByText('寥寥几句，就足以启程。')).toBeInTheDocument();
        expect(textbox).toBeDisabled();

        resolveOptions([]);
        await waitFor(() => expect(generateIntakeOptions).toHaveBeenCalledTimes(1));
        expect(onStart).not.toHaveBeenCalled();
    });

    it('confirms an intake brief before starting the BeeGame session', async () => {
        const onStart = vi.fn().mockResolvedValue({ status: 'started', projectId: 'proj_1' });

        renderLanding({ onStart });

        const textbox = screen.getByRole('textbox');
        fireEvent.change(textbox, { target: { value: '城市经营游戏' } });
        fireEvent.submit(textbox.closest('form') as HTMLFormElement);

        fireEvent.click(await screen.findByRole('button', { name: /经典 Web 版/ }));
        expect(screen.getByTestId('intake-settings')).toBeInTheDocument();

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
            idea: '城市经营游戏',
            option: { id: 'classic_web', title: '经典 Web 版' },
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
            { id: 'project-1', name: 'Classic Snake', created_at: '2026-04-20T00:00:00.000Z' },
        ];

        renderLanding({ lang: 'zh' });

        fireEvent.click(screen.getByRole('button', { name: '历史项目' }));

        expect(screen.getByRole('dialog', { name: '历史项目' })).toBeInTheDocument();
        expect(screen.getByText('Classic Snake')).toBeInTheDocument();
    });

    it('shows an empty state in the history modal', () => {
        renderLanding({ lang: 'en' });

        fireEvent.click(screen.getByRole('button', { name: 'History Projects' }));

        expect(screen.getByRole('dialog', { name: 'History Projects' })).toBeInTheDocument();
        expect(screen.getByText('No Projects Found')).toBeInTheDocument();
    });
});
