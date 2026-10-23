import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import App from './App';
import i18n from './i18n';

const { applyThemeToDocument } = vi.hoisted(() => ({
  applyThemeToDocument: vi.fn(),
}));
const loadProjects = vi.fn().mockResolvedValue(undefined);
const loadStatus = vi.fn().mockResolvedValue(undefined);
const loadAgents = vi.fn().mockResolvedValue(undefined);
const loadActivities = vi.fn().mockResolvedValue(undefined);
const loadCurrentUser = vi.fn().mockResolvedValue({
  id: 'owner-user',
  role: 'owner',
  permissions: ['project.read'],
});
let activeLoadProjects = loadProjects;
let activeLoadCurrentUser = loadCurrentUser;
const setAuthenticationStatus = vi.fn();
let mockedAuthenticationStatus: 'initializing' | 'authenticated' | 'anonymous' = 'authenticated';
let mockedIsDark = true;
const bootstrapProject = vi.fn().mockResolvedValue('proj_1');
const setToastCallbacks = vi.fn();
const { getChatHistory } = vi.hoisted(() => ({
  getChatHistory: vi.fn().mockResolvedValue([]),
}));
const showError = vi.fn();
const showSuccess = vi.fn();
let mockedActiveProjectId: string | null = 'proj_1';
let mockedHasLoadedProjects = true;
const mockedProjects = [
  { id: 'proj_1', name: 'Project One', created_at: Date.now() },
  { id: 'proj_2', name: 'Project Two', created_at: Date.now() },
];

vi.mock('./store/projectStore', () => {
  const projectState = () => ({
    loadProjects: activeLoadProjects,
    projects: mockedProjects,
    activeProjectId: mockedActiveProjectId,
    hasLoadedProjects: mockedHasLoadedProjects,
    bootstrapProject,
    setToastCallbacks,
    clearActiveProject: vi.fn(),
    syncActiveProjectFromRoute: vi.fn(),
  });
  const useProjectStore = Object.assign((selector?: (state: ReturnType<typeof projectState>) => unknown) => selector ? selector(projectState()) : projectState(), {
    getState: () => ({ activeProjectId: mockedActiveProjectId }),
  });
  return { useProjectStore };
});

