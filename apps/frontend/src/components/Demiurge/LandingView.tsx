import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, X } from 'lucide-react';
import { WorkspaceLoadingPage } from '../Common/WorkspaceLoadingPage';
import { Button as BeUiButton } from '../beui/project-button';
import type { Language } from './AgentsConfig';
import { normalizeI18nLanguage, useCommonText } from '../../i18n/useBeeGameTranslations';
import { useProjectStore } from '../../store/projectStore';
import { useSystemStore } from '../../store/systemStore';
import { HeroIntro } from './Landing/HeroIntro';
import { IdeaPromptForm, type CreationMode } from './Landing/IdeaPromptForm';
import { BeeGameLogo } from '../BeeGameLogo';
import { AccountActionsMenu } from './Landing/AccountActionsMenu';
import { ThemeToggle } from '../beui/motion/theme-toggle';
import { LandingImageBackground } from './Landing/LandingImageBackground';
import { CreditStoreModal } from './Landing/CreditStoreModal';
import { ProjectHistoryModal } from './Landing/ProjectHistoryModal';
import { ProfileModal } from './Landing/ProfileModal';
import { SettingsMenu } from './Landing/SettingsMenu';
import { LandingSiteMenu, type LandingPage } from './Landing/LandingSiteMenu';
import { AuthDialog } from './Landing/AuthDialog';
import { ConfirmedBrief, IntakeOptionCards, IntakeSettingsForm } from './Landing/IntakePanels';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../ui/dialog';
import {
  closeResourceLibraryRoute,
  isResourceLibraryRoute,
  openResourceLibraryRoute,
} from '../ResourceLibrary/resourceLibraryRoute';
import {
  CONFIGURED_PRODUCTION_SETTING_OPTIONS,
  type ProductionSettingOptions,
} from '../../config/productionSettingOptions';
import type { StartProjectResult } from '../../types/project';
import {
  beeGameAdapter,
  type BeeGameBuildBrief,
  type BeeGameIntakeOption,
  type BeeGameIntakeSettings,
} from '../../services/beeGameAdapter';

import { useCredits } from '../../hooks/useCredits';
import { useToastContext } from '../../contexts/ToastContext';
import {
  clearSupabaseSession,
  isSupabaseAuthConfigured,
  resendSupabaseSignupCode,
  sendSupabasePasswordReset,
  signInWithSupabaseOAuth,
  signInWithSupabasePassword,
  signUpWithSupabasePassword,
  verifySupabaseSignupCode,
  SupabaseAuthApiError,
  type SupabaseOAuthProvider,
} from '../../services/supabaseAuthApi';
import { getInvitationPublicSettings } from '../../services/invitationApi';
import type { ChatAttachmentPayload } from '../../services/api';

const ResourceLibraryPage = lazy(async () => {
  const module = await import('../ResourceLibrary/ResourceLibraryView');
  return { default: module.ResourceLibraryPage };
});

type IntakePhase =
  | 'idle'
  | 'generating_options'
  | 'options_ready'
  | 'configuring_details'
  | 'confirming_brief'
  | 'starting_build';


export type IntakeCopy = {
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
    resourceLibrary: string;
    selectPlaceholder: string;
  };
  resourceLibraryUsage: Record<BeeGameIntakeSettings['resourceLibraryUsage'], string>;
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
  starting: {
    title: string;
    description: string;
  };
  errors: {
    missingPlatformModel: string;
    projectStartFailed: string;
    authNotConfigured: string;
    missingEmailPassword: string;
    missingDisplayName: string;
    termsRequired: string;
    missingProductionSettings: string;
  };
  placeholders: {
    notes: string;
  };
  profile: {
    displayNameFallback: string;
    emailFallback: string;
    balance: string;
    consumed: string;
    deleteAccount: string;
    deleteConfirm: string;
    deleteFailed: string;
    finish: string;
    saving: string;
  };
  auth: {
    oauthDivider: string;
    signingIn: string;
    sendReset: string;
    registerAndContinue: string;
    signInAndContinue: string;
    oauthFailed: string;
    successTitle: string;
    errorTitle: string;
    loginSuccess: string;
    registerSuccess: string;
    resetEmailSent: string;
    feedbackClose: string;
    forgotPassword: string;
    acceptTermsAria: string;
    acceptTermsPrefix: string;
    termsLabel: string;
    privacyLabel: string;
    acceptTermsConnector: string;
    acceptTermsSuffix: string;
  };
};

export type Translate = (key: string, options?: Record<string, unknown>) => string;

