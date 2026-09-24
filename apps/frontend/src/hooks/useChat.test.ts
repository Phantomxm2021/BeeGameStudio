import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let latestWebSocketOptions: {
  onMessage?: (message: any) => void;
  onOpen?: () => void | Promise<void>;
  onClose?: () => void;
} = {};
const { chatStoreState, useChatStoreMock, projectStoreState, useProjectStoreMock, systemStoreState } = vi.hoisted(() => {
  const state = {
    pendingPermissions: [] as any[],
    projectStatus: null as any,
    removePendingPermission: vi.fn(),
    upsertPendingPermission: vi.fn(),
    loadProjectStatus: vi.fn().mockResolvedValue(undefined),
    loadPendingPermissions: vi.fn().mockResolvedValue(undefined),
    loadProjectRuntimeState: vi.fn().mockResolvedValue(undefined),
  };
  const chatState = {
    addMessage: vi.fn(),
    updateMessage: vi.fn(),
    updateThought: vi.fn(),
    removeMessage: vi.fn(),
    finalizeMessage: vi.fn(),
    setCurrentSender: vi.fn(),
    setIsStreaming: vi.fn(),
    settleActivity: vi.fn(),
    loadHistory: vi.fn(),
    clearMessages: vi.fn(),
    messages: [] as any[],
  };
  const systemState = {
    updateTokenUsage: vi.fn(),
    updateLastP2PRoute: vi.fn(),
    loadTokenUsage: vi.fn().mockResolvedValue(undefined),
    loadCurrentUser: vi.fn().mockResolvedValue(null),
    authenticationStatus: 'authenticated' as const,
    setIsSyncing: vi.fn(),
  };
  const chatHook = Object.assign((selector?: (state: typeof chatState) => unknown) => selector ? selector(chatState) : chatState, {
    getState: () => chatState,
  });
  const projectHook = Object.assign(
    (selector: (state: typeof state) => unknown) => selector(state),
    {
      getState: () => state,
    },
  );
  return {
    chatStoreState: chatState,
    useChatStoreMock: chatHook,
    projectStoreState: state,
    useProjectStoreMock: projectHook,
    systemStoreState: systemState,
  };
});

vi.mock('./useProjectEventPolling', () => ({
  useProjectEventPolling: (options: { onMessage?: (message: any) => void }) => {
    latestWebSocketOptions = options;
    return {
      state: 'connected',
      reconnect: vi.fn(),
    };
  },
}));

vi.mock('../store/chatStore', () => ({
  useChatStore: useChatStoreMock,
}));

vi.mock('../store/projectStore', () => ({
  useProjectStore: useProjectStoreMock,
}));

vi.mock('../store/systemStore', () => ({
  useSystemStore: Object.assign(() => systemStoreState, {
    getState: () => systemStoreState,
  }),
}));

