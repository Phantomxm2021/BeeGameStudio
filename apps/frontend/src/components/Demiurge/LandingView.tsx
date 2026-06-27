import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { translations, type Language } from './AgentsConfig';
import { useProjectStore } from '../../store/projectStore';
import { useSystemStore } from '../../store/systemStore';
import { HeroIntro } from './Landing/HeroIntro';
import { IdeaPromptForm } from './Landing/IdeaPromptForm';
import { LandingActions } from './Landing/LandingActions';
import { FaultyTerminalBackground } from './Landing/FaultyTerminalBackground';
import { ProjectHistoryModal } from './Landing/ProjectHistoryModal';
import { SettingsMenu } from './Landing/SettingsMenu';
import type { StartProjectResult } from '../../types/project';
import {
    beeGameAdapter,
    type BeeGameBuildBrief,
    type BeeGameClarification,
    type BeeGameIntakeOption,
    type BeeGameIntakeSettings,
} from '../../services/beeGameAdapter';
import { getCreditBalance } from '../../services/creditsApi';

type IntakePhase =
    | 'idle'
    | 'generating_options'
    | 'options_ready'
    | 'configuring_details'
    | 'confirming_brief'
    | 'starting_build';

const platformOptions = ['Auto', 'Web', 'Unity', 'Godot', 'XR', 'Native'];
const dimensionOptions = ['Auto', '2D', '3D', 'Mixed'];
const genreOptions = ['Auto', 'Arcade', 'Puzzle', 'Action', 'Adventure', 'Casual', 'Simulation', 'Strategy'];
const styleOptions = ['Auto', 'Pixel', 'Cartoon', 'Minimal', 'Painterly', 'Sci-fi', 'Fantasy', 'Realistic'];
const inputOptions = ['Auto', 'Keyboard/mouse', 'Gamepad', 'Touch', 'Voice', 'Hand tracking XR'];
const scopeOptions = ['Prototype', 'Playable demo', 'Vertical slice', 'MVP'];

interface LandingViewProps {
    onStart: (projectName: string, clarification?: Record<string, string>, brief?: BeeGameBuildBrief) => StartProjectResult | Promise<StartProjectResult>;
    lang: Language;
    onSetLang: (lang: Language) => void;
}

const settingsFromOption = (option: BeeGameIntakeOption): BeeGameIntakeSettings => ({
    platform: option.recommendedPlatform || 'Auto',
    visualStyle: option.recommendedStyle || 'Auto',
    dimension: option.recommendedDimension || 'Auto',
    genre: option.recommendedGenre || 'Auto',
    inputs: option.recommendedInputs.length > 0 ? option.recommendedInputs : ['Keyboard/mouse'],
    scope: option.scope || 'Prototype',
    notes: '',
});

const optionTags = (option: BeeGameIntakeOption): string[] => [
    option.recommendedPlatform,
    option.recommendedDimension,
    option.recommendedGenre,
].filter(tag => tag && tag !== 'Auto');

const optionsWithCurrentValue = (options: string[], value: string): string[] => {
    if (!value || options.includes(value)) return options;
    return [value, ...options];
};

