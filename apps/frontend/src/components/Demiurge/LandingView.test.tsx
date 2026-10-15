import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { LandingView } from './LandingView';
import { ToastProvider } from '../../contexts/ToastContext';
import { resourceLibraryApi } from '../../services/resourceLibraryApi';

// Workflow tests use the accessible reduced-motion path; the animated reveal is
// verified separately with a controlled frame clock in AvatarDialogue.test.tsx.
vi.mock('motion/react', async importOriginal => ({
  ...await importOriginal<typeof import('motion/react')>(),
  useReducedMotion: () => true,
}));

// Workflow tests isolate the GPU surface; fallback/rendering is checked separately.
vi.mock('../beui/grain-gradient', () => ({ GrainGradient: () => <div aria-hidden="true" /> }));

vi.mock('./Landing/DotsAvatar', () => ({
  DotsAvatar: ({ mood, token, label }: { mood: string; token: string; label: string }) => <div role="img" aria-label={label} data-testid="idea-avatar" data-mood={mood} data-dot-token={token} />,
}));

const { analyzeIdeaIntake } = vi.hoisted(() => ({
  analyzeIdeaIntake: vi.fn(),
}));
const { generateIntakeOptions } = vi.hoisted(() => ({
  generateIntakeOptions: vi.fn(),
}));
const { runIdeaIntake } = vi.hoisted(() => ({
  runIdeaIntake: vi.fn(),
}));
const { analyzeAttachmentBuild } = vi.hoisted(() => ({
  analyzeAttachmentBuild: vi.fn(),
}));
const {
  createStripeCheckoutSession,
  getBillingCreditPacks,
  getBillingEvents,
  getCreditSummary,
  getCreditBalance,
  getStripeCreditPacks,
  upsertBillingCreditPack,
} = vi.hoisted(() => ({
  createStripeCheckoutSession: vi.fn(),
  getBillingCreditPacks: vi.fn(),
  getBillingEvents: vi.fn(),
  getCreditSummary: vi.fn(),
  getCreditBalance: vi.fn(),
  getStripeCreditPacks: vi.fn(),
  upsertBillingCreditPack: vi.fn(),
}));
const { getProjectLifecycleOverview } = vi.hoisted(() => ({
  getProjectLifecycleOverview: vi.fn(),
}));
const { listModelConfigs } = vi.hoisted(() => ({
  listModelConfigs: vi.fn(),
}));
const { deleteCurrentUser } = vi.hoisted(() => ({
  deleteCurrentUser: vi.fn(),
}));
const { listUserSkills } = vi.hoisted(() => ({
  listUserSkills: vi.fn(),
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
  getValidSupabaseAccessToken,
  isHttpOnlySessionsEnabled,
  isSupabaseAuthConfigured,
  sendSupabasePasswordReset,
  signInWithSupabaseOAuth,
  signInWithSupabasePassword,
  signUpWithSupabasePassword,
  verifySupabaseSignupCode,
  resendSupabaseSignupCode,
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
  getValidSupabaseAccessToken: vi.fn(),
  isHttpOnlySessionsEnabled: vi.fn(() => false),
  isSupabaseAuthConfigured: vi.fn(),
  sendSupabasePasswordReset: vi.fn(),
  signInWithSupabaseOAuth: vi.fn(),
  signInWithSupabasePassword: vi.fn(),
  signUpWithSupabasePassword: vi.fn(),
  verifySupabaseSignupCode: vi.fn(),
  resendSupabaseSignupCode: vi.fn(),
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

vi.mock('../../store/projectStore', () => ({
  useProjectStore: (
    selector?: (state: {
      projects: typeof mockProjects;
      deleteProject: typeof mockDeleteProject;
      setActiveProject: typeof mockSetActiveProject;
    }) => unknown,
  ) => {
    const state = {
      projects: mockProjects,
      deleteProject: mockDeleteProject,
      setActiveProject: mockSetActiveProject,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../store/systemStore', () => {
  const useSystemStore = (
    selector?: (state: {
      currentUser: typeof mockCurrentUser;
      authenticationStatus: 'authenticated' | 'anonymous';
      loadCurrentUser: typeof mockLoadCurrentUser;
      hasPermission: (permission: string) => boolean;
      isDark: boolean;
      setTheme: (isDark: boolean) => void;
    }) => unknown,
  ) => {
    const state = {
      currentUser: mockCurrentUser,
      authenticationStatus: mockCurrentUser ? 'authenticated' as const : 'anonymous' as const,
      loadCurrentUser: mockLoadCurrentUser,
      hasPermission: (permission: string) => Boolean(mockCurrentUser?.permissions.includes(permission)),
      isDark: false,
      setTheme: vi.fn(),
    };
    return selector ? selector(state) : state;
  };
  useSystemStore.getState = () => ({
    currentUser: mockCurrentUser,
    authenticationStatus: mockCurrentUser ? 'authenticated' as const : 'anonymous' as const,
    loadCurrentUser: mockLoadCurrentUser,
    hasPermission: (permission: string) => Boolean(mockCurrentUser?.permissions.includes(permission)),
    isDark: false,
    setTheme: vi.fn(),
  });
  return { useSystemStore, applyThemeToDocument: vi.fn() };
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
    analyzeAttachmentBuild,
  },
  getBeeGameWorkspaceSettings: vi.fn().mockResolvedValue({
    workspacePath: '/tmp/beegame-projects',
    isDefault: true,
  }),
}));

vi.mock('../../services/modelConfigApi', () => ({
  createModelConfig: vi.fn(),
  listModelConfigs,
}));

vi.mock('../../services/creditsApi', () => ({
  createStripeCheckoutSession,
  getBillingCreditPacks,
  getBillingEvents,
  getCreditSummary,
  getCreditBalance,
  getStripeCreditPacks,
  upsertBillingCreditPack,
}));

vi.mock('../../services/projectLifecycleApi', () => ({
  getProjectLifecycleOverview,
}));

vi.mock('../../services/currentUserApi', () => ({
  deleteCurrentUser,
}));

vi.mock('../../services/userSkillsApi', () => ({
  listUserSkills,
  importUserSkillPackage: vi.fn(),
  setUserSkillEnabled: vi.fn(),
  deleteUserSkill: vi.fn(),
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
  getValidSupabaseAccessToken,
  isHttpOnlySessionsEnabled,
  isSupabaseAuthConfigured,
  sendSupabasePasswordReset,
  signInWithSupabaseOAuth,
  signInWithSupabasePassword,
  signUpWithSupabasePassword,
  verifySupabaseSignupCode,
  resendSupabaseSignupCode,
  updateSupabaseAvatarUrl,
  uploadSupabaseAvatarImage,
}));

const renderLanding = async (props?: Partial<React.ComponentProps<typeof LandingView>>, enterPrompt = true) => {
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <ToastProvider>
        <LandingView onStart={vi.fn()} lang="zh" onSetLang={vi.fn()} {...props} />
      </ToastProvider>,
    );
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  // Most workflow tests begin after the visitor explicitly chooses a mode.
  const choices = screen.queryByTestId('creation-mode-choices');
  if (enterPrompt && choices) {
    await act(async () => {
      fireEvent.click(within(choices).getByRole('button', { name: /^(创意模式|Creative mode|創意模式)$/ }));
    });
  }
  if (enterPrompt && !choices) {
    const input = screen.queryByRole('textbox');
    if (input) fireEvent.focus(input);
  }
  return result;
};

const submitIdea = async (idea: string) => {
  const textbox = screen.getByRole('textbox');
  await act(async () => {
    fireEvent.change(textbox, { target: { value: idea } });
    fireEvent.submit(textbox.closest('form') as HTMLFormElement);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return textbox;
};

const confirmIntakeCreditQuote = async () => {
  const dialog = await screen.findByRole('group', { name: '实时 Credit 扣除提示' });
  fireEvent.click(within(dialog).getByRole('button', { name: '继续生成' }));
};

const settingGroup = (label: string) => ['平台', '引擎', '表现形式', '屏幕方向'].includes(label) ? 0 : label === '补充说明' ? 2 : 1;
const goToSettingsGroup = async (target: number) => {
  const panel = screen.queryByTestId('intake-settings');
  if (!panel) return;
  let current = Number(panel.getAttribute('data-group'));
  while (current !== target) {
    fireEvent.click(screen.getByRole('button', { name: current < target ? '下一步' : '返回', exact: true }));
    current = Number(screen.getByTestId('intake-settings').getAttribute('data-group'));
  }
};
const confirmBrief = async () => {
  await goToSettingsGroup(2);
  fireEvent.click(screen.getByRole('button', { name: '确认方案' }));
};
const openSettingOptions = async (label: string) => {
  if (label !== 'Language') await goToSettingsGroup(settingGroup(label));
  fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
  return screen.findByRole('listbox', { name: label, exact: true });
};

const selectSetting = async (label: string, option: string) => {
  const listbox = await openSettingOptions(label);
  fireEvent.click(within(listbox).getByRole('option', { name: option, exact: true }));
};

const selectScreenOrientation = (label: '横屏' | '竖屏') => selectSetting('屏幕方向', label);

const submitIdeaAndConfirmIntake = async (idea: string) => {
  const textbox = await submitIdea(idea);
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
  {
    id: 'llm_mode_c',
    title: 'LLM Mode C',
    pitch: 'LLM generated pitch C.',
    gameplay: 'LLM generated gameplay rules C.',
    coreGameplayHypothesis: 'LLM generated hypothesis C.',
    experienceSnapshot: 'LLM generated snapshot C.',
    playerFirstMinute: 'LLM generated first minute C.',
    whyFitsIdea: 'LLM generated fit C.',
    playablePrototype: 'LLM generated first playable C.',
    validationTarget: 'LLM generated validation target C.',
    coreMechanic: 'LLM generated core mechanic C.',
    firstBuild: 'LLM generated first build C.',
    validationGoal: 'LLM generated validation goal C.',
    risk: 'LLM generated risk C.',
    fit: 'LLM generated fit C.',
    firstPlayableValidation: 'LLM generated validation C.',
    riskComplexity: 'LLM generated complexity C.',
    recommendedPlatform: 'PC',
    recommendedEngine: 'Unity',
    recommendedDimension: '3D',
    recommendedGenre: 'Adventure',
    recommendedStyle: 'Low Poly',
    recommendedInputs: ['Gamepad'],
    scope: 'Prototype',
  },
];

beforeEach(() => {
  sessionStorage.clear();
  getValidSupabaseAccessToken.mockReset();
  getValidSupabaseAccessToken.mockResolvedValue('');
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
    needsClarification: false,
    clarificationQuestions: [],
    detectedConstraints: [],
    recommendedNextStep: 'choose_direction',
    options,
  });
  analyzeAttachmentBuild.mockReset();
  analyzeAttachmentBuild.mockResolvedValue({
    analysisId: 'analysis_default',
    sourceType: 'gdd',
    completeness: 'complete',
    confirmedFacts: [],
    inferredDesign: [],
    missingFields: [],
    conflicts: [],
    gddDraft: '# Confirmed GDD',
  });
  mockProjects = [];
  mockDeleteProject.mockReset();
  mockSetActiveProject.mockReset();
  mockLoadCurrentUser.mockReset();
  mockLoadCurrentUser.mockResolvedValue(undefined);
  listUserSkills.mockReset();
  listUserSkills.mockResolvedValue([]);
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
    creditUnitWeightedTokens: 10000,
    estimates: {
      ideaIntake: { minCredits: 3, maxCredits: 3 },
      planningDocs: { minCredits: 8, maxCredits: 30 },
      smallPlayableGame: { minCredits: 80, maxCredits: 200 },
      standardGame: { minCredits: 200, maxCredits: 600 },
      complexGame: { minCredits: 600, maxCredits: 1500 },
    },
  });
  getStripeCreditPacks.mockReset();
  getStripeCreditPacks.mockResolvedValue({
    packs: [
      { priceId: 'price_beegame_500', credits: 500 },
      { priceId: 'price_beegame_1200', credits: 1200 },
    ],
  });
  createStripeCheckoutSession.mockReset();
  createStripeCheckoutSession.mockResolvedValue({
    id: 'cs_beegame_store',
    url: 'https://checkout.stripe.com/c/pay/cs_beegame_store',
    priceId: 'price_beegame_500',
    credits: 500,
  });
  getCreditSummary.mockReset();
  getCreditSummary.mockResolvedValue({
    entriesCount: 0,
    consumedCredits: 0,
    weightedTokens: 0,
  });
  getBillingCreditPacks.mockReset();
  getBillingCreditPacks.mockResolvedValue({
    packs: [
      {
        provider: 'stripe',
        priceId: 'price_db_500',
        credits: 500,
        displayName: '500 credits',
        enabled: true,
        sortOrder: 1,
        metadata: {},
      },
    ],
  });
  getBillingEvents.mockReset();
  getBillingEvents.mockResolvedValue({
    events: [
      {
        id: 'billing-event-1',
        provider: 'stripe',
        eventType: 'checkout.session.created',
        status: 'succeeded',
        userId: 'customer-a',
        priceId: 'price_db_500',
        credits: 500,
        checkoutSessionId: 'cs_db_500',
        metadata: {},
        createdAt: '2026-07-08T00:00:00.000Z',
      },
    ],
  });
  upsertBillingCreditPack.mockReset();
  upsertBillingCreditPack.mockResolvedValue({
    pack: {
      provider: 'stripe',
      priceId: 'price_db_1200',
      credits: 1200,
      displayName: '1,200 credits',
      enabled: true,
      sortOrder: 2,
      metadata: {},
    },
  });
  getProjectLifecycleOverview.mockReset();
  getProjectLifecycleOverview.mockResolvedValue({
    quota: {
      limit: 100,
      used: 0,
      remaining: 100,
    },
    storage: {
      supabaseStorageConfigured: false,
    },
    projects: [],
    recentDeletions: [],
  });
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
  deleteCurrentUser.mockReset();
  deleteCurrentUser.mockResolvedValue({ ok: true });
  getInvitationPublicSettings.mockReset();
  getInvitationPublicSettings.mockResolvedValue({ required: false });
  listInvitations.mockReset();
  listInvitations.mockResolvedValue([]);
  saveInvitationSettings.mockReset();
  saveInvitationSettings.mockImplementation((required: boolean) => Promise.resolve({ required }));
  createInvitation.mockReset();
  createInvitation.mockResolvedValue({
    id: 'invite-1',
    code: 'BEE-ALPHA',
    label: 'Alpha',
    enabled: true,
    usedCount: 0,
    maxUses: null,
  });
  updateInvitation.mockReset();
  updateInvitation.mockImplementation((input: { id: string; enabled?: boolean }) =>
    Promise.resolve({
      id: input.id,
      code: 'BEE-ALPHA',
      label: 'Alpha',
      enabled: input.enabled ?? true,
      usedCount: 0,
      maxUses: null,
    }),
  );
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
  verifySupabaseSignupCode.mockReset();
  verifySupabaseSignupCode.mockResolvedValue({
    accessToken: 'verified-access-token', expiresAt: Date.now() + 3600_000,
    user: { id: 'user-2', email: 'new@example.com' },
  });
  resendSupabaseSignupCode.mockReset();
  resendSupabaseSignupCode.mockResolvedValue(undefined);
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
});

describe('LandingView bootstrap submission', () => {
  it('replays the home fade after resource navigation without remounting the idea draft', async () => {
    const listPacks = vi.spyOn(resourceLibraryApi, 'listPacks').mockResolvedValue([]);
    const originalUrl = window.location.href;
    try {
      const { container } = await renderLanding();
      const page = container.firstElementChild;
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'Keep this draft' } });
      expect(page).toHaveClass('page-enter');
      await act(async () => {
        window.history.pushState({}, '', '/?resourceLibrary=1');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await screen.findByRole('dialog');
      expect(page).not.toHaveClass('page-enter');
      await act(async () => {
        window.history.replaceState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(container.firstElementChild).toBe(page);
      expect(page).toHaveClass('page-enter');
      expect(screen.getByRole('textbox')).toBe(input);
      expect(input).toHaveValue('Keep this draft');
      expect(listPacks).toHaveBeenCalledTimes(1);
    } finally {
      listPacks.mockRestore();
      window.history.replaceState({}, '', originalUrl);
    }
  });

  it('keeps the idea home header controls without a sound button', async () => {
    await renderLanding();

    expect(screen.queryByTestId('home-sound-toggle')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '用户菜单' })).toBeInTheDocument();
    expect(document.querySelector('header .lucide-moon')).toBeInTheDocument();
  });

  it('asks the user to sign in before generating intake options', async () => {
    mockCurrentUser = null;

    await renderLanding();

    await submitIdea('LLM generated idea');

    expect(await screen.findByRole('dialog', { name: '欢迎回来' })).toBeInTheDocument();
    expect(screen.getByText('你的灵感与项目，正在这里等待继续。')).toBeInTheDocument();
    expect(runIdeaIntake).not.toHaveBeenCalled();
    expect(getCreditBalance).not.toHaveBeenCalled();
  });

  it('does not require administrator model-config access before showing the realtime billing notice', async () => {
    listModelConfigs.mockRejectedValueOnce(new Error('Forbidden'));

    await renderLanding();

    const send = screen.getByTestId('idea-prompt-send');
    await submitIdea('LLM generated idea');

    expect(await screen.findByRole('group', { name: '实时 Credit 扣除提示' })).toBeInTheDocument();
    expect(screen.getByTestId('idea-prompt-morph-shell')).toHaveAttribute('data-confirming', 'true');
    // Consent merges the existing action into the same liquid surface. Removing
    // and recreating it would snap its silhouette during the contraction.
    expect(screen.getByTestId('idea-prompt-send')).toBe(send);
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('dialog', { name: '实时 Credit 扣除提示' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(listModelConfigs).not.toHaveBeenCalled();
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

    await renderLanding();

    const textbox = screen.getByRole('textbox');
    fireEvent.change(textbox, { target: { value: 'LLM generated idea' } });
    fireEvent.submit(textbox.closest('form') as HTMLFormElement);

    await screen.findByRole('dialog', { name: '欢迎回来' });
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'player@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录并继续' }));

    expect(await screen.findByRole('group', { name: '实时 Credit 扣除提示' })).toBeInTheDocument();
    expect(runIdeaIntake).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续生成' }));

    await screen.findByText('LLM Mode A');
    expect(signInWithSupabasePassword).toHaveBeenCalledWith({
      email: 'player@example.com',
      password: 'secret-password',
    });
    expect(runIdeaIntake).toHaveBeenCalledWith({
      idea: 'LLM generated idea',
      language: 'zh',
    });
  });

  it('shows localized feedback for invalid Supabase login credentials', async () => {
    mockCurrentUser = null;
    signInWithSupabasePassword.mockRejectedValueOnce(
      new SupabaseAuthApiError('Invalid login credentials', {
        code: 'invalid_credentials',
        status: 400,
      }),
    );

    await renderLanding();

    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
    await screen.findByRole('dialog', { name: '欢迎回来' });
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'player@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录并继续' }));

    const errorDialog = await screen.findByRole('dialog', { name: '错误提示' });
    expect(within(errorDialog).getByText('邮箱或密码不正确，请检查后重试。')).toBeInTheDocument();
    expect(within(errorDialog).queryByText('Invalid login credentials')).not.toBeInTheDocument();
  });

  it('restores the pending idea after an OAuth redirect and continues generation', async () => {
    mockCurrentUser = null;

    const { unmount } = await renderLanding();

    await submitIdea('OAuth generated idea');

    await screen.findByRole('dialog', { name: '欢迎回来' });
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
    await renderLanding();

    expect(await screen.findByRole('group', { name: '实时 Credit 扣除提示' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '继续生成' }));

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

    await renderLanding();

    await submitIdea('LLM generated idea');

    expect(await screen.findByRole('dialog', { name: '欢迎回来' })).toBeInTheDocument();
    expect(runIdeaIntake).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'player@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录并继续' }));

    expect(await screen.findByRole('group', { name: '实时 Credit 扣除提示' })).toBeInTheDocument();
    expect(runIdeaIntake).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => {
      expect(screen.queryByRole('group', { name: '实时 Credit 扣除提示' })).not.toBeInTheDocument();
    });
    expect(await screen.findByRole('textbox')).toHaveValue('LLM generated idea');
    expect(runIdeaIntake).not.toHaveBeenCalled();

    await submitIdea('LLM generated idea');
    fireEvent.click(await screen.findByRole('button', { name: '继续生成' }));

    expect(await screen.findByText('LLM Mode A')).toBeInTheDocument();
    expect(runIdeaIntake).toHaveBeenCalledWith({
      idea: 'LLM generated idea',
      language: 'zh',
    });
  });

  it('restores a pending realtime billing notice after a page refresh', async () => {
    const { unmount } = await renderLanding();

    await submitIdea('Persistent LLM generated idea');

    expect(await screen.findByRole('group', { name: '实时 Credit 扣除提示' })).toBeInTheDocument();
    unmount();
    await renderLanding();

    expect(await screen.findByRole('group', { name: '实时 Credit 扣除提示' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续生成' }));

    expect(await screen.findByText('LLM Mode A')).toBeInTheDocument();
    expect(runIdeaIntake).toHaveBeenCalledWith({ idea: 'Persistent LLM generated idea', language: 'zh' });
  });

  it('restores typed idea text after a page refresh without opening intake', async () => {
    const { unmount } = await renderLanding();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft sample idea' } });
    unmount();
    await renderLanding();

    expect(screen.getByRole('textbox')).toHaveValue('Draft sample idea');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(runIdeaIntake).not.toHaveBeenCalled();
  });

  it('restores generated intake options after a page refresh without regenerating them', async () => {
    const { unmount } = await renderLanding();

    await submitIdeaAndConfirmIntake('Cached options idea');
    expect(await screen.findByRole('region', { name: '选择方案' })).toBeInTheDocument();
    expect(runIdeaIntake).toHaveBeenCalledTimes(1);
    unmount();
    await renderLanding();

    const dialog = await screen.findByRole('region', { name: '选择方案' });
    expect(dialog).toContainElement(screen.getByRole('button', { name: /LLM Mode A/ }));
    expect(dialog).toContainElement(screen.getByRole('button', { name: /LLM Mode B/ }));
    expect(JSON.parse(sessionStorage.getItem('beegame.pendingIntakeFlow.v1')!).idea).toBe('Cached options idea');
    expect(runIdeaIntake).toHaveBeenCalledTimes(1);
  });

  it('discards a legacy cached selection state containing only one option', async () => {
    sessionStorage.setItem(
      'beegame.pendingIntakeFlow.v1',
      JSON.stringify({
        phase: 'options_ready',
        idea: 'Legacy cached idea',
        language: 'zh',
        options: [makeIntakeOptions()[0]],
        createdAt: Date.now(),
      }),
    );

    await renderLanding();

    expect(screen.queryByRole('region', { name: '选择方案' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('restores selected intake settings after a page refresh', async () => {
    const { unmount } = await renderLanding();

    await submitIdeaAndConfirmIntake('Cached settings idea');
    fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await selectSetting('引擎', 'Godot');
    await goToSettingsGroup(2);
    fireEvent.change(screen.getByRole('textbox', { name: '补充说明' }), {
      target: { value: 'Keep the selected settings.' },
    });
    unmount();
    await renderLanding();

    expect(await screen.findByRole('region', { name: 'LLM Mode A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '引擎', exact: true })).toHaveTextContent('Godot');
    await goToSettingsGroup(2);
    expect(screen.getByRole('textbox', { name: '补充说明' })).toHaveValue('Keep the selected settings.');
    expect(screen.queryByTestId('intake-options')).not.toBeInTheDocument();
    expect(runIdeaIntake).toHaveBeenCalledTimes(1);
  });

  it('blueprint opens settings directly and restores them without generating three options', async () => {
    const { unmount } = await renderLanding();
    fireEvent.blur(screen.getByRole('textbox'), { relatedTarget: document.body });
    fireEvent.click(screen.getByRole('button', { name: '创意模式' }));
    fireEvent.click(await screen.findByRole('button', { name: '蓝图模式' }));
    await submitIdea('按我的蓝图制作一个解谜游戏');
    expect(await screen.findByTestId('intake-settings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回输入' })).toBeInTheDocument();
    expect(screen.queryByTestId('intake-options')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '实时 Credit 扣除提示' })).not.toBeInTheDocument();
    expect(runIdeaIntake).not.toHaveBeenCalled();
    expect(analyzeAttachmentBuild).not.toHaveBeenCalled();
    unmount();
    await renderLanding();
    expect(await screen.findByTestId('intake-settings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回输入' }));
    expect(screen.getByRole('textbox')).toHaveValue('按我的蓝图制作一个解谜游戏');
    expect(screen.queryByTestId('intake-options')).not.toBeInTheDocument();
    expect(runIdeaIntake).not.toHaveBeenCalled();
  });

  it('creative references accompany the typed idea through options and confirmed build', async () => {
    const onStart = vi.fn().mockResolvedValue({});
    await renderLanding({ onStart });
    fireEvent.change(document.querySelector('#landing-attachment-upload')!, {
      target: { files: [new File(['Keep the hand-drawn visual style.'], 'reference.md', { type: 'text/markdown' })] },
    });
    await screen.findByText('reference.md');
    await submitIdeaAndConfirmIntake('参考附件，但玩法是解谜');
    fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(runIdeaIntake).toHaveBeenCalledWith(expect.objectContaining({
      idea: '参考附件，但玩法是解谜',
      attachments: [expect.objectContaining({ filename: 'reference.md', data: btoa('Keep the hand-drawn visual style.') })],
    }));
    expect(analyzeAttachmentBuild).not.toHaveBeenCalled();
    await selectScreenOrientation('横屏');
    await confirmBrief();
    fireEvent.click(screen.getByRole('button', { name: '开始构建' }));
    await waitFor(() => expect(onStart).toHaveBeenCalledOnce());
    expect(onStart.mock.calls[0][2]).toMatchObject({
      creationMode: 'creative', attachments: [{ filename: 'reference.md', data: btoa('Keep the hand-drawn visual style.') }],
    });
  });

  it('groups resources with gameplay and leaves notes alone without a close action', async () => {
    await renderLanding();
    fireEvent.blur(screen.getByRole('textbox'), { relatedTarget: document.body });
    fireEvent.click(screen.getByRole('button', { name: '创意模式' }));
    fireEvent.click(screen.getByRole('button', { name: '蓝图模式' }));
    await submitIdea('My blueprint draft');
    expect(screen.getByRole('button', { name: '屏幕方向' })).toHaveTextContent('横屏');
    await goToSettingsGroup(1);
    expect(screen.getByRole('button', { name: '资源库使用方式' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '补充说明' })).not.toBeInTheDocument();
    await goToSettingsGroup(2);
    expect(screen.getByRole('textbox', { name: '补充说明' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '资源库使用方式' })).not.toBeInTheDocument();
    const bubble = screen.getByRole('dialog');
    expect(bubble.querySelector('svg.lucide-undo-2')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '关闭创作流程' })).not.toBeInTheDocument();
    expect(runIdeaIntake).not.toHaveBeenCalled();
  });

  it('uses sparkles for creation and offers closing beside return on the final confirmation', async () => {
    const onStart = vi.fn();
    await renderLanding({ onStart });
    await submitIdeaAndConfirmIntake('Example game idea');
    fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await confirmBrief();
    expect(screen.getByRole('button', { name: '开始构建' }).querySelector('svg.lucide-sparkles')).not.toBeNull();
    const close = screen.getByRole('button', { name: '关闭创作流程' });
    const navigation = close.parentElement!;
    expect(within(navigation).getAllByRole('button').at(-1)).toBe(close);
    fireEvent.click(close);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.queryByTestId('confirmed-brief')).not.toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('blueprint references enter settings without analysis and survive closing settings', async () => {
    await renderLanding();
    fireEvent.change(document.querySelector('#landing-attachment-upload')!, {
      target: { files: [new File(['# Complete blueprint'], 'blueprint.md', { type: 'text/markdown' })] },
    });
    await screen.findByText('blueprint.md');
    fireEvent.blur(screen.getByRole('textbox'), { relatedTarget: document.body });
    fireEvent.click(screen.getByRole('button', { name: '创意模式' }));
    fireEvent.click(await screen.findByRole('button', { name: '蓝图模式' }));
    await submitIdea('实现附件蓝图');
    expect(await screen.findByTestId('intake-settings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回输入' }));
    expect(screen.getByText('blueprint.md')).toBeInTheDocument();
    expect(runIdeaIntake).not.toHaveBeenCalled();
    expect(analyzeAttachmentBuild).not.toHaveBeenCalled();
  });

  it('blueprint configured settings and original references reach the build entry', async () => {
    const onStart = vi.fn().mockResolvedValue({});
    await renderLanding({ onStart });
    fireEvent.change(document.querySelector('#landing-attachment-upload')!, {
      target: { files: [new File(['# Blueprint'], 'plan.md', { type: 'text/markdown' })] },
    });
    await screen.findByText('plan.md');
    fireEvent.blur(screen.getByRole('textbox'), { relatedTarget: document.body });
    fireEvent.click(screen.getByRole('button', { name: '创意模式' }));
    fireEvent.click(await screen.findByRole('button', { name: '蓝图模式' }));
    await submitIdea('按蓝图制作');
    for (const [label, value] of [['平台', 'Web'], ['引擎', 'React'], ['表现形式', '2D'], ['游戏类型', '解谜'], ['风格', '像素']]) {
      await selectSetting(label, value);
    }
    await goToSettingsGroup(1);
    const inputTrigger = screen.getByText('输入方式').parentElement!.querySelector('button')!;
    fireEvent.click(inputTrigger);
    fireEvent.click(await screen.findByRole('option', { name: '键鼠', exact: true }));
    await selectScreenOrientation('横屏');
    await confirmBrief();
    expect(screen.getByTestId('confirmed-brief')).toBeInTheDocument();
    expect(screen.getByTestId('confirmed-brief')).not.toHaveTextContent('平台 AI 生图')
    expect(screen.getByTestId('confirmed-brief')).not.toHaveTextContent('不再逐张确认')
    fireEvent.click(screen.getByRole('button', { name: '开始构建' }));
    await waitFor(() => expect(onStart).toHaveBeenCalledOnce());
    expect(onStart.mock.calls[0][2]).toMatchObject({
      creationMode: 'blueprint', idea: '按蓝图制作',
      attachments: [{ filename: 'plan.md', data: btoa('# Blueprint') }],
      settings: { platform: 'Web', engine: 'React', dimension: '2D', genre: 'Puzzle', visualStyle: 'Pixel' },
    });
    expect(runIdeaIntake).not.toHaveBeenCalled();
    expect(analyzeAttachmentBuild).not.toHaveBeenCalled();
  });

  it('blocks creative generation after refresh until references are reattached', async () => {
    const { unmount } = await renderLanding();
    fireEvent.change(document.querySelector('#landing-attachment-upload')!, {
      target: { files: [new File(['# Reference'], 'reference.md', { type: 'text/markdown' })] },
    });
    await screen.findByText('reference.md');
    await submitIdea('Use my reference');
    unmount();
    await renderLanding();
    await confirmIntakeCreditQuote();
    expect(await screen.findByText(/刷新后请返回输入重新添加参考文件/)).toBeInTheDocument();
    expect(runIdeaIntake).not.toHaveBeenCalled();
  });

  it('restores confirmed intake brief after a page refresh', async () => {
    const { unmount } = await renderLanding();

    await submitIdeaAndConfirmIntake('Cached brief idea');
    fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    for (const [label, value] of [['平台', 'Web'], ['引擎', 'Godot'], ['表现形式', '3D'], ['游戏类型', '解谜'], ['风格', '卡通']]) {
      await selectSetting(label, value);
    }
    await goToSettingsGroup(1);
    expect(screen.getByRole('button', { name: '资源库使用方式', exact: true })).toHaveTextContent('按需使用');
    // The options must escape the scrolling dialog, not merely have a larger
    // z-index inside its clipping ancestor. All choices still update the brief.
    for (const option of ['优先使用', '必须使用', '按需使用']) {
      const listbox = await openSettingOptions('资源库使用方式');
      expect(listbox.parentElement).toBe(document.body);
      expect(listbox.closest('[role="dialog"]')).toBeNull();
      expect(within(listbox).getAllByRole('option')).toHaveLength(3);
      fireEvent.click(within(listbox).getByRole('option', { name: option, exact: true }));
      expect(screen.getByRole('button', { name: '资源库使用方式', exact: true })).toHaveTextContent(option);
      expect(screen.queryByRole('listbox', { name: '资源库使用方式', exact: true })).not.toBeInTheDocument();
      expect(screen.getByTestId('intake-settings')).toBeInTheDocument();
    }
    const openResourceMenu = await openSettingOptions('资源库使用方式');
    fireEvent.keyDown(within(openResourceMenu).getByRole('option', { name: '必须使用', exact: true }), { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: '资源库使用方式', exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '资源库使用方式', exact: true })).toHaveFocus();
    expect(screen.getByTestId('intake-settings')).toBeInTheDocument();
    await selectSetting('资源库使用方式', '按需使用');
    await goToSettingsGroup(1);
    fireEvent.click(screen.getByRole('button', { name: /键鼠/ }));
    fireEvent.click(screen.getByRole('option', { name: '键鼠' }));
    await selectScreenOrientation('横屏');
    await confirmBrief();
    expect(screen.getByTestId('confirmed-brief')).toBeInTheDocument();
    expect(screen.getByTestId('confirmed-brief')).toHaveTextContent('按需使用');
    unmount();
    await renderLanding();

    expect(await screen.findByRole('region', { name: 'LLM Mode A' })).toBeInTheDocument();
    expect(screen.getByTestId('confirmed-brief')).not.toHaveTextContent('确认构建方案');
    expect(screen.getByTestId('confirmed-brief')).toHaveTextContent('Godot');
    expect(screen.getByTestId('confirmed-brief')).toHaveTextContent('横屏');
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
    await renderLanding();

    fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '系统设置' }));

    expect(await screen.findByRole('dialog', { name: '系统设置' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '通用' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '平台' })).not.toBeInTheDocument();
  });

  it('opens credit administration only when the owner has credit administration permission', async () => {
    mockCurrentUser = {
      id: 'owner-user',
      role: 'owner',
      permissions: ['project.create', 'project.delete', 'credits.admin'],
    };
    await renderLanding();

    fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '系统设置' }));
    fireEvent.click(await screen.findByRole('tab', { name: '平台' }));
    fireEvent.click(screen.getByRole('tab', { name: '信用' }));

    await waitFor(() => expect(getCreditSummary).toHaveBeenCalledWith());
    expect(screen.getAllByText('Credit 审计').length).toBeGreaterThan(0);
  });

  it('manages billing credit packs from credit audit settings', async () => {
    mockCurrentUser = {
      id: 'owner-user',
      role: 'owner',
      permissions: ['project.create', 'project.delete', 'credits.admin'],
    };
    await renderLanding();

    fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '系统设置' }));
    fireEvent.click(await screen.findByRole('tab', { name: '平台' }));
    fireEvent.click(screen.getByRole('tab', { name: '信用' }));

    await waitFor(() => expect(getBillingCreditPacks).toHaveBeenCalledWith());
    await waitFor(() => expect(getBillingEvents).toHaveBeenCalledWith());
    expect(screen.getAllByText('500 credits').length).toBeGreaterThan(0);
    expect(screen.getByText('checkout.session.created')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Stripe price id'), {
      target: { value: 'price_db_1200' },
    });
    fireEvent.change(screen.getByPlaceholderText('Credits'), {
      target: { value: '1200' },
    });
    fireEvent.change(screen.getByPlaceholderText('显示名称'), {
      target: { value: '1,200 credits' },
    });
    fireEvent.change(screen.getByPlaceholderText('排序'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存套餐' }));

    await waitFor(() =>
      expect(upsertBillingCreditPack).toHaveBeenCalledWith({
        priceId: 'price_db_1200',
        credits: 1200,
        displayName: '1,200 credits',
        enabled: true,
        sortOrder: 2,
      }),
    );
    expect(await screen.findByText('1,200 credits')).toBeInTheDocument();
  });

  it('opens project lifecycle settings only when the owner has lifecycle administration permission', async () => {
    mockCurrentUser = {
      id: 'owner-user',
      role: 'owner',
      permissions: ['project.create', 'project.delete', 'lifecycle.admin'],
    };
    await renderLanding();

    fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '系统设置' }));
    fireEvent.click(await screen.findByRole('tab', { name: '平台' }));
    fireEvent.click(screen.getByRole('tab', { name: '项目' }));

    await waitFor(() => expect(getProjectLifecycleOverview).toHaveBeenCalledWith());
    expect(screen.getAllByText('项目生命周期').length).toBeGreaterThan(0);
  });

  it('opens account actions from a circular signed-in user avatar', async () => {
    mockCurrentUser = {
      id: 'alice',
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'owner',
      permissions: ['project.create', 'project.delete'],
    };
    await renderLanding();

    expect(screen.queryByRole('button', { name: '系统设置' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '历史项目' })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(await screen.findByText('300 credits')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /模式|mode/i })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '个人主页' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '系统设置' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '历史项目' })).toBeInTheDocument();
  });

  it('opens the credit store from the user menu and starts Stripe checkout', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mockCurrentUser = {
      id: 'alice',
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'developer',
      permissions: ['project.create'],
    };
    await renderLanding();

    fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Credit 商店' }));

    expect(await screen.findByRole('dialog', { name: 'Credit 商店' })).toBeInTheDocument();
    await waitFor(() => expect(getStripeCreditPacks).toHaveBeenCalledWith());
    expect(screen.getByText('500 credits')).toBeInTheDocument();
    expect(screen.getByText('1,200 credits')).toBeInTheDocument();
    expect(screen.queryByText(/price_/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '购买 500 credits' }));

    await waitFor(() => expect(createStripeCheckoutSession).toHaveBeenCalledWith('price_beegame_500'));
    expect(openSpy).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_beegame_store', '_self');
    openSpy.mockRestore();
  });

  it('does not display the raw user id as the signed-in nickname fallback', async () => {
    mockCurrentUser = {
      id: '00000000-0000-0000-0000-000000000001',
      role: 'owner',
      permissions: ['project.create', 'project.delete'],
    };
    await renderLanding();

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
    await renderLanding();

    fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '个人主页' }));

    const profileDialog = await screen.findByRole('dialog', { name: '个人主页' });
    expect(profileDialog).toBeInTheDocument();
    expect(within(profileDialog).getByText('Alice')).toBeInTheDocument();
    expect(within(profileDialog).getByText('alice@example.com')).toBeInTheDocument();
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

  it('shows only the compact realtime credit summary', async () => {
    mockCurrentUser = {
      id: 'alice',
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'owner',
      permissions: ['project.create', 'project.delete'],
    };
    await renderLanding();

    fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '个人主页' }));

    expect(await screen.findByText('余额')).toBeInTheDocument();
    expect(screen.getByText('已用')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /查看 Credit 明细/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/账本|ledger|明细/i)).not.toBeInTheDocument();
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
    await renderLanding();

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
    await renderLanding();

    fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
    expect(screen.getByRole('menu', { name: '用户菜单' })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(screen.queryByRole('menu', { name: '用户菜单' })).not.toBeInTheDocument());
  });

  it('uses the shared circular dashboard avatar for the account menu', async () => {
    mockCurrentUser = {
      id: 'alice',
      role: 'owner',
      permissions: ['project.create', 'project.delete'],
    };
    await renderLanding();

    const userButton = await screen.findByRole('button', { name: '用户菜单' });
    expect(userButton).toHaveClass('rounded-full', 'bg-[var(--surface-2)]');
    expect(userButton).not.toHaveClass('rounded-lg');

    fireEvent.click(userButton);

    expect(screen.getByRole('menu', { name: '用户菜单' })).toHaveClass('bg-popover', 'border-border');
  });

  it('opens the login and registration dialog from the anonymous user icon', async () => {
    mockCurrentUser = null;

    await renderLanding();

    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));

    expect(await screen.findByRole('dialog', { name: '欢迎回来' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '欢迎回来' })).toHaveClass('border-border', 'bg-popover');
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

    await renderLanding();

    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
    const authDialog = await screen.findByRole('dialog', { name: '欢迎回来' });
    const authPanel = authDialog.querySelector('form');

    expect(authPanel).toHaveClass('max-w-[520px]');
    expect(authPanel).toHaveClass('max-h-[calc(100dvh-2rem)]');

    fireEvent.click(screen.getByRole('button', { name: '注册账号' }));

    expect(authPanel).toHaveClass('max-w-[520px]');
    expect(authPanel).toHaveClass('max-h-[calc(100dvh-2rem)]');

    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(authPanel).toHaveClass('max-w-[520px]');
    expect(authPanel).toHaveClass('max-h-[calc(100dvh-2rem)]');
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

    await renderLanding();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Typed but not submitted idea' } });
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
    await screen.findByRole('dialog', { name: '欢迎回来' });
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'player@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录并继续' }));

    await waitFor(() => expect(signInWithSupabasePassword).toHaveBeenCalled());
    expect(screen.queryByRole('group', { name: '实时 Credit 扣除提示' })).not.toBeInTheDocument();
    expect(runIdeaIntake).not.toHaveBeenCalled();
  });

  it('does not store an OAuth generation intent from the account menu without an explicit generate click', async () => {
    mockCurrentUser = null;

    const { unmount } = await renderLanding();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Typed but not submitted idea' } });
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
    await screen.findByRole('dialog', { name: '欢迎回来' });
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
    await renderLanding();

    expect(screen.queryByRole('group', { name: '实时 Credit 扣除提示' })).not.toBeInTheDocument();
    expect(runIdeaIntake).not.toHaveBeenCalled();
  });

  it('opens a dedicated password reset view before sending reset email', async () => {
    mockCurrentUser = null;

    await renderLanding();

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

    await renderLanding();

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

    await waitFor(() =>
      expect(signUpWithSupabasePassword).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'secret-password',
        displayName: 'New Player',
      }),
    );
    expect(mockLoadCurrentUser).toHaveBeenCalled();
  });

  it('asks for the email code when signup requires confirmation', async () => {
    mockCurrentUser = null;
    signUpWithSupabasePassword.mockResolvedValueOnce(null);
    mockLoadCurrentUser.mockImplementation(async () => {
      if (verifySupabaseSignupCode.mock.calls.length) {
        mockCurrentUser = { id: 'user-2', role: 'owner', permissions: ['project.create'] };
      }
    });
    await renderLanding();
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
    fireEvent.click(await screen.findByRole('button', { name: '注册账号' }));
    fireEvent.change(screen.getByLabelText('昵称'), { target: { value: 'New Player' } });
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByLabelText('同意用户协议'));
    fireEvent.click(screen.getByRole('button', { name: '注册并继续' }));

    expect(await screen.findByRole('dialog', { name: '验证邮箱' })).toBeInTheDocument();
    expect(verifySupabaseSignupCode).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('邮箱验证码'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '验证邮箱并继续' }));

    await waitFor(() => expect(verifySupabaseSignupCode).toHaveBeenCalledWith('new@example.com', '123456'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '验证邮箱' })).not.toBeInTheDocument());
  });

  it('starts Supabase OAuth from third-party login buttons', async () => {
    mockCurrentUser = null;

    await renderLanding();

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

    await renderLanding();

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
    await renderLanding();

    fireEvent.click(await screen.findByRole('button', { name: '用户菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '退出登录' }));

    expect(clearSupabaseSession).toHaveBeenCalledTimes(1);
    expect(mockLoadCurrentUser).toHaveBeenCalled();
  });

  it('generates selectable intake options without starting a BeeGame session immediately', async () => {
    const onStart = vi.fn().mockResolvedValue({ status: 'started', projectId: 'proj_1' });

    await renderLanding({ onStart });

    await submitIdeaAndConfirmIntake('LLM generated idea');

    await screen.findByText('LLM Mode A');
    expect(screen.getByText('LLM Mode B')).toBeInTheDocument();
    expect(screen.getByText('LLM Mode C')).toBeInTheDocument();
    expect(runIdeaIntake).toHaveBeenCalledWith({
      idea: 'LLM generated idea',
      language: 'zh',
    });
    expect(onStart).not.toHaveBeenCalled();
    expect(analyzeIdeaIntake).not.toHaveBeenCalled();
  });

  it('shows generated options and their real gameplay inside the production dialog', async () => {
    await renderLanding();
    await submitIdeaAndConfirmIntake('LLM generated idea');
    const options = await screen.findByRole('region', { name: '选择方案' });
    const bubble = screen.getByRole('dialog');
    expect(bubble).toContainElement(options);
    const backdrop = screen.getByTestId('idea-home-backdrop');
    expect(within(options).getAllByTestId('bouncy-accordion-trigger')).toHaveLength(3);
    expect(within(options).getAllByTestId('bouncy-accordion-trigger').every(button => button.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(screen.queryByRole('button', { name: '下一步' })).not.toBeInTheDocument();
    expect(options).toContainElement(screen.getByText('LLM generated gameplay rules A.'));
    expect(screen.queryByTestId('idea-avatar')).not.toBeInTheDocument();
    fireEvent.click(within(options).getByRole('button', { name: /LLM Mode A/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toContainElement(screen.getByTestId('intake-settings')));
    expect(screen.getByRole('dialog')).toBe(bubble);
    expect(screen.getByTestId('idea-home-backdrop')).toBe(backdrop);
  });

  it('does not show clarification when intake returns an old clarification-only response', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runIdeaIntake.mockRejectedValueOnce(new Error('BeeGame intake did not return game mode options'));

    await renderLanding();

    await submitIdeaAndConfirmIntake('LLM generated idea');

    expect(await screen.findByText('BeeGame intake did not return game mode options')).toBeInTheDocument();
    expect(screen.queryByTestId('intake-clarification')).not.toBeInTheDocument();
    expect(screen.queryByText('需求补充')).not.toBeInTheDocument();
    expect(runIdeaIntake).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(
      'Failed to generate intake options:',
      expect.objectContaining({ message: 'BeeGame intake did not return game mode options' }),
    );
    errorLog.mockRestore();
  });

  it('shows a rejected idea below the prompt and keeps the draft editable', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runIdeaIntake.mockRejectedValueOnce(new Error('这里用于创建游戏。请描述你想制作的游戏。'));

    await renderLanding();
    await submitIdeaAndConfirmIntake('你是谁');

    const message = await screen.findByText('这里用于创建游戏。请描述你想制作的游戏。');
    expect(screen.getByRole('alert')).toContainElement(message);
    expect(screen.queryByTestId('idea-avatar')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('你是谁');
    expect(screen.getByRole('textbox')).toBeEnabled();
    errorLog.mockRestore();
  });

  it('replaces the consent input with a writing avatar while generating, then restores the draft on failure', async () => {
    let rejectOptions: (reason: Error) => void = () => undefined;
    runIdeaIntake.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectOptions = reject;
      }),
    );
    const onStart = vi.fn();

    await renderLanding({ onStart });

    await submitIdeaAndConfirmIntake('LLM generated idea');

    expect(screen.queryByTestId('avatar-dialogue')).not.toBeInTheDocument();
    expect(screen.queryByText('正在根据你的想法生成可选方案...')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(screen.getByTestId('idea-avatar')).toHaveAttribute('data-mood', 'writing');
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.queryByText('可以是一句话、一张图片、一段视频。')).not.toBeInTheDocument();
    expect(screen.queryByTestId('idea-prompt-beam')).not.toBeInTheDocument();

    await act(async () => {
      rejectOptions(new Error('Preview request failed'));
    });
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    expect(screen.getByRole('textbox')).toHaveValue('LLM generated idea');
    expect(screen.queryByTestId('idea-avatar')).not.toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('shows three selectable directions even for a concrete idea', async () => {
    runIdeaIntake.mockResolvedValueOnce({
      maturity: 'concrete',
      needsClarification: false,
      clarificationQuestions: [],
      detectedConstraints: ['LLM concrete constraint'],
      recommendedNextStep: 'choose_direction',
      options: makeIntakeOptions(),
    });

    await renderLanding();

    await submitIdeaAndConfirmIntake('LLM concrete idea');

    expect(await screen.findByRole('region', { name: '选择方案' })).toBeInTheDocument();
    expect(screen.getAllByTestId('bouncy-accordion-trigger')).toHaveLength(3);
    expect(screen.queryByTestId('intake-settings')).not.toBeInTheDocument();
  });

  it('requires production settings to stay inside configured values', async () => {
    runIdeaIntake.mockResolvedValueOnce({
      maturity: 'vague',
      needsClarification: false,
      clarificationQuestions: [],
      detectedConstraints: [],
      recommendedNextStep: 'choose_direction',
      options: [
        {
          ...makeIntakeOptions()[0],
          recommendedPlatform: 'Experimental Arcade Cabinet',
          recommendedEngine: 'Custom Engine From Prompt',
          recommendedDimension: 'Holographic 4D',
          recommendedGenre: 'Generated Genre',
          recommendedStyle: 'Generated Style',
          recommendedInputs: ['Generated Input'],
        },
        {
          ...makeIntakeOptions()[1],
          recommendedPlatform: 'Another Generated Platform',
          recommendedEngine: 'Another Generated Engine',
          recommendedDimension: 'Another Generated Dimension',
          recommendedGenre: 'Another Generated Genre',
          recommendedStyle: 'Another Generated Style',
          recommendedInputs: ['Another Generated Input'],
        },
      ],
    });

    await renderLanding();

    await submitIdeaAndConfirmIntake('LLM generated idea');

    fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));

    for (const [label, choices, invalid] of [
      ['平台', ['Web', 'PC'], 'Experimental Arcade Cabinet'],
      ['引擎', ['React', 'Unity', 'Godot', 'Unreal'], 'Custom Engine From Prompt'],
      ['表现形式', ['2D'], 'Holographic 4D'],
      ['游戏类型', ['街机'], 'Generated Genre'],
      ['风格', ['像素'], 'Generated Style'],
    ] as const) {
      await goToSettingsGroup(settingGroup(label));
      expect(screen.getByRole('button', { name: label, exact: true })).toHaveTextContent('请选择');
      const listbox = await openSettingOptions(label);
      for (const choice of choices) expect(within(listbox).getByRole('option', { name: choice, exact: true })).toBeInTheDocument();
      expect(within(listbox).queryByRole('option', { name: invalid, exact: true })).not.toBeInTheDocument();
      expect(within(listbox).queryByRole('option', { selected: true })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    }

    await selectScreenOrientation('横屏');
    await confirmBrief();

    expect(screen.getByTestId('intake-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('confirmed-brief')).not.toBeInTheDocument();
    expect(screen.getByText('请选择制作设置。')).toBeInTheDocument();
  });

  it('uses configured production setting choices and preselects valid LLM recommendations', async () => {
    runIdeaIntake.mockResolvedValueOnce({
      maturity: 'concrete',
      needsClarification: false,
      clarificationQuestions: [],
      detectedConstraints: [],
      recommendedNextStep: 'choose_direction',
      options: makeIntakeOptions().map((option, index) =>
        index === 0
          ? {
              ...option,
              recommendedPlatform: 'PC',
              recommendedEngine: 'Unity',
              recommendedDimension: '3D',
              recommendedGenre: 'Racing',
              recommendedStyle: 'Realistic',
              recommendedInputs: ['Keyboard/mouse', 'Gamepad', 'Hand tracking'],
            }
          : option,
      ),
    });

    await renderLanding();

    await submitIdeaAndConfirmIntake('LLM concrete settings idea');
    fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByRole('region', { name: 'LLM Mode A' })).toBeInTheDocument();

    for (const [label, value] of [['平台', 'PC'], ['引擎', 'Unity'], ['表现形式', '3D'], ['游戏类型', 'Racing'], ['风格', '写实']]) {
      await goToSettingsGroup(settingGroup(label));
      expect(screen.getByRole('button', { name: label, exact: true })).toHaveTextContent(value);
      const listbox = await openSettingOptions(label);
      expect(within(listbox).getByRole('option', { name: value, exact: true })).toHaveAttribute('aria-selected', 'true');
      fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    }
    await goToSettingsGroup(1);
    expect(screen.getByRole('button', { name: '键鼠 / 手柄 / 手追' })).toBeInTheDocument();
    const engines = await openSettingOptions('引擎');
    expect(within(engines).getAllByRole('option').map(option => option.textContent)).toEqual(['React', 'Unity', 'Godot', 'Unreal']);
    fireEvent.click(screen.getByRole('button', { name: '引擎', exact: true }));
    await goToSettingsGroup(1);
    fireEvent.click(screen.getByRole('button', { name: '键鼠 / 手柄 / 手追' }));
    expect(
      within(screen.getByRole('listbox', { name: '输入方式' })).getByRole('option', { name: '手追' }),
    ).toBeInTheDocument();
  });

  it('defaults orientation to landscape and allows an explicit portrait choice', async () => {
    await renderLanding();
    await submitIdeaAndConfirmIntake('Touch game');
    fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    const orientation = screen.getByRole('button', { name: '屏幕方向', exact: true });
    expect(orientation).toHaveTextContent('横屏');
    expect(orientation).not.toHaveTextContent('竖屏');
    await selectScreenOrientation('竖屏');
    await confirmBrief();
    expect(screen.getByTestId('confirmed-brief')).toHaveTextContent('竖屏');
    expect(screen.getByTestId('confirmed-brief')).toHaveTextContent('Touch');
  });

  it('confirms an intake brief before starting the BeeGame session', async () => {
    const onStart = vi.fn().mockResolvedValue({ status: 'started', projectId: 'proj_1' });

    await renderLanding({ onStart });

    await submitIdeaAndConfirmIntake('LLM generated idea');

    fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByTestId('intake-settings')).toHaveAttribute('data-panel-depth', 'single');
    expect(screen.getByRole('region', { name: 'LLM Mode A' })).toBeInTheDocument();
    expect(screen.queryByText('补齐制作设置')).not.toBeInTheDocument();
    expect(screen.queryByText('LLM generated hypothesis A.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '范围', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Auto')).not.toBeInTheDocument();

    const engineListbox = await openSettingOptions('引擎');
    const engineValues = within(engineListbox).getAllByRole('option').map(option => option.textContent);
    expect(engineValues).toEqual(['React', 'Unity', 'Godot', 'Unreal']);
    fireEvent.click(within(engineListbox).getByRole('option', { name: 'Godot', exact: true }));
    for (const [label, value] of [['平台', 'Web'], ['表现形式', '3D'], ['游戏类型', '解谜'], ['风格', '卡通']]) {
      await selectSetting(label, value);
    }
    await goToSettingsGroup(1);
    fireEvent.click(screen.getByRole('button', { name: /键鼠/ }));
    const inputListbox = screen.getByRole('listbox', { name: '输入方式' });
    expect(inputListbox).toHaveAttribute('data-floating-layer', 'true');
    expect(inputListbox).toHaveClass('fixed', 'z-[260]');
    expect(inputListbox).toHaveClass('bg-popover', 'border-border');
    await goToSettingsGroup(2);
    fireEvent.change(screen.getByRole('textbox', { name: '补充说明' }), { target: { value: '优先验证关卡节奏。' } });
    await selectScreenOrientation('横屏');
    await confirmBrief();

    expect(screen.getByTestId('confirmed-brief')).toBeInTheDocument();
    expect(screen.getByTestId('confirmed-brief')).not.toHaveTextContent('LLM generated pitch A.');
    mockLoadCurrentUser.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '开始构建' }));

    expect(mockLoadCurrentUser).toHaveBeenCalledTimes(1);

    const startingCover = await screen.findByRole('status', { name: '正在启动项目' });
    expect(startingCover).toBeInTheDocument();
    expect(screen.queryByTestId('avatar-dialogue')).not.toBeInTheDocument();
    expect(within(startingCover).getByText('正在创建独立工作区并连接构建会话，很快就好。')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '启动构建' })).not.toBeInTheDocument();
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    const [, clarification, brief] = onStart.mock.calls[0];
    expect(clarification).toBeUndefined();
    expect(brief).toMatchObject({
      idea: 'LLM generated idea',
      language: 'zh',
      documentLanguage: 'zh',
      gameUserVisibleLanguage: 'zh',
      agentResponseLanguage: 'zh',
      title: 'LLM Mode A',
      option: { id: 'llm_mode_a', title: 'LLM Mode A' },
      settings: {
        platform: 'Web',
        engine: 'Godot',
        dimension: '3D',
        orientation: 'Landscape',
        genre: 'Puzzle',
        visualStyle: 'Cartoon',
        inputs: ['Keyboard/mouse', 'Touch'],
        notes: '优先验证关卡节奏。',
        resourceLibraryUsage: 'optional',
      },
    });
  });

  it('closes the input method dropdown when clicking outside it', async () => {
    await renderLanding();

    await submitIdeaAndConfirmIntake('LLM generated idea');
    fireEvent.click(await screen.findByRole('button', { name: /LLM Mode A/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await goToSettingsGroup(1);
    fireEvent.click(screen.getByRole('button', { name: /键鼠/ }));

    expect(screen.getByRole('listbox', { name: '输入方式' })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: '输入方式' })).not.toBeInTheDocument();
    });
  });

  it('shows the restored prompt immediately with English mode selection', async () => {
    const { container } = await renderLanding({ lang: 'en' }, false);
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'What kind of game do you want to create?');
    expect(screen.getByRole('button', { name: 'Creative mode', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a reference' })).toBeInTheDocument();
    expect(container.querySelector('img[src="/assets/bgs_logo.svg"]')).toBeInTheDocument();
    expect(screen.queryByTestId('avatar-dialogue')).not.toBeInTheDocument();
  });

  it('accepts a GDD attachment from the landing prompt', async () => {
    await renderLanding();

    const input = document.getElementById('landing-attachment-upload') as HTMLInputElement;
    expect(input.accept).toContain('.md');
    expect(input.accept).toContain('.doc');
    expect(input.accept).toContain('.mp4');
    expect(input.accept).not.toContain('.jsonl');
    expect(input.accept).not.toContain('image/gif');

    fireEvent.change(input, {
      target: { files: [new File(['# Game Design'], 'game-design.md', { type: 'text/markdown' })] },
    });

    expect(await screen.findByText('game-design.md')).toBeInTheDocument();
  });

  it('limits Idea Home images and documents to the requested types and sizes', async () => {
    await renderLanding();
    const input = document.getElementById('landing-attachment-upload') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('large.jpg 不得超过 3 MB'));
    expect(screen.queryByText('large.jpg')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { files: [new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('large.pdf 不得超过 2 MB'));
    expect(screen.queryByText('large.pdf')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { files: [new File(['legacy document'], 'reference.doc', { type: 'application/msword' })] } });
    expect(await screen.findByText('reference.doc')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { files: [new File(['image'], 'reference.webp', { type: 'image/webp' })] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('请上传 JPG、PNG、DOC、MD、PDF 或 MP4 文件'));
    expect(screen.queryByText('reference.webp')).not.toBeInTheDocument();
  });

  it('rejects MP4 videos longer than 10 seconds and accepts a 10-second video', async () => {
    await renderLanding();
    const input = document.getElementById('landing-attachment-upload') as HTMLInputElement;
    const createObjectURL = vi.fn(() => 'blob:reference-video');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const duration = vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(11);
    const src = vi.spyOn(HTMLMediaElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLMediaElement) {
      queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')));
    });
    try {
      fireEvent.change(input, { target: { files: [new File(['video'], 'long.mp4', { type: 'video/mp4' })] } });
      expect(await screen.findByRole('alert')).toHaveTextContent('10 秒');
      expect(screen.queryByText('long.mp4')).not.toBeInTheDocument();

      duration.mockReturnValue(10);
      fireEvent.change(input, { target: { files: [new File(['video'], 'short.mp4', { type: 'video/mp4' })] } });
      expect(await screen.findByText('short.mp4')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(createObjectURL).toHaveBeenCalledTimes(2);
      expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    } finally {
      src.mockRestore();
      duration.mockRestore();
      delete (URL as typeof URL & { createObjectURL?: typeof createObjectURL }).createObjectURL;
      delete (URL as typeof URL & { revokeObjectURL?: typeof revokeObjectURL }).revokeObjectURL;
    }
  });

  it('renders the restored prompt with the current backdrop and theme control', async () => {
    await renderLanding();
    expect(screen.queryByTestId('landing-background-image')).not.toBeInTheDocument();
    expect(screen.getByTestId('idea-prompt-surface')).toContainElement(screen.getByRole('textbox'));
    expect(screen.getByTestId('beui-theme-toggle')).toHaveAccessibleName('深色模式');
  });

  it('hides Send until input focus, stays open while clearing, and supports focusing Send', async () => {
    await renderLanding(undefined, false);
    const input = screen.getByRole('textbox');
    const group = screen.getByTestId('idea-prompt-liquid');
    const send = screen.getByTestId('idea-prompt-send');
    const mode = screen.getByRole('button', { name: '创意模式' });
    expect(mode).toHaveAttribute('aria-hidden', 'false');
    expect(group).toHaveAttribute('data-send-detached', 'false');
    expect(send).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button', { name: '生成' })).not.toBeInTheDocument();
    // A restored or programmatically changed draft must not open the action.
    fireEvent.change(input, { target: { value: '像素跑酷游戏' } });
    expect(group).toHaveAttribute('data-send-detached', 'false');
    fireEvent.focus(input);
    expect(group).toHaveAttribute('data-send-detached', 'true');
    expect(send).toHaveAttribute('aria-hidden', 'false');
    expect(mode).toHaveAttribute('aria-hidden', 'true');
    expect(mode).toHaveAttribute('tabindex', '-1');
    expect(mode).toHaveAttribute('hidden');
    expect(send).toBeEnabled();
    fireEvent.change(input, { target: { value: '' } });
    expect(group).toHaveAttribute('data-send-detached', 'true');
    expect(send).toBeDisabled();
    fireEvent.change(input, { target: { value: '像素跑酷游戏' } });
    fireEvent.blur(input, { relatedTarget: send });
    expect(group).toHaveAttribute('data-send-detached', 'true');
    fireEvent.click(send);
    expect(await screen.findByRole('group', { name: '实时 Credit 扣除提示' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.focus(screen.getByRole('textbox'));
    fireEvent.blur(screen.getByRole('textbox'), { relatedTarget: document.body });
    expect(group).toHaveAttribute('data-send-detached', 'false');
    expect(screen.getByRole('button', { name: '创意模式' })).toHaveAttribute('aria-hidden', 'false');
  });

  it('keeps the prompt usable while typing', async () => {
    await renderLanding();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '像素跑酷游戏' } });

    expect(screen.getByRole('textbox')).toHaveValue('像素跑酷游戏');
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('does not expose model thinking controls in the idea prompt', async () => {
    await renderLanding();
    expect(screen.queryByLabelText('思考')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '深度思考' })).not.toBeInTheDocument();
  });

  it('renders the idea prompt as a semantic surface', async () => {
    await renderLanding();

    expect(screen.queryByTestId('idea-prompt-beam')).not.toBeInTheDocument();
    expect(screen.getByTestId('idea-prompt-surface')).toContainElement(screen.getByRole('textbox'));
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
    expect(screen.queryByTestId('command-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('progressive-blur-layer')).not.toBeInTheDocument();
  });

  it('does not submit during Chinese composition and preserves the idea after cancelling consent', async () => {
    await renderLanding();
    const input = screen.getByRole('textbox');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '会改变重力的游戏' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(screen.queryByRole('group', { name: '实时 Credit 扣除提示' })).not.toBeInTheDocument();
    expect(runIdeaIntake).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    const confirmation = await screen.findByRole('group', { name: '实时 Credit 扣除提示' });
    expect(screen.queryByRole('button', { name: '切换创作方式' })).not.toBeInTheDocument();
    expect(within(confirmation).getByRole('button', { name: '取消' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(await screen.findByRole('textbox')).toHaveValue('会改变重力的游戏');
    expect(runIdeaIntake).not.toHaveBeenCalled();
  });

  it('keeps reference upload available and changes mode without losing the draft', async () => {
    await renderLanding({ lang: 'zh' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '我的游戏想法' } });
    const submitButton = screen.getByRole('button', { name: '生成' });
    expect(submitButton.querySelector('path[d="m5 12 7-7 7 7"]')).not.toBeNull();
    expect(submitButton.querySelector('path[d="M12 19V5"]')).not.toBeNull();
    const picker = document.getElementById('landing-attachment-upload') as HTMLInputElement;
    const clickPicker = vi.spyOn(picker, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: '添加参考文件' }));
    expect(clickPicker).toHaveBeenCalledOnce();
    expect(picker.accept).toBe('.jpg,.jpeg,.png,.doc,.md,.pdf,.mp4');
    fireEvent.blur(screen.getByRole('textbox'), { relatedTarget: document.body });
    fireEvent.click(screen.getByRole('button', { name: '创意模式' }));
    expect(screen.getByRole('textbox')).toHaveValue('我的游戏想法');
    fireEvent.click(screen.getByRole('button', { name: '蓝图模式', exact: true }));
    expect(screen.queryByTestId('creation-mode-choices')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('我的游戏想法');
  });

  it('starts with the original input rather than the hidden Avatar mode picker', async () => {
    await renderLanding({ lang: 'zh' }, false);
    expect(screen.getByRole('textbox')).toBeEnabled();
    expect(screen.getByRole('button', { name: '创意模式', exact: true })).toBeInTheDocument();
    expect(screen.queryByTestId('creation-mode-choices')).not.toBeInTheDocument();
    expect(screen.queryByTestId('avatar-dialogue')).not.toBeInTheDocument();
  });

  it('localizes the restored prompt in Traditional Chinese', async () => {
    await renderLanding({ lang: 'zh-TW' }, false);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '創意模式', exact: true })).toBeInTheDocument();
  });

  it('opens the simplified settings overlay on the general tab', async () => {
    const onSetLang = vi.fn();
    await renderLanding({ lang: 'en', onSetLang });

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    await screen.findByRole('menuitem', { name: 'Settings' });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Settings' }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByText('Dark Mode')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Language')).toBeInTheDocument();
    expect(screen.getByText('System Settings')).toBeInTheDocument();
    const languages = await openSettingOptions('Language');
    for (const name of ['English', '简体中文', '繁體中文', '日本語', '한국어', 'Français', 'Deutsch', 'Español', 'Italiano', 'Português']) {
      expect(within(languages).getByRole('option', { name, exact: true })).toBeInTheDocument();
    }
    fireEvent.click(within(languages).getByRole('option', { name: '简体中文', exact: true }));
    expect(onSetLang).toHaveBeenCalledWith('zh');
  });

  it('opens a centered history modal with project list content', async () => {
    mockProjects = [{ id: 'project-1', name: 'LLM Project', created_at: '2026-04-20T00:00:00.000Z' }];

    await renderLanding({ lang: 'zh' });

    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }));
    await screen.findByRole('menuitem', { name: '历史项目' });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '历史项目' }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByRole('dialog', { name: '历史项目' })).toBeInTheDocument();
    expect(screen.getByText('LLM Project')).toBeInTheDocument();
  });

  it('renders the project action menu outside the history dialog to avoid clipping', async () => {
    mockProjects = [{ id: 'project-1', name: 'LLM Project', created_at: '2026-04-20T00:00:00.000Z' }];

    await renderLanding({ lang: 'en' });

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    await screen.findByRole('menuitem', { name: 'History Projects' });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'History Projects' }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const dialog = screen.getByRole('dialog', { name: 'History Projects' });

    fireEvent.click(screen.getByRole('button', { name: 'More actions LLM Project' }));

    const deleteAction = screen.getByRole('button', { name: 'Delete Project' });
    expect(dialog).not.toContainElement(deleteAction);
  });

  it('shows an empty state in the history modal', async () => {
    await renderLanding({ lang: 'en' });

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    await screen.findByRole('menuitem', { name: 'History Projects' });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'History Projects' }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByRole('dialog', { name: 'History Projects' })).toBeInTheDocument();
    expect(screen.getByText('No projects for this account yet')).toBeInTheDocument();
  });

  it('keeps the history modal content area stable for empty and populated project lists', async () => {
    const emptyRender = await renderLanding({ lang: 'en' });

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    await screen.findByRole('menuitem', { name: 'History Projects' });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'History Projects' }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const emptyDialog = screen.getByRole('dialog', { name: 'History Projects' });
    const emptyContent = emptyDialog.querySelector('.scrollbar-premium');
    expect(emptyDialog).toHaveClass('h-[min(680px,calc(100dvh-2rem))]');
    expect(emptyContent).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');

    emptyRender.unmount();

    mockProjects = [{ id: 'project-1', name: 'LLM Project', created_at: '2026-04-20T00:00:00.000Z' }];
    await renderLanding({ lang: 'en' });

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
    await screen.findByRole('menuitem', { name: 'History Projects' });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'History Projects' }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const populatedDialog = screen.getByRole('dialog', { name: 'History Projects' });
    const populatedContent = populatedDialog.querySelector('.scrollbar-premium');
    expect(populatedDialog).toHaveClass('h-[min(680px,calc(100dvh-2rem))]');
    expect(populatedContent).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
  });
});
