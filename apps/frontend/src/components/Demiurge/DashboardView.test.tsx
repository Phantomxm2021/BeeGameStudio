import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DashboardView } from './DashboardView';

const { loadRuntime, refreshCredits, taskEvent, system, project, i18n, chat, preview } = vi.hoisted(() => {
  const loadRuntime = vi.fn<(projectId: string) => Promise<void>>().mockResolvedValue(undefined);
  return {
    loadRuntime,
    chat: { sessionTokenUsage: undefined as undefined | { prompt_tokens: number; completion_tokens: number; cache_read_tokens?: number; total_tokens: number } },
    preview: vi.fn((_props: Record<string, unknown>) => null),
    refreshCredits: vi.fn().mockResolvedValue(undefined),
    taskEvent: { current: undefined as undefined | ((type: string) => void) },
    system: { authenticationStatus: 'authenticated', currentUser: { id: 'user-a' },
      isSyncing: false, isDark: false, hasPermission: () => true },
    project: { projects: [], pendingPermissions: [], projectStatus: { project_id: 'A', phase: 'idle', context: undefined as undefined | { token_budget: Record<string, number | boolean> } },
      isOpeningProject: false, loadProjectRuntimeState: loadRuntime },
    i18n: { getFixedT: () => (key: string) => key },
  };
});

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n }) }));
vi.mock('../../store/systemStore', () => ({ useSystemStore: (select: (state: typeof system) => unknown) => select(system) }));
vi.mock('../../store/projectStore', () => ({ useProjectStore: (select: (state: typeof project) => unknown) => select(project) }));
vi.mock('../../store/chatStore', () => ({ useChatStore: () => ({ messages: [] }) }));
vi.mock('../../contexts/ToastContext', () => ({ useToastContext: () => ({ showWarning: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }) }));
vi.mock('../../hooks/useCredits', () => ({ useCredits: () => ({ creditBalance: null, creditSummary: null, refreshCredits }) }));
vi.mock('../../hooks/useChat', () => ({ useChat: (options: { onTaskEvent: (type: string) => void }) => {
  taskEvent.current = options.onTaskEvent;
  return { isLoading: false, isStopping: false, wsState: 'connected', ...chat };
} }));
vi.mock('../../services/api', () => ({ api: { listProjectDeployments: vi.fn().mockResolvedValue([]) } }));
vi.mock('./BeeGameLivePreviewPage', () => ({ BeeGameLivePreviewPage: preview }));
vi.mock('./RightSidebar', () => ({ RightSidebar: () => null }));

beforeEach(() => {
  loadRuntime.mockClear(); refreshCredits.mockClear(); preview.mockClear();
  project.projectStatus = { project_id: 'A', phase: 'idle', context: undefined };
  chat.sessionTokenUsage = undefined;
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('routes runtime events to the scheduler and billing events to credits without locale-driven runtime reads', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const { container, rerender, unmount } = render(<DashboardView projectId="A" projectName="test" lang="en" onSetLang={vi.fn()} />);
  const page = container.firstElementChild;
  expect(page).toHaveClass('page-enter');
  await act(async () => {});
  expect(loadRuntime).toHaveBeenCalledExactlyOnceWith('A');
  rerender(<DashboardView projectId="A" projectName="test" lang="zh" onSetLang={vi.fn()} />);
  expect(container.firstElementChild).toBe(page);
  act(() => { taskEvent.current?.('billing_update'); taskEvent.current?.('usage'); });
  expect(refreshCredits).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(loadRuntime).toHaveBeenCalledTimes(2);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('shows received session tokens immediately while runtime and billing snapshots remain stale', async () => {
  const { rerender, unmount } = render(<DashboardView projectId="A" projectName="test" lang="en" onSetLang={vi.fn()} />);
  await act(async () => {});
  expect(preview.mock.lastCall?.[0].tokenUsage).toBeNull();
  project.projectStatus = { project_id: 'A', phase: 'running', context: { token_budget: { input_tokens: 20, output_tokens: 1, total_tokens: 21 } } };
  chat.sessionTokenUsage = { prompt_tokens: 120, completion_tokens: 30, cache_read_tokens: 400, total_tokens: 550 };
  rerender(<DashboardView projectId="A" projectName="test" lang="en" onSetLang={vi.fn()} />);
  expect(preview.mock.lastCall?.[0]).toMatchObject({ tokenUsage: chat.sessionTokenUsage, tokenUsageScope: 'session' });
  chat.sessionTokenUsage = { ...chat.sessionTokenUsage, prompt_tokens: 150, total_tokens: 580 };
  rerender(<DashboardView projectId="A" projectName="test" lang="en" onSetLang={vi.fn()} />);
  expect(preview.mock.lastCall?.[0].tokenUsage).toEqual(chat.sessionTokenUsage);
  unmount();
  chat.sessionTokenUsage = undefined;
});

it('restores the incomplete usage notice from runtime history without a new live event', async () => {
  project.projectStatus = { project_id: 'A', phase: 'idle', context: { token_budget: {
    input_tokens: 0, output_tokens: 0, total_tokens: 0, providerUsageIncomplete: true,
  } } };
  const { unmount } = render(<DashboardView projectId="A" projectName="test" lang="zh" onSetLang={vi.fn()} />);
  await act(async () => {});
  expect(preview.mock.lastCall?.[0].tokenUsage).toMatchObject({ total_tokens: 0, providerUsageIncomplete: true });
  unmount();
});
