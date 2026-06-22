import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { translations, type Language } from './AgentsConfig';
import { useProjectStore } from '../../store/projectStore';
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
    type BeeGameIntakeOption,
    type BeeGameIntakeSettings,
} from '../../services/beeGameAdapter';

type IntakePhase =
    | 'idle'
    | 'generating_options'
    | 'options_ready'
    | 'configuring_details'
    | 'confirming_brief'
    | 'starting_build';

const platformOptions = ['Web', 'Unity', 'Godot', 'XR', 'Native'];
const dimensionOptions = ['2D', '3D', 'Mixed'];
const genreOptions = ['Arcade', 'Puzzle', 'Action', 'Adventure', 'Casual', 'Simulation', 'Strategy'];
const styleOptions = ['Pixel', 'Cartoon', 'Minimal', 'Painterly', 'Sci-fi', 'Fantasy', 'Realistic'];
const inputOptions = ['Keyboard/mouse', 'Gamepad', 'Touch', 'Voice', 'Hand tracking XR'];
const scopeOptions = ['Prototype', 'Playable demo', 'Vertical slice', 'MVP'];

interface LandingViewProps {
    onStart: (projectName: string, clarification?: Record<string, string>, brief?: BeeGameBuildBrief) => StartProjectResult | Promise<StartProjectResult>;
    lang: Language;
    isDark: boolean;
    onToggleTheme: () => void;
    onSetLang: (lang: Language) => void;
}

const settingsFromOption = (option: BeeGameIntakeOption): BeeGameIntakeSettings => ({
    platform: option.recommendedPlatform,
    visualStyle: option.recommendedStyle,
    dimension: option.recommendedDimension,
    genre: option.recommendedGenre,
    inputs: option.recommendedInputs.length > 0 ? option.recommendedInputs : ['Keyboard/mouse'],
    scope: option.scope,
    notes: '',
});