vi.mock('./store/systemStore', () => ({
  applyThemeToDocument,
  useSystemStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
    loadStatus,
    loadAgents,
    loadActivities,
    loadCurrentUser: activeLoadCurrentUser,
    authenticationStatus: mockedAuthenticationStatus,
    setAuthenticationStatus,
    currentUser: mockedAuthenticationStatus === 'authenticated'
      ? { id: 'owner-user', role: 'owner', permissions: ['project.read'] }
      : null,
    isDark: mockedIsDark,
    toggleTheme: vi.fn(),
    status: { capabilities: {} },
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('./contexts/ToastContext', () => ({
  useToastContext: () => ({
    showError,
    showSuccess,
  }),
}));

vi.mock('./services/api', () => ({
  api: {
    getChatHistory,
  },
  setToastErrorCallback: vi.fn(),
}));

vi.mock('./utils/chatHistory', () => ({
  normalizeChatHistory: (value: unknown) => value,
}));

vi.mock('./components/Common/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./components/Demiurge/LandingView', () => ({
  LandingView: () => <div data-testid="landing-view" />,
}));

// App routing/auth tests also render WorkspaceLoadingPage. Its canvas avatar
// has separate interaction/renderer tests; JSDOM does not implement Path2D.
vi.mock('./components/Demiurge/Landing/DotsAvatar', () => ({
  DotsAvatar: () => null,
}));

vi.mock('./components/Demiurge/DashboardView', () => ({
  DashboardView: ({ lang, projectId, onSetLang }: { lang: string; projectId: string; onSetLang: (language: 'en') => void }) => (
    <div data-testid="dashboard-view" data-language={lang} data-project-id={projectId}>
      <button onClick={() => onSetLang('en')}>Switch to English</button>
    </div>
  ),
}));

describe('App view routing', () => {
  afterEach(async () => {
    vi.useRealTimers();
    await i18n.changeLanguage('zh');
    localStorage.clear();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    loadCurrentUser.mockResolvedValue({
      id: 'owner-user',
      role: 'owner',
      permissions: ['project.read'],
    });
    mockedAuthenticationStatus = 'authenticated';
    mockedIsDark = true;
    mockedActiveProjectId = 'proj_1';
    mockedHasLoadedProjects = true;
    activeLoadProjects = loadProjects;
    activeLoadCurrentUser = loadCurrentUser;
    getChatHistory.mockReset().mockResolvedValue([]);
    window.history.pushState({}, '', '/');
  });

  it('restores an HttpOnly session without requiring a browser-readable token', async () => {
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '1');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      authenticated: true,
      user: { id: 'owner-user' },
    })));

    render(<App />);

    await waitFor(() => expect(loadCurrentUser).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith('/api/auth/session', { credentials: 'include' });
  });

  it('does not mount protected or anonymous views while authentication is initializing', () => {
    mockedAuthenticationStatus = 'initializing';

    render(<App />);

    expect(screen.getByLabelText('Initializing BeeGame')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('landing-view')).not.toBeInTheDocument();
  });

  it('keeps the project loading page visible while authentication initializes', () => {
    mockedAuthenticationStatus = 'initializing';
    window.history.pushState({}, '', '/?project=proj_1');

    render(<App />);

    expect(screen.getByLabelText('Restoring project workspace')).toBeInTheDocument();
    expect(screen.queryByLabelText('Initializing BeeGame')).not.toBeInTheDocument();
    expect(applyThemeToDocument).toHaveBeenLastCalledWith(true);
  });

  it('restarts authentication when its store action is replaced by hot reload', async () => {
    mockedAuthenticationStatus = 'initializing';
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '1');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ authenticated: true, user: { id: 'owner-user' } })));
    const { rerender } = render(<App />);
    await waitFor(() => expect(loadCurrentUser).toHaveBeenCalledTimes(1));

    const replacement = vi.fn().mockResolvedValue({ id: 'owner-user' });
    activeLoadCurrentUser = replacement;
    rerender(<App />);

    await waitFor(() => expect(replacement).toHaveBeenCalledTimes(1));
  });

  it('reloads projects when hot reload replaces the project store', async () => {
    mockedActiveProjectId = null;
    mockedHasLoadedProjects = false;
    window.history.pushState({}, '', '/?project=proj_1');
    const { rerender } = render(<App />);
    await waitFor(() => expect(loadProjects).toHaveBeenCalledTimes(1));

    const replacement = vi.fn().mockResolvedValue(undefined);
    activeLoadProjects = replacement;
    rerender(<App />);

    await waitFor(() => expect(replacement).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Restoring project workspace')).toBeInTheDocument();
  });

  it('leaves transcript loading to the mounted workspace session', async () => {
    render(<App />);
    await screen.findByTestId('dashboard-view');
    expect(getChatHistory).not.toHaveBeenCalled();
  });

  it('shows a recovery state and retries a temporarily unavailable authentication service', async () => {
    vi.useFakeTimers();
    mockedAuthenticationStatus = 'initializing';
    vi.stubEnv('VITE_BEEGAME_HTTPONLY_SESSIONS', '1');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      authenticated: true,
      user: { id: 'owner-user' },
    })));
    const unavailable = Object.assign(
      new Error('Authentication service is temporarily unavailable'),
      { status: 503, code: 'authentication_unavailable' },
    );
    loadCurrentUser
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce({
        id: 'owner-user',
        role: 'owner',
        permissions: ['project.read'],
      });

    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(loadCurrentUser).toHaveBeenCalledTimes(1);
    expect(screen.getByText('认证服务暂时不可用，正在重新连接…')).toBeInTheDocument();
    expect(screen.queryByTestId('landing-view')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(loadCurrentUser).toHaveBeenCalledTimes(2);
  });

  it('keeps the production app on the workspace dashboard when the URL has an internal diagnostics view', () => {
    window.history.pushState({}, '', '/?view=test');
    render(<App />);
    expect(screen.getByTestId('dashboard-view')).toBeInTheDocument();
  });

  it('renders the dashboard when the URL view is not test', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByTestId('dashboard-view')).toBeInTheDocument();
    expect(applyThemeToDocument).toHaveBeenLastCalledWith(true);
  });

  it('keeps the selected dashboard language after remounting', async () => {
    const { unmount } = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to English' }));

    await waitFor(() => expect(localStorage.getItem('i18nextLng')).toBe('en'));
    expect(await screen.findByTestId('dashboard-view')).toHaveAttribute('data-language', 'en');

    unmount();
    render(<App />);
    expect(await screen.findByTestId('dashboard-view')).toHaveAttribute('data-language', 'en');
  });

  it('does not flash Idea Home while restoring a project route', () => {
    mockedActiveProjectId = null;
    mockedHasLoadedProjects = false;
    window.history.pushState({}, '', '/?project=proj_1&editor=scene');

    render(<App />);

    const restoreStatus = screen.getByLabelText('Restoring project workspace');
    expect(restoreStatus).toHaveClass('bg-background');
    expect(screen.getByText('正在恢复项目工作区')).toBeInTheDocument();
    expect(screen.getByText('正在准备你的项目')).toBeInTheDocument();
    expect(applyThemeToDocument).toHaveBeenLastCalledWith(true);
    expect(screen.queryByTestId('landing-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-view')).not.toBeInTheDocument();
  });

  it('restores the resource library route instead of redirecting it to the project dashboard', () => {
    window.history.pushState({}, '', '/?resourceLibrary=1');
    render(<App />);
    expect(screen.getByTestId('landing-view')).toBeInTheDocument();
    expect(applyThemeToDocument).toHaveBeenLastCalledWith(true);
  });

  it('keeps the persisted dark theme on the landing page', () => {
    mockedActiveProjectId = null;
    mockedIsDark = true;

    render(<App />);

    expect(screen.getByTestId('landing-view')).toBeInTheDocument();
    expect(applyThemeToDocument).toHaveBeenLastCalledWith(true);
  });

  it('does not load protected dashboard data when no user is signed in', async () => {
    mockedAuthenticationStatus = 'anonymous';
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'access-token',
      expiresAt: Date.now() + 3600_000,
      user: { id: 'signed-out-user' },
    }));
    loadCurrentUser.mockResolvedValueOnce(null);

    render(<App />);

    expect(screen.getByTestId('landing-view')).toBeInTheDocument();
    await waitFor(() => expect(loadCurrentUser).toHaveBeenCalledTimes(1));
    expect(loadProjects).not.toHaveBeenCalled();
    expect(loadStatus).not.toHaveBeenCalled();
    expect(loadAgents).not.toHaveBeenCalled();
    expect(loadActivities).not.toHaveBeenCalled();
  });

  it('routes project changes without issuing transcript requests from the app shell', async () => {
    const { rerender } = render(<App />);
    expect(await screen.findByTestId('dashboard-view')).toHaveAttribute('data-project-id', 'proj_1');
    mockedActiveProjectId = 'proj_2';
    rerender(<App />);
    expect(screen.getByTestId('dashboard-view')).toHaveAttribute('data-project-id', 'proj_2');
    expect(getChatHistory).not.toHaveBeenCalled();
  });
});
