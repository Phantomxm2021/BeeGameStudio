import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

import App from './App';

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
const setAuthenticationStatus = vi.fn();
let mockedAuthenticationStatus: 'initializing' | 'authenticated' | 'anonymous' = 'authenticated';
let mockedIsDark = true;
const bootstrapProject = vi.fn().mockResolvedValue('proj_1');
const setToastCallbacks = vi.fn();
const loadHistory = vi.fn();
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
    loadProjects,
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
    loadCurrentUser,
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

vi.mock('./store/chatStore', () => ({
  useChatStore: Object.assign((selector?: (state: { loadHistory: typeof loadHistory; messages: never[] }) => unknown) => {
    const state = {
    loadHistory,
    messages: [],
    };
    return selector ? selector(state) : state;
  }, {
    getState: () => ({
      messages: [],
    }),
  }),
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

vi.mock('./utils/bootstrapIdea', () => ({
  buildBootstrapPayload: (idea: string) => ({ idea }),
}));

vi.mock('./components/Common/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./components/Demiurge/LandingView', () => ({
  LandingView: () => <div data-testid="landing-view" />,
}));

vi.mock('./components/Demiurge/DashboardView', () => ({
  DashboardView: () => <div data-testid="dashboard-view" />,
}));

describe('App view routing', () => {
  afterEach(() => {
    vi.useRealTimers();
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
    expect(applyThemeToDocument).toHaveBeenLastCalledWith(false);
  });

  it('keeps the landing page light when the persisted dashboard theme is dark', () => {
    mockedActiveProjectId = null;
    mockedIsDark = true;

    render(<App />);

    expect(screen.getByTestId('landing-view')).toBeInTheDocument();
    expect(applyThemeToDocument).toHaveBeenLastCalledWith(false);
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

  it('does not commit late chat history after switching projects', async () => {
    let resolveFirstHistory: (value: unknown) => void = () => undefined;
    getChatHistory.mockImplementation((projectId: string) => {
      if (projectId === 'proj_1') {
        return new Promise((resolve) => { resolveFirstHistory = resolve; });
      }
      return Promise.resolve([{ id: 'new-project-message' }]);
    });

    const { rerender } = render(<App />);
    await waitFor(() => expect(getChatHistory).toHaveBeenCalledWith('proj_1'));

    mockedActiveProjectId = 'proj_2';
    rerender(<App />);
    await waitFor(() => expect(loadHistory).toHaveBeenCalledWith([{ id: 'new-project-message' }]));

    await act(async () => {
      resolveFirstHistory([{ id: 'old-project-message' }]);
      await Promise.resolve();
    });

    expect(loadHistory).not.toHaveBeenCalledWith([{ id: 'old-project-message' }]);
  });
});
