import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DashboardView } from './DashboardView';
import { useChatStore } from '../../store/chatStore';
import type { ReactNode } from 'react';
import type { Message } from '../../types/message';

const { loadRuntime, refreshCredits, taskEvent, system, project, i18n, chat, preview, deploymentApi, showError } = vi.hoisted(() => {
  const loadRuntime = vi.fn<(projectId: string) => Promise<void>>().mockResolvedValue(undefined);
  return {
    loadRuntime,
    showError: vi.fn(),
    deploymentApi: { listProjectDeployments: vi.fn().mockResolvedValue([]), deployProject: vi.fn() },
    chat: { sessionTokenUsage: undefined as undefined | { prompt_tokens: number; completion_tokens: number; cache_read_tokens?: number; total_tokens: number } },
    preview: vi.fn((props: Record<string, unknown>) => props.collaboration as ReactNode),
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
vi.mock('../../contexts/ToastContext', () => ({ useToastContext: () => ({ showWarning: vi.fn(), showError, showSuccess: vi.fn() }) }));
vi.mock('../../hooks/useCredits', () => ({ useCredits: () => ({ creditBalance: null, creditSummary: null, refreshCredits }) }));
vi.mock('../../hooks/useChat', () => ({ useChat: (options: { onTaskEvent: (type: string) => void }) => {
  taskEvent.current = options.onTaskEvent;
  return { isLoading: false, isStopping: false, wsState: 'connected', ...chat };
} }));
vi.mock('../../services/api', () => ({ api: deploymentApi }));
vi.mock('./BeeGameLivePreviewPage', () => ({ BeeGameLivePreviewPage: preview }));
vi.mock('./RightSidebar', () => ({ RightSidebar: ({ messages }: { messages: Message[] }) => <div data-testid="chat-content">{messages.at(-1)?.content}</div> }));

beforeEach(() => {
  useChatStore.setState({ messages: [] });
  loadRuntime.mockClear(); refreshCredits.mockClear(); preview.mockClear(); showError.mockClear();
  deploymentApi.listProjectDeployments.mockReset().mockResolvedValue([]);
  deploymentApi.deployProject.mockReset();
  project.projectStatus = { project_id: 'A', phase: 'idle', context: undefined };
  chat.sessionTokenUsage = undefined;
  system.isSyncing = false;
  project.isOpeningProject = false;
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

// Visibility changes reconnect the event transport and synchronize the session.
// A loaded project's publication must remain available during that read.
it('keeps publishing available during background sync but retains project and execution locks', async () => {
  const { rerender, unmount } = render(<DashboardView projectId="A" projectName="test" lang="en" onSetLang={vi.fn()} />);
  await act(async () => {});
  expect(preview.mock.lastCall?.[0].onDeployProject).toBeTypeOf('function');
  system.isSyncing = true;
  const refresh = () => rerender(<DashboardView projectId="A" projectName="test" lang="en" onSetLang={vi.fn()} />);
  refresh();
  expect(preview.mock.lastCall?.[0]).toMatchObject({ isSyncing: true, isInteractionLocked: false, isWorkspaceBusy: false });
  expect(preview.mock.lastCall?.[0].onDeployProject).toBeTypeOf('function');
  project.isOpeningProject = true;
  refresh();
  expect(preview.mock.lastCall?.[0].onDeployProject).toBeUndefined();
  project.isOpeningProject = false;
  project.projectStatus = { project_id: 'other', phase: 'idle', context: undefined };
  refresh();
  expect(preview.mock.lastCall?.[0].onDeployProject).toBeUndefined();
  project.projectStatus = { project_id: 'A', phase: 'running', context: undefined };
  refresh();
  expect(preview.mock.lastCall?.[0].onDeployProject).toBeUndefined();
  unmount();
});

it('reports a background publication failure through the global notification', async () => {
  vi.useFakeTimers();
  const queued = { id: 'publication', status: 'queued', createdAt: '', updatedAt: '' };
  deploymentApi.deployProject.mockResolvedValue(queued);
  const { unmount } = render(<DashboardView projectId="A" projectName="test" lang="en" onSetLang={vi.fn()} />);
  await act(async () => {});
  deploymentApi.listProjectDeployments.mockResolvedValue([queued]);
  await act(async () => { await (preview.mock.lastCall?.[0].onDeployProject as () => Promise<void>)(); });
  expect(preview.mock.lastCall?.[0].isDeploying).toBe(true);
  deploymentApi.listProjectDeployments.mockResolvedValue([{ ...queued, status: 'failed', message: 'Publication build failed: fixture' }]);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(showError).toHaveBeenCalledExactlyOnceWith('Publication build failed: fixture');
  expect(preview.mock.lastCall?.[0].isDeploying).toBe(false);
  unmount();
});

it('updates streamed chat without rerendering the workbench, but propagates terminal status', async () => {
  const view = render(<DashboardView projectId="A" projectName="test" lang="en" onSetLang={vi.fn()} />);
  await act(async () => {});
  const renders = preview.mock.calls.length;
  act(() => useChatStore.setState({ messages: [{ id: 'stream', sender: 'assistant', content: 'one' } as Message] }));
  expect(view.getByTestId('chat-content').textContent).toBe('one');
  act(() => useChatStore.setState(state => ({ messages: [{ ...state.messages[0], content: 'one two' }] })));
  expect(view.getByTestId('chat-content').textContent).toBe('one two');
  expect(preview.mock.calls.length).toBe(renders);
  act(() => useChatStore.setState(state => ({ messages: [...state.messages, { id: 'done', sender: 'system', content: 'finished' } as Message] })));
  expect(preview.mock.calls.length).toBeGreaterThan(renders);
  view.unmount();
});

it('pauses deployment polling while hidden and resumes without overlapping requests', async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const queued = { id: 'publication', status: 'queued', createdAt: '', updatedAt: '' };
  deploymentApi.deployProject.mockResolvedValue(queued);
  const view = render(<DashboardView projectId="A" projectName="test" lang="en" onSetLang={vi.fn()} />);
  await act(async () => {});
  deploymentApi.listProjectDeployments.mockResolvedValue([queued]);
  await act(async () => { await (preview.mock.lastCall?.[0].onDeployProject as () => Promise<void>)(); });
  deploymentApi.listProjectDeployments.mockClear();
  hidden.mockReturnValue(true);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(deploymentApi.listProjectDeployments).not.toHaveBeenCalled();
  let resolve!: (value: unknown[]) => void;
  deploymentApi.listProjectDeployments.mockImplementation(() => new Promise(yes => { resolve = yes; }));
  hidden.mockReturnValue(false);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(deploymentApi.listProjectDeployments).toHaveBeenCalledTimes(1);
  hidden.mockReturnValue(true);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  hidden.mockReturnValue(false);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(deploymentApi.listProjectDeployments).toHaveBeenCalledTimes(1);
  await act(async () => resolve([queued]));
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(deploymentApi.listProjectDeployments).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => resolve([queued]));
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(deploymentApi.listProjectDeployments).toHaveBeenCalledTimes(2);
});
