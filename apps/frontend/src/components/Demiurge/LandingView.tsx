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
import { deleteCurrentUser } from '../../services/currentUserApi';
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

type LegalDocumentKind = 'terms' | 'privacy';

const legalDocuments: Record<LegalDocumentKind, {
    title: string;
    updatedAt: string;
    intro: string;
    sections: Array<{ title: string; body: string }>;
}> = {
    terms: {
        title: 'BeeGame 用户协议',
        updatedAt: '2026-06-27',
        intro: '欢迎使用 BeeGame。本协议说明你在使用 BeeGame 生成、管理和预览游戏项目时的基本权利与责任。',
        sections: [
            {
                title: '账号与安全',
                body: '你需要提供真实可用的邮箱和昵称来创建账号。请妥善保管登录凭证，不要共享账号或用于规避系统限制。',
            },
            {
                title: '生成服务与 Credit',
                body: 'BeeGame 会根据你的输入调用模型、工具和项目运行环境生成游戏文档、代码、资源占位和预览。生成行为会消耗 credit，实际消耗可能因项目复杂度、模型、工具调用和重试次数变化。',
            },
            {
                title: '内容与项目归属',
                body: '你保留自己输入的 idea、上传资源和项目文件的权利。你需要确认输入、上传和分发的内容不侵犯第三方权利，也不违反适用法律或平台规则。',
            },
            {
                title: '可用性与风险',
                body: 'BeeGame 会尽力帮助你创建可运行的游戏项目，但生成内容可能包含错误、遗漏或不适合商业发布的部分。正式发布前，你应自行审查、测试并确认合规。',
            },
            {
                title: '禁止行为',
                body: '不得使用 BeeGame 生成恶意软件、规避安全策略、侵犯他人权益、违反法律法规或破坏服务稳定性的内容。',
            },
            {
                title: '变更与终止',
                body: 'BeeGame 可根据产品、安全或合规要求调整功能、计费和使用规则。你可以在个人主页注销账号；注销后云端账号和关联数据将按系统策略删除。',
            },
        ],
    },
    privacy: {
        title: 'BeeGame 隐私条款',
        updatedAt: '2026-06-27',
        intro: '本条款说明 BeeGame 如何处理登录、生成游戏和管理项目过程中涉及的数据。',
        sections: [
            {
                title: '我们收集的数据',
                body: '我们会处理你的账号信息、邮箱、昵称、头像地址、模型配置、项目元数据、生成记录、工具日志、credit 记录以及你主动上传的资源。',
            },
            {
                title: '数据用途',
                body: '这些数据用于身份验证、保存项目、同步配置、执行生成任务、展示历史记录、计算 credit、排查错误和改进产品体验。',
            },
            {
                title: '模型与第三方服务',
                body: '当你配置第三方 LLM、搜索、MCP 或托管服务时，相关请求可能会发送到你选择的服务商。请确认这些服务商的隐私和数据处理规则符合你的需求。',
            },
            {
                title: '资源与项目文件',
                body: '你上传的素材和生成的项目文件会用于当前项目构建、预览和后续修改。请不要上传你无权使用的素材、敏感身份信息或密钥。',
            },
            {
                title: '数据保留与删除',
                body: '你可以在个人主页注销账号。注销会触发账号删除流程，并按数据库关联规则清理云端账号数据。部分本地工作目录、导出包或备份需要你自行管理。',
            },
            {
                title: '安全',
                body: 'BeeGame 会通过登录鉴权、权限控制和隔离的项目工作目录降低风险。你仍应避免在项目或提示词中写入未加保护的密钥、凭证和隐私信息。',
            },
        ],
    },
};

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
    const [authMode, setAuthMode] = useState<'login' | 'register' | 'resetPassword'>('login');
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [avatarDraft, setAvatarDraft] = useState('');
    const [profileError, setProfileError] = useState('');
    const [profileNotice, setProfileNotice] = useState('');
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [isDeletingAccount, setIsDeletingAccount] = useState(false);
    const [isDeleteAccountConfirmOpen, setIsDeleteAccountConfirmOpen] = useState(false);
    const [deleteAccountConfirmation, setDeleteAccountConfirmation] = useState('');
    const [activeLegalDocument, setActiveLegalDocument] = useState<LegalDocumentKind | null>(null);
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
        if (authMode === 'resetPassword') {
            await handleSendPasswordReset();
            return;
        }
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
        setIsDeleteAccountConfirmOpen(false);
        setDeleteAccountConfirmation('');
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

    const handleDeleteAccount = async () => {
        if (isDeletingAccount) return;
        if (deleteAccountConfirmation.trim() !== 'DELETE') {
            setProfileError('请输入 DELETE 确认注销账户。');
            return;
        }
        setProfileError('');
        setProfileNotice('');
        setIsDeletingAccount(true);
        try {
            await deleteCurrentUser();
            clearSupabaseSession();
            await loadCurrentUser();
            setIsProfileOpen(false);
            setIsDeleteAccountConfirmOpen(false);
            setDeleteAccountConfirmation('');
        } catch (error) {
            setProfileError(error instanceof Error ? error.message : '账户注销失败。');
        } finally {
            setIsDeletingAccount(false);
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

                            {isDeleteAccountConfirmOpen ? (
                                <div className="mt-5 rounded-3xl border border-red-300/20 bg-red-950/20 p-4">
                                    <div className="text-sm font-semibold text-red-100">注销账户会删除云端账号和关联数据。</div>
                                    <div className="mt-1 text-xs leading-5 text-red-100/70">
                                        这一步无法撤销。请输入 DELETE 后确认注销。
                                    </div>
                                    <div className="mt-3 flex gap-2">
                                        <input
                                            aria-label="注销账户确认"
                                            value={deleteAccountConfirmation}
                                            onChange={(event) => setDeleteAccountConfirmation(event.target.value)}
                                            placeholder="DELETE"
                                            className="h-11 min-w-0 flex-1 rounded-2xl border border-red-200/20 bg-black/20 px-3 text-white outline-none placeholder:text-red-100/35 focus:border-red-200/60"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleDeleteAccount}
                                            disabled={isDeletingAccount}
                                            className="rounded-2xl bg-red-100 px-4 text-sm font-bold text-red-950 transition hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {isDeletingAccount ? '注销中...' : '确认注销'}
                                        </button>
                                    </div>
                                </div>
                            ) : null}

                            <div className="mt-6 flex justify-between gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setProfileError('');
                                        setProfileNotice('');
                                        setIsDeleteAccountConfirmOpen(true);
                                    }}
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
                                        {authMode === 'resetPassword'
                                            ? '重置密码'
                                            : authMode === 'register'
                                                ? '创建 BeeGame 账号'
                                                : '欢迎回来'}
                                    </h2>
                                    <p className="mt-3 text-sm leading-6 text-zinc-300">
                                        {authMode === 'resetPassword'
                                            ? '输入注册邮箱，我们会发送密码重置邮件。'
                                            : authMode === 'register'
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
                            {authMode !== 'resetPassword' ? (
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
                            ) : null}
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
                                {authMode !== 'resetPassword' ? (
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
                                ) : null}
                                {authMode === 'login' ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAuthMode('resetPassword');
                                            setLoginError('');
                                            setLoginNotice('');
                                        }}
                                        disabled={isSigningIn}
                                        className="mx-auto block text-center text-sm font-semibold text-amber-200 transition hover:text-amber-100 disabled:opacity-60"
                                    >
                                        忘记密码？
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
                                            我已阅读并同意 BeeGame{' '}
                                            <button
                                                type="button"
                                                onClick={() => setActiveLegalDocument('terms')}
                                                className="font-semibold text-amber-200 underline decoration-amber-200/40 underline-offset-4 transition hover:text-amber-100"
                                            >
                                                用户协议
                                            </button>
                                            {' '}与{' '}
                                            <button
                                                type="button"
                                                onClick={() => setActiveLegalDocument('privacy')}
                                                className="font-semibold text-amber-200 underline decoration-amber-200/40 underline-offset-4 transition hover:text-amber-100"
                                            >
                                                隐私条款
                                            </button>
                                            ，理解生成内容会消耗 credit。
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
                            {authMode === 'login' ? (
                                <>
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
                                </>
                            ) : null}
                            <div className="mt-6 flex items-center justify-end gap-3">
                                {authMode === 'resetPassword' ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAuthMode('login');
                                            setLoginError('');
                                            setLoginNotice('');
                                        }}
                                        className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-bold text-zinc-200 transition hover:bg-white/10 hover:text-white"
                                    >
                                        返回登录
                                    </button>
                                ) : null}
                                <button
                                    type="submit"
                                    disabled={isSigningIn}
                                    className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isSigningIn
                                        ? '处理中...'
                                        : authMode === 'resetPassword'
                                            ? '发送重置邮件'
                                            : authMode === 'register'
                                                ? '注册并继续'
                                                : '登录并继续'}
                                </button>
                            </div>
                        </form>
                    </div>
                ) : null}

                {activeLegalDocument ? (
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={legalDocuments[activeLegalDocument].title}
                        data-surface="frosted-glass"
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm"
                    >
                        <div className="input-surface flex max-h-[calc(100vh-3rem)] w-full max-w-2xl flex-col rounded-[30px] border border-white/20 p-6 text-zinc-100 shadow-[0_28px_90px_rgba(0,0,0,0.55)] sm:p-7">
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <h2 className="text-2xl font-semibold text-white">
                                        {legalDocuments[activeLegalDocument].title}
                                    </h2>
                                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                                        Updated {legalDocuments[activeLegalDocument].updatedAt}
                                    </p>
                                    <p className="mt-4 text-sm leading-6 text-zinc-300">
                                        {legalDocuments[activeLegalDocument].intro}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    aria-label="关闭法律文档"
                                    onClick={() => setActiveLegalDocument(null)}
                                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#757575]/10 text-[#c5c1b9] transition hover:bg-[#757575]/20 hover:text-white"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
                                <div className="space-y-4">
                                    {legalDocuments[activeLegalDocument].sections.map(section => (
                                        <section key={section.title} className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                                            <h3 className="text-sm font-bold text-white">{section.title}</h3>
                                            <p className="mt-2 text-sm leading-6 text-zinc-300">{section.body}</p>
                                        </section>
                                    ))}
                                </div>
                            </div>
                            <div className="mt-6 flex justify-end border-t border-white/10 pt-5">
                                <button
                                    type="button"
                                    onClick={() => setActiveLegalDocument(null)}
                                    className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-zinc-950 transition hover:bg-amber-200"
                                >
                                    我已了解
                                </button>
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

const getDisplayInitial = (value: string): string => {
    const first = Array.from(value.trim() || 'U')[0] || 'U';
    return /^[a-z]$/i.test(first) ? first.toUpperCase() : first;
};
