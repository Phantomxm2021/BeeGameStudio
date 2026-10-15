import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardView } from './DashboardView';

const { loadRuntime, refreshCredits, taskEvent, system, project, i18n } = vi.hoisted(() => {
  const loadRuntime = vi.fn<(projectId: string) => Promise<void>>().mockResolvedValue(undefined);
  return {
    loadRuntime,
    refreshCredits: vi.fn().mockResolvedValue(undefined),
    taskEvent: { current: undefined as undefined | ((type: string) => void) },
    system: { authenticationStatus: 'authenticated', currentUser: { id: 'user-a' },
      isSyncing: false, isDark: false, hasPermission: () => true },
    project: { projects: [], pendingPermissions: [], projectStatus: { project_id: 'A', phase: 'idle' },
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
  return { isLoading: false, isStopping: false, wsState: 'connected' };
} }));
vi.mock('../../services/api', () => ({ api: { listProjectDeployments: vi.fn().mockResolvedValue([]) } }));
vi.mock('./BeeGameLivePreviewPage', () => ({ BeeGameLivePreviewPage: () => null }));
vi.mock('./RightSidebar', () => ({ RightSidebar: () => null }));

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