export type AuthMode = 'login' | 'register' | 'resetPassword' | 'verifyEmail';

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
    resourceLibrary: translate('fields.resourceLibrary'),
    selectPlaceholder: translate('fields.selectPlaceholder'),
  },
  resourceLibraryUsage: {
    optional: translate('resourceLibraryUsage.optional'),
    preferred: translate('resourceLibraryUsage.preferred'),
    required: translate('resourceLibraryUsage.required'),
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
  starting: {
    title: translate('starting.title'),
    description: translate('starting.description'),
  },
  errors: {
    missingPlatformModel: translate('errors.missingPlatformModel'),
    projectStartFailed: translate('errors.projectStartFailed'),
    authNotConfigured: translate('errors.authNotConfigured'),
    missingEmailPassword: translate('errors.missingEmailPassword'),
    missingDisplayName: translate('errors.missingDisplayName'),
    termsRequired: translate('errors.termsRequired'),
    missingProductionSettings: translate('errors.missingProductionSettings'),
  },
  placeholders: {
    notes: translate('placeholders.notes'),
  },
  profile: {
    displayNameFallback: translate('profile.displayNameFallback'),
    emailFallback: translate('profile.emailFallback'),
    balance: translate('profile.balance'),
    consumed: translate('profile.consumed'),
    deleteAccount: translate('profile.deleteAccount'),
    deleteConfirm: translate('profile.deleteConfirm'),
    deleteFailed: translate('profile.deleteFailed'),
    finish: translate('profile.finish'),
    saving: translate('profile.saving'),
  },
  auth: {
    oauthDivider: translate('auth.oauthDivider'),
    signingIn: translate('auth.signingIn'),
    sendReset: translate('auth.sendReset'),
    registerAndContinue: translate('auth.registerAndContinue'),
    signInAndContinue: translate('auth.signInAndContinue'),
    oauthFailed: translate('auth.oauthFailed'),
    successTitle: translate('auth.feedback.successTitle'),
    errorTitle: translate('auth.feedback.errorTitle'),
    loginSuccess: translate('auth.feedback.loginSuccess'),
    registerSuccess: translate('auth.feedback.registerSuccess'),
    resetEmailSent: translate('auth.feedback.resetEmailSent'),
    feedbackClose: translate('auth.feedback.close'),
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

export type AuthFeedbackDialog = {
  kind: 'success' | 'error';
  title: string;
  message: string;
};

type LegalDocumentBundle = Record<
  LegalDocumentKind,
  {
    title: string;
    updatedAt: string;
    intro: string;
    sections: Array<{ title: string; body: string }>;
  }
>;

interface LandingViewProps {
  onStart: (
    projectName: string,
    clarification?: Record<string, string>,
    brief?: BeeGameBuildBrief,
  ) => StartProjectResult | Promise<StartProjectResult>;
  lang: Language;
  onSetLang: (lang: Language) => void;
}

const settingsFromOption = (option: BeeGameIntakeOption): BeeGameIntakeSettings => ({
  platform: pickConfiguredProductionValue(option.recommendedPlatform, CONFIGURED_PRODUCTION_SETTING_OPTIONS.platforms),
  engine: pickConfiguredProductionValue(
    normalizeEngine(option.recommendedEngine),
    CONFIGURED_PRODUCTION_SETTING_OPTIONS.engines,
  ),
  visualStyle: pickConfiguredProductionValue(option.recommendedStyle, CONFIGURED_PRODUCTION_SETTING_OPTIONS.styles),
  dimension: pickConfiguredProductionValue(
    option.recommendedDimension,
    CONFIGURED_PRODUCTION_SETTING_OPTIONS.dimensions,
  ),
  genre: pickConfiguredProductionValue(option.recommendedGenre, CONFIGURED_PRODUCTION_SETTING_OPTIONS.genres),
  inputs: (option.recommendedInputs || [])
    .map(input => pickConfiguredProductionValue(input, CONFIGURED_PRODUCTION_SETTING_OPTIONS.inputs))
    .filter(Boolean),
  scope: option.scope || 'Prototype',
  notes: '',
  resourceLibraryUsage: 'optional',
});

function pickConfiguredProductionValue(value: string | undefined, options: string[]): string {
  const normalized = value?.trim();
  if (!normalized || normalized === 'Auto') return '';
  return options.includes(normalized) ? normalized : '';
}

function hasRequiredProductionSettings(settings: BeeGameIntakeSettings): boolean {
  return Boolean(
    settings.platform.trim() &&
      settings.engine?.trim() &&
      settings.dimension.trim() &&
      settings.genre.trim() &&
      settings.visualStyle.trim() &&
      settings.inputs.length > 0 &&
      ['optional', 'preferred', 'required'].includes(settings.resourceLibraryUsage),
  );
}

function blueprintOption(idea: string): BeeGameIntakeOption {
  return {
    id: 'blueprint', title: idea.slice(0, 80), gameplay: idea,
    pitch: '', coreGameplayHypothesis: '', experienceSnapshot: '', playerFirstMinute: '',
    whyFitsIdea: '', playablePrototype: '', validationTarget: '', coreMechanic: '',
    firstBuild: '', validationGoal: '', risk: '', fit: '', firstPlayableValidation: '',
    riskComplexity: '', recommendedPlatform: '', recommendedEngine: '',
    recommendedDimension: '', recommendedGenre: '', recommendedStyle: '',
    recommendedInputs: [], scope: '',
  };
}

function normalizeEngine(value: string | undefined): string {
  return value === 'Unreal Engine' ? 'Unreal' : value || '';
}

const pendingAuthIdeaStorageKey = 'beegame.pendingAuthIdea.v1';
const pendingIdeaDraftStorageKey = 'beegame.pendingIdeaDraft.v1';
const pendingIntakeFlowStorageKey = 'beegame.pendingIntakeFlow.v1';
const pendingRealtimeBillingStorageKey = 'beegame.pendingRealtimeBilling.v1';
const pendingAuthIdeaMaxAgeMs = 30 * 60 * 1000;
const pendingIntakeFlowMaxAgeMs = 30 * 60 * 1000;

type RestorableIntakePhase = Extract<IntakePhase, 'options_ready' | 'configuring_details' | 'confirming_brief'>;

type PendingAuthIdeaState = {
  idea: string;
  creationMode?: CreationMode;
  referenceNames?: string[];
  createdAt: number;
};

type PendingIdeaDraftState = {
  idea: string;
  creationMode?: CreationMode;
  referenceNames?: string[];
  createdAt: number;
};

type PendingIntakeFlowState = {
  creationMode?: CreationMode;
  referenceNames?: string[];
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

function writePendingIdeaDraftState(idea: string, creationMode: CreationMode, referenceNames: string[]): void {
  const normalizedIdea = idea.trim();
  try {
    if (!normalizedIdea && !referenceNames.length) {
      clearPendingIdeaDraftState();
      return;
    }
    sessionStorage.setItem(
      pendingIdeaDraftStorageKey,
      JSON.stringify({
        idea: normalizedIdea,
        creationMode,
        referenceNames,
        createdAt: Date.now(),
      }),
    );
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
    if (!isPendingIntakeFlowState(value)) {
      clearPendingIntakeFlowState();
      return null;
    }
    if (Date.now() - value.createdAt > pendingIntakeFlowMaxAgeMs) {
      clearPendingIntakeFlowState();
      return null;
    }
    return value;
  } catch {
    clearPendingIntakeFlowState();
    return null;
  }
}

function writePendingIntakeFlowState(value: Omit<PendingIntakeFlowState, 'createdAt'>): void {
  try {
    sessionStorage.setItem(
      pendingIntakeFlowStorageKey,
      JSON.stringify({
        ...value,
        createdAt: Date.now(),
      }),
    );
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

function readPendingRealtimeBillingIdea(): string {
  try {
    const raw = sessionStorage.getItem(pendingRealtimeBillingStorageKey);
    if (!raw) return '';
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || typeof value.idea !== 'string' || typeof value.createdAt !== 'number') return '';
    if (Date.now() - value.createdAt > pendingIntakeFlowMaxAgeMs) {
      sessionStorage.removeItem(pendingRealtimeBillingStorageKey);
      return '';
    }
    return value.idea.trim();
  } catch {
    return '';
  }
}

function writePendingRealtimeBillingIdea(idea: string): void {
  try {
    sessionStorage.setItem(
      pendingRealtimeBillingStorageKey,
      JSON.stringify({ idea: idea.trim(), createdAt: Date.now() }),
    );
  } catch {
    // Best-effort recovery for a browser refresh.
  }
}

function clearPendingRealtimeBillingIdea(): void {
  try {
    sessionStorage.removeItem(pendingRealtimeBillingStorageKey);
  } catch {
    // Ignore storage failures; the in-memory flow remains authoritative.
  }
}

function writePendingAuthIdeaState(idea: string, creationMode: CreationMode, referenceNames: string[]): void {
  const normalizedIdea = idea.trim();
  if (!normalizedIdea) return;
  try {
    sessionStorage.setItem(
      pendingAuthIdeaStorageKey,
      JSON.stringify({
        idea: normalizedIdea,
        creationMode,
        referenceNames,
        createdAt: Date.now(),
      }),
    );
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

function clearIntakeRecoveryState(): void {
  clearPendingIdeaDraftState();
  clearPendingIntakeFlowState();
}

function isPendingAuthIdeaState(value: unknown): value is PendingAuthIdeaState {
  return (
    isRecord(value) &&
    typeof value.idea === 'string' &&
    value.idea.trim().length > 0 &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt)
  );
}

function isPendingIdeaDraftState(value: unknown): value is PendingIdeaDraftState {
  return (
    isRecord(value) &&
    typeof value.idea === 'string' &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt)
  );
}

function isPendingIntakeFlowState(value: unknown): value is PendingIntakeFlowState {
  if (!isRecord(value)) return false;
  const phase = value.phase;
  if (phase !== 'options_ready' && phase !== 'configuring_details' && phase !== 'confirming_brief') return false;
  if (typeof value.idea !== 'string' || value.idea.trim().length === 0) return false;
  if (!Array.isArray(value.options) || (value.creationMode === 'blueprint' ? value.options.length !== 0 : value.options.length !== 3)) return false;
  if (typeof value.language !== 'string') return false;
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return false;
  if (
    (phase === 'configuring_details' || phase === 'confirming_brief') &&
    (!isRecord(value.selectedOption) || !isRecord(value.settings))
  ) {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function LandingView({ onStart, lang, onSetLang }: LandingViewProps) {
  const { t: translate, i18n } = useTranslation();
  const { showError } = useToastContext();
  const [restoredIntakeFlow] = useState<PendingIntakeFlowState | null>(() => readPendingIntakeFlowState());
  const [restoredIdeaDraft] = useState<PendingIdeaDraftState | null>(() => readPendingIdeaDraftState());
  const [restoredRealtimeBillingIdea] = useState(() => readPendingRealtimeBillingIdea());
  const [projectName, setProjectName] = useState(() => restoredIntakeFlow?.idea || restoredIdeaDraft?.idea || '');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [landingPage, setLandingPage] = useState<LandingPage>(() => {
    const page = window.location.pathname.replace(/^\//, '');
    return page === 'blog' || page === 'learn' || page === 'about' ? page : 'home';
  });
  const [isResourceLibraryOpen, setIsResourceLibraryOpen] = useState(() => isResourceLibraryRoute());
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isCreditStoreOpen, setIsCreditStoreOpen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  useEffect(() => {
    const syncResourceRoute = () => setIsResourceLibraryOpen(isResourceLibraryRoute());
    window.addEventListener('popstate', syncResourceRoute);
    return () => window.removeEventListener('popstate', syncResourceRoute);
  }, []);
  useEffect(() => {
    const onPopState = () => {
      const page = window.location.pathname.replace(/^\//, '');
      setLandingPage(page === 'blog' || page === 'learn' || page === 'about' ? page : 'home');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const [intakePhase, setIntakePhase] = useState<IntakePhase>(restoredIntakeFlow?.phase || 'idle');
  const [intakeOptions, setIntakeOptions] = useState<BeeGameIntakeOption[]>(restoredIntakeFlow?.options || []);
  const [selectedOption, setSelectedOption] = useState<BeeGameIntakeOption | null>(
    restoredIntakeFlow?.selectedOption || null,
  );
  const [settings, setSettings] = useState<BeeGameIntakeSettings | null>(restoredIntakeFlow?.settings || null);
  const [intakeError, setIntakeError] = useState('');
  const [attachmentBuildAttachments, setAttachmentBuildAttachments] = useState<ChatAttachmentPayload[]>([]);
  const [creationMode, setCreationMode] = useState<CreationMode>(restoredIntakeFlow?.creationMode || readPendingAuthIdeaState()?.creationMode || restoredIdeaDraft?.creationMode || 'creative');
  const [requiredReferenceNames, setRequiredReferenceNames] = useState<string[]>(restoredIntakeFlow?.referenceNames || restoredIdeaDraft?.referenceNames || []);
  const [isLoginPromptOpen, setIsLoginPromptOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerDisplayName, setRegisterDisplayName] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [isInvitationRequired, setIsInvitationRequired] = useState(false);
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const [, setLoginError] = useState('');
  const [, setLoginNotice] = useState('');
  const [authFeedbackDialog, setAuthFeedbackDialog] = useState<AuthFeedbackDialog | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [emailVerificationCode, setEmailVerificationCode] = useState('');
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [activeLegalDocument, setActiveLegalDocument] = useState<LegalDocumentKind | null>(null);
  const [pendingIdeaAfterLogin, setPendingIdeaAfterLogin] = useState('');
  const [pendingRealtimeBillingIdea, setPendingRealtimeBillingIdea] = useState(restoredRealtimeBillingIdea);
  const [isRealtimeBillingNoticeOpen, setIsRealtimeBillingNoticeOpen] = useState(Boolean(restoredRealtimeBillingIdea));
  const [isInputMenuOpen, setIsInputMenuOpen] = useState(false);
  const inputMenuRef = useRef<HTMLDivElement | null>(null);
  const inputMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const inputMenuDropdownRef = useRef<HTMLDivElement | null>(null);
  const [inputMenuPosition, setInputMenuPosition] = useState<InputMenuPosition | null>(null);
  useEffect(() => {
    const targetLanguage = normalizeI18nLanguage(lang);
    if (i18n.resolvedLanguage !== targetLanguage) {
      void i18n.changeLanguage(targetLanguage);
    }
  }, [i18n, lang]);

  useEffect(() => {
    let cancelled = false;
    void getInvitationPublicSettings()
      .then(settings => {
        if (!cancelled) setIsInvitationRequired(settings.required);
      })
      .catch(() => {
        if (!cancelled) setIsInvitationRequired(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const t = useCommonText(lang);
  const heroPhrases: Record<Language, { connector: string; words: string[] }> = {
    zh: { connector: '，可以是', words: ['一句话', '一张图', '一段视频'] },
    'zh-TW': { connector: '，可以是', words: ['一句話', '一張圖', '一段影片'] },
    en: { connector: ' can be ', words: ['a sentence', 'an image', 'a video'] },
    ja: { connector: '。', words: ['ひとことでも', '一枚の画像でも', 'ひとつの動画でも'] },
    ko: { connector: ' — ', words: ['한 문장', '한 장의 이미지', '한 편의 영상'] },
    fr: { connector: ' : ', words: ['une phrase', 'une image', 'une vidéo'] },
    de: { connector: ' – ', words: ['ein Satz', 'ein Bild', 'ein Video'] },
    es: { connector: ': ', words: ['una frase', 'una imagen', 'un vídeo'] },
    it: { connector: ': ', words: ['una frase', 'un’immagine', 'un video'] },
    pt: { connector: ': ', words: ['uma frase', 'uma imagem', 'um vídeo'] },
  };
  const navigateLandingPage = (page: LandingPage) => {
    const pathname = page === 'home' ? '/' : `/${page}`;
    window.history.pushState({}, '', pathname);
    setLandingPage(page);
  };
  const isChinaVisitor = lang === 'zh' && Intl.DateTimeFormat().resolvedOptions().timeZone === 'Asia/Shanghai';
  const icpNumber = import.meta.env.VITE_ICP_RECORD_NUMBER as string | undefined;
  const intakeTranslate: Translate = (key, options) => translate(`intake.${key}`, options);
  const intakeText = createLandingIntakeCopy(intakeTranslate);
  // Login, billing consent and local UI transitions are not Agent thinking.
  const showAuthError = (message: string) => {
    setLoginError(message);
    setAuthFeedbackDialog({
      kind: 'error',
      title: intakeText.auth.errorTitle,
      message,
    });
  };
  const showAuthSuccess = (message: string) => {
    setLoginNotice(message);
    setAuthFeedbackDialog({
      kind: 'success',
      title: intakeText.auth.successTitle,
      message,
    });
  };
  const localizeAuthError = (error: unknown, fallbackMessage: string): string => {
    if (error instanceof SupabaseAuthApiError) {
      if (error.code === 'invalid_credentials') {
        return translate('intake.errors.invalidCredentials');
      }
      if (error.code === 'email_not_confirmed') {
        return translate('intake.errors.emailNotConfirmed');
      }
      if (error.code === 'signup_disabled') {
        return translate('intake.errors.signupDisabled');
      }
      if (error.code === 'weak_password') {
        return translate('intake.errors.weakPassword');
      }
    }
    return fallbackMessage;
  };
  const legalDocuments = translate('legal', { returnObjects: true }) as LegalDocumentBundle;
  const localizedOptionLabel = (value: string): string => translate(`intake.options.${value}`, { defaultValue: value });
  const productionSettingOptions: ProductionSettingOptions = CONFIGURED_PRODUCTION_SETTING_OPTIONS;
  const shouldShowIntakeModal =
    (intakePhase !== 'idle' && intakePhase !== 'generating_options' && intakePhase !== 'starting_build');
  const modalTitle =
    intakePhase === 'options_ready'
        ? intakeText.modal.chooseOption
        : intakePhase === 'configuring_details'
          ? (creationMode === 'blueprint' ? intakeText.modal.productionSettings : selectedOption?.title || intakeText.modal.productionSettings)
          : intakePhase === 'confirming_brief'
            ? selectedOption?.title || intakeText.modal.confirmBuildBrief
            : intakeText.modal.startBuild;
  const intakeModalWidthClass =
    intakePhase === 'options_ready' ? 'max-w-5xl' : 'max-w-[34rem]';

  const setActiveProject = useProjectStore(state => state.setActiveProject);
  const currentUser = useSystemStore(state => state.currentUser);
  const authenticationStatus = useSystemStore(state => state.authenticationStatus);
  const { creditBalance } = useCredits(undefined, authenticationStatus === 'authenticated', currentUser?.id);
  const loadCurrentUser = useSystemStore(state => state.loadCurrentUser);

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
      creationMode,
      referenceNames: attachmentBuildAttachments.map(item => item.filename || 'image'),
    });
  };

  const handleSignOut = async () => {
    clearIntakeRecoveryState();
    clearPendingAuthIdeaState();
    clearSupabaseSession();
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
      const pendingIdea = projectName.trim() || attachmentBuildAttachments.map(item => item.filename || 'image').join(', ');
      setPendingIdeaAfterLogin(pendingIdea);
      writePendingAuthIdeaState(pendingIdea, creationMode, attachmentBuildAttachments.map(file => file.filename || 'image'));
      setIsLoginPromptOpen(true);
      return false;
    }
    return true;
  };

  const startIntake = async (idea: string) => {
    if (!hasReferenceFiles()) return;
    setIntakeError('');
    clearPendingIntakeFlowState();
    writePendingIdeaDraftState(idea, creationMode, requiredReferenceNames);
    await runIntake(idea);
  };

  const requestIntakeStart = (idea: string) => {
    writePendingRealtimeBillingIdea(idea);
    setPendingRealtimeBillingIdea(idea);
    setIsRealtimeBillingNoticeOpen(true);
  };

  useEffect(() => {
    if (!currentUser || isPreparing || intakePhase !== 'idle') {
      return;
    }
    const pendingAuthIdea = readPendingAuthIdeaState();
    if (!pendingAuthIdea) return;
    clearPendingAuthIdeaState();
    setProjectName(pendingAuthIdea.idea);
    setPendingIdeaAfterLogin('');
    setIsLoginPromptOpen(false);
    const missingReferences = pendingAuthIdea.referenceNames?.filter(name => !attachmentBuildAttachments.some(file => (file.filename || 'image') === name)) || [];
    if (missingReferences.length) {
      setIntakeError(lang.startsWith('zh') ? '登录跳转后请重新添加参考文件，再继续。' : 'Please reattach your references after signing in, then continue.');
      return;
    }
    if (creationMode === 'blueprint') openBlueprintSettings(pendingAuthIdea.idea);
    else requestIntakeStart(pendingAuthIdea.idea);
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
    setIsPreparing(true);
    setIntakePhase('generating_options');
    try {
      const intake = await beeGameAdapter.runIdeaIntake({
        idea,
        language: lang,
        ...(attachmentBuildAttachments.length ? { attachments: attachmentBuildAttachments } : {}),
      });
      const nextOptions = intake.options;
      setIntakeOptions(nextOptions);
      clearPendingIdeaDraftState();
      setIntakePhase('options_ready');
      writePendingIntakeFlowState({
        phase: 'options_ready',
        idea: projectName.trim() || idea,
        language: lang,
        options: nextOptions,
        creationMode,
        referenceNames: attachmentBuildAttachments.map(item => item.filename || 'image'),
      });
      setIsPreparing(false);
    } catch (error) {
      setIsPreparing(false);
      setIntakePhase('idle');
      setIsTransitioning(false);
      showError(error instanceof Error ? error.message : translate('intake.errors.intakeFailed'));
      console.error('Failed to generate intake options:', error);
    }
  };

  const openBlueprintSettings = (idea: string) => {
    const option = blueprintOption(idea);
    const nextSettings = { ...settingsFromOption(option), scope: idea };
    setSelectedOption(option);
    setSettings(nextSettings);
    setIntakeOptions([]);
    setIntakePhase('configuring_details');
    setIsPreparing(false);
    writePendingIntakeFlowState({
      phase: 'configuring_details', idea, language: lang, creationMode: 'blueprint',
      options: [], selectedOption: option, settings: nextSettings,
      referenceNames: attachmentBuildAttachments.map(item => item.filename || 'image'),
    });
  };

  const handleStart = async (event: React.FormEvent) => {
    event.preventDefault();
    const idea = projectName.trim() || attachmentBuildAttachments.map(item => item.filename || 'image').join(', ');
    if ((!idea && attachmentBuildAttachments.length === 0) || isTransitioning || isPreparing) return;
    if (!hasReferenceFiles()) return;
    if (!projectName.trim()) setProjectName(idea);
    writePendingIdeaDraftState(idea, creationMode, requiredReferenceNames);
    clearPendingIntakeFlowState();
    setIntakeError('');
    setIsPreparing(true);
    const canGenerate = await ensureGenerationAccess();
    if (!canGenerate) {
      setIsPreparing(false);
      return;
    }
    if (creationMode === 'blueprint') {
      openBlueprintSettings(idea);
      return;
    }
    setIsPreparing(false);
    requestIntakeStart(idea);
  };

  const handleConfirmRealtimeBilling = () => {
    const idea = pendingRealtimeBillingIdea;
    clearPendingRealtimeBillingIdea();
    setPendingRealtimeBillingIdea('');
    setIsRealtimeBillingNoticeOpen(false);
    if (idea) void startIntake(idea);
  };

  const handleCancelRealtimeBilling = () => {
    clearPendingRealtimeBillingIdea();
    setPendingRealtimeBillingIdea('');
    setIsRealtimeBillingNoticeOpen(false);
  };

  const finishAuthentication = async () => {
    await loadCurrentUser();
    setAuthFeedbackDialog(null);
    setIsLoginPromptOpen(false);
    setLoginPassword('');
    setEmailVerificationCode('');
    setRegisterDisplayName('');
    setInvitationCode('');
    setHasAcceptedTerms(false);
    const nextIdea = pendingIdeaAfterLogin.trim();
    setPendingIdeaAfterLogin('');
    clearPendingAuthIdeaState();
    if (nextIdea) {
      setProjectName(nextIdea);
      const canGenerate = await ensureGenerationAccess();
      if (canGenerate) {
        if (creationMode === 'blueprint') openBlueprintSettings(nextIdea);
        else requestIntakeStart(nextIdea);
      }
    }
  };

  const handleLoginSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (authMode === 'resetPassword') {
      await handleSendPasswordReset();
      return;
    }
    if (authMode === 'verifyEmail') {
      await handleVerifyEmail();
      return;
    }
    if (isSigningIn) return;
    setLoginError('');
    setLoginNotice('');
    if (!isSupabaseAuthConfigured()) {
      showAuthError(intakeText.errors.authNotConfigured);
      return;
    }
    const email = loginEmail.trim();
    if (!email || !loginPassword) {
      showAuthError(intakeText.errors.missingEmailPassword);
      return;
    }
    if (authMode === 'register') {
      if (!registerDisplayName.trim()) {
        showAuthError(intakeText.errors.missingDisplayName);
        return;
      }
      if (!hasAcceptedTerms) {
        showAuthError(intakeText.errors.termsRequired);
        return;
      }
      if (isInvitationRequired && !invitationCode.trim()) {
        showAuthError(translate('intake.errors.invitationRequired'));
        return;
      }
    }
    setIsSigningIn(true);
    try {
      if (authMode === 'register') {
        const session = await signUpWithSupabasePassword({
          email,
          password: loginPassword,
          displayName: registerDisplayName,
          ...(isInvitationRequired ? { invitationCode } : {}),
        });
        if (!session) {
          setEmailVerificationCode('');
          setAuthMode('verifyEmail');
          return;
        }
        showAuthSuccess(intakeText.auth.registerSuccess);
      } else {
        await signInWithSupabasePassword({ email, password: loginPassword });
        showAuthSuccess(intakeText.auth.loginSuccess);
      }
      await finishAuthentication();
    } catch (error) {
      showAuthError(localizeAuthError(error, translate('intake.errors.loginFailed')));
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleVerifyEmail = async () => {
    if (isSigningIn) return;
    if (!emailVerificationCode.trim()) {
      showAuthError(translate('intake.errors.verificationCodeRequired'));
      return;
    }
    setIsSigningIn(true);
    try {
      await verifySupabaseSignupCode(loginEmail.trim(), emailVerificationCode);
      await finishAuthentication();
    } catch (error) {
      showAuthError(localizeAuthError(error, translate('intake.errors.verificationFailed')));
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleResendEmailCode = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    try {
      await resendSupabaseSignupCode(loginEmail.trim());
      showAuthSuccess(translate('intake.auth.verificationResent'));
    } catch (error) {
      showAuthError(localizeAuthError(error, translate('intake.errors.verificationFailed')));
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSendPasswordReset = async () => {
    setLoginError('');
    setLoginNotice('');
    const email = loginEmail.trim();
    if (!email) {
      showAuthError(translate('intake.errors.resetEmailRequired'));
      return;
    }
    setIsSigningIn(true);
    try {
      await sendSupabasePasswordReset(email);
      showAuthSuccess(intakeText.auth.resetEmailSent);
    } catch (error) {
      showAuthError(localizeAuthError(error, translate('intake.errors.resetEmailFailed')));
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleOpenProfile = () => {
    setIsProfileOpen(true);
  };

  const handleOAuthSignIn = async (provider: SupabaseOAuthProvider) => {
    setLoginError('');
    try {
      writePendingAuthIdeaState(pendingIdeaAfterLogin, creationMode, attachmentBuildAttachments.map(file => file.filename || 'image'));
      if (invitationCode.trim()) {
        await signInWithSupabaseOAuth(provider, { invitationCode });
      } else {
        await signInWithSupabaseOAuth(provider);
      }
    } catch (error) {
      clearPendingAuthIdeaState();
      showAuthError(localizeAuthError(error, intakeText.auth.oauthFailed));
    }
  };

  const handleProjectNameChange = (value: string) => {
    setProjectName(value);
    writePendingIdeaDraftState(value, creationMode, requiredReferenceNames);
    if (intakePhase !== 'idle' && !isPreparing && !isTransitioning) {
      setIntakePhase('idle');
      setIntakeOptions([]);
      setSelectedOption(null);
      setSettings(null);
      clearPendingIntakeFlowState();
      setIntakeError('');
    }
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
    setSettings(current => {
      if (!current) return current;
      const nextSettings = { ...current, ...patch };
      if (selectedOption && (intakePhase === 'configuring_details' || intakePhase === 'confirming_brief')) {
        persistIntakeFlow(intakePhase, intakeOptions, selectedOption, nextSettings);
      }
      return nextSettings;
    });
  };

  const toggleInput = (input: string) => {
    setSettings(current => {
      if (!current) return current;
      const hasInput = current.inputs.includes(input);
      const nextInputs = hasInput ? current.inputs.filter(item => item !== input) : [...current.inputs, input];
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
    if (!hasRequiredProductionSettings(settings)) {
      setIntakeError(intakeText.errors.missingProductionSettings);
      return;
    }
    setIntakeError('');
    setIsInputMenuOpen(false);
    setIntakePhase('confirming_brief');
    persistIntakeFlow('confirming_brief', intakeOptions, selectedOption, settings);
  };

  const handleBackToOptions = () => {
    if (creationMode === 'blueprint') {
      setIntakePhase('idle');
      clearPendingIntakeFlowState();
      return;
    }
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
    // Closing settings does not discard the user's original reference files.
    clearIntakeRecoveryState();
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

  const hasReferenceFiles = (): boolean => {
    const missing = requiredReferenceNames.filter(name => !attachmentBuildAttachments.some(file => (file.filename || 'image') === name));
    if (missing.length) {
      setIntakeError(`${lang.startsWith('zh') ? '刷新后请返回输入重新添加参考文件：' : 'Return to input and reattach references after refreshing: '}${missing.join(', ')}`);
      return false;
    }
    return true;
  };

  const handleStartBuild = async () => {
    if (!selectedOption || !settings || isTransitioning || isPreparing || !hasReferenceFiles()) return;
    const brief: BeeGameBuildBrief = {
      creationMode,
      attachments: attachmentBuildAttachments,
      idea: projectName.trim(),
      option: selectedOption,
      settings: {
        ...settings,
        engine: normalizeEngine(settings.engine),
        resourceLibraryUsage: settings.resourceLibraryUsage,
      },
      title: selectedOption.title,
      language: lang,
      documentLanguage: lang,
      gameUserVisibleLanguage: lang,
      agentResponseLanguage: lang,
    };
    setIntakeError('');
    setIsPreparing(true);
    try {
      // This path can be reached from a persisted Brief after a refresh.
      // Revalidate the session before starting the build. Do not reuse ensureGenerationAccess here:
      // its pending-idea recovery flow would discard this confirmed Brief.
      await loadCurrentUser();
      if (!useSystemStore.getState().currentUser) {
        setLoginError('');
        setLoginNotice('');
        setAuthMode('login');
        setIsLoginPromptOpen(true);
        return;
      }
      await startConfirmedBuild(brief);
    } catch (error) {
      setIntakeError(error instanceof Error ? error.message : intakeText.errors.projectStartFailed);
      console.error('Failed to start build:', error);
    } finally {
      setIsPreparing(false);
    }
  };

  const handleSelectProject = async (id: string) => {
    // Replace the landing page immediately so the account avatar and home UI
    // do not fade away while the project-opening request is still pending.
    setIsLoadingProject(true);
    setIsHistoryOpen(false);
    try {
      await setActiveProject(id);
    } catch (error) {
      setIsLoadingProject(false);
      console.error('Failed to select project:', error);
    }
  };

  if (isLoadingProject) {
    return (
      <WorkspaceLoadingPage
        title={lang.startsWith('zh') ? '正在打开项目' : 'Opening project'}
        description={lang.startsWith('zh') ? '正在加载项目工作区' : 'Loading project workspace'}
        ariaLabel="Opening project workspace"
        className="fixed inset-0 z-[300]"
      />
    );
  }

  return (
    <div
      key="landing"
      className={`absolute inset-0 z-50 flex flex-col overflow-y-auto bg-[#c97843] text-white opacity-100 transition-opacity duration-300 dark:bg-black ${isTransitioning ? 'opacity-0' : ''}`}
    >
      <LandingImageBackground />
      <header className="absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-between px-4 sm:h-20 sm:px-8">
        <div className="flex items-center gap-2.5 text-white [text-shadow:0_2px_16px_rgba(0,0,0,0.32)]">
          <BeeGameLogo className="size-8 drop-shadow-sm" />
          <span className="text-lg font-semibold tracking-[-0.03em]">Bee Game Studio</span>
        </div>
        <div className="relative z-20 flex items-center gap-2">
          <LandingSiteMenu language={lang} onNavigate={navigateLandingPage} onOpenLegal={setActiveLegalDocument} />
          <ThemeToggle
            darkModeLabel={t.darkMode}
            lightModeLabel={t.lightMode}
            className="text-white hover:bg-white/15 hover:text-white focus-visible:ring-white/70"
          />
          <AccountActionsMenu
            lang={lang}
            isTransitioning={isTransitioning}
            isSettingsOpen={isSettingsOpen}
            isHistoryOpen={isHistoryOpen}
            isProfileOpen={isProfileOpen}
            isCreditStoreOpen={isCreditStoreOpen}
            isResourceLibraryOpen={isResourceLibraryOpen}
            currentUserId={currentUser?.id}
            currentUserDisplayName={currentUser?.displayName || currentUser?.email}
            currentUserEmail={currentUser?.email}
            currentUserAvatarUrl={currentUser?.avatarUrl}
            className="relative flex items-center gap-2"
            creditBalance={creditBalance?.balanceCredits}
            onOpenLogin={handleOpenLogin}
            onOpenProfile={handleOpenProfile}
            onSignOut={currentUser ? () => void handleSignOut() : undefined}
            onToggleSettings={() => {
              setIsSettingsOpen(value => !value);
              setIsHistoryOpen(false);
              setIsCreditStoreOpen(false);
            }}
            canManageResources={currentUser?.role === 'owner' || currentUser?.permissions.includes('resources.manage')}
            onOpenResourceLibrary={() => {
              openResourceLibraryRoute();
              setIsResourceLibraryOpen(true);
              setIsSettingsOpen(false);
              setIsHistoryOpen(false);
              setIsCreditStoreOpen(false);
            }}
            onToggleHistory={() => {
              setIsHistoryOpen(value => !value);
              setIsSettingsOpen(false);
              setIsCreditStoreOpen(false);
            }}
            onOpenCreditStore={() => {
              setIsCreditStoreOpen(true);
              setIsSettingsOpen(false);
              setIsHistoryOpen(false);
            }}
          />
        </div>
      </header>

      <SettingsMenu
        isOpen={isSettingsOpen}
        lang={lang}
        onClose={() => setIsSettingsOpen(false)}
        onSetLang={onSetLang}
      />

      {isResourceLibraryOpen ? (
        <Suspense
          fallback={
            <div className="grid min-h-screen place-items-center bg-background">
              <span className="size-7 animate-spin rounded-full border-2 border-border border-t-foreground/80" />
            </div>
          }
        >
          <ResourceLibraryPage
            onBack={() => {
              closeResourceLibraryRoute();
              setIsResourceLibraryOpen(false);
            }}
          />
        </Suspense>
      ) : null}

      <ProjectHistoryModal
        isOpen={isHistoryOpen}
        lang={lang}
        onClose={() => setIsHistoryOpen(false)}
        onSelectProject={handleSelectProject}
      />

      <CreditStoreModal isOpen={isCreditStoreOpen} lang={lang} onClose={() => setIsCreditStoreOpen(false)} />

      <ProfileModal
        isOpen={isProfileOpen}
        lang={lang}
        currentUser={currentUser}
        creditBalance={creditBalance}
        onClose={() => setIsProfileOpen(false)}
        onUserChanged={async () => {
          await loadCurrentUser();
        }}
      />

      <AuthDialog
          isOpen={isLoginPromptOpen}
          authMode={authMode}
          isInvitationRequired={isInvitationRequired}
          loginEmail={loginEmail}
          loginPassword={loginPassword}
          registerDisplayName={registerDisplayName}
          invitationCode={invitationCode}
          hasAcceptedTerms={hasAcceptedTerms}
          isSigningIn={isSigningIn}
          intakeText={intakeText}
          translate={translate}
          onSubmit={handleLoginSubmit}
          onClose={handleCloseLoginPrompt}
          onAuthModeChange={setAuthMode}
          onResetFeedback={() => {
            setLoginError('');
            setLoginNotice('');
          }}
          onLoginEmailChange={setLoginEmail}
          onLoginPasswordChange={setLoginPassword}
          onRegisterDisplayNameChange={setRegisterDisplayName}
          onInvitationCodeChange={setInvitationCode}
          emailVerificationCode={emailVerificationCode}
          onEmailVerificationCodeChange={setEmailVerificationCode}
          onResendEmailCode={handleResendEmailCode}
          onTermsChange={setHasAcceptedTerms}
          onOpenLegalDocument={setActiveLegalDocument}
          onOAuthSignIn={handleOAuthSignIn}
        />

      {authFeedbackDialog ? (
        <Dialog open onOpenChange={open => !open && setAuthFeedbackDialog(null)}>
          <DialogContent aria-label={authFeedbackDialog.title} className="max-w-[420px] rounded-2xl border-border bg-popover p-6 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <DialogTitle className="text-xl font-semibold">{authFeedbackDialog.title}</DialogTitle>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{authFeedbackDialog.message}</p>
              </div>
              <DialogClose
                aria-label={intakeText.auth.feedbackClose}
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </DialogClose>
            </div>
            <div className="mt-6">
              <BeUiButton type="button" size="lg" onClick={() => setAuthFeedbackDialog(null)} className="h-11 w-full rounded-xl text-sm">
                {intakeText.auth.feedbackClose}
              </BeUiButton>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {activeLegalDocument ? (
        <Dialog open onOpenChange={open => !open && setActiveLegalDocument(null)}>
          <DialogContent aria-label={legalDocuments[activeLegalDocument].title} className="max-h-[calc(100dvh-3rem)] max-w-2xl p-5 text-foreground sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <DialogTitle>{legalDocuments[activeLegalDocument].title}</DialogTitle>
                <p className="mt-2 text-xs text-muted-foreground">
                  {translate('intake.auth.legalUpdated', { date: legalDocuments[activeLegalDocument].updatedAt })}
                </p>
                <p className="mt-4 text-sm text-muted-foreground">{legalDocuments[activeLegalDocument].intro}</p>
              </div>
              <DialogClose
                type="button"
                aria-label={translate('intake.auth.legalClose')}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </DialogClose>
            </div>
            <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="space-y-4">
                {legalDocuments[activeLegalDocument].sections.map(section => (
                  <section key={section.title} className="rounded-lg border border-border bg-muted/40 p-4">
                    <h3 className="text-sm font-medium">{section.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{section.body}</p>
                  </section>
                ))}
              </div>
            </div>
            <div className="mt-6 flex justify-end border-t border-border pt-5">
              <DialogClose
                type="button"
                className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                {translate('intake.auth.legalUnderstand')}
              </DialogClose>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {landingPage === 'home' ? <main className="relative z-10 mx-auto flex min-h-dvh w-full flex-1 items-center justify-center px-4 pb-10 pt-24 sm:px-8 sm:pb-14 sm:pt-28 lg:pb-16 lg:pt-32">
        <div className="flex w-full max-w-4xl -translate-y-4 flex-col items-center gap-9 sm:-translate-y-6 sm:gap-11 lg:-translate-y-8 lg:gap-[3.25rem]">
          <HeroIntro title={t.landingTitle} connector={heroPhrases[lang].connector} subtitle={t.landingSubtitle} rotatingWords={heroPhrases[lang].words} isTransitioning={isTransitioning} />

          <IdeaPromptForm
            creationMode={creationMode}
            onCreationModeChange={mode => {
              setCreationMode(mode);
              writePendingIdeaDraftState(projectName, mode, requiredReferenceNames);
              setIntakePhase('idle');
              setSelectedOption(null);
              setSettings(null);
              setIntakeOptions([]);
              clearPendingIntakeFlowState();
            }}
            value={projectName}
            placeholder={t.ideaPlaceholder}
            generateLabel={t.generate}
            isTransitioning={isTransitioning || isPreparing}
            onChange={handleProjectNameChange}
            onSubmit={handleStart}
            billingConfirmation={isRealtimeBillingNoticeOpen ? {
              title: translate('intake.realtimeBillingTitle'),
              summary: translate('intake.realtimeBillingSummary'),
              notice: translate('intake.realtimeBillingNotice'),
              confirmLabel: translate('intake.realtimeBillingConfirm'),
              cancelLabel: intakeText.actions.cancel,
              onConfirm: handleConfirmRealtimeBilling,
              onCancel: handleCancelRealtimeBilling,
            } : undefined}
            attachments={attachmentBuildAttachments}
            onAttachmentsChange={files => {
              setAttachmentBuildAttachments(files);
              setRequiredReferenceNames(files.map(item => item.filename || 'image'));
              writePendingIdeaDraftState(projectName, creationMode, files.map(item => item.filename || 'image'));
              clearPendingIntakeFlowState();
            }}
          />
        </div>
      </main> : <LandingContentPage page={landingPage} language={lang} onBack={() => navigateLandingPage('home')} />}
      {landingPage === 'home' ? (
        <footer className="fixed inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 pb-4 text-center text-xs text-white/72 [text-shadow:0_1px_8px_rgba(0,0,0,.42)]">
          <span>© {new Date().getFullYear()} Bee Game Studio</span>
          {isChinaVisitor && icpNumber ? <a href="https://beian.miit.gov.cn" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{icpNumber}</a> : null}
        </footer>
      ) : null}
      {shouldShowIntakeModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={modalTitle}
          data-intake-modal="true"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/38 px-4 py-6 backdrop-blur-[2px]"
        >
          <div
            className={`relative flex max-h-[calc(100dvh-3rem)] w-full ${intakeModalWidthClass} flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground`}
          >
            <div className="relative z-10 flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-6">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold">{modalTitle}</h2>
              </div>
              <button
                type="button"
                aria-label={intakeText.modal.close}
                disabled={isPreparing || isTransitioning}
                onClick={handleCloseIntake}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="scrollbar-premium relative z-10 min-h-0 flex-1 overflow-y-auto px-6 pb-6">
              {intakePhase === 'options_ready' ? (
                <IntakeOptionCards
                  options={intakeOptions}
                  copy={intakeText}
                  localizedOptionLabel={localizedOptionLabel}
                  onSelect={handleSelectOption}
                />
              ) : null}

              {intakePhase === 'configuring_details' && selectedOption && settings ? (
                <IntakeSettingsForm
                  settings={settings}
                  copy={intakeText}
                  options={productionSettingOptions}
                  localizedOptionLabel={localizedOptionLabel}
                  onChange={updateSettings}
                  isInputMenuOpen={isInputMenuOpen}
                  onToggleInputMenu={() => setIsInputMenuOpen(value => !value)}
                  inputMenuRef={inputMenuRef}
                  inputMenuButtonRef={inputMenuButtonRef}
                  onBack={handleBackToOptions}
                  backLabel={creationMode === 'blueprint' ? (lang.startsWith('zh') ? '返回输入' : 'Back to input') : undefined}
                  onConfirm={handleConfirmSettings}
                />
              ) : null}

              {intakePhase === 'confirming_brief' && selectedOption && settings ? (
                <ConfirmedBrief
                  settings={settings}
                  copy={intakeText}
                  localizedOptionLabel={localizedOptionLabel}
                  isPreparing={isPreparing}
                  onEdit={() => setIntakePhase('configuring_details')}
                  onStart={handleStartBuild}
                />
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
              data-floating-layer="true"
              style={{
                left: inputMenuPosition.left,
                top: inputMenuPosition.top,
                width: inputMenuPosition.width,
              }}
              className="fixed z-[220] overflow-hidden rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
            >
              <div className="relative z-10">
                {productionSettingOptions.inputs.map(input => {
                  const active = settings.inputs.includes(input);
                  return (
                    <button
                      key={input}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => toggleInput(input)}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm transition hover:bg-accent"
                    >
                      <span>{localizedOptionLabel(input)}</span>
                      {active ? <Check className="h-4 w-4 text-foreground" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}

      {intakePhase === 'starting_build' ? (
        <WorkspaceLoadingPage
          title={intakeText.starting.title}
          description={intakeText.starting.description}
          ariaLabel={intakeText.starting.title}
          className="fixed inset-0 z-[300] overflow-hidden"
        />
      ) : null}

      {intakeError ? (
        <div role="alert" className="relative z-20 mt-4 max-w-xl rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
          {intakeError}
        </div>
      ) : null}

    </div>
  );
}

function LandingContentPage({ page, language, onBack }: { page: Exclude<LandingPage, 'home'>; language: Language; onBack: () => void }) {
  const zh = language.startsWith('zh');
  const content = page === 'blog'
    ? (zh ? { eyebrow: 'Bee Game Studio', title: '博客', description: '产品动态、游戏创作洞察与团队故事将在这里发布。', note: '首批文章即将上线。' } : { eyebrow: 'Bee Game Studio', title: 'Blog', description: 'Product updates, game-making notes, and stories from the studio will live here.', note: 'The first posts are on their way.' })
    : page === 'learn'
      ? (zh ? { eyebrow: 'Bee Game Studio', title: '学习中心', description: '从灵感到可玩的世界，逐步了解每一个创作环节。', note: '教学内容即将上线。' } : { eyebrow: 'Bee Game Studio', title: 'Learn', description: 'Learn each creative step, from an idea to a playable world.', note: 'Learning guides are coming soon.' })
      : (zh ? { eyebrow: 'Bee Game Studio', title: '关于我们', description: '我们相信游戏创作应该从灵感开始，而不该被工具阻挡。', note: 'Bee Game Studio 正在打造更自然的游戏创作体验。' } : { eyebrow: 'Bee Game Studio', title: 'About', description: 'We believe game making should start with inspiration, not friction.', note: 'Bee Game Studio is building a more natural creative experience.' });
  return <main className="relative z-10 mx-auto flex min-h-dvh w-full items-center justify-center px-6 pt-20 text-white">
    <section className="w-full max-w-2xl rounded-[2rem] border border-white/30 bg-black/15 p-8 text-center shadow-2xl backdrop-blur-md sm:p-12">
      <p className="text-sm font-medium tracking-[.12em] text-white/70">{content.eyebrow}</p>
      <h1 className="type-hero mt-4 text-white">{content.title}</h1>
      <p className="type-body-lg mx-auto mt-5 max-w-xl text-white/90">{content.description}</p>
      <p className="mt-8 text-sm text-white/70">{content.note}</p>
      <button type="button" onClick={onBack} className="mt-9 inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/12 px-4 py-2.5 text-sm font-medium transition hover:bg-white/20"><ArrowLeft className="size-4" />{zh ? '返回首页' : 'Back to home'}</button>
    </section>
  </main>;
}
