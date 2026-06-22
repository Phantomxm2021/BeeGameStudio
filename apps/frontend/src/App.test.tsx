import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import App from './App';

const loadProjects = vi.fn().mockResolvedValue(undefined);
const loadStatus = vi.fn().mockResolvedValue(undefined);
const loadAgents = vi.fn().mockResolvedValue(undefined);
const loadActivities = vi.fn().mockResolvedValue(undefined);
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
    isDark: false,
    toggleTheme: vi.fn(),
    status: {
      capabilities: {
        operator_controls_enabled: true,
      },
    },
  }),
}));

vi.mock('./store/chatStore', () => ({
  useChatStore: () => ({
    loadHistory,
    messages: [],
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
    vi.clearAllMocks();
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
});