vi.mock('../services/api', () => ({
  api: {
    continueTask: vi.fn(),
    sendMessage: vi.fn(),
    stopTask: vi.fn(),
    resolveToolPermission: vi.fn(),
    getChatHistory: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../services/beeGameAdapter', () => ({
}));

vi.mock('../services/creditsApi', () => ({
  getCreditQuote: vi.fn().mockResolvedValue({
    taskType: 'edit_turn',
    balanceCredits: 300,
    canStart: true,
  }),
}));

import { api } from '../services/api';
import { useChat } from './useChat';
import { settleChatActivity } from '../utils/chatActivity';

describe('useChat clarification gate handling', () => {
  it('keeps detached child work busy after parent completion and queues a new send', async () => {
    const child = { id: 'child', sender: 'beegame', type: 'tool', taskId: 'parent-task',
      timestamp: 100, isSubagentTool: true, toolStatus: 'running' };
    chatStoreState.messages = [child];
    const { result, rerender } = renderHook(() => useChat({ projectId: 'p' }));
    act(() => latestWebSocketOptions.onMessage?.({ type: 'status', status: 'finished', task_id: 'parent-task' }));
    expect(result.current.isLoading).toBe(true);
    const calls = vi.mocked(api.sendMessage).mock.calls.length;
    vi.mocked(api.sendMessage).mockResolvedValueOnce({ task_id: 'parent-task', state: 'queued' } as never);
    await act(async () => { expect(await result.current.sendMessage('new request')).toBe(true); });
    expect(api.sendMessage).toHaveBeenCalledTimes(calls + 1);
    expect(chatStoreState.addMessage).not.toHaveBeenCalledWith(expect.objectContaining({ sender: 'user', content: 'new request' }));
    expect(chatStoreState.removeMessage).not.toHaveBeenCalled();
    await act(async () => { await result.current.continueTask(); });
    expect(api.continueTask).not.toHaveBeenCalled();
    chatStoreState.messages = [{ ...child, toolStatus: 'completed' }];
    rerender();
    expect(result.current.isLoading).toBe(true);
  });

  it.each(['stopped', 'failed'] as const)('retains live child task scope so %s unlocks the composer', async (status) => {
    const { result, rerender } = renderHook(() => useChat({ projectId: 'p' }));
    act(() => latestWebSocketOptions.onMessage?.({
      type: 'tool_start', task_id: 'parent', turn_id: 'turn',
      tool: 'Agent', tool_use_id: 'child', is_subagent_tool: true, timestamp: 100,
    }));
    const child = chatStoreState.addMessage.mock.calls.at(-1)?.[0];
    expect(child).toMatchObject({ taskId: 'parent', turnId: 'turn', toolStatus: 'running' });
    chatStoreState.messages = [child];
    rerender();
    expect(result.current.isLoading).toBe(true);
    act(() => latestWebSocketOptions.onMessage?.({
      type: 'status', task_id: 'parent', turn_id: 'turn', status, timestamp: 200,
    }));
    expect(chatStoreState.settleActivity).toHaveBeenLastCalledWith('parent', 'turn', status, 200);
    chatStoreState.messages = settleChatActivity(chatStoreState.messages,
      { taskId: 'parent', turnId: 'turn', reason: status, at: 200 });
    rerender();
    expect(result.current.isLoading).toBe(false);
  });

  beforeEach(() => {
    latestWebSocketOptions = {};
    projectStoreState.pendingPermissions = [];
    projectStoreState.projectStatus = null;
    projectStoreState.removePendingPermission.mockClear();
    projectStoreState.upsertPendingPermission.mockClear();
    projectStoreState.loadProjectStatus.mockClear();
    projectStoreState.loadPendingPermissions.mockClear();
    projectStoreState.loadProjectRuntimeState.mockReset();
    projectStoreState.loadProjectRuntimeState.mockResolvedValue(undefined);
    chatStoreState.messages = [];
    Object.values(chatStoreState).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) {
        value.mockClear();
      }
    });

    systemStoreState.tasks = [];
    Object.values(systemStoreState).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) {
        value.mockClear();
      }
    });
    Object.values(api).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) {
        value.mockClear();
      }
    });
  });

  it('worker terminals settle their activity without stopping the project composer', async () => {
    const onTaskComplete = vi.fn();
    const { result } = renderHook(() => useChat({ projectId: 'proj_1', onTaskComplete }));
    act(() => latestWebSocketOptions.onMessage?.({ type: 'status', status: 'running', task_id: 'main' }));
    expect(result.current.isLoading).toBe(true);
    for (const message of [
      { type: 'status', status: 'idle' },
      { type: 'status', status: 'stopped' },
      { type: 'error', content: 'Worker failed' },
    ]) {
      act(() => latestWebSocketOptions.onMessage?.({ ...message, task_id: 'worker',
        turnId: 'worker-turn', task_kind: 'workflow_stage:implementation', timestamp: 1234 }));
      expect(result.current.isLoading).toBe(true);
    }
    expect(chatStoreState.settleActivity).toHaveBeenCalledWith('worker', 'worker-turn', 'failed', 1234);
    expect(onTaskComplete).not.toHaveBeenCalled();
    act(() => latestWebSocketOptions.onMessage?.({ type: 'status', status: 'stopped', task_id: 'main' }));
    expect(result.current.isLoading).toBe(false);
  });

  it('coalesces duplicate stop requests while waiting for backend confirmation', async () => {
    let resolveStop: (() => void) | undefined;
    vi.mocked(api.stopTask).mockImplementationOnce(() => new Promise(resolve => {
      resolveStop = () => resolve({ state: 'stopped' } as any);
    }));
    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    let firstStop: Promise<void> | undefined;
    let secondStop: Promise<void> | undefined;
    act(() => {
      firstStop = result.current.stopTask();
      secondStop = result.current.stopTask();
    });

    expect(api.stopTask).toHaveBeenCalledTimes(1);
    expect(result.current.isStopping).toBe(true);

    await act(async () => {
      resolveStop?.();
      await Promise.all([firstStop, secondStop]);
    });

    expect(result.current.isStopping).toBe(false);
  });

  it('reports pending stop honestly and refreshes the authoritative state', async () => {
    vi.mocked(api.stopTask).mockResolvedValueOnce({ state: 'stop_requested' } as any);
    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));
    await act(async () => { await result.current.stopTask(); });
    expect(chatStoreState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: '停止请求已提交，正在等待执行退出或清理确认。',
    }));
    expect(chatStoreState.addMessage).not.toHaveBeenCalledWith(expect.objectContaining({ taskKind: 'task_stopped' }));
    expect(projectStoreState.loadProjectRuntimeState).toHaveBeenCalledWith('proj_1');
  });

  it('refreshes project state when a permission gate event arrives', async () => {
    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    act(() => {
      latestWebSocketOptions.onMessage?.({
        type: 'human_gate',
        gate: 'BEEGAME_PERMISSION',
        project_id: 'proj_1',
        message: 'Tool permission required',
      });
    });

    expect(result.current.canContinue).toBe(false);
    await waitFor(() => {
      expect(projectStoreState.loadProjectRuntimeState).toHaveBeenCalledWith('proj_1');
    });
  });

  it('opens and closes one redacted thinking status by stable message id', () => {
    renderHook(() => useChat({ projectId: 'proj_1' }));

    act(() => {
      latestWebSocketOptions.onMessage?.({
        type: 'think_start',
        task_id: 'task_1',
        sender: 'beegame',
        content: 'Thinking',
        message_id: 'thinking-turn-1',
        timestamp: 100,
      });
    });
    expect(chatStoreState.updateThought).toHaveBeenCalledWith(
      'task_1', '', 'beegame', 100, 'thinking-turn-1', undefined, 'snapshot', undefined,
    );

    act(() => {
      latestWebSocketOptions.onMessage?.({
        type: 'think_end',
        task_id: 'task_1',
        sender: 'beegame',
        message_id: 'thinking-turn-1',
      });
    });
    expect(chatStoreState.removeMessage).toHaveBeenCalledWith('thinking-turn-1');
  });

  it('keeps streamed thought content when think_end completes the activity', () => {
    renderHook(() => useChat({ projectId: 'proj_1' }));

    act(() => {
      latestWebSocketOptions.onMessage?.({
        type: 'think_start',
        task_id: 'task_1',
        sender: 'beegame',
        content: 'Thinking',
        message_id: 'thinking-turn-2',
        timestamp: 100,
        turnId: 'turn-2',
      });
    });
    chatStoreState.messages = [{
      id: 'thinking-turn-2',
      messageId: 'thinking-turn-2',
      sender: 'beegame',
      content: 'Thinking',
      thought: 'Checking the preview entry.',
      taskId: 'task_1',
      turnId: 'turn-2',
      type: 'thought',
      taskKind: 'assistant_thinking',
      timestamp: 101,
    }];

    act(() => {
      latestWebSocketOptions.onMessage?.({
        type: 'thought',
        task_id: 'task_1',
        sender: 'beegame',
        content: 'Checking the preview entry.',
        message_id: 'thinking-turn-2',
        timestamp: 101,
        turnId: 'turn-2',
      });
      latestWebSocketOptions.onMessage?.({
        type: 'think_end',
        task_id: 'task_1',
        sender: 'beegame',
        message_id: 'thinking-turn-2',
        turnId: 'turn-2',
        thinking_duration_ms: 2_130,
      });
    });

    expect(chatStoreState.removeMessage).not.toHaveBeenCalled();
    expect(chatStoreState.finalizeMessage).toHaveBeenLastCalledWith(
      'task_1', 'Thinking', 'beegame', 'thought', undefined, undefined, undefined,
      { taskKind: 'assistant_thinking', turnId: 'turn-2', thinkingDurationMs: 2_130 }, 101, 'thinking-turn-2',
    );
  });

  it('renders context updates as collapsed chat-visible system evidence', () => {
    const onTaskEvent = vi.fn();
    renderHook(() => useChat({ projectId: 'proj_1', onTaskEvent }));

    act(() => {
      latestWebSocketOptions.onMessage?.({
        type: 'context_update',
        task_id: 'pipe_1',
        project_id: 'proj_1',
        context: {
          bundle_id: 'ctx_1',
          phase: 'gdd',
          status: 'ready',
          blackboard_record_count: 1,
          memory_hits: 2,
          rag_sources: ['docs/SystemDesign/05.md'],
          selected_skills: ['gdd_contract'],
        },
      });
    });

    expect(chatStoreState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'system',
      type: 'system_status',
      taskKind: 'context_update',
      content: expect.stringContaining('Context used'),
    }));
    expect(onTaskEvent).toHaveBeenCalledWith('context_update', expect.any(Object));
  });

  it('uses artifact producer metadata for artifact cards', () => {
    renderHook(() => useChat({ projectId: 'proj_1' }));

    act(() => {
      latestWebSocketOptions.onMessage?.({
        type: 'artifact_created',
        task_id: 'pipe_1',
        project_id: 'proj_1',
        artifact_id: 'art_1',
        artifact_type: 'gdd',
        name: 'GDD.md',
        agent: 'metis',
      });
    });

    expect(chatStoreState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'metis',
      type: 'artifact_card',
      artifactId: 'art_1',
      artifactType: 'gdd',
      documentTitle: 'GDD.md',
      taskKind: 'artifact_created',
    }));
  });

  it('uses BeeGame usage events without issuing a duplicate token request', async () => {
    const onTaskEvent = vi.fn();
    renderHook(() => useChat({ projectId: 'proj_1', onTaskEvent }));

    await act(async () => {
      latestWebSocketOptions.onMessage?.({
        type: 'usage',
        task_id: 'pipe_1',
        project_id: 'proj_1',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 30,
          total_tokens: 130,
        },
      });
    });

    expect(systemStoreState.updateTokenUsage).toHaveBeenCalledWith(
      { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
      'proj_1',
      'pipe_1',
    );
    expect(systemStoreState.loadTokenUsage).not.toHaveBeenCalled();
    expect(onTaskEvent).toHaveBeenCalledWith('usage', { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 });
  });

  it('restores loading state when reconnect sync finds an already running BeeGame project status', async () => {
    projectStoreState.loadProjectRuntimeState.mockImplementation(async () => {
      projectStoreState.projectStatus = {
        project_id: 'proj_1',
        phase: 'running',
        blocked: false,
        active_agents: ['beegame'],
        updated_at: '2026-07-05T00:00:00.000Z',
        next_action: 'BeeGame is building',
        workflow: {
          runId: 'run_reconnected',
          status: 'running',
          currentPhase: 'IMPLEMENTATION',
        },
      };
    });

    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    await act(async () => {
      await latestWebSocketOptions.onOpen?.();
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
    });
    expect(result.current.currentTaskId).toBe('proj_1');
  });

  it.each(['completed', 'failed', 'stopped', undefined])('locks a running native follow-up with workflow=%s, and unlocks on confirmed idle', async (status) => {
    projectStoreState.projectStatus = { project_id: 'proj_1', phase: 'running',
      workflow: status ? { status } : undefined };
    const { result, rerender } = renderHook(() => useChat({ projectId: 'proj_1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    vi.mocked(api.sendMessage).mockResolvedValueOnce({ task_id: 'proj_1', state: 'queued' } as never);
    await act(async () => { expect(await result.current.sendMessage('another request')).toBe(true); });
    act(() => latestWebSocketOptions.onClose?.());
    expect(result.current.isLoading).toBe(true);
    projectStoreState.projectStatus = { ...projectStoreState.projectStatus, phase: 'idle' };
    rerender();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('does not flash a sent user bubble while a running turn queues input', async () => {
    projectStoreState.projectStatus = { project_id: 'proj_1', phase: 'running' };
    let resolveSend!: (response: unknown) => void;
    vi.mocked(api.sendMessage).mockImplementationOnce(() => new Promise(resolve => { resolveSend = resolve; }) as never);
    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    let send!: Promise<boolean>;
    await act(async () => { send = result.current.sendMessage('Queue this'); });
    expect(chatStoreState.addMessage).not.toHaveBeenCalledWith(expect.objectContaining({ sender: 'user', content: 'Queue this' }));
    await act(async () => { resolveSend({ task_id: 'proj_1', state: 'queued' }); await send; });
    expect(chatStoreState.addMessage).not.toHaveBeenCalledWith(expect.objectContaining({ sender: 'user', content: 'Queue this' }));
  });

  it('does not carry an active turn lock into another project', async () => {
    projectStoreState.projectStatus = {
      project_id: 'proj_1',
      phase: 'running',
      blocked: false,
      workflow: {
        runId: 'run_project_1',
        status: 'running',
      },
    };
    const { result, rerender } = renderHook(
      ({ projectId }) => useChat({ projectId }),
      { initialProps: { projectId: 'proj_1' } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(result.current.currentTaskId).toBe('proj_1');

    projectStoreState.projectStatus = null;
    rerender({ projectId: 'proj_2' });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.currentTaskId).toBeNull();
  });

  it('unlocks an interrupted turn when the recovered runtime is paused', async () => {
    projectStoreState.projectStatus = {
      project_id: 'proj_1',
      phase: 'running',
      blocked: false,
      workflow: {
        runId: 'run_interrupted',
        status: 'running',
      },
    };
    const { result, rerender } = renderHook(() => useChat({ projectId: 'proj_1' }));

    await waitFor(() => expect(result.current.isLoading).toBe(true));

    projectStoreState.projectStatus = {
      project_id: 'proj_1',
      phase: 'paused',
      blocked: true,
      blocked_reason: 'Previous turn was interrupted.',
      workflow: {
        runId: 'run_interrupted',
        status: 'failed',
        blockedReason: 'Previous turn was interrupted.',
      },
    };
    rerender();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.currentTaskId).toBeNull();
  });

  it('keeps the composer locked across intermediate assistant messages and transport reconnects', async () => {
    projectStoreState.projectStatus = {
      project_id: 'proj_1',
      phase: 'running',
      blocked: false,
      workflow: {
        runId: 'run_transport_reconnect',
        status: 'running',
      },
    };
    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    await waitFor(() => expect(result.current.isLoading).toBe(true));

    act(() => {
      latestWebSocketOptions.onMessage?.({
        type: 'agent_message',
        task_id: 'turn_1',
        message_id: 'assistant_intermediate',
        project_id: 'proj_1',
        sender: 'agent',
        content: 'I am continuing with the implementation.',
      });
      latestWebSocketOptions.onClose?.();
    });

    expect(result.current.isLoading).toBe(true);
  });

  it('does not trigger project-wide polling for every tool-start event', async () => {
    const onTaskEvent = vi.fn();
    renderHook(() => useChat({ projectId: 'proj_1', onTaskEvent }));

    await act(async () => {
      latestWebSocketOptions.onMessage?.({
        type: 'tool_start',
        task_id: 'beegame_1',
        project_id: 'proj_1',
        tool: 'Bash',
        tool_use_id: 'tool_1',
        message_id: 'tool-start-1',
        timestamp: Date.now(),
      });
    });

    expect(chatStoreState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'tool-start-1',
      taskId: 'beegame_1',
      type: 'tool',
      taskKind: 'tool_execution',
    }));
    expect(onTaskEvent).toHaveBeenCalledWith('tool_start', expect.any(Object));
    expect(projectStoreState.loadProjectStatus).not.toHaveBeenCalled();
    expect(projectStoreState.loadPendingPermissions).not.toHaveBeenCalled();
  });

  it('stores structured tool card metadata from tool events', async () => {
    renderHook(() => useChat({ projectId: 'proj_1' }));

    await act(async () => {
      latestWebSocketOptions.onMessage?.({
        type: 'tool_end',
        task_id: 'beegame_1',
        project_id: 'proj_1',
        tool: 'Bash',
        tool_use_id: 'tool_1',
        message_id: 'tool-card-1',
        tool_status: 'completed',
        tool_detail: 'Command: game-engine build',
        tool_output: 'Build passed',
        tool_diff: '--- a/src/StartScreen.tsx\n+++ b/src/StartScreen.tsx\n@@\n-old\n+new',
        structured_patch: { files: ['src/StartScreen.tsx'] },
        tool_input: { file_path: 'src/StartScreen.tsx', content: 'new' },
        is_subagent_tool: false,
        timestamp: Date.now(),
      });
    });

    expect(chatStoreState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'tool-card-1',
      messageId: 'tool-card-1',
      taskId: 'beegame_1',
      type: 'tool',
      taskKind: 'tool_execution',
      toolName: 'Bash',
      toolStatus: 'completed',
      toolDetail: 'Command: game-engine build',
      toolOutput: 'Build passed',
      toolDiff: '--- a/src/StartScreen.tsx\n+++ b/src/StartScreen.tsx\n@@\n-old\n+new',
      toolStructuredPatch: { files: ['src/StartScreen.tsx'] },
      toolInput: { file_path: 'src/StartScreen.tsx', content: 'new' },
      isSubagentTool: false,
    }));
  });

  it('renders paused workflow status as a chat-visible alert', () => {
    const onTaskEvent = vi.fn();
    renderHook(() => useChat({ projectId: 'proj_1', onTaskEvent }));

    act(() => {
      latestWebSocketOptions.onMessage?.({
        type: 'status',
        status: 'paused',
        task_id: 'beegame_1',
        project_id: 'proj_1',
        content: 'BeeGame paused build: traceability evidence is incomplete',
        timestamp: 1710000000000,
      });
    });

    expect(chatStoreState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringContaining('status-paused-beegame_1'),
      sender: 'system',
      type: 'system_status',
      taskKind: 'workflow_paused',
      canContinue: true,
      content: 'BeeGame paused build: traceability evidence is incomplete',
    }));
    expect(onTaskEvent).toHaveBeenCalledWith('status_failed', expect.any(Object));
  });

  it('blocks sendMessage while waiting for a tool permission decision', async () => {
    projectStoreState.projectStatus = {
      project_id: 'proj_1',
      phase: 'IMPLEMENTATION',
      blocked: false,
    };
    projectStoreState.pendingPermissions = [{
      gate_id: 'permission-1',
      type: 'BEEGAME_PERMISSION',
    }];
    const onError = vi.fn();
    const { result } = renderHook(() => useChat({ projectId: 'proj_1', onError }));

    let accepted = true;
    await act(async () => {
      accepted = await result.current.sendMessage('please continue');
    });

    expect(accepted).toBe(false);
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(chatStoreState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'system',
      content: 'BeeGame 正在等待工具权限决定。',
      type: 'error',
    }));
  });

  it('refreshes REST state after sendMessage even when WebSocket is already connected', async () => {
    vi.mocked(api.sendMessage).mockResolvedValue({
      task_id: 'task_1',
      command_id: 'task_1',
      state: 'running',
    } as any);

    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    let accepted = false;
    await act(async () => {
      accepted = await result.current.sendMessage('continue from paused state');
    });

    expect(accepted).toBe(true);
    expect(api.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: 'continue from paused state',
      project_id: 'proj_1',
    }));
    await waitFor(() => {
      expect(projectStoreState.loadProjectRuntimeState).toHaveBeenCalledWith('proj_1');
      expect(api.getChatHistory).toHaveBeenCalledWith('proj_1');
    });
    expect(systemStoreState.loadTokenUsage).not.toHaveBeenCalled();
  });

  it('records the source message when sending an edited draft', async () => {
    vi.mocked(api.sendMessage).mockResolvedValue({
      task_id: 'task_edited',
      command_id: 'task_edited',
      state: 'running',
    } as any);

    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    await act(async () => {
      await result.current.sendMessage('updated request', undefined, undefined, 'msg_original');
    });

    expect(api.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: 'updated request',
      supersedes_message_id: 'msg_original',
    }));
  });

  it('does not report an accepted edit as failed when only the history refresh fails', async () => {
    vi.mocked(api.sendMessage).mockResolvedValueOnce({ task_id: 'task_edited', state: 'running' } as any);
    const showToastError = vi.fn();
    const { result } = renderHook(() => useChat({ projectId: 'proj_1', showToastError }));
    vi.mocked(api.getChatHistory).mockRejectedValueOnce(new Error('temporary history outage'));
    let accepted = false;
    await act(async () => {
      accepted = await result.current.sendMessage('replacement', undefined, undefined, 'original');
    });
    expect(accepted).toBe(true);
    expect(showToastError).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores a late send response after the chat hook unmounts', async () => {
    let resolveSend: ((value: unknown) => void) | undefined;
    vi.mocked(api.sendMessage).mockImplementationOnce(
      () => new Promise(resolve => {
        resolveSend = resolve;
      }),
    );
    const { result, unmount } = renderHook(() => useChat({ projectId: 'proj_1' }));

    let sendPromise: Promise<boolean> | undefined;
    act(() => {
      sendPromise = result.current.sendMessage('late response');
    });
    unmount();
    resolveSend?.({ task_id: 'late-task', command_id: 'late-task', state: 'running' });

    let accepted = true;
    await act(async () => {
      accepted = await sendPromise!;
    });

    expect(accepted).toBe(false);
    expect(chatStoreState.addMessage).toHaveBeenCalledTimes(1);
    expect(chatStoreState.addMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'late response' }));
    expect(projectStoreState.loadProjectRuntimeState).not.toHaveBeenCalled();
    expect(api.getChatHistory).not.toHaveBeenCalled();
  });

  it('surfaces backend send failures in chat and toast', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const showToastError = vi.fn();
    const onError = vi.fn();
    vi.mocked(api.sendMessage).mockRejectedValue(new Error('Credit 不足。本次请求需要预扣 50 credits，你当前有 0 credits。'));
    const { result } = renderHook(() => useChat({ projectId: 'proj_1', onError, showToastError }));

    let accepted = true;
    await act(async () => {
      accepted = await result.current.sendMessage('fix the issue');
    });

    expect(accepted).toBe(false);
    expect(chatStoreState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'system',
      content: 'Credit 不足。本次请求需要预扣 50 credits，你当前有 0 credits。',
      type: 'error',
    }));
    expect(showToastError).toHaveBeenCalledWith('Credit 不足。本次请求需要预扣 50 credits，你当前有 0 credits。');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Credit 不足。本次请求需要预扣 50 credits，你当前有 0 credits。',
    }));
    expect(errorLog).toHaveBeenCalledWith('[useChat] Failed to send message:', expect.any(Error));
    errorLog.mockRestore();
  });

  it('resynchronizes after reconnect without replaying a failed mutating request', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(api.sendMessage).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    await act(async () => {
      await result.current.sendMessage('do this once');
    });
    expect(api.sendMessage).toHaveBeenCalledTimes(1);

    vi.mocked(api.sendMessage).mockResolvedValue({
      task_id: 'unexpected-replay',
      command_id: 'unexpected-replay',
      state: 'running',
    } as any);
    await act(async () => {
      await latestWebSocketOptions.onOpen?.();
    });

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.getChatHistory).toHaveBeenCalledWith('proj_1');
    expect(errorLog).toHaveBeenCalledWith('[useChat] Failed to send message:', expect.any(TypeError));
    errorLog.mockRestore();
  });

  it('surfaces runtime error events as toast notifications', () => {
    const showToastError = vi.fn();
    renderHook(() => useChat({ projectId: 'proj_1', showToastError }));

    act(() => {
      latestWebSocketOptions.onMessage?.({
        type: 'error',
        task_id: 'task_1',
        project_id: 'proj_1',
        content: 'Credit 不足。本次请求需要预扣 50 credits，你当前有 0 credits。',
      });
    });

    expect(chatStoreState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'system',
      content: 'Credit 不足。本次请求需要预扣 50 credits，你当前有 0 credits。',
      type: 'error',
    }));
    expect(showToastError).toHaveBeenCalledWith('Credit 不足。本次请求需要预扣 50 credits，你当前有 0 credits。');
  });

  it('refreshes REST state after continueTask even when WebSocket is already connected', async () => {
    vi.mocked(api.continueTask).mockResolvedValue({
      resume_task_id: 'task_1',
      command_id: 'task_1',
      resume_mode: 'resume',
      state: 'resuming',
    } as any);

    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    await act(async () => {
      await result.current.continueTask();
    });

    expect(api.continueTask).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'proj_1',
    }));
    await waitFor(() => {
      expect(projectStoreState.loadProjectRuntimeState).toHaveBeenCalledWith('proj_1');
      expect(api.getChatHistory).toHaveBeenCalledWith('proj_1');
    });
    expect(systemStoreState.loadTokenUsage).not.toHaveBeenCalled();
  });

  it('removes the pending permission immediately after a successful decision', async () => {
    projectStoreState.pendingPermissions = [
      {
        gate_id: 'gate_approval',
        type: 'BEEGAME_PERMISSION',
      },
    ];
    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    await act(async () => {
      await result.current.resolveToolPermission({
        gate_id: 'gate_approval',
      }, 'allow');
    });

    expect(api.resolveToolPermission).toHaveBeenCalledWith({
      project_id: 'proj_1',
      gate_id: 'gate_approval',
      decision: 'allow',
      scope: 'once',
    });
    expect(projectStoreState.removePendingPermission).toHaveBeenCalledWith('gate_approval');
    expect(projectStoreState.loadProjectRuntimeState).toHaveBeenCalledWith('proj_1');
    expect(projectStoreState.upsertPendingPermission).not.toHaveBeenCalled();
    expect(result.current.permissionState).toEqual({
      gateId: null,
      action: null,
      phase: 'idle',
      message: '',
    });
  });

  it('restores the pending permission when resolution fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const review = {
      gate_id: 'gate_approval',
      type: 'BEEGAME_PERMISSION',
    };
    projectStoreState.pendingPermissions = [review];
    vi.mocked(api.resolveToolPermission).mockRejectedValueOnce(new Error('permission failed'));
    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    await act(async () => {
      await result.current.resolveToolPermission(review as any);
    });

    expect(projectStoreState.removePendingPermission).not.toHaveBeenCalled();
    expect(projectStoreState.upsertPendingPermission).toHaveBeenCalledWith(review);
    expect(result.current.permissionState.phase).toBe('failed');
    expect(errorLog).toHaveBeenCalledWith('[useChat] Failed to resolve tool permission:', expect.any(Error));
    errorLog.mockRestore();
  });

  it('removes an expired permission instead of restoring its card', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const review = { gate_id: 'expired-gate', type: 'BEEGAME_PERMISSION' };
    projectStoreState.pendingPermissions = [review];
    vi.mocked(api.resolveToolPermission).mockRejectedValueOnce(Object.assign(
      new Error('This request is no longer pending.'), { code: 'permission_not_pending' },
    ));
    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    await act(async () => {
      await result.current.resolveToolPermission(review as any);
    });

    expect(projectStoreState.removePendingPermission).toHaveBeenCalledWith('expired-gate');
    expect(projectStoreState.upsertPendingPermission).not.toHaveBeenCalled();
    expect(projectStoreState.loadProjectRuntimeState).toHaveBeenCalledWith('proj_1');
    expect(result.current.permissionState.phase).toBe('idle');
    errorLog.mockRestore();
  });

  it('forwards question answers without creating a second chat message', async () => {
    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));
    const answers = { 'Which style?': 'Pixel' };
    await act(async () => {
      await result.current.resolveToolPermission({ gate_id: 'question' }, 'allow', 'once', answers);
    });
    expect(api.resolveToolPermission).toHaveBeenCalledWith({
      project_id: 'proj_1', gate_id: 'question', decision: 'allow', scope: 'once', answers,
    });
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});