export function LandingView({ onStart, lang, onSetLang }: LandingViewProps) {
    const [projectName, setProjectName] = useState('');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [isPreparing, setIsPreparing] = useState(false);
    const [intakePhase, setIntakePhase] = useState<IntakePhase>('idle');
    const [intakeOptions, setIntakeOptions] = useState<BeeGameIntakeOption[]>([]);
    const [selectedOption, setSelectedOption] = useState<BeeGameIntakeOption | null>(null);
    const [settings, setSettings] = useState<BeeGameIntakeSettings | null>(null);
    const [intakeError, setIntakeError] = useState('');
    const [clarification, setClarification] = useState<BeeGameClarification | null>(null);
    const [clarificationDraft, setClarificationDraft] = useState('');
    const [isLoginPromptOpen, setIsLoginPromptOpen] = useState(false);
    const t = translations[lang];
    const shouldShowIntakeModal = intakePhase !== 'idle' && intakePhase !== 'generating_options';
    const modalTitle = intakePhase === 'options_ready'
        ? '选择方案'
        : intakePhase === 'configuring_details'
            ? selectedOption?.title || '制作设置'
            : intakePhase === 'confirming_brief'
                ? '确认构建方案'
                : '启动构建';

    const setActiveProject = useProjectStore(state => state.setActiveProject);
    const hasPermission = useSystemStore(state => state.hasPermission);
    const loadCurrentUser = useSystemStore(state => state.loadCurrentUser);

    const ensureGenerationAccess = async (): Promise<boolean> => {
        await loadCurrentUser();
        const latestUser = useSystemStore.getState().currentUser;
        if (!latestUser) {
            setIsLoginPromptOpen(true);
            return false;
        }
        const credits = await getCreditBalance();
        const requiredCredits = credits.estimates.ideaIntake.minCredits;
        if (credits.balanceCredits < requiredCredits) {
            setIntakeError(`Credit 不足，生成方案预计至少需要 ${requiredCredits} credit。`);
            return false;
        }
        return true;
    };

    const runIntake = async (idea: string) => {
        setIntakeError('');
        setSelectedOption(null);
        setSettings(null);
        setIntakeOptions([]);
        setClarification(null);
        setClarificationDraft('');
        setIsPreparing(true);
        setIntakePhase('generating_options');
        try {
            const intake = await beeGameAdapter.runIdeaIntake({ idea, language: lang });
            if (intake.needsClarification && intake.clarification) {
                setIsPreparing(false);
                setIntakePhase('idle');
                setClarification(intake.clarification);
                return;
            }
            if (intake.needsClarification && intake.clarificationQuestions.length > 0) {
                setIsPreparing(false);
                setIntakePhase('idle');
                setClarification({
                    prompt: intake.clarificationQuestions[0],
                    options: [],
                    freeformLabel: '我来补充',
                });
                return;
            }
            setIntakeOptions(intake.options);
            if (!intake.needsOptions && intake.options[0]) {
                const option = intake.options[0];
                setSelectedOption(option);
                setSettings(settingsFromOption(option));
                setIntakePhase('configuring_details');
            } else {
                setIntakePhase('options_ready');
            }
            setIsPreparing(false);
        } catch (error) {
            setIsPreparing(false);
            setIntakePhase('idle');
            setIsTransitioning(false);
            setIntakeError(error instanceof Error ? error.message : '方案生成失败，请重试。');
            console.error('Failed to generate intake options:', error);
        }
    };

    const handleStart = async (event: React.FormEvent) => {
        event.preventDefault();
        const idea = projectName.trim();
        if (!idea || isTransitioning || isPreparing) return;
        setIntakeError('');
        setIsPreparing(true);
        const canGenerate = await ensureGenerationAccess();
        if (!canGenerate) {
            setIsPreparing(false);
            return;
        }
        setIsPreparing(false);
        await runIntake(idea);
    };

    const handleProjectNameChange = (value: string) => {
        setProjectName(value);
        if (intakePhase !== 'idle' && !isPreparing && !isTransitioning) {
            setIntakePhase('idle');
            setIntakeOptions([]);
            setSelectedOption(null);
            setSettings(null);
            setIntakeError('');
            setClarification(null);
            setClarificationDraft('');
        }
    };

    const handleClarificationAnswer = async (answer: string) => {
        if (!clarification || isPreparing || isTransitioning) return;
        const normalizedAnswer = answer.trim();
        if (!normalizedAnswer) return;
        const clarifiedIdea = [
            projectName.trim(),
            '',
            'Additional clarification:',
            `Question: ${clarification.prompt}`,
            `Answer: ${normalizedAnswer}`,
        ].join('\n');
        await runIntake(clarifiedIdea);
    };

    const handleSelectOption = (option: BeeGameIntakeOption) => {
        setSelectedOption(option);
        setSettings(settingsFromOption(option));
        setIntakePhase('configuring_details');
        setIntakeError('');
    };

    const updateSettings = (patch: Partial<BeeGameIntakeSettings>) => {
        setSettings((current) => current ? { ...current, ...patch } : current);
    };

    const toggleInput = (input: string) => {
        setSettings((current) => {
            if (!current) return current;
            const hasInput = current.inputs.includes(input);
            const nextInputs = hasInput
                ? current.inputs.filter((item) => item !== input)
                : [...current.inputs, input];
            return {
                ...current,
                inputs: nextInputs.length > 0 ? nextInputs : [input],
            };
        });
    };

    const handleConfirmSettings = () => {
        if (!selectedOption || !settings) return;
        setIntakePhase('confirming_brief');
    };

    const handleBackToOptions = () => {
        setIntakePhase('options_ready');
        setSelectedOption(null);
        setSettings(null);
    };

    const handleCloseIntake = () => {
        if (isPreparing || isTransitioning) return;
        setIntakePhase('idle');
        setIntakeOptions([]);
        setSelectedOption(null);
        setSettings(null);
        setIntakeError('');
        setClarification(null);
        setClarificationDraft('');
    };

    const handleStartBuild = async () => {
        if (!selectedOption || !settings || isTransitioning || isPreparing) return;
        setIntakeError('');
        setIsPreparing(true);
        setIntakePhase('starting_build');
        try {
            const brief: BeeGameBuildBrief = {
                idea: projectName.trim(),
                option: selectedOption,
                settings,
                title: selectedOption.title,
                language: lang,
            };
            await onStart(projectName.trim(), undefined, brief);
            setIsTransitioning(true);
        } catch (error) {
            setIsPreparing(false);
            setIntakePhase('confirming_brief');
            setIntakeError(error instanceof Error ? error.message : '项目启动失败，请检查服务后重试。');
            console.error('Failed to start confirmed project:', error);
        }
    };

    const handleSelectProject = async (id: string) => {
        setIsTransitioning(true);
        setIsHistoryOpen(false);
        try {
            await setActiveProject(id);
        } catch (error) {
            setIsTransitioning(false);
            console.error('Failed to select project:', error);
        }
    };

    return (
        <AnimatePresence mode="wait">
            <motion.div
                key="landing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 1.05, filter: 'blur(20px)' }}
                transition={{ duration: 0.8 }}
                className="absolute inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-white dark:bg-zinc-950"
            >
                <FaultyTerminalBackground isTransitioning={isTransitioning} />

                <LandingActions
                    lang={lang}
                    isTransitioning={isTransitioning}
                    isSettingsOpen={isSettingsOpen}
                    isHistoryOpen={isHistoryOpen}
                    onToggleSettings={() => {
                        setIsSettingsOpen((value) => !value);
                        setIsHistoryOpen(false);
                    }}
                    onToggleHistory={() => {
                        setIsHistoryOpen((value) => !value);
                        setIsSettingsOpen(false);
                    }}
                />

                <SettingsMenu
                    isOpen={isSettingsOpen}
                    lang={lang}
                    onClose={() => setIsSettingsOpen(false)}
                    onSetLang={onSetLang}
                    canManageWorkspace={hasPermission('workspace.manage')}
                    canManageSecrets={hasPermission('secrets.manage')}
                    canManageRuntimeSettings={hasPermission('runtime_settings.manage')}
                    canManageMcp={hasPermission('mcp.manage')}
                    canManageModelConfig={hasPermission('model_config.manage')}
                />

                <ProjectHistoryModal
                    isOpen={isHistoryOpen}
                    lang={lang}
                    onClose={() => setIsHistoryOpen(false)}
                    onSelectProject={handleSelectProject}
                />

                {isLoginPromptOpen ? (
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="登录 BeeGame"
                        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
                    >
                        <div className="w-full max-w-md rounded-[28px] border border-white/15 bg-zinc-950/90 p-6 text-zinc-100 shadow-[0_28px_90px_rgba(0,0,0,0.5)]">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-2xl font-semibold text-white">登录 BeeGame</h2>
                                    <p className="mt-3 text-sm leading-6 text-zinc-300">
                                        登录后即可继续生成方案，当前输入不会丢失。
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    aria-label="关闭登录弹窗"
                                    onClick={() => setIsLoginPromptOpen(false)}
                                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-zinc-300 transition hover:bg-white/15 hover:text-white"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="mt-6 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
                                正式登录入口将在 Supabase Auth 接入后启用；当前不会要求你在设置里粘贴 token。
                            </div>
                        </div>
                    </div>
                ) : null}

                <HeroIntro
                    title={t.landingTitle}
                    subtitle={t.landingSubtitle}
                    isTransitioning={isTransitioning}
                />

                <IdeaPromptForm
                    value={projectName}
                    placeholder={t.ideaPlaceholder}
                    generateLabel={t.generate}
                    isTransitioning={isTransitioning || isPreparing}
                    onChange={handleProjectNameChange}
                    onSubmit={handleStart}
                />

                {shouldShowIntakeModal ? (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={modalTitle}
                    data-intake-modal="true"
                    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm"
                >
                    <div className="relative flex max-h-[calc(100vh-3rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[32px] border border-white/15 bg-zinc-950/85 text-zinc-100 shadow-[0_28px_90px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
                        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,212,54,0.10),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.08),transparent_38%)]" />
                        <div className="relative z-10 flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-6">
                            <div className="min-w-0">
                                <h2 className="text-2xl font-semibold tracking-normal text-white">
                                    {modalTitle}
                                </h2>
                            </div>
                            <button
                                type="button"
                                aria-label="关闭方案弹窗"
                                disabled={isPreparing || isTransitioning}
                                onClick={handleCloseIntake}
                                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#757575]/10 text-[#c5c1b9] transition hover:bg-[#757575]/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-6 pb-6">

                    {intakePhase === 'options_ready' ? (
                        <div className="space-y-4" data-testid="intake-options">
                            <div className="grid gap-3 md:grid-cols-3">
                                {intakeOptions.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        onClick={() => handleSelectOption(option)}
                                        className="group rounded-2xl border border-white/15 bg-zinc-950/65 p-4 text-left shadow-2xl backdrop-blur-xl transition hover:border-amber-300/70 hover:bg-zinc-900/80"
                                    >
                                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">游戏模式</div>
                                        <div className="mt-2 text-base font-semibold text-white">{option.title}</div>
                                        <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">玩法</div>
                                        <div className="mt-2 text-sm leading-6 text-zinc-300">{option.gameplay}</div>
                                        {optionTags(option).length > 0 ? (
                                            <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-200">
                                                {optionTags(option).map(tag => (
                                                    <span key={tag} className="rounded-full bg-white/10 px-2.5 py-1">{tag}</span>
                                                ))}
                                            </div>
                                        ) : null}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {intakePhase === 'configuring_details' && selectedOption && settings ? (
                        <div className="space-y-5" data-testid="intake-settings" data-panel-depth="single">
                            <div>
                                <p className="max-w-3xl text-sm leading-6 text-zinc-300">{selectedOption.coreGameplayHypothesis}</p>
                                <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-500">{selectedOption.playablePrototype}</p>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                <label className="text-sm font-medium text-zinc-200">
                                    平台
                                    <select aria-label="平台" value={settings.platform} onChange={(event) => updateSettings({ platform: event.target.value })} className="mt-2 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-white">
                                        {optionsWithCurrentValue(platformOptions, settings.platform).map((option) => <option key={option}>{option}</option>)}
                                    </select>
                                </label>
                                <label className="text-sm font-medium text-zinc-200">
                                    表现形式
                                    <select aria-label="表现形式" value={settings.dimension} onChange={(event) => updateSettings({ dimension: event.target.value })} className="mt-2 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-white">
                                        {optionsWithCurrentValue(dimensionOptions, settings.dimension).map((option) => <option key={option}>{option}</option>)}
                                    </select>
                                </label>
                                <label className="text-sm font-medium text-zinc-200">
                                    游戏类型
                                    <select aria-label="游戏类型" value={settings.genre} onChange={(event) => updateSettings({ genre: event.target.value })} className="mt-2 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-white">
                                        {optionsWithCurrentValue(genreOptions, settings.genre).map((option) => <option key={option}>{option}</option>)}
                                    </select>
                                </label>
                                <label className="text-sm font-medium text-zinc-200">
                                    风格
                                    <select aria-label="风格" value={settings.visualStyle} onChange={(event) => updateSettings({ visualStyle: event.target.value })} className="mt-2 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-white">
                                        {optionsWithCurrentValue(styleOptions, settings.visualStyle).map((option) => <option key={option}>{option}</option>)}
                                    </select>
                                </label>
                                <label className="text-sm font-medium text-zinc-200">
                                    范围
                                    <select aria-label="范围" value={settings.scope} onChange={(event) => updateSettings({ scope: event.target.value })} className="mt-2 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-white">
                                        {optionsWithCurrentValue(scopeOptions, settings.scope).map((option) => <option key={option}>{option}</option>)}
                                    </select>
                                </label>
                            </div>

                            <div>
                                <div className="text-sm font-medium text-zinc-200">输入方式</div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {inputOptions.map((input) => {
                                        const active = settings.inputs.includes(input);
                                        return (
                                            <button
                                                key={input}
                                                type="button"
                                                onClick={() => toggleInput(input)}
                                                aria-pressed={active}
                                                className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${active ? 'border-emerald-300 bg-emerald-400 text-zinc-950' : 'border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10'}`}
                                            >
                                                {input}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <label className="block text-sm font-medium text-zinc-200">
                                补充说明
                                <textarea
                                    aria-label="补充说明"
                                    value={settings.notes || ''}
                                    onChange={(event) => updateSettings({ notes: event.target.value })}
                                    placeholder="可补充目标用户、参考游戏、特殊限制或你想优先验证的体验。"
                                    className="mt-2 min-h-20 w-full resize-none rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-white placeholder:text-zinc-500"
                                />
                            </label>

                            <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                                <button type="button" onClick={handleBackToOptions} className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-white/10">
                                    重新选择
                                </button>
                                <button type="button" onClick={handleConfirmSettings} className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-zinc-950 hover:bg-amber-200">
                                    确认方案
                                </button>
                            </div>
                        </div>
                    ) : null}

                    {intakePhase === 'confirming_brief' && selectedOption && settings ? (
                        <div className="space-y-4" data-testid="confirmed-brief" data-panel-depth="single">
                            <h3 className="text-2xl font-semibold text-white">{selectedOption.title}</h3>
                            <p className="mt-3 text-sm leading-6 text-zinc-300">{selectedOption.pitch}</p>
                            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                                <div><dt className="text-zinc-500">平台</dt><dd className="font-semibold text-white">{settings.platform}</dd></div>
                                <div><dt className="text-zinc-500">表现</dt><dd className="font-semibold text-white">{settings.dimension}</dd></div>
                                <div><dt className="text-zinc-500">类型</dt><dd className="font-semibold text-white">{settings.genre}</dd></div>
                                <div><dt className="text-zinc-500">风格</dt><dd className="font-semibold text-white">{settings.visualStyle}</dd></div>
                                <div><dt className="text-zinc-500">输入</dt><dd className="font-semibold text-white">{settings.inputs.join(' / ')}</dd></div>
                                <div><dt className="text-zinc-500">范围</dt><dd className="font-semibold text-white">{settings.scope}</dd></div>
                            </dl>
                            {settings.notes ? <p className="mt-4 rounded-2xl bg-white/5 p-3 text-sm text-zinc-300">{settings.notes}</p> : null}
                            <div className="mt-5 flex flex-wrap justify-end gap-3">
                                <button type="button" onClick={() => setIntakePhase('configuring_details')} className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-zinc-200 hover:bg-white/10">
                                    返回修改
                                </button>
                                <button type="button" disabled={isPreparing} onClick={handleStartBuild} className="rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-bold text-zinc-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60">
                                    {isPreparing ? '正在启动...' : '开始构建'}
                                </button>
                            </div>
                        </div>
                    ) : null}
                        </div>
                    </div>
                </div>
                ) : null}

                {clarification ? (
                    <div
                        role="status"
                        aria-live="polite"
                        data-testid="intake-clarification"
                        className="relative z-20 mt-4 w-[min(760px,calc(100vw-2rem))] rounded-[24px] border border-white/15 bg-zinc-950/60 px-5 py-4 text-left text-zinc-100 shadow-[0_18px_55px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
                    >
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-300">需求补充</div>
                        <p className="mt-2 text-sm leading-6 text-zinc-200">{clarification.prompt}</p>
                        {clarification.options.length > 0 ? (
                            <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                {clarification.options.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        disabled={isPreparing || isTransitioning}
                                        onClick={() => handleClarificationAnswer(option.value || option.label)}
                                        className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-left transition hover:border-amber-300/60 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <span className="block text-sm font-semibold text-white">{option.label}</span>
                                        {option.description ? (
                                            <span className="mt-1 block text-xs leading-5 text-zinc-400">{option.description}</span>
                                        ) : null}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        <form
                            className="mt-4 flex flex-col gap-2 sm:flex-row"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void handleClarificationAnswer(clarificationDraft);
                            }}
                        >
                            <input
                                aria-label={clarification.freeformLabel || '补充说明'}
                                value={clarificationDraft}
                                disabled={isPreparing || isTransitioning}
                                onChange={(event) => setClarificationDraft(event.target.value)}
                                placeholder={clarification.freeformLabel || '也可以直接补充你的理解'}
                                className="min-w-0 flex-1 rounded-full border border-white/15 bg-zinc-900/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-amber-300/70 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                            <button
                                type="submit"
                                disabled={!clarificationDraft.trim() || isPreparing || isTransitioning}
                                className="rounded-full bg-white px-5 py-3 text-sm font-bold text-zinc-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                继续
                            </button>
                        </form>
                    </div>
                ) : null}

                {intakeError ? (
                    <div className="relative z-20 mt-4 max-w-xl rounded-xl border border-red-400/30 bg-red-950/60 px-4 py-3 text-sm text-red-100 shadow-lg backdrop-blur">
                        {intakeError}
                    </div>
                ) : null}
            </motion.div>
        </AnimatePresence>
    );
}
