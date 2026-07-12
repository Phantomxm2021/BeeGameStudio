import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import App from './App';

const loadProjects = vi.fn().mockResolvedValue(undefined);
const loadStatus = vi.fn().mockResolvedValue(undefined);
const loadAgents = vi.fn().mockResolvedValue(undefined);
const loadActivities = vi.fn().mockResolvedValue(undefined);
const loadCurrentUser = vi.fn().mockResolvedValue({
  id: 'owner-user',
  role: 'owner',
  permissions: ['project.read'],
});
const bootstrapProject = vi.fn().mockResolvedValue('proj_1');
const setToastCallbacks = vi.fn();
const loadHistory = vi.fn();

vi.mock('./store/projectStore', () => ({
  useProjectStore: () => ({
    loadProjects,
    projects: [{ id: 'proj_1', name: 'Project One', created_at: Date.now() }],
    activeProjectId: 'proj_1',
    bootstrapProject,
    setToastCallbacks,
  }),
}));

vi.mock('./store/systemStore', () => ({
  useSystemStore: () => ({
    loadStatus,
    loadAgents,
    loadActivities,
    loadCurrentUser,
    isDark: false,
    toggleTheme: vi.fn(),
    status: { capabilities: {} },
  }),
}));

vi.mock('./store/chatStore', () => ({
  useChatStore: Object.assign(() => ({
    loadHistory,
    messages: [],
  }), {
    getState: () => ({
      messages: [],
    }),
  }),
}));

vi.mock('./contexts/ToastContext', () => ({
  useToastContext: () => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
  }),
}));

vi.mock('./services/api', () => ({
  api: {
    getChatHistory: vi.fn().mockResolvedValue([]),
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
    localStorage.clear();
    vi.clearAllMocks();
    loadCurrentUser.mockResolvedValue({
      id: 'owner-user',
      role: 'owner',
      permissions: ['project.read'],
    });
    window.history.pushState({}, '', '/');
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
  });

  it('restores the resource library route instead of redirecting it to the project dashboard', () => {
    window.history.pushState({}, '', '/?resourceLibrary=1');
    render(<App />);
    expect(screen.getByTestId('landing-view')).toBeInTheDocument();
  });

  it('does not load protected dashboard data when no user is signed in', async () => {
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'access-token',
      expiresAt: Date.now() + 3600_000,
      user: { id: 'signed-out-user' },
    }));
    loadCurrentUser.mockResolvedValueOnce(null);

    render(<App />);

    expect(screen.getByTestId('dashboard-view')).toBeInTheDocument();
    await waitFor(() => expect(loadCurrentUser).toHaveBeenCalledTimes(1));
    expect(loadProjects).not.toHaveBeenCalled();
    expect(loadStatus).not.toHaveBeenCalled();
    expect(loadAgents).not.toHaveBeenCalled();
    expect(loadActivities).not.toHaveBeenCalled();
  });
});
