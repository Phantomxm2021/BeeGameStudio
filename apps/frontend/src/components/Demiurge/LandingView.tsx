import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Camera, X } from 'lucide-react';
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
import { getCreditBalance, type BeeGameCreditBalance } from '../../services/creditsApi';
import {
    clearSupabaseSession,
    isSupabaseAuthConfigured,
    sendSupabasePasswordReset,
    signInWithSupabaseOAuth,
    signInWithSupabasePassword,
    signUpWithSupabasePassword,
    updateSupabaseAvatarUrl,
} from '../../services/supabaseAuthApi';

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
    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [registerDisplayName, setRegisterDisplayName] = useState('');
    const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [loginNotice, setLoginNotice] = useState('');
    const [isSigningIn, setIsSigningIn] = useState(false);
    const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [avatarDraft, setAvatarDraft] = useState('');
    const [profileError, setProfileError] = useState('');
    const [profileNotice, setProfileNotice] = useState('');
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [pendingIdeaAfterLogin, setPendingIdeaAfterLogin] = useState('');
    const [creditBalance, setCreditBalance] = useState<BeeGameCreditBalance | null>(null);
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
    const currentUser = useSystemStore(state => state.currentUser);
    const hasPermission = useSystemStore(state => state.hasPermission);
    const loadCurrentUser = useSystemStore(state => state.loadCurrentUser);

    useEffect(() => {
        if (!currentUser) {
            setCreditBalance(null);
            return;
        }
        let cancelled = false;
        void getCreditBalance()
            .then((balance) => {
                if (!cancelled) setCreditBalance(balance);
            })
            .catch(() => {
                if (!cancelled) setCreditBalance(null);
            });
        return () => {
            cancelled = true;
        };
    }, [currentUser?.id]);

    const handleSignOut = async () => {
        clearSupabaseSession();
        setCreditBalance(null);
        await loadCurrentUser();
    };

    const handleOpenLogin = () => {
        setPendingIdeaAfterLogin(projectName.trim());
        setLoginError('');
        setLoginNotice('');
        setAuthMode('login');
        setIsLoginPromptOpen(true);
    };

    const ensureGenerationAccess = async (): Promise<boolean> => {
        await loadCurrentUser();
        const latestUser = useSystemStore.getState().currentUser;
        if (!latestUser) {
            setPendingIdeaAfterLogin(projectName.trim());
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

    const handleLoginSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (isSigningIn) return;
        setLoginError('');
        setLoginNotice('');
        if (!isSupabaseAuthConfigured()) {
            setLoginError('Supabase Auth 尚未配置。');
            return;
        }
        const email = loginEmail.trim();
        if (!email || !loginPassword) {
            setLoginError('请输入邮箱和密码。');
            return;
        }
        if (authMode === 'register') {
            if (!registerDisplayName.trim()) {
                setLoginError('请设置昵称。');
                return;
            }
            if (!hasAcceptedTerms) {
                setLoginError('请先阅读并同意用户协议。');
                return;
            }
        }
        setIsSigningIn(true);
        try {
            if (authMode === 'register') {
                await signUpWithSupabasePassword({
                    email,
                    password: loginPassword,
                    displayName: registerDisplayName,
                });
            } else {
                await signInWithSupabasePassword({ email, password: loginPassword });
            }
            await loadCurrentUser();
            setIsLoginPromptOpen(false);
            setLoginPassword('');
            setRegisterDisplayName('');
            setHasAcceptedTerms(false);
            const nextIdea = pendingIdeaAfterLogin || projectName.trim();
            setPendingIdeaAfterLogin('');
            if (nextIdea) {
                setProjectName(nextIdea);
                const canGenerate = await ensureGenerationAccess();
                if (canGenerate) {
                    await runIntake(nextIdea);
                }
            }
        } catch (error) {
            setLoginError(error instanceof Error ? error.message : '登录失败，请重试。');
        } finally {
            setIsSigningIn(false);
        }
    };

    const handleSendPasswordReset = async () => {
        setLoginError('');
        setLoginNotice('');
        const email = loginEmail.trim();
        if (!email) {
            setLoginError('请输入邮箱，我们会发送重置密码邮件。');
            return;
        }
        setIsSigningIn(true);
        try {
            await sendSupabasePasswordReset(email);
            setLoginNotice('重置密码邮件已发送，请检查邮箱。');
        } catch (error) {
            setLoginError(error instanceof Error ? error.message : '重置密码邮件发送失败。');
        } finally {
            setIsSigningIn(false);
        }
    };

    const handleOpenProfile = () => {
        setProfileError('');
        setProfileNotice('');
        setAvatarDraft(currentUser?.avatarUrl || '');
        setIsProfileOpen(true);
    };

    const handleSaveAvatar = async () => {
        if (isSavingProfile) return;
        setProfileError('');
        setProfileNotice('');
        setIsSavingProfile(true);
        try {
            await updateSupabaseAvatarUrl(avatarDraft);
            await loadCurrentUser();
            setProfileNotice('头像已更新。');
        } catch (error) {
            setProfileError(error instanceof Error ? error.message : '头像更新失败。');
        } finally {
            setIsSavingProfile(false);
        }
    };

    const handleOAuthSignIn = (provider: 'github' | 'google') => {
        setLoginError('');
        try {
            signInWithSupabaseOAuth(provider);
        } catch (error) {
            setLoginError(error instanceof Error ? error.message : '第三方登录启动失败。');
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
                    currentUserId={currentUser?.id}
                    currentUserDisplayName={currentUser?.displayName || currentUser?.email}
                    currentUserAvatarUrl={currentUser?.avatarUrl}
                    creditBalance={creditBalance?.balanceCredits}
                    onOpenLogin={handleOpenLogin}
                    onOpenProfile={handleOpenProfile}
                    onSignOut={currentUser ? () => void handleSignOut() : undefined}
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

                {isProfileOpen && currentUser ? (
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="个人主页"
                        data-surface="frosted-glass"
                        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
                    >
                        <div className="input-surface w-full max-w-md rounded-[28px] border border-white/20 p-6 text-zinc-100 shadow-[0_28px_90px_rgba(0,0,0,0.5)]">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-2xl font-semibold text-white">个人主页</h2>
                                    <p className="mt-3 text-sm leading-6 text-zinc-300">
                                        管理你的 BeeGame 账号资料和登录状态。
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    aria-label="关闭个人主页"
                                    onClick={() => setIsProfileOpen(false)}
                                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#757575]/10 text-[#c5c1b9] transition hover:bg-[#757575]/20 hover:text-white"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="mt-6 flex items-center gap-4">
                                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-amber-300/35 bg-white/5 text-xl font-black text-white">
                                    {currentUser.avatarUrl ? (
                                        <img src={currentUser.avatarUrl} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                        getDisplayInitial(currentUser.displayName || currentUser.email || currentUser.id)
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <div className="truncate text-lg font-semibold text-white">{currentUser.displayName || '未设置昵称'}</div>
                                    <div className="truncate text-sm text-zinc-400">{currentUser.email || '邮箱未公开'}</div>
                                </div>
                            </div>

                            <label className="mt-6 block text-sm font-semibold text-zinc-200">
                                头像 URL
                                <div className="mt-2 flex gap-2">
                                    <input
                                        aria-label="头像 URL"
                                        type="url"
                                        value={avatarDraft}
                                        onChange={(event) => setAvatarDraft(event.target.value)}
                                        placeholder="https://..."
                                        className="h-11 min-w-0 flex-1 rounded-2xl border border-white/15 bg-black/15 px-3 text-white outline-none transition placeholder:text-zinc-500 focus:border-amber-300/70"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleSaveAvatar}
                                        disabled={isSavingProfile}
                                        className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white px-4 text-sm font-bold text-zinc-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <Camera className="h-4 w-4" />
                                        保存
                                    </button>
                                </div>
                            </label>

                            <div className="mt-4 grid gap-3">
                                <label className="block text-sm font-semibold text-zinc-200">
                                    昵称
                                    <input aria-label="昵称" readOnly value={currentUser.displayName || ''} className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-3 text-zinc-300 outline-none" />
                                </label>
                                <label className="block text-sm font-semibold text-zinc-200">
                                    邮箱
                                    <input aria-label="个人邮箱" readOnly value={currentUser.email || ''} className="mt-2 h-11 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-3 text-zinc-300 outline-none" />
                                </label>
                            </div>

                            {profileError ? <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-950/50 px-4 py-3 text-sm text-red-100">{profileError}</div> : null}
                            {profileNotice ? <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100">{profileNotice}</div> : null}

                            <div className="mt-6 flex justify-between gap-3">
                                <button
                                    type="button"
                                    onClick={() => void handleSignOut()}
                                    className="rounded-full border border-red-300/25 px-5 py-2.5 text-sm font-bold text-red-100 transition hover:bg-red-500/10"
                                >
                                    注销账户
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsProfileOpen(false)}
                                    className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-amber-200"
                                >
                                    完成
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}

                {isLoginPromptOpen ? (
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="登录 / 注册 BeeGame"
                        data-surface="frosted-glass"
                        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
                    >
                        <form
                            onSubmit={handleLoginSubmit}
                            className="input-surface w-full max-w-md rounded-[28px] border border-white/20 p-6 text-zinc-100 shadow-[0_28px_90px_rgba(0,0,0,0.5)]"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-2xl font-semibold text-white">
                                        {authMode === 'register' ? '创建 BeeGame 账号' : '欢迎回来'}
                                    </h2>
                                    <p className="mt-3 text-sm leading-6 text-zinc-300">
                                        {authMode === 'register'
                                            ? '设置昵称后即可保存项目、同步配置，并继续生成游戏方案。'
                                            : '登录后继续你的项目、模型设置和生成进度。'}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    aria-label="关闭登录弹窗"
                                    onClick={() => {
                                        setIsLoginPromptOpen(false);
                                        setLoginError('');
                                        setLoginNotice('');
                                    }}
                                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#757575]/10 text-[#c5c1b9] transition hover:bg-[#757575]/20 hover:text-white"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="mt-6 grid grid-cols-2 gap-2 rounded-full border border-white/10 bg-black/10 p-1">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAuthMode('login');
                                        setLoginError('');
                                        setLoginNotice('');
                                    }}
                                    className={`rounded-full px-3 py-2 text-sm font-semibold transition ${authMode === 'login' ? 'bg-white text-zinc-950' : 'text-zinc-300 hover:bg-white/10 hover:text-white'}`}
                                >
                                    登录
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAuthMode('register');
                                        setLoginError('');
                                        setLoginNotice('');
                                    }}
                                    className={`rounded-full px-3 py-2 text-sm font-semibold transition ${authMode === 'register' ? 'bg-white text-zinc-950' : 'text-zinc-300 hover:bg-white/10 hover:text-white'}`}
                                >
                                    注册账号
                                </button>
                            </div>
                            <div className="mt-6 space-y-3">
                                {authMode === 'register' ? (
                                    <label className="block text-sm font-semibold text-zinc-200">
                                        昵称
                                        <input
                                            aria-label="注册昵称"
                                            type="text"
                                            value={registerDisplayName}
                                            onChange={(event) => setRegisterDisplayName(event.target.value)}
                                            className="mt-2 h-11 w-full rounded-2xl border border-white/15 bg-black/15 px-3 text-white outline-none transition placeholder:text-zinc-500 focus:border-amber-300/70"
                                            autoComplete="nickname"
                                            placeholder="例如：Bee Maker"
                                        />
                                    </label>
                                ) : null}
                                <label className="block text-sm font-semibold text-zinc-200">
                                    邮箱
                                    <input
                                        aria-label="邮箱"
                                        type="email"
                                        value={loginEmail}
                                        onChange={(event) => setLoginEmail(event.target.value)}
                                        className="mt-2 h-11 w-full rounded-2xl border border-white/15 bg-black/15 px-3 text-white outline-none transition placeholder:text-zinc-500 focus:border-amber-300/70"
                                        autoComplete="email"
                                        placeholder="you@example.com"
                                    />
                                </label>
                                <label className="block text-sm font-semibold text-zinc-200">
                                    密码
                                    <input
                                        aria-label="密码"
                                        type="password"
                                        value={loginPassword}
                                        onChange={(event) => setLoginPassword(event.target.value)}
                                        className="mt-2 h-11 w-full rounded-2xl border border-white/15 bg-black/15 px-3 text-white outline-none transition placeholder:text-zinc-500 focus:border-amber-300/70"
                                        autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                                        placeholder={authMode === 'register' ? '至少 6 位密码' : '输入密码'}
                                    />
                                </label>
                                {authMode === 'login' ? (
                                    <button
                                        type="button"
                                        onClick={() => void handleSendPasswordReset()}
                                        disabled={isSigningIn}
                                        className="text-sm font-semibold text-amber-200 transition hover:text-amber-100 disabled:opacity-60"
                                    >
                                        忘记密码？发送重置邮件
                                    </button>
                                ) : (
                                    <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-zinc-300">
                                        <input
                                            aria-label="同意用户协议"
                                            type="checkbox"
                                            checked={hasAcceptedTerms}
                                            onChange={(event) => setHasAcceptedTerms(event.target.checked)}
                                            className="mt-1 h-4 w-4 rounded border-white/20 bg-black/30"
                                        />
                                        <span>
                                            我已阅读并同意 BeeGame 用户协议与隐私条款，理解生成内容会消耗 credit。
                                        </span>
                                    </label>
                                )}
                            </div>
                            {loginError ? (
                                <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-950/50 px-4 py-3 text-sm text-red-100">
                                    {loginError}
                                </div>
                            ) : null}
                            {loginNotice ? (
                                <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100">
                                    {loginNotice}
                                </div>
                            ) : null}
                            <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                                <span className="h-px flex-1 bg-white/10" />
                                <span>或使用第三方账号</span>
                                <span className="h-px flex-1 bg-white/10" />
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                                <button
                                    type="button"
                                    onClick={() => handleOAuthSignIn('github')}
                                    className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
                                >
                                    GitHub
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleOAuthSignIn('google')}
                                    className="rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
                                >
                                    Google
                                </button>
                            </div>
                            <div className="mt-6 flex items-center justify-end gap-3">
                                <button
                                    type="submit"
                                    disabled={isSigningIn}
                                    className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isSigningIn ? '处理中...' : authMode === 'register' ? '注册并继续' : '登录并继续'}
                                </button>
                            </div>
                        </form>
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

const getDisplayInitial = (value: string): string => {
    const first = Array.from(value.trim() || 'U')[0] || 'U';
    return /^[a-z]$/i.test(first) ? first.toUpperCase() : first;
};
