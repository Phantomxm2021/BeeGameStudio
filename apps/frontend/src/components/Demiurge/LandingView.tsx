import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Camera, Check, ChevronDown, X } from 'lucide-react';
import type { Language } from './AgentsConfig';
import { normalizeI18nLanguage, useCommonText } from '../../i18n/useBeeGameTranslations';
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
import {
    getCreditBalance,
    getCreditLedger,
    getCreditQuote,
    type BeeGameCreditBalance,
    type BeeGameCreditLedgerEntry,
    type BeeGameCreditQuote,
} from '../../services/creditsApi';
import {
    clearSupabaseSession,
    isSupabaseAuthConfigured,
    sendSupabasePasswordReset,
    signInWithSupabaseOAuth,
    signInWithSupabasePassword,
    signUpWithSupabasePassword,
    type SupabaseOAuthProvider,
    updateSupabaseAvatarUrl,
    uploadSupabaseAvatarImage,
} from '../../services/supabaseAuthApi';
import { deleteCurrentUser } from '../../services/currentUserApi';
import { listModelConfigs } from '../../services/modelConfigApi';

type IntakePhase =
    | 'idle'
    | 'generating_options'
    | 'options_ready'
    | 'configuring_details'
    | 'confirming_brief'
    | 'starting_build';

const platformOptions = ['Web', 'Mobile', 'Desktop', 'XR', 'Console'];
const engineOptions = ['React', 'Unity', 'Godot', 'Unreal'];
const dimensionOptions = ['2D', '3D', 'Mixed'];
const genreOptions = ['Arcade', 'Puzzle', 'Action', 'Adventure', 'Casual', 'Simulation', 'Strategy', 'RPG'];
const styleOptions = ['Pixel', 'Cartoon', 'Minimal', 'Painterly', 'Sci-fi', 'Fantasy', 'Realistic'];
const inputOptions = ['Keyboard/mouse', 'Gamepad', 'Touch', 'Voice', 'Hand tracking XR'];