export function LandingView({ onStart, lang, isDark, onToggleTheme, onSetLang }: LandingViewProps) {
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
    const t = translations[lang];

    const setActiveProject = useProjectStore(state => state.setActiveProject);

    const handleStart = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!projectName.trim() || isTransitioning || isPreparing) return;

        setIntakeError('');
        setSelectedOption(null);
        setSettings(null);
        setIntakeOptions([]);
        setIsPreparing(true);
        setIntakePhase('generating_options');
        try {
            const options = await beeGameAdapter.generateIntakeOptions({ idea: projectName.trim() });
            setIntakeOptions(options);
            setIntakePhase('options_ready');
            setIsPreparing(false);
        } catch (error) {
            setIsPreparing(false);
            setIntakePhase('idle');
            setIsTransitioning(false);
            setIntakeError(error instanceof Error ? error.message : '方案生成失败，请重试。');
            console.error('Failed to generate intake options:', error);
        }
    };

    const handleProjectNameChange = (value: string) => {
        setProjectName(value);
        if (intakePhase !== 'idle' && !isPreparing && !isTransitioning) {
            setIntakePhase('idle');
            setIntakeOptions([]);
            setSelectedOption(null);
            setSettings(null);
            setIntakeError('');
        }
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
                    isDark={isDark}
                    onClose={() => setIsSettingsOpen(false)}
                    onToggleTheme={onToggleTheme}
                    onSetLang={onSetLang}
                />

                <ProjectHistoryModal
                    isOpen={isHistoryOpen}
                    lang={lang}
                    onClose={() => setIsHistoryOpen(false)}
                    onSelectProject={handleSelectProject}
                />

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

                <div className="relative z-20 mt-6 w-full max-w-5xl px-4">
                    {intakePhase === 'generating_options' ? (
                        <div className="mx-auto max-w-xl rounded-2xl border border-white/15 bg-zinc-950/55 px-5 py-4 text-center text-sm text-zinc-100 shadow-2xl backdrop-blur-xl">
                            正在根据你的想法生成可选方案...
                        </div>
                    ) : null}

                    {intakePhase === 'options_ready' ? (
                        <div className="space-y-4" data-testid="intake-options">
                            <div className="text-center text-xs font-semibold uppercase tracking-[0.28em] text-amber-300">
                                Choose a direction
                            </div>
                            <div className="grid gap-3 md:grid-cols-3">
                                {intakeOptions.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        onClick={() => handleSelectOption(option)}
                                        className="group rounded-2xl border border-white/15 bg-zinc-950/65 p-4 text-left shadow-2xl backdrop-blur-xl transition hover:border-amber-300/70 hover:bg-zinc-900/80"
                                    >
                                        <div className="text-base font-semibold text-white">{option.title}</div>
                                        <div className="mt-2 text-sm leading-6 text-zinc-300">{option.pitch}</div>
                                        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-200">
                                            <span className="rounded-full bg-white/10 px-2.5 py-1">{option.recommendedPlatform}</span>
                                            <span className="rounded-full bg-white/10 px-2.5 py-1">{option.recommendedDimension}</span>
                                            <span className="rounded-full bg-white/10 px-2.5 py-1">{option.recommendedGenre}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {intakePhase === 'configuring_details' && selectedOption && settings ? (
                        <div className="mx-auto max-w-4xl rounded-3xl border border-white/15 bg-zinc-950/70 p-5 shadow-2xl backdrop-blur-xl" data-testid="intake-settings">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <div className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-300">Build settings</div>
                                    <h2 className="mt-2 text-2xl font-semibold text-white">{selectedOption.title}</h2>
                                    <p className="mt-2 text-sm leading-6 text-zinc-300">{selectedOption.gameplay}</p>
                                </div>
                                <button type="button" onClick={handleBackToOptions} className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/10">
                                    重新选择
                                </button>
                            </div>

                            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                <label className="text-sm font-medium text-zinc-200">
                                    平台
                                    <select aria-label="平台" value={settings.platform} onChange={(event) => updateSettings({ platform: event.target.value })} className="mt-2 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-white">
                                        {platformOptions.map((option) => <option key={option}>{option}</option>)}
                                    </select>
                                </label>
                                <label className="text-sm font-medium text-zinc-200">
                                    表现形式
                                    <select aria-label="表现形式" value={settings.dimension} onChange={(event) => updateSettings({ dimension: event.target.value })} className="mt-2 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-white">
                                        {dimensionOptions.map((option) => <option key={option}>{option}</option>)}
                                    </select>
                                </label>
                                <label className="text-sm font-medium text-zinc-200">
                                    游戏类型
                                    <select aria-label="游戏类型" value={settings.genre} onChange={(event) => updateSettings({ genre: event.target.value })} className="mt-2 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-white">
                                        {genreOptions.map((option) => <option key={option}>{option}</option>)}
                                    </select>
                                </label>
                                <label className="text-sm font-medium text-zinc-200">
                                    风格
                                    <select aria-label="风格" value={settings.visualStyle} onChange={(event) => updateSettings({ visualStyle: event.target.value })} className="mt-2 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-white">
                                        {styleOptions.map((option) => <option key={option}>{option}</option>)}
                                    </select>
                                </label>
                                <label className="text-sm font-medium text-zinc-200">
                                    范围
                                    <select aria-label="范围" value={settings.scope} onChange={(event) => updateSettings({ scope: event.target.value })} className="mt-2 w-full rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-white">
                                        {scopeOptions.map((option) => <option key={option}>{option}</option>)}
                                    </select>
                                </label>
                            </div>

                            <div className="mt-5">
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

                            <label className="mt-5 block text-sm font-medium text-zinc-200">
                                补充说明
                                <textarea
                                    aria-label="补充说明"
                                    value={settings.notes || ''}
                                    onChange={(event) => updateSettings({ notes: event.target.value })}
                                    placeholder="可补充目标用户、参考游戏、特殊限制或你想优先验证的体验。"
                                    className="mt-2 min-h-20 w-full resize-none rounded-xl border border-white/15 bg-zinc-900 px-3 py-2 text-white placeholder:text-zinc-500"
                                />
                            </label>

                            <div className="mt-5 flex justify-end">
                                <button type="button" onClick={handleConfirmSettings} className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-zinc-950 hover:bg-amber-200">
                                    确认方案
                                </button>
                            </div>
                        </div>
                    ) : null}

                    {intakePhase === 'confirming_brief' && selectedOption && settings ? (
                        <div className="mx-auto max-w-3xl rounded-3xl border border-amber-300/30 bg-zinc-950/75 p-5 shadow-2xl backdrop-blur-xl" data-testid="confirmed-brief">
                            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-300">Confirmed brief</div>
                            <h2 className="mt-2 text-2xl font-semibold text-white">{selectedOption.title}</h2>
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

                {intakeError ? (
                    <div className="relative z-20 mt-4 max-w-xl rounded-xl border border-red-400/30 bg-red-950/60 px-4 py-3 text-sm text-red-100 shadow-lg backdrop-blur">
                        {intakeError}
                    </div>
                ) : null}
            </motion.div>
        </AnimatePresence>
    );
}