type IntakeCopy = {
    modal: {
        chooseOption: string;
        productionSettings: string;
        confirmBuildBrief: string;
        startBuild: string;
        close: string;
    };
    optionCard: {
        mode: string;
        gameplay: string;
    };
    fields: {
        platform: string;
        engine: string;
        dimension: string;
        genre: string;
        style: string;
        inputs: string;
        notes: string;
        presentation: string;
        type: string;
    };
    actions: {
        chooseAgain: string;
        confirmBrief: string;
        edit: string;
        building: string;
        startBuild: string;
        continue: string;
        backToLogin: string;
        cancel: string;
        confirmGenerate: string;
        confirmBuild: string;
    };
    clarification: {
        title: string;
        freeformLabel: string;
        placeholder: string;
    };
    errors: {
        missingPlatformModel: string;
        insufficientCredits: (taskName: string, reservedCredits: number, balanceCredits: number) => string;
        quoteFailed: string;
        projectStartFailed: string;
        authNotConfigured: string;
        missingEmailPassword: string;
        missingDisplayName: string;
        termsRequired: string;
    };
    placeholders: {
        notes: string;
    };
    profile: {
        displayNameFallback: string;
        emailFallback: string;
        balance: string;
        consumed: string;
        reserved: string;
        loadingCreditDetails: string;
        viewCreditDetails: string;
        ledgerCount: (count: number) => string;
        noLedgerRecords: string;
        closeCreditDetails: string;
        deleteAccount: string;
        deleteConfirm: string;
        deleteFailed: string;
        finish: string;
        saving: string;
    };
    credits: {
        intakeTask: string;
        buildTask: string;
        title: (taskName: string) => string;
        description: (taskName: string, reservedCredits: number) => string;
        refundRule: string;
        balance: string;
        reserved: string;
    };
    auth: {
        oauthDivider: string;
        signingIn: string;
        sendReset: string;
        registerAndContinue: string;
        signInAndContinue: string;
        oauthFailed: string;
        forgotPassword: string;
        acceptTermsAria: string;
        acceptTermsPrefix: string;
        termsLabel: string;
        privacyLabel: string;
        acceptTermsConnector: string;
        acceptTermsSuffix: string;
    };
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

const createLandingIntakeCopy = (translate: Translate): IntakeCopy => ({
    modal: {
        chooseOption: translate('modal.chooseOption'),
        productionSettings: translate('modal.productionSettings'),
        confirmBuildBrief: translate('modal.confirmBuildBrief'),
        startBuild: translate('modal.startBuild'),
        close: translate('modal.close'),
    },
    optionCard: {
        mode: translate('optionCard.mode'),
        gameplay: translate('optionCard.gameplay'),
    },
    fields: {
        platform: translate('fields.platform'),
        engine: translate('fields.engine'),
        dimension: translate('fields.dimension'),
        genre: translate('fields.genre'),
        style: translate('fields.style'),
        inputs: translate('fields.inputs'),
        notes: translate('fields.notes'),
        presentation: translate('fields.presentation'),
        type: translate('fields.type'),
    },
    actions: {
        chooseAgain: translate('actions.chooseAgain'),
        confirmBrief: translate('actions.confirmBrief'),
        edit: translate('actions.edit'),
        building: translate('actions.building'),
        startBuild: translate('actions.startBuild'),
        continue: translate('actions.continue'),
        backToLogin: translate('actions.backToLogin'),
        cancel: translate('actions.cancel'),
        confirmGenerate: translate('actions.confirmGenerate'),
        confirmBuild: translate('actions.confirmBuild'),
    },
    clarification: {
        title: translate('clarification.title'),
        freeformLabel: translate('clarification.freeformLabel'),
        placeholder: translate('clarification.placeholder'),
    },
    errors: {
        missingPlatformModel: translate('errors.missingPlatformModel'),
        insufficientCredits: (taskName, reservedCredits, balanceCredits) => translate('errors.insufficientCredits', {
            taskName,
            reservedCredits,
            balanceCredits,
        }),
        quoteFailed: translate('errors.quoteFailed'),
        projectStartFailed: translate('errors.projectStartFailed'),
        authNotConfigured: translate('errors.authNotConfigured'),
        missingEmailPassword: translate('errors.missingEmailPassword'),
        missingDisplayName: translate('errors.missingDisplayName'),
        termsRequired: translate('errors.termsRequired'),
    },
    placeholders: {
        notes: translate('placeholders.notes'),
    },
    profile: {
        displayNameFallback: translate('profile.displayNameFallback'),
        emailFallback: translate('profile.emailFallback'),
        balance: translate('profile.balance'),
        consumed: translate('profile.consumed'),
        reserved: translate('profile.reserved'),
        loadingCreditDetails: translate('profile.loadingCreditDetails'),
        viewCreditDetails: translate('profile.viewCreditDetails'),
        ledgerCount: count => translate('profile.ledgerCount', { count }),
        noLedgerRecords: translate('profile.noLedgerRecords'),
        closeCreditDetails: translate('profile.closeCreditDetails'),
        deleteAccount: translate('profile.deleteAccount'),
        deleteConfirm: translate('profile.deleteConfirm'),
        deleteFailed: translate('profile.deleteFailed'),
        finish: translate('profile.finish'),
        saving: translate('profile.saving'),
    },
    credits: {
        intakeTask: translate('credits.task.ideaIntake'),
        buildTask: translate('credits.task.fullBuild'),
        title: taskName => (
            taskName === translate('credits.task.ideaIntake')
                ? translate('credits.title.ideaIntake')
                : translate('credits.title.fullBuild')
        ),
        description: (taskName, reservedCredits) => translate('credits.description', {
            taskName,
            reservedCredits,
        }),
        refundRule: translate('credits.refundRule'),
        balance: translate('credits.balance'),
        reserved: translate('credits.reserved'),
    },
    auth: {
        oauthDivider: translate('auth.oauthDivider'),
        signingIn: translate('auth.signingIn'),
        sendReset: translate('auth.sendReset'),
        registerAndContinue: translate('auth.registerAndContinue'),
        signInAndContinue: translate('auth.signInAndContinue'),
        oauthFailed: translate('auth.oauthFailed'),
        forgotPassword: translate('auth.forgotPassword'),
        acceptTermsAria: translate('auth.acceptTermsAria'),
        acceptTermsPrefix: translate('auth.acceptTermsPrefix'),
        termsLabel: translate('auth.termsLabel'),
        privacyLabel: translate('auth.privacyLabel'),
        acceptTermsConnector: translate('auth.acceptTermsConnector'),
        acceptTermsSuffix: translate('auth.acceptTermsSuffix'),
    },
});

type LegalDocumentKind = 'terms' | 'privacy';

type LegalDocumentBundle = Record<LegalDocumentKind, {
    title: string;
    updatedAt: string;
    intro: string;
    sections: Array<{ title: string; body: string }>;
}>;

interface LandingViewProps {
    onStart: (projectName: string, clarification?: Record<string, string>, brief?: BeeGameBuildBrief) => StartProjectResult | Promise<StartProjectResult>;
    lang: Language;
    onSetLang: (lang: Language) => void;
}

const settingsFromOption = (option: BeeGameIntakeOption): BeeGameIntakeSettings => ({
    platform: normalizeOptionValue(platformOptions, inferPlatform(option.recommendedPlatform), 'Web'),
    engine: normalizeOptionValue(engineOptions, inferEngine(option.recommendedPlatform), 'React'),
    visualStyle: normalizeOptionValue(styleOptions, option.recommendedStyle, 'Cartoon'),
    dimension: normalizeOptionValue(dimensionOptions, option.recommendedDimension, '2D'),
    genre: normalizeOptionValue(genreOptions, option.recommendedGenre, 'Arcade'),
    inputs: normalizeInputs(option.recommendedInputs),
    scope: option.scope || 'Prototype',
    notes: '',
});

const optionsWithCurrentValue = (options: string[], value: string): string[] => {
    if (!value || value === 'Auto' || options.includes(value)) return options;
    return [value, ...options];
};

function normalizeInputs(inputs: string[]): string[] {
    const normalized = inputs.filter(input => input && input !== 'Auto');
    return normalized.length > 0 ? normalized : ['Keyboard/mouse'];
}

function normalizeOptionValue(_options: string[], value: string | undefined, fallback: string): string {
    const normalized = value?.trim();
    if (!normalized || normalized === 'Auto') return fallback;
    return normalized;
}

function inferPlatform(value: string | undefined): string {
    const normalized = value?.trim();
    if (!normalized || normalized === 'Auto') return 'Web';
    if (engineOptions.includes(normalized)) return normalized === 'React' ? 'Web' : 'Desktop';
    return normalized;
}

function inferEngine(value: string | undefined): string {
    const normalized = value?.trim();
    if (!normalized || normalized === 'Auto') return 'React';
    if (normalized === 'Unreal Engine') return 'Unreal';
    if (engineOptions.includes(normalized)) return normalized;
    if (normalized === 'Web') return 'React';
    if (normalized === 'XR') return 'Unity';
    return 'React';
}

function normalizeEngine(value: string | undefined): string {
    return normalizeOptionValue(engineOptions, value === 'Unreal Engine' ? 'Unreal' : value, 'React');
}

const pendingCreditStorageKey = 'beegame.pendingCreditQuote.v1';
const pendingAuthIdeaStorageKey = 'beegame.pendingAuthIdea.v1';
const pendingIdeaDraftStorageKey = 'beegame.pendingIdeaDraft.v1';
const pendingIntakeFlowStorageKey = 'beegame.pendingIntakeFlow.v1';
const pendingAuthIdeaMaxAgeMs = 30 * 60 * 1000;
const pendingIntakeFlowMaxAgeMs = 30 * 60 * 1000;

type RestorableIntakePhase = Extract<IntakePhase, 'options_ready' | 'configuring_details' | 'confirming_brief'>;

type PendingCreditState =
    | { kind: 'intake'; idea: string; quote: BeeGameCreditQuote }
    | { kind: 'build'; brief: BeeGameBuildBrief; quote: BeeGameCreditQuote };

type PendingAuthIdeaState = {
    idea: string;
    createdAt: number;
};

type PendingIdeaDraftState = {
    idea: string;
    createdAt: number;
};

type PendingIntakeFlowState = {
    phase: RestorableIntakePhase;
    idea: string;
    language: Language;
    options: BeeGameIntakeOption[];
    selectedOption?: BeeGameIntakeOption;
    settings?: BeeGameIntakeSettings;
    createdAt: number;
};

type InputMenuPosition = {
    left: number;
    top: number;
    width: number;
};

function readPendingCreditState(): PendingCreditState | null {
    try {
        const raw = sessionStorage.getItem(pendingCreditStorageKey);
        if (!raw) return null;
        const value = JSON.parse(raw) as unknown;
        if (!isPendingCreditState(value)) return null;
        return value;
    } catch {
        return null;
    }
}

function writePendingCreditState(value: PendingCreditState): void {
    try {
        sessionStorage.setItem(pendingCreditStorageKey, JSON.stringify(value));
    } catch {
        // Best-effort UI recovery only. Billing truth still lives on the server.
    }
}

function readPendingAuthIdeaState(): PendingAuthIdeaState | null {
    try {
        const raw = sessionStorage.getItem(pendingAuthIdeaStorageKey);
        if (!raw) return null;
        const value = JSON.parse(raw) as unknown;
        if (!isPendingAuthIdeaState(value)) return null;
        if (Date.now() - value.createdAt > pendingAuthIdeaMaxAgeMs) {
            clearPendingAuthIdeaState();
            return null;
        }
        return value;
    } catch {
        return null;
    }
}

function readPendingIdeaDraftState(): PendingIdeaDraftState | null {
    try {
        const raw = sessionStorage.getItem(pendingIdeaDraftStorageKey);
        if (!raw) return null;
        const value = JSON.parse(raw) as unknown;
        if (!isPendingIdeaDraftState(value)) return null;
        if (Date.now() - value.createdAt > pendingIntakeFlowMaxAgeMs) {
            clearPendingIdeaDraftState();
            return null;
        }
        return value;
    } catch {
        return null;
    }
}

function writePendingIdeaDraftState(idea: string): void {
    const normalizedIdea = idea.trim();
    try {
        if (!normalizedIdea) {
            clearPendingIdeaDraftState();
            return;
        }
        sessionStorage.setItem(pendingIdeaDraftStorageKey, JSON.stringify({
            idea: normalizedIdea,
            createdAt: Date.now(),
        }));
    } catch {
        // Best-effort draft recovery only.
    }
}

function clearPendingIdeaDraftState(): void {
    try {
        sessionStorage.removeItem(pendingIdeaDraftStorageKey);
    } catch {
        // Ignore storage failures; this cache never drives server state.
    }
}

function readPendingIntakeFlowState(): PendingIntakeFlowState | null {
    try {
        const raw = sessionStorage.getItem(pendingIntakeFlowStorageKey);
        if (!raw) return null;
        const value = JSON.parse(raw) as unknown;
        if (!isPendingIntakeFlowState(value)) return null;
        if (Date.now() - value.createdAt > pendingIntakeFlowMaxAgeMs) {
            clearPendingIntakeFlowState();
            return null;
        }
        return value;
    } catch {
        return null;
    }
}

function writePendingIntakeFlowState(value: Omit<PendingIntakeFlowState, 'createdAt'>): void {
    try {
        sessionStorage.setItem(pendingIntakeFlowStorageKey, JSON.stringify({
            ...value,
            createdAt: Date.now(),
        }));
    } catch {
        // Best-effort UI recovery only. Confirmed builds still go through server state.
    }
}

function clearPendingIntakeFlowState(): void {
    try {
        sessionStorage.removeItem(pendingIntakeFlowStorageKey);
    } catch {
        // Ignore storage failures; this cache never drives server state.
    }
}

function writePendingAuthIdeaState(idea: string): void {
    const normalizedIdea = idea.trim();
    if (!normalizedIdea) return;
    try {
        sessionStorage.setItem(pendingAuthIdeaStorageKey, JSON.stringify({
            idea: normalizedIdea,
            createdAt: Date.now(),
        }));
    } catch {
        // OAuth redirects unload the page; this is best-effort recovery only.
    }
}

function clearPendingAuthIdeaState(): void {
    try {
        sessionStorage.removeItem(pendingAuthIdeaStorageKey);
    } catch {
        // Ignore storage failures; the in-memory login flow can still continue.
    }
}

function clearPendingCreditState(): void {
    try {
        sessionStorage.removeItem(pendingCreditStorageKey);
    } catch {
        // Ignore storage failures; the dialog state will still clear in memory.
    }
}

function clearIntakeRecoveryState(): void {
    clearPendingCreditState();
    clearPendingIdeaDraftState();
    clearPendingIntakeFlowState();
}

function isPendingCreditState(value: unknown): value is PendingCreditState {
    if (!isRecord(value) || !isRecord(value.quote)) return false;
    if (value.kind === 'intake') {
        return typeof value.idea === 'string' && value.idea.trim().length > 0;
    }
    if (value.kind === 'build') {
        return isRecord(value.brief) && typeof value.brief.idea === 'string';
    }
    return false;
}

function isPendingAuthIdeaState(value: unknown): value is PendingAuthIdeaState {
    return isRecord(value)
        && typeof value.idea === 'string'
        && value.idea.trim().length > 0
        && typeof value.createdAt === 'number'
        && Number.isFinite(value.createdAt);
}

function isPendingIdeaDraftState(value: unknown): value is PendingIdeaDraftState {
    return isRecord(value)
        && typeof value.idea === 'string'
        && value.idea.trim().length > 0
        && typeof value.createdAt === 'number'
        && Number.isFinite(value.createdAt);
}

function isPendingIntakeFlowState(value: unknown): value is PendingIntakeFlowState {
    if (!isRecord(value)) return false;
    const phase = value.phase;
    if (phase !== 'options_ready' && phase !== 'configuring_details' && phase !== 'confirming_brief') return false;
    if (typeof value.idea !== 'string' || value.idea.trim().length === 0) return false;
    if (!Array.isArray(value.options)) return false;
    if (typeof value.language !== 'string') return false;
    if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return false;
    if ((phase === 'configuring_details' || phase === 'confirming_brief') && (!isRecord(value.selectedOption) || !isRecord(value.settings))) {
        return false;
    }
    return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function LandingView({ onStart, lang, onSetLang }: LandingViewProps) {
    const { t: translate, i18n } = useTranslation();
    const [restoredPendingCredit] = useState<PendingCreditState | null>(() => readPendingCreditState());
    const [restoredIntakeFlow] = useState<PendingIntakeFlowState | null>(() => readPendingIntakeFlowState());
    const [restoredIdeaDraft] = useState<PendingIdeaDraftState | null>(() => readPendingIdeaDraftState());
    const [projectName, setProjectName] = useState(() => (
        restoredPendingCredit?.kind === 'intake'
            ? restoredPendingCredit.idea
            : restoredPendingCredit?.kind === 'build'
                ? restoredPendingCredit.brief.idea
                : restoredIntakeFlow?.idea
                    ? restoredIntakeFlow.idea
                    : restoredIdeaDraft?.idea || ''
    ));
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [isPreparing, setIsPreparing] = useState(false);
    const [intakePhase, setIntakePhase] = useState<IntakePhase>(restoredIntakeFlow?.phase || 'idle');
    const [intakeOptions, setIntakeOptions] = useState<BeeGameIntakeOption[]>(restoredIntakeFlow?.options || []);
    const [selectedOption, setSelectedOption] = useState<BeeGameIntakeOption | null>(restoredIntakeFlow?.selectedOption || null);
    const [settings, setSettings] = useState<BeeGameIntakeSettings | null>(restoredIntakeFlow?.settings || null);
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
    const [avatarDraftFailed, setAvatarDraftFailed] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [profileNotice, setProfileNotice] = useState('');
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [activeLegalDocument, setActiveLegalDocument] = useState<LegalDocumentKind | null>(null);
    const [pendingIdeaAfterLogin, setPendingIdeaAfterLogin] = useState('');
    const [creditBalance, setCreditBalance] = useState<BeeGameCreditBalance | null>(null);
    const [creditLedger, setCreditLedger] = useState<BeeGameCreditLedgerEntry[]>([]);
    const [isCreditLedgerLoading, setIsCreditLedgerLoading] = useState(false);
    const [isCreditLedgerExpanded, setIsCreditLedgerExpanded] = useState(false);
    const [intakeCreditQuote, setIntakeCreditQuote] = useState<BeeGameCreditQuote | null>(
        restoredPendingCredit?.kind === 'intake' ? restoredPendingCredit.quote : null,
    );
    const [pendingIntakeIdea, setPendingIntakeIdea] = useState(
        restoredPendingCredit?.kind === 'intake' ? restoredPendingCredit.idea : '',
    );
    const [buildCreditQuote, setBuildCreditQuote] = useState<BeeGameCreditQuote | null>(
        restoredPendingCredit?.kind === 'build' ? restoredPendingCredit.quote : null,
    );
    const [pendingBuildBrief, setPendingBuildBrief] = useState<BeeGameBuildBrief | null>(
        restoredPendingCredit?.kind === 'build' ? restoredPendingCredit.brief : null,
    );
    const [isInputMenuOpen, setIsInputMenuOpen] = useState(false);
    const inputMenuRef = useRef<HTMLDivElement | null>(null);
    const inputMenuButtonRef = useRef<HTMLButtonElement | null>(null);
    const inputMenuDropdownRef = useRef<HTMLDivElement | null>(null);
    const [inputMenuPosition, setInputMenuPosition] = useState<InputMenuPosition | null>(null);
    useEffect(() => {
        void i18n.changeLanguage(normalizeI18nLanguage(lang));
    }, [i18n, lang]);

    const t = useCommonText(lang);
    const intakeTranslate: Translate = (key, options) => translate(`intake.${key}`, options);
    const intakeText = createLandingIntakeCopy(intakeTranslate);
    const legalDocuments = translate('legal', { returnObjects: true }) as LegalDocumentBundle;
    const localizedOptionLabel = (value: string): string => translate(`intake.options.${value}`, { defaultValue: value });
    const localizedInputs = (inputs: string[]): string => inputs.map(localizedOptionLabel).join(' / ');
    const shouldShowIntakeModal = intakePhase !== 'idle' && intakePhase !== 'generating_options';
    const modalTitle = intakePhase === 'options_ready'
        ? intakeText.modal.chooseOption
        : intakePhase === 'configuring_details'
            ? selectedOption?.title || intakeText.modal.productionSettings
            : intakePhase === 'confirming_brief'
                ? selectedOption?.title || intakeText.modal.confirmBuildBrief
                : intakeText.modal.startBuild;
    const intakeModalWidthClass = intakePhase === 'options_ready'
        ? 'max-w-5xl'
        : 'max-w-[34rem]';

    const setActiveProject = useProjectStore(state => state.setActiveProject);
    const currentUser = useSystemStore(state => state.currentUser);
    const hasPermission = useSystemStore(state => state.hasPermission);
    const loadCurrentUser = useSystemStore(state => state.loadCurrentUser);
    const canOpenPlatformSettings = currentUser?.role === 'owner';

    const persistIntakeFlow = (
        phase: RestorableIntakePhase,
        options: BeeGameIntakeOption[],
        option?: BeeGameIntakeOption | null,
        nextSettings?: BeeGameIntakeSettings | null,
    ) => {
        const idea = projectName.trim();
        if (!idea) return;
        writePendingIntakeFlowState({
            phase,
            idea,
            language: lang,
            options,
            selectedOption: option || undefined,
            settings: nextSettings || undefined,
        });
    };

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

    useEffect(() => {
        if (!currentUser) return;
        const refreshCredits = () => {
            void getCreditBalance()
                .then(balance => setCreditBalance(balance))
                .catch(() => setCreditBalance(null));
            if (isProfileOpen) {
                setIsCreditLedgerLoading(true);
                void getCreditLedger()
                    .then(entries => setCreditLedger(entries))
                    .catch(() => setCreditLedger([]))
                    .finally(() => setIsCreditLedgerLoading(false));
            }
        };
        window.addEventListener('beegame:credits-updated', refreshCredits);
        return () => {
            window.removeEventListener('beegame:credits-updated', refreshCredits);
        };
    }, [currentUser?.id, isProfileOpen]);

    const handleSignOut = async () => {
        clearIntakeRecoveryState();
        clearPendingAuthIdeaState();
        setIntakeCreditQuote(null);
        setPendingIntakeIdea('');
        setBuildCreditQuote(null);
        setPendingBuildBrief(null);
        clearSupabaseSession();
        setCreditBalance(null);
        await loadCurrentUser();
    };

    const handleOpenLogin = () => {
        setPendingIdeaAfterLogin('');
        clearPendingAuthIdeaState();
        setLoginError('');
        setLoginNotice('');
        setAuthMode('login');
        setIsLoginPromptOpen(true);
    };

    const handleCloseLoginPrompt = () => {
        clearPendingAuthIdeaState();
        setPendingIdeaAfterLogin('');
        setIsLoginPromptOpen(false);
        setLoginError('');
        setLoginNotice('');
    };

    const ensureGenerationAccess = async (): Promise<boolean> => {
        await loadCurrentUser();
        const latestUser = useSystemStore.getState().currentUser;
        if (!latestUser) {
            const pendingIdea = projectName.trim();
            setPendingIdeaAfterLogin(pendingIdea);
            writePendingAuthIdeaState(pendingIdea);
            setIsLoginPromptOpen(true);
            return false;
        }
        return true;
    };

    const requestIntakeCreditConfirmation = async (idea: string) => {
        setIntakeError('');
        setIsPreparing(true);
        clearPendingIntakeFlowState();
        writePendingIdeaDraftState(idea);
        try {
            const modelConfigs = await listModelConfigs();
            if (modelConfigs.length === 0) {
                setIntakeError(intakeText.errors.missingPlatformModel);
                return;
            }
            const quote = await getCreditQuote('idea_intake');
            if (!quote.canStart) {
                setIntakeError(intakeText.errors.insufficientCredits(
                    intakeText.credits.intakeTask,
                    quote.reservedCredits,
                    quote.balanceCredits,
                ));
                return;
            }
            setPendingIntakeIdea(idea);
            setIntakeCreditQuote(quote);
            writePendingCreditState({ kind: 'intake', idea, quote });
        } catch (error) {
            setIntakeError(error instanceof Error ? error.message : intakeText.errors.quoteFailed);
            console.error('Failed to quote intake credits:', error);
        } finally {
            setIsPreparing(false);
        }
    };

    useEffect(() => {
        if (!currentUser || isPreparing || intakePhase !== 'idle' || intakeCreditQuote || buildCreditQuote) {
            return;
        }
        const pendingAuthIdea = readPendingAuthIdeaState();
        if (!pendingAuthIdea) return;
        clearPendingAuthIdeaState();
        setProjectName(pendingAuthIdea.idea);
        setPendingIdeaAfterLogin('');
        setIsLoginPromptOpen(false);
        void requestIntakeCreditConfirmation(pendingAuthIdea.idea);
    }, [currentUser?.id]);

    useEffect(() => {
        if (!isInputMenuOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (inputMenuRef.current?.contains(target)) return;
            if (inputMenuDropdownRef.current?.contains(target)) return;
            setIsInputMenuOpen(false);
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [isInputMenuOpen]);

    useEffect(() => {
        if (!isInputMenuOpen) return;
        const updatePosition = () => {
            const rect = inputMenuButtonRef.current?.getBoundingClientRect();
            if (!rect) return;
            setInputMenuPosition({
                left: rect.left,
                top: rect.bottom + 8,
                width: rect.width,
            });
        };
        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isInputMenuOpen]);

    const runIntake = async (idea: string) => {
        setIntakeError('');
        setSelectedOption(null);
        setSettings(null);
        setIntakeOptions([]);
        clearPendingIntakeFlowState();
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
                    freeformLabel: translate('intake.clarification.freeformOption'),
                });
                return;
            }
            const nextOptions = intake.options;
            setIntakeOptions(nextOptions);
            clearPendingIdeaDraftState();
            if (!intake.needsOptions && intake.options[0]) {
                const option = intake.options[0];
                const nextSettings = settingsFromOption(option);
                setSelectedOption(option);
                setSettings(nextSettings);
                setIntakePhase('configuring_details');
                writePendingIntakeFlowState({
                    phase: 'configuring_details',
                    idea: projectName.trim() || idea,
                    language: lang,
                    options: nextOptions,
                    selectedOption: option,
                    settings: nextSettings,
                });
            } else {
                setIntakePhase('options_ready');
                writePendingIntakeFlowState({
                    phase: 'options_ready',
                    idea: projectName.trim() || idea,
                    language: lang,
                    options: nextOptions,
                });
            }
            setIsPreparing(false);
        } catch (error) {
            setIsPreparing(false);
            setIntakePhase('idle');
            setIsTransitioning(false);
            setIntakeError(error instanceof Error ? error.message : translate('intake.errors.intakeFailed'));
            console.error('Failed to generate intake options:', error);
        }
    };

    const handleStart = async (event: React.FormEvent) => {
        event.preventDefault();
        const idea = projectName.trim();
        if (!idea || isTransitioning || isPreparing) return;
        writePendingIdeaDraftState(idea);
        clearPendingIntakeFlowState();
        setIntakeError('');
        setIsPreparing(true);
        const canGenerate = await ensureGenerationAccess();
        if (!canGenerate) {
            setIsPreparing(false);
            return;
        }
        await requestIntakeCreditConfirmation(idea);
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
            setLoginError(intakeText.errors.authNotConfigured);
            return;
        }
        const email = loginEmail.trim();
        if (!email || !loginPassword) {
            setLoginError(intakeText.errors.missingEmailPassword);
            return;
        }
        if (authMode === 'register') {
            if (!registerDisplayName.trim()) {
                setLoginError(intakeText.errors.missingDisplayName);
                return;
            }
            if (!hasAcceptedTerms) {
                setLoginError(intakeText.errors.termsRequired);
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
            const nextIdea = pendingIdeaAfterLogin.trim();
            setPendingIdeaAfterLogin('');
            clearPendingAuthIdeaState();
            if (nextIdea) {
                setProjectName(nextIdea);
                const canGenerate = await ensureGenerationAccess();
                if (canGenerate) {
                    await requestIntakeCreditConfirmation(nextIdea);
                }
            }
        } catch (error) {
            setLoginError(error instanceof Error ? error.message : translate('intake.errors.loginFailed'));
        } finally {
            setIsSigningIn(false);
        }
    };

    const handleSendPasswordReset = async () => {
        setLoginError('');
        setLoginNotice('');
        const email = loginEmail.trim();
        if (!email) {
            setLoginError(translate('intake.errors.resetEmailRequired'));
            return;
        }
        setIsSigningIn(true);
        try {
            await sendSupabasePasswordReset(email);
            setLoginNotice(translate('intake.errors.resetEmailSent'));
        } catch (error) {
            setLoginError(error instanceof Error ? error.message : translate('intake.errors.resetEmailFailed'));
        } finally {
            setIsSigningIn(false);
        }
    };

    const handleOpenProfile = () => {
        setProfileError('');
        setProfileNotice('');
        setAvatarDraft(currentUser?.avatarUrl || '');
        setAvatarDraftFailed(false);
        setIsCreditLedgerExpanded(false);
        setIsProfileOpen(true);
        setIsCreditLedgerLoading(true);
        void getCreditLedger()
            .then(entries => setCreditLedger(entries))
            .catch(() => setCreditLedger([]))
            .finally(() => setIsCreditLedgerLoading(false));
    };

    const handleAvatarFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setAvatarDraftFailed(false);
        setProfileError('');
        setProfileNotice('');
        if (!file.type.startsWith('image/')) {
            setProfileError(translate('intake.errors.profileImageRequired'));
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            setProfileError(translate('intake.errors.profileImageTooLarge'));
            return;
        }
        setIsSavingProfile(true);
        void uploadSupabaseAvatarImage(file)
            .then(url => {
                setAvatarDraft(url);
                setProfileNotice(translate('intake.errors.profileAvatarSelected'));
            })
            .catch(error => {
                setProfileError(error instanceof Error ? error.message : translate('intake.errors.profileAvatarUploadFailed'));
            })
            .finally(() => setIsSavingProfile(false));
    };

    const handleFinishProfile = async () => {
        if (isSavingProfile) return;
        const nextAvatar = avatarDraft.trim();
        const currentAvatar = currentUser?.avatarUrl || '';
        if (!nextAvatar || nextAvatar === currentAvatar) {
            setIsProfileOpen(false);
            return;
        }
        setProfileError('');
        setProfileNotice('');
        setIsSavingProfile(true);
        try {
            await updateSupabaseAvatarUrl(nextAvatar);
            await loadCurrentUser();
            setIsProfileOpen(false);
        } catch (error) {
            setProfileError(error instanceof Error ? error.message : translate('intake.errors.profileAvatarUpdateFailed'));
        } finally {
            setIsSavingProfile(false);
        }
    };

    const handleDeleteAccount = async () => {
        setProfileError('');
        setProfileNotice('');
        const confirmed = window.confirm(intakeText.profile.deleteConfirm);
        if (!confirmed) return;
        try {
            await deleteCurrentUser();
            clearSupabaseSession();
            setIsProfileOpen(false);
            await loadCurrentUser();
        } catch (error) {
            setProfileError(error instanceof Error ? error.message : intakeText.profile.deleteFailed);
        }
    };

    const handleOAuthSignIn = async (provider: SupabaseOAuthProvider) => {
        setLoginError('');
        try {
            writePendingAuthIdeaState(pendingIdeaAfterLogin);
            await signInWithSupabaseOAuth(provider);
        } catch (error) {
            clearPendingAuthIdeaState();
            setLoginError(error instanceof Error ? error.message : intakeText.auth.oauthFailed);
        }
    };

    const handleProjectNameChange = (value: string) => {
        setProjectName(value);
        writePendingIdeaDraftState(value);
        if (intakePhase !== 'idle' && !isPreparing && !isTransitioning) {
            setIntakePhase('idle');
            setIntakeOptions([]);
            setSelectedOption(null);
            setSettings(null);
            clearPendingCreditState();
            clearPendingIntakeFlowState();
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
        const nextSettings = settingsFromOption(option);
        setSelectedOption(option);
        setSettings(nextSettings);
        setIntakePhase('configuring_details');
        setIsInputMenuOpen(false);
        persistIntakeFlow('configuring_details', intakeOptions, option, nextSettings);
        setIntakeError('');
    };

    const updateSettings = (patch: Partial<BeeGameIntakeSettings>) => {
        setSettings((current) => {
            if (!current) return current;
            const nextSettings = { ...current, ...patch };
            if (selectedOption && (intakePhase === 'configuring_details' || intakePhase === 'confirming_brief')) {
                persistIntakeFlow(intakePhase, intakeOptions, selectedOption, nextSettings);
            }
            return nextSettings;
        });
    };

    const toggleInput = (input: string) => {
        setSettings((current) => {
            if (!current) return current;
            const hasInput = current.inputs.includes(input);
            const nextInputs = hasInput
                ? current.inputs.filter((item) => item !== input)
                : [...current.inputs, input];
            const nextSettings = {
                ...current,
                inputs: nextInputs.length > 0 ? nextInputs : [input],
            };
            if (selectedOption && (intakePhase === 'configuring_details' || intakePhase === 'confirming_brief')) {
                persistIntakeFlow(intakePhase, intakeOptions, selectedOption, nextSettings);
            }
            return {
                ...nextSettings,
            };
        });
    };

    const handleConfirmSettings = () => {
        if (!selectedOption || !settings) return;
        setIsInputMenuOpen(false);
        setIntakePhase('confirming_brief');
        persistIntakeFlow('confirming_brief', intakeOptions, selectedOption, settings);
    };

    const handleBackToOptions = () => {
        setIntakePhase('options_ready');
        setSelectedOption(null);
        setSettings(null);
        setIsInputMenuOpen(false);
        persistIntakeFlow('options_ready', intakeOptions);
    };

    const handleCloseIntake = () => {
        if (isPreparing || isTransitioning) return;
        setIntakePhase('idle');
        setIntakeOptions([]);
        setSelectedOption(null);
        setSettings(null);
        setIsInputMenuOpen(false);
        setIntakeError('');
        setClarification(null);
        setClarificationDraft('');
        clearIntakeRecoveryState();
    };

    const handleConfirmIntakeCredit = () => {
        const idea = pendingIntakeIdea;
        setIntakeCreditQuote(null);
        setPendingIntakeIdea('');
        clearPendingCreditState();
        if (idea) {
            void runIntake(idea);
        }
    };

    const handleCancelIntakeCredit = () => {
        setIntakeCreditQuote(null);
        setPendingIntakeIdea('');
        clearPendingCreditState();
    };

    const startConfirmedBuild = async (brief: BeeGameBuildBrief) => {
        setIntakeError('');
        setIsPreparing(true);
        setIntakePhase('starting_build');
        try {
            await onStart(projectName.trim(), undefined, brief);
            clearPendingIdeaDraftState();
            clearPendingIntakeFlowState();
            setIsTransitioning(true);
        } catch (error) {
            setIsPreparing(false);
            setIntakePhase('confirming_brief');
            setIntakeError(error instanceof Error ? error.message : intakeText.errors.projectStartFailed);
            console.error('Failed to start confirmed project:', error);
        }
    };

    const handleStartBuild = async () => {
        if (!selectedOption || !settings || isTransitioning || isPreparing) return;
        const brief: BeeGameBuildBrief = {
            idea: projectName.trim(),
            option: selectedOption,
            settings: {
                ...settings,
                engine: normalizeEngine(settings.engine),
            },
            title: selectedOption.title,
            language: lang,
        };
        setIntakeError('');
        setIsPreparing(true);
        try {
            const quote = await getCreditQuote('full_build');
            if (!quote.canStart) {
                setIntakeError(intakeText.errors.insufficientCredits(
                    intakeText.credits.buildTask,
                    quote.reservedCredits,
                    quote.balanceCredits,
                ));
                return;
            }
            setPendingBuildBrief(brief);
            setBuildCreditQuote(quote);
            writePendingCreditState({ kind: 'build', brief, quote });
        } catch (error) {
            setIntakeError(error instanceof Error ? error.message : intakeText.errors.quoteFailed);
            console.error('Failed to quote build credits:', error);
        } finally {
            setIsPreparing(false);
        }
    };

    const handleConfirmBuildCredit = () => {
        const brief = pendingBuildBrief;
        setBuildCreditQuote(null);
        setPendingBuildBrief(null);
        clearPendingCreditState();
        if (brief) {
            void startConfirmedBuild(brief);
        }
    };

    const handleCancelBuildCredit = () => {
        setBuildCreditQuote(null);
        setPendingBuildBrief(null);
        clearPendingCreditState();
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
            <div
                key="landing"
                className={`absolute inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-white opacity-100 transition-opacity duration-300 dark:bg-zinc-950 ${isTransitioning ? 'opacity-0' : ''}`}
            >
                <FaultyTerminalBackground isTransitioning={isTransitioning} />

                <LandingActions
                    lang={lang}
                    isTransitioning={isTransitioning}
                    isSettingsOpen={isSettingsOpen}
                    isHistoryOpen={isHistoryOpen}
                    currentUserId={currentUser?.id}
                    currentUserDisplayName={currentUser?.displayName || currentUser?.email}
                    currentUserEmail={currentUser?.email}
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
                    canManageWorkspace={canOpenPlatformSettings && hasPermission('workspace.manage')}
                    canManageSecrets={canOpenPlatformSettings && hasPermission('secrets.manage')}
                    canManageRuntimeSettings={canOpenPlatformSettings && hasPermission('runtime_settings.manage')}
                    canManageMcp={canOpenPlatformSettings && hasPermission('mcp.manage')}
                    canManageModelConfig={canOpenPlatformSettings && hasPermission('model_config.manage')}
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
                        aria-label={translate('intake.profile.title')}
                        data-surface="frosted-glass"
                        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
                    >
                        <div className="input-surface glass-panel w-full max-w-md rounded-[28px] p-6 text-zinc-100">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="type-title-3 text-white">{translate('intake.profile.title')}</h2>
                                    <p className="type-callout mt-3 text-zinc-300">
                                        {translate('intake.profile.description')}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    aria-label={translate('intake.profile.close')}
                                    onClick={() => setIsProfileOpen(false)}
                                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full glass-icon-button"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="mt-8 flex flex-col items-center text-center">
                                <label className="type-title-3 group relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-amber-300/35 bg-white/5 text-white shadow-[0_18px_50px_rgba(0,0,0,0.35)] transition hover:border-amber-200/70">
                                    {avatarDraft && !avatarDraftFailed ? (
                                        <img
                                            src={avatarDraft}
                                            alt=""
                                            referrerPolicy="no-referrer"
                                            className="h-full w-full object-cover"
                                            onLoad={() => setAvatarDraftFailed(false)}
                                            onError={() => setAvatarDraftFailed(true)}
                                        />
                                    ) : (
                                        getDisplayInitial(currentUser.displayName || currentUser.email || currentUser.id)
                                    )}
                                    <input
                                        aria-label={translate('intake.profile.uploadAvatar')}
                                        type="file"
                                        accept="image/*"
                                        onChange={handleAvatarFileChange}
                                        className="sr-only"
                                    />
                                    <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition group-hover:opacity-100">
                                        <Camera className="h-6 w-6 text-white" />
                                    </span>
                                </label>
                                <div className="type-headline mt-5 max-w-full truncate text-white">
                                    {currentUser.displayName || intakeText.profile.displayNameFallback}
                                </div>
                                <div className="type-footnote mt-1 max-w-full truncate text-zinc-400">
                                    {currentUser.email || intakeText.profile.emailFallback}
                                </div>
                            </div>

                            {profileError ? <div className="type-footnote mt-4 rounded-2xl border border-red-400/30 bg-red-950/50 px-4 py-3 text-red-100">{profileError}</div> : null}
                            {profileNotice ? <div className="type-footnote mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-950/40 px-4 py-3 text-emerald-100">{profileNotice}</div> : null}

                            <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-4 text-left">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="type-callout text-white">{translate('intake.profile.creditUsage')}</div>
                                    {creditBalance ? (
                                        <div className="type-footnote text-emerald-200">
                                            {creditBalance.balanceCredits} credits
                                        </div>
                                    ) : null}
                                </div>
                                {creditBalance ? (
                                    <div className="mt-4 grid grid-cols-3 gap-2">
                                        <CreditMetric label={intakeText.profile.balance} value={creditBalance.balanceCredits} tone="positive" />
                                        <CreditMetric label={intakeText.profile.consumed} value={creditBalance.consumedCredits} />
                                        <CreditMetric label={intakeText.profile.reserved} value={creditBalance.reservedCredits} />
                                    </div>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => setIsCreditLedgerExpanded(true)}
                                    disabled={isCreditLedgerLoading}
                                    className="type-button mt-4 flex h-12 w-full items-center justify-between rounded-2xl border border-white/15 bg-black/15 px-4 text-left text-zinc-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <span>{isCreditLedgerLoading ? intakeText.profile.loadingCreditDetails : intakeText.profile.viewCreditDetails}</span>
                                    <span className="type-footnote text-zinc-500">
                                        {creditLedger.length > 0 ? intakeText.profile.ledgerCount(creditLedger.length) : intakeText.profile.noLedgerRecords}
                                    </span>
                                </button>
                            </div>

                            <div className="mt-6 flex justify-between gap-3">
                                <button
                                    type="button"
                                    onClick={() => void handleDeleteAccount()}
                                    className="type-button rounded-full border border-red-300/25 px-5 py-2.5 text-red-200 transition hover:border-red-200/50 hover:bg-red-500/10"
                                >
                                    {intakeText.profile.deleteAccount}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void handleFinishProfile()}
                                    disabled={isSavingProfile}
                                    className="primary-pill type-button px-5 py-2.5 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isSavingProfile ? intakeText.profile.saving : intakeText.profile.finish}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}

                {isProfileOpen && isCreditLedgerExpanded ? (
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={translate('intake.profile.creditDetailsTitle')}
                        data-surface="frosted-glass"
                        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
                    >
                        <div className="input-surface glass-panel flex max-h-[78vh] w-full max-w-lg flex-col rounded-[28px] p-5 text-zinc-100">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="type-title-3 text-white">{translate('intake.profile.creditDetailsTitle')}</h2>
                                    <p className="type-footnote mt-2 text-zinc-400">
                                        {translate('intake.profile.creditDetailsDescription')}
                                    </p>
                                </div>
	                                <button
	                                    type="button"
	                                    aria-label={intakeText.profile.closeCreditDetails}
                                    onClick={() => setIsCreditLedgerExpanded(false)}
                                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full glass-icon-button"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="mt-5 max-h-[52vh] space-y-2 overflow-y-auto pr-1" data-credit-ledger-scroll="true">
                                {creditLedger.length > 0 ? (
                                    creditLedger.map(entry => (
                                        <CreditLedgerRow key={entry.id} entry={entry} translate={intakeTranslate} />
                                    ))
                                ) : (
	                                    <div className="type-footnote text-zinc-500">{intakeText.profile.noLedgerRecords}</div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : null}

                {isLoginPromptOpen ? (
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={translate('intake.auth.dialogLabel')}
                        data-surface="frosted-glass"
                        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
                    >
                        <form
                            onSubmit={handleLoginSubmit}
                            className="input-surface glass-panel w-full max-w-md rounded-[28px] p-6 text-zinc-100"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="type-title-3 text-white">
                                        {translate(`intake.auth.title.${authMode === 'resetPassword' ? 'resetPassword' : authMode === 'register' ? 'register' : 'login'}`)}
                                    </h2>
                                    <p className="type-callout mt-3 text-zinc-300">
                                        {translate(`intake.auth.description.${authMode === 'resetPassword' ? 'resetPassword' : authMode === 'register' ? 'register' : 'login'}`)}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    aria-label={translate('intake.auth.close')}
                                    onClick={handleCloseLoginPrompt}
                                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full glass-icon-button"
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
                                    className={`type-button rounded-full px-3 py-2 transition ${authMode === 'login' ? 'bg-white text-zinc-950' : 'text-zinc-300 hover:bg-white/10 hover:text-white'}`}
                                    >
                                        {translate('intake.auth.tabs.login')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAuthMode('register');
                                            setLoginError('');
                                            setLoginNotice('');
                                        }}
                                    className={`type-button rounded-full px-3 py-2 transition ${authMode === 'register' ? 'bg-white text-zinc-950' : 'text-zinc-300 hover:bg-white/10 hover:text-white'}`}
                                    >
                                        {translate('intake.auth.tabs.register')}
                                    </button>
                                </div>
                            ) : null}
                            <div className="mt-6 space-y-3">
                                {authMode === 'register' ? (
                                    <label className="type-subheadline block text-zinc-200">
                                        {translate('intake.auth.fields.displayName')}
                                        <input
                                            aria-label={translate('intake.auth.fields.displayNameAria')}
                                            type="text"
                                            value={registerDisplayName}
                                            onChange={(event) => setRegisterDisplayName(event.target.value)}
                                            className="glass-control type-input mt-2 h-11 w-full rounded-2xl px-3 placeholder:text-zinc-500"
                                            autoComplete="nickname"
                                            placeholder={translate('intake.auth.fields.displayNamePlaceholder')}
                                        />
                                    </label>
                                ) : null}
                                <label className="type-subheadline block text-zinc-200">
                                    {translate('intake.auth.fields.email')}
                                    <input
                                        aria-label={translate('intake.auth.fields.emailAria')}
                                        type="email"
                                        value={loginEmail}
                                        onChange={(event) => setLoginEmail(event.target.value)}
                                        className="glass-control type-input mt-2 h-11 w-full rounded-2xl px-3 placeholder:text-zinc-500"
                                        autoComplete="email"
                                        placeholder="you@example.com"
                                    />
                                </label>
                                {authMode !== 'resetPassword' ? (
                                    <label className="type-subheadline block text-zinc-200">
                                    {translate('intake.auth.fields.password')}
                                    <input
                                        aria-label={translate('intake.auth.fields.passwordAria')}
                                        type="password"
                                        value={loginPassword}
                                        onChange={(event) => setLoginPassword(event.target.value)}
                                        className="glass-control type-input mt-2 h-11 w-full rounded-2xl px-3 placeholder:text-zinc-500"
                                        autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                                        placeholder={authMode === 'register' ? translate('intake.auth.fields.passwordNewPlaceholder') : translate('intake.auth.fields.passwordPlaceholder')}
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
                                        className="type-button mx-auto block text-center text-zinc-300 transition hover:text-white disabled:opacity-60"
                                    >
	                                        {intakeText.auth.forgotPassword}
                                    </button>
                                ) : (
                                    <label className="type-callout flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-zinc-300">
                                        <input
	                                            aria-label={intakeText.auth.acceptTermsAria}
                                            type="checkbox"
                                            checked={hasAcceptedTerms}
                                            onChange={(event) => setHasAcceptedTerms(event.target.checked)}
                                            className="mt-1 h-4 w-4 rounded border-white/20 bg-black/30"
                                        />
                                        <span>
	                                            {intakeText.auth.acceptTermsPrefix}{' '}
                                            <button
                                                type="button"
                                                onClick={() => setActiveLegalDocument('terms')}
	                                                className="text-amber-200 underline decoration-amber-200/40 underline-offset-4 transition hover:text-amber-100"
                                            >
	                                                {intakeText.auth.termsLabel}
                                            </button>
	                                            {' '}{intakeText.auth.acceptTermsConnector}{' '}
                                            <button
                                                type="button"
                                                onClick={() => setActiveLegalDocument('privacy')}
	                                                className="text-amber-200 underline decoration-amber-200/40 underline-offset-4 transition hover:text-amber-100"
                                            >
	                                                {intakeText.auth.privacyLabel}
                                            </button>
	                                            {intakeText.auth.acceptTermsSuffix}
                                        </span>
                                    </label>
                                )}
                            </div>
                            {loginError ? (
                                <div className="type-footnote mt-4 rounded-2xl border border-red-400/30 bg-red-950/50 px-4 py-3 text-red-100">
                                    {loginError}
                                </div>
                            ) : null}
                            {loginNotice ? (
                                <div className="type-footnote mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-950/40 px-4 py-3 text-emerald-100">
                                    {loginNotice}
                                </div>
                            ) : null}
                            {authMode === 'login' ? (
                                <>
                                    <div className="type-caption-1 my-5 flex items-center gap-3 text-zinc-500">
                                        <span className="h-px flex-1 bg-white/10" />
                                        <span>{intakeText.auth.oauthDivider}</span>
                                        <span className="h-px flex-1 bg-white/10" />
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        <OAuthButton provider="github" label="GitHub" onClick={handleOAuthSignIn} />
                                        <OAuthButton provider="google" label="Google" onClick={handleOAuthSignIn} />
                                        <OAuthButton provider="facebook" label="Facebook" onClick={handleOAuthSignIn} />
                                        <OAuthButton provider="x" label="X" onClick={handleOAuthSignIn} iconOnly />
                                        <OAuthButton provider="discord" label="Discord" onClick={handleOAuthSignIn} wide />
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
                                        className="secondary-pill type-button px-5 py-2.5"
                                    >
                                        {intakeText.actions.backToLogin}
                                    </button>
                                ) : null}
                                <button
                                    type="submit"
                                    disabled={isSigningIn}
                                    className="primary-pill type-button px-5 py-2.5 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isSigningIn
                                        ? intakeText.auth.signingIn
                                        : authMode === 'resetPassword'
                                            ? intakeText.auth.sendReset
                                            : authMode === 'register'
                                                ? intakeText.auth.registerAndContinue
                                                : intakeText.auth.signInAndContinue}
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
                        <div className="input-surface glass-panel flex max-h-[calc(100vh-3rem)] w-full max-w-2xl flex-col rounded-[30px] p-6 text-zinc-100 sm:p-7">
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <h2 className="type-title-3 text-white">
                                        {legalDocuments[activeLegalDocument].title}
                                    </h2>
                                    <p className="type-caption-1 mt-2 text-zinc-500">
                                        {translate('intake.auth.legalUpdated', { date: legalDocuments[activeLegalDocument].updatedAt })}
                                    </p>
                                    <p className="type-callout mt-4 text-zinc-300">
                                        {legalDocuments[activeLegalDocument].intro}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    aria-label={translate('intake.auth.legalClose')}
                                    onClick={() => setActiveLegalDocument(null)}
                                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full glass-icon-button"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
                                <div className="space-y-4">
                                    {legalDocuments[activeLegalDocument].sections.map(section => (
                                        <section key={section.title} className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                                            <h3 className="type-subheadline text-white">{section.title}</h3>
                                            <p className="type-callout mt-2 text-zinc-300">{section.body}</p>
                                        </section>
                                    ))}
                                </div>
                            </div>
                            <div className="mt-6 flex justify-end border-t border-white/10 pt-5">
                                <button
                                    type="button"
                                    onClick={() => setActiveLegalDocument(null)}
                                    className="primary-pill type-button px-5 py-2.5"
                                >
                                    {translate('intake.auth.legalUnderstand')}
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
                    <div className={`input-surface glass-panel relative flex max-h-[calc(100vh-3rem)] w-full ${intakeModalWidthClass} flex-col overflow-hidden rounded-[32px] text-zinc-100`}>
                        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,212,54,0.10),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.08),transparent_38%)]" />
                        <div className="relative z-10 flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-6">
                            <div className="min-w-0">
                                <h2 className="type-title-2 text-white">
                                    {modalTitle}
                                </h2>
                            </div>
                            <button
                                type="button"
                                aria-label={intakeText.modal.close}
                                disabled={isPreparing || isTransitioning}
                                onClick={handleCloseIntake}
                                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full glass-icon-button disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-6 pb-6">

                    {intakePhase === 'options_ready' ? (
                        <div className="space-y-4" data-testid="intake-options">
                            <div className="grid items-stretch gap-4 md:grid-cols-3">
                                {intakeOptions.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        onClick={() => handleSelectOption(option)}
                                        data-testid="intake-option-card"
                                        className="group grid h-[25rem] grid-rows-[5.25rem_1.75rem_minmax(0,1fr)] overflow-hidden rounded-[26px] border border-white/15 bg-black/20 p-5 text-left shadow-[0_18px_54px_rgba(0,0,0,0.32)] transition hover:border-white/35 hover:bg-white/[0.045] focus-visible:border-white/50 focus-visible:outline-none"
                                    >
                                        <div className="min-h-0">
                                            <div className="type-caption-1 text-white/45 transition-colors group-hover:text-white/60">{intakeText.optionCard.mode}</div>
                                            <div
                                                data-testid="intake-option-title"
                                                className="type-title-3 mt-2 line-clamp-2 overflow-hidden text-white"
                                            >
                                                {option.title}
                                            </div>
                                        </div>
                                        <div className="type-caption-1 self-start text-white/45 transition-colors group-hover:text-white/60">{intakeText.optionCard.gameplay}</div>
                                        <div
                                            data-testid="intake-option-gameplay"
                                            className="type-body min-h-0 overflow-y-auto pr-1 text-zinc-300 [scrollbar-width:thin]"
                                        >
                                            {option.gameplay}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {intakePhase === 'configuring_details' && selectedOption && settings ? (
                        <div className="space-y-4" data-testid="intake-settings" data-panel-depth="single">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="type-subheadline text-zinc-300">
                                    {intakeText.fields.platform}
                                    <select aria-label={intakeText.fields.platform} value={settings.platform} onChange={(event) => updateSettings({ platform: event.target.value })} className="glass-control type-input mt-2 h-11 w-full rounded-2xl px-3">
                                        {optionsWithCurrentValue(platformOptions, settings.platform).map((option) => <option key={option} value={option}>{localizedOptionLabel(option)}</option>)}
                                    </select>
                                </label>
                                <label className="type-subheadline text-zinc-300">
                                    {intakeText.fields.engine}
                                    <select aria-label={intakeText.fields.engine} value={normalizeEngine(settings.engine)} onChange={(event) => updateSettings({ engine: event.target.value })} className="glass-control type-input mt-2 h-11 w-full rounded-2xl px-3">
                                        {engineOptions.map((option) => <option key={option} value={option}>{localizedOptionLabel(option)}</option>)}
                                    </select>
                                </label>
                                <label className="type-subheadline text-zinc-300">
                                    {intakeText.fields.dimension}
                                    <select aria-label={intakeText.fields.dimension} value={settings.dimension} onChange={(event) => updateSettings({ dimension: event.target.value })} className="glass-control type-input mt-2 h-11 w-full rounded-2xl px-3">
                                        {optionsWithCurrentValue(dimensionOptions, settings.dimension).map((option) => <option key={option} value={option}>{localizedOptionLabel(option)}</option>)}
                                    </select>
                                </label>
                                <label className="type-subheadline text-zinc-300">
                                    {intakeText.fields.genre}
                                    <select aria-label={intakeText.fields.genre} value={settings.genre} onChange={(event) => updateSettings({ genre: event.target.value })} className="glass-control type-input mt-2 h-11 w-full rounded-2xl px-3">
                                        {optionsWithCurrentValue(genreOptions, settings.genre).map((option) => <option key={option} value={option}>{localizedOptionLabel(option)}</option>)}
                                    </select>
                                </label>
                                <label className="type-subheadline text-zinc-300">
                                    {intakeText.fields.style}
                                    <select aria-label={intakeText.fields.style} value={settings.visualStyle} onChange={(event) => updateSettings({ visualStyle: event.target.value })} className="glass-control type-input mt-2 h-11 w-full rounded-2xl px-3">
                                        {optionsWithCurrentValue(styleOptions, settings.visualStyle).map((option) => <option key={option} value={option}>{localizedOptionLabel(option)}</option>)}
                                    </select>
                                </label>
                                <div ref={inputMenuRef} className="type-subheadline relative text-zinc-300">
                                    {intakeText.fields.inputs}
                                    <button
                                        ref={inputMenuButtonRef}
                                        type="button"
                                        aria-haspopup="listbox"
                                        aria-expanded={isInputMenuOpen}
                                        onClick={() => setIsInputMenuOpen(value => !value)}
                                        className="glass-control type-input mt-2 flex h-11 w-full items-center justify-between gap-3 rounded-2xl px-3 text-left"
                                    >
                                        <span className="min-w-0 truncate">{localizedInputs(settings.inputs)}</span>
                                        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition ${isInputMenuOpen ? 'rotate-180' : ''}`} />
                                    </button>
                                </div>
                            </div>

                            <label className="type-subheadline block text-zinc-300">
                                {intakeText.fields.notes}
                                <textarea
                                    aria-label={intakeText.fields.notes}
                                    value={settings.notes || ''}
                                    onChange={(event) => updateSettings({ notes: event.target.value })}
                                    placeholder={intakeText.placeholders.notes}
                                    className="glass-control type-callout mt-2 min-h-24 w-full resize-none rounded-2xl px-3 py-3 placeholder:text-zinc-500"
                                />
                            </label>

                            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                                <button type="button" onClick={handleBackToOptions} className="secondary-pill type-button px-5 py-2.5">
                                    {intakeText.actions.chooseAgain}
                                </button>
                                <button type="button" onClick={handleConfirmSettings} className="primary-pill type-button px-6 py-2.5">
                                    {intakeText.actions.confirmBrief}
                                </button>
                            </div>
                        </div>
                    ) : null}

                    {intakePhase === 'confirming_brief' && selectedOption && settings ? (
                        <div className="space-y-4" data-testid="confirmed-brief" data-panel-depth="single">
                            <p className="type-body mt-3 text-zinc-300">{selectedOption.pitch}</p>
                            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
	                                <div><dt className="type-caption-1 text-zinc-500">{intakeText.fields.platform}</dt><dd className="type-callout mt-1 text-white">{localizedOptionLabel(settings.platform)}</dd></div>
	                                <div><dt className="type-caption-1 text-zinc-500">{intakeText.fields.engine}</dt><dd className="type-callout mt-1 text-white">{localizedOptionLabel(settings.engine || 'React')}</dd></div>
	                                <div><dt className="type-caption-1 text-zinc-500">{intakeText.fields.presentation}</dt><dd className="type-callout mt-1 text-white">{localizedOptionLabel(settings.dimension)}</dd></div>
	                                <div><dt className="type-caption-1 text-zinc-500">{intakeText.fields.type}</dt><dd className="type-callout mt-1 text-white">{localizedOptionLabel(settings.genre)}</dd></div>
	                                <div><dt className="type-caption-1 text-zinc-500">{intakeText.fields.style}</dt><dd className="type-callout mt-1 text-white">{localizedOptionLabel(settings.visualStyle)}</dd></div>
	                                <div><dt className="type-caption-1 text-zinc-500">{intakeText.fields.inputs}</dt><dd className="type-callout mt-1 text-white">{localizedInputs(settings.inputs)}</dd></div>
                            </dl>
                            {settings.notes ? <p className="type-footnote mt-4 rounded-2xl bg-white/5 p-3 text-zinc-300">{settings.notes}</p> : null}
                            <div className="mt-5 flex flex-wrap justify-end gap-3">
                                <button type="button" onClick={() => setIntakePhase('configuring_details')} className="secondary-pill type-button px-5 py-2.5">
                                    {intakeText.actions.edit}
                                </button>
                                <button type="button" disabled={isPreparing} onClick={handleStartBuild} className="primary-pill type-button px-5 py-2.5 disabled:cursor-not-allowed disabled:opacity-60">
                                    {isPreparing ? intakeText.actions.building : intakeText.actions.startBuild}
                                </button>
                            </div>
                        </div>
                    ) : null}
                        </div>
                    </div>
                </div>
                ) : null}

                {isInputMenuOpen && settings && inputMenuPosition && typeof document !== 'undefined'
                    ? createPortal(
                        <div
                            ref={inputMenuDropdownRef}
                            role="listbox"
                            aria-label={intakeText.fields.inputs}
                            data-surface="frosted-glass"
                            data-glass-density="reinforced"
                            data-floating-layer="true"
                            style={{
                                left: inputMenuPosition.left,
                                top: inputMenuPosition.top,
                                width: inputMenuPosition.width,
                            }}
                            className="input-surface glass-panel fixed z-[220] overflow-hidden rounded-3xl p-1.5 text-zinc-100 backdrop-blur-2xl"
                        >
                            <div className="relative z-10">
                                {inputOptions.map((input) => {
                                    const active = settings.inputs.includes(input);
                                    return (
                                        <button
                                            key={input}
                                            type="button"
                                            role="option"
                                            aria-selected={active}
                                            onClick={() => toggleInput(input)}
                                            className="type-button flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left text-zinc-200 transition hover:bg-white/10"
                                        >
                                            <span>{localizedOptionLabel(input)}</span>
                                            {active ? <Check className="h-4 w-4 text-emerald-200" /> : null}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>,
                        document.body,
                    )
                    : null}

                {clarification ? (
                    <div
                        role="status"
                        aria-live="polite"
                        data-testid="intake-clarification"
                        className="relative z-20 mt-4 w-[min(760px,calc(100vw-2rem))] rounded-[24px] border border-white/15 bg-zinc-950/60 px-5 py-4 text-left text-zinc-100 shadow-[0_18px_55px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
                    >
                        <div className="type-caption-1 text-amber-300">{intakeText.clarification.title}</div>
                        <p className="type-callout mt-2 text-zinc-200">{clarification.prompt}</p>
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
                                        <span className="type-subheadline block text-white">{option.label}</span>
                                        {option.description ? (
                                            <span className="type-callout mt-1 block text-zinc-400">{option.description}</span>
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
                                aria-label={clarification.freeformLabel || intakeText.clarification.freeformLabel}
                                value={clarificationDraft}
                                disabled={isPreparing || isTransitioning}
                                onChange={(event) => setClarificationDraft(event.target.value)}
                                placeholder={clarification.freeformLabel || intakeText.clarification.placeholder}
                                className="glass-control type-input min-w-0 flex-1 rounded-full px-4 py-3 placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                            <button
                                type="submit"
                                disabled={!clarificationDraft.trim() || isPreparing || isTransitioning}
                                className="primary-pill type-button px-5 py-3 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {intakeText.actions.continue}
                            </button>
                        </form>
                    </div>
                ) : null}

                {intakeCreditQuote ? (
                    <CreditConfirmDialog
                        quote={intakeCreditQuote}
                        onCancel={handleCancelIntakeCredit}
                        onConfirm={handleConfirmIntakeCredit}
                    />
                ) : null}

                {buildCreditQuote ? (
                    <CreditConfirmDialog
                        quote={buildCreditQuote}
                        onCancel={handleCancelBuildCredit}
                        onConfirm={handleConfirmBuildCredit}
                    />
                ) : null}

                {intakeError ? (
                    <div className="type-footnote relative z-20 mt-4 max-w-xl rounded-xl border border-red-400/30 bg-red-950/60 px-4 py-3 text-red-100 shadow-lg backdrop-blur">
                        {intakeError}
                    </div>
                ) : null}
            </div>
    );
}

function CreditConfirmDialog({
    quote,
    onCancel,
    onConfirm,
}: {
    quote: BeeGameCreditQuote;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const { t: translate } = useTranslation();
    const copy = createLandingIntakeCopy((key, options) => translate(`intake.${key}`, options));
    const isIntake = quote.taskType === 'idea_intake';
    const taskName = isIntake ? copy.credits.intakeTask : copy.credits.buildTask;
    const titleId = `beegame-${quote.taskType}-credit-title`;
    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                data-surface="frosted-glass"
                className="input-surface glass-panel w-full max-w-[520px] rounded-[30px] p-6 text-left text-zinc-100 sm:p-7"
            >
                <h2 id={titleId} className="type-title-2 text-white">
                    {copy.credits.title(taskName)}
                </h2>
                <div className="credit-ticket-shell mt-6">
                    <div className="credit-ticket">
                        <div className="grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-stretch px-10 py-5">
                            <div className="min-w-0 pr-5">
                                <div className="type-caption-1 text-zinc-500">
                                    {copy.credits.balance}
                                </div>
                                <div className="type-title-3 mt-2 text-emerald-200">
                                    {quote.balanceCredits} credits
                                </div>
                            </div>
                            <div className="credit-ticket-divider" aria-hidden="true" />
                            <div className="min-w-0 pl-5 text-right">
                                <div className="type-caption-1 text-zinc-500">
                                    {copy.credits.reserved}
                                </div>
                                <div className="type-title-3 mt-2 text-white">
                                    {quote.reservedCredits} credits
                                </div>
                            </div>
                        </div>
                        <div className="border-t border-white/10 px-7 py-3">
                            <p className="type-caption-2 truncate text-zinc-400">
                                {copy.credits.refundRule}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="secondary-pill type-button px-6 py-3"
                    >
                        {copy.actions.cancel}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="primary-pill type-button px-7 py-3"
                    >
                        {isIntake ? copy.actions.confirmGenerate : copy.actions.confirmBuild}
                    </button>
                </div>
            </div>
        </div>
    );
}

function CreditMetric({
    label,
    value,
    tone = 'neutral',
}: {
    label: string;
    value: number;
    tone?: 'neutral' | 'positive';
}) {
    return (
        <div className="rounded-2xl border border-white/10 bg-black/15 px-3 py-2">
            <div className="type-caption-1 text-zinc-500">{label}</div>
            <div className={`type-headline mt-1 truncate ${tone === 'positive' ? 'text-emerald-200' : 'text-zinc-100'}`}>
                {value}
            </div>
        </div>
    );
}

function CreditLedgerRow({
    entry,
    translate,
    compact = false,
}: {
    entry: BeeGameCreditLedgerEntry;
    translate: Translate;
    compact?: boolean;
}) {
    return (
        <div className={`flex items-center justify-between gap-3 rounded-2xl bg-black/20 ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
            <div className="min-w-0">
                <div className="type-callout truncate text-zinc-200">
                    {formatCreditLedgerTitle(entry, translate)}
                </div>
                <div className="type-footnote mt-0.5 truncate text-zinc-500">
                    {formatCreditLedgerMeta(entry)}
                </div>
            </div>
            <div className={`type-headline shrink-0 ${getCreditLedgerAmountClass(entry.kind)}`}>
                {formatCreditLedgerAmount(entry)}
            </div>
        </div>
    );
}

function formatCreditLedgerKind(kind: BeeGameCreditLedgerEntry['kind'], translate: Translate): string {
    return translate(`credits.kind.${kind}`, { defaultValue: kind });
}

function formatCreditLedgerTitle(entry: BeeGameCreditLedgerEntry, translate: Translate): string {
    return `${formatCreditLedgerStage(entry, translate)} · ${formatCreditLedgerKind(entry.kind, translate)}`;
}

function formatCreditLedgerStage(entry: BeeGameCreditLedgerEntry, translate: Translate): string {
    const taskType = typeof entry.metadata?.taskType === 'string'
        ? entry.metadata.taskType
        : undefined;
    if (taskType) return formatCreditTaskType(taskType, translate);
    const displayName = typeof entry.metadata?.displayName === 'string'
        ? entry.metadata.displayName.trim()
        : '';
    if (displayName) return displayName;
    return 'Credit';
}

function formatCreditTaskType(taskType: string, translate: Translate): string {
    return translate(`credits.task.${taskType}`, {
        defaultValue: taskType.replaceAll('_', ' '),
    });
}

function formatCreditLedgerMeta(entry: BeeGameCreditLedgerEntry): string {
    const parts = [new Date(entry.createdAt).toLocaleString()];
    if (typeof entry.weightedTokens === 'number' && entry.weightedTokens > 0) {
        parts.push(`${entry.weightedTokens.toLocaleString()} weighted tokens`);
    }
    return parts.join(' · ');
}

function formatCreditLedgerAmount(entry: BeeGameCreditLedgerEntry): string {
    const amount = Math.abs(entry.credits);
    if (entry.kind === 'grant' || entry.kind === 'refund') {
        return `+${amount}`;
    }
    if (entry.kind === 'reserve' || entry.kind === 'settle') {
        return `-${amount}`;
    }
    return String(entry.credits);
}

function getCreditLedgerAmountClass(kind: BeeGameCreditLedgerEntry['kind']): string {
    if (kind === 'grant' || kind === 'refund') return 'text-emerald-200';
    if (kind === 'reserve' || kind === 'settle') return 'text-amber-200';
    return 'text-zinc-300';
}

function OAuthButton({
    provider,
    label,
    onClick,
    wide = false,
    iconOnly = false,
}: {
    provider: SupabaseOAuthProvider;
    label: string;
    onClick: (provider: SupabaseOAuthProvider) => void | Promise<void>;
    wide?: boolean;
    iconOnly?: boolean;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            onClick={() => void onClick(provider)}
            className={`type-button inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-zinc-100 transition hover:bg-white/10 ${iconOnly ? 'gap-0' : 'gap-2.5'} ${wide ? 'sm:col-span-2' : ''}`}
        >
            <OAuthProviderIcon provider={provider} />
            {iconOnly ? <span className="sr-only">{label}</span> : <span>{label}</span>}
        </button>
    );
}

function OAuthProviderIcon({ provider }: { provider: SupabaseOAuthProvider }) {
    if (provider === 'github') {
        return (
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current text-white">
                <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.21.09 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.63-5.48 5.93.43.37.82 1.1.82 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .5Z" />
            </svg>
        );
    }
    if (provider === 'google') {
        return (
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]">
                <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.53-.2-2.27H12v4.29h6.47a5.54 5.54 0 0 1-2.4 3.63v2.96h3.88c2.27-2.09 3.54-5.17 3.54-8.61Z" />
                <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-2.96c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.05A12 12 0 0 0 12 24Z" />
                <path fill="#FBBC05" d="M5.27 14.33a7.2 7.2 0 0 1 0-4.66V6.62H1.26a12 12 0 0 0 0 10.76l4.01-3.05Z" />
                <path fill="#EA4335" d="M12 4.72c1.76 0 3.34.61 4.58 1.79l3.44-3.44A11.55 11.55 0 0 0 12 0 12 12 0 0 0 1.26 6.62l4.01 3.05C6.22 6.83 8.87 4.72 12 4.72Z" />
            </svg>
        );
    }
    if (provider === 'facebook') {
        return (
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-[#1877F2]">
                <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.03 1.79-4.7 4.53-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.09 24 18.1 24 12.07Z" />
            </svg>
        );
    }
    if (provider === 'x') {
        return (
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[17px] w-[17px] fill-current text-white">
                <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.59-6.64 7.59H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93Zm-1.29 19.5h2.04L6.48 3.23H4.29l13.32 17.42Z" />
            </svg>
        );
    }
    return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[19px] w-[19px] fill-[#5865F2]">
            <path d="M20.32 4.37A19.8 19.8 0 0 0 15.36 2.8a13.9 13.9 0 0 0-.64 1.32 18.4 18.4 0 0 0-5.44 0 13.9 13.9 0 0 0-.65-1.32 19.7 19.7 0 0 0-4.96 1.57C.53 9.04-.32 13.59.1 18.08a20 20 0 0 0 6.08 3.11 15 15 0 0 0 1.3-2.13 12.9 12.9 0 0 1-2.05-.99c.17-.13.34-.26.5-.39a14.2 14.2 0 0 0 12.14 0c.16.13.33.26.5.39-.65.39-1.33.72-2.05.99.38.76.82 1.48 1.3 2.13a20 20 0 0 0 6.08-3.11c.5-5.2-.84-9.7-3.58-13.71ZM8.02 15.33c-1.18 0-2.15-1.09-2.15-2.43s.95-2.43 2.15-2.43c1.2 0 2.17 1.1 2.15 2.43 0 1.34-.95 2.43-2.15 2.43Zm7.96 0c-1.18 0-2.15-1.09-2.15-2.43s.95-2.43 2.15-2.43c1.2 0 2.17 1.1 2.15 2.43 0 1.34-.95 2.43-2.15 2.43Z" />
        </svg>
    );
}

const getDisplayInitial = (value: string): string => {
    const first = Array.from(value.trim() || 'U')[0] || 'U';
    return /^[a-z]$/i.test(first) ? first.toUpperCase() : first;
};
