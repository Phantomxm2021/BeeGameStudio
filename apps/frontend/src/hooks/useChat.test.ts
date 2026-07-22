import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let latestWebSocketOptions: {
  onMessage?: (message: any) => void;
  onOpen?: () => void | Promise<void>;
  onClose?: () => void;
} = {};
const { chatStoreState, useChatStoreMock, projectStoreState, useProjectStoreMock, systemStoreState } = vi.hoisted(() => {
  const state = {
    pendingReviews: [] as any[],
    projectStatus: null as any,
    removePendingReview: vi.fn(),
    upsertPendingReview: vi.fn(),
    loadProjectStatus: vi.fn().mockResolvedValue(undefined),
    loadPendingReviews: vi.fn().mockResolvedValue(undefined),
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
    loadHistory: vi.fn(),
    clearMessages: vi.fn(),
    messages: [] as any[],
  };
  const systemState = {
    updateTokenUsage: vi.fn(),
    updateLastP2PRoute: vi.fn(),
    loadTasks: vi.fn().mockResolvedValue(undefined),
    loadActivities: vi.fn().mockResolvedValue(undefined),
    loadPhases: vi.fn().mockResolvedValue(undefined),
    loadAgents: vi.fn().mockResolvedValue(undefined),
    loadTokenUsage: vi.fn().mockResolvedValue(undefined),
    loadCurrentUser: vi.fn().mockResolvedValue(null),
    authenticationStatus: 'authenticated' as const,
    setAgentStatus: vi.fn(),
    refreshAgents: vi.fn().mockResolvedValue(undefined),
    setIsSyncing: vi.fn(),
    tasks: [] as any[],
  };
  const chatHook = Object.assign(() => chatState, {
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

vi.mock('./useWebSocket', () => ({
  useWebSocket: (options: { onMessage?: (message: any) => void }) => {
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
    approvePlan: vi.fn(),
    uploadManifestCsv: vi.fn(),
    approveManifest: vi.fn(),
    reviseManifest: vi.fn(),
    getChatHistory: vi.fn().mockResolvedValue([]),
  },
  normalizeApprovePlanPayload: (payload: unknown) => payload,
  normalizeReviewBindingPayload: (payload: unknown) => payload,
}));

vi.mock('../services/beeGameAdapter', () => ({
}));

vi.mock('../services/creditsApi', () => ({
  getCreditQuote: vi.fn().mockResolvedValue({
    taskType: 'edit_turn',
    reservedCredits: 1,
    balanceCredits: 300,
    canStart: true,
  }),
}));

import { api } from '../services/api';
import { useChat } from './useChat';

describe('useChat clarification gate handling', () => {
  beforeEach(() => {
    latestWebSocketOptions = {};
    projectStoreState.pendingReviews = [];
    projectStoreState.projectStatus = null;
    projectStoreState.removePendingReview.mockClear();
    projectStoreState.upsertPendingReview.mockClear();
    projectStoreState.loadProjectStatus.mockClear();
    projectStoreState.loadPendingReviews.mockClear();
    projectStoreState.loadProjectRuntimeState.mockReset();
    projectStoreState.loadProjectRuntimeState.mockResolvedValue(undefined);
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

  it('coalesces duplicate stop requests while waiting for backend confirmation', async () => {
    let resolveStop: (() => void) | undefined;
    vi.mocked(api.stopTask).mockImplementationOnce(() => new Promise(resolve => {
      resolveStop = () => resolve({} as any);
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

  it('does not expose clarification gates as generic continue state and refreshes pending approvals', async () => {
    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    act(() => {
      latestWebSocketOptions.onMessage?.({
        type: 'human_gate',
        gate: 'INTENT_CLARIFICATION',
        project_id: 'proj_1',
        message: '需要你确认需求澄清',
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
    expect(chatStoreState.finalizeMessage).toHaveBeenCalledWith(
      'task_1', 'Thinking', 'beegame', 'thought', false, undefined, undefined,
      { taskKind: 'assistant_thinking' }, 100, 'thinking-turn-1',
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

  it('refreshes current user credits when credit events arrive', async () => {
    const onTaskEvent = vi.fn();
    renderHook(() => useChat({ projectId: 'proj_1', onTaskEvent }));

    act(() => {
      latestWebSocketOptions.onMessage?.({
        type: 'credit_update',
        task_id: 'task_1',
        project_id: 'proj_1',
        credit_event: 'credit.refunded',
        balance_credits: 294,
        credits: 50,
      });
    });

    await waitFor(() => {
      expect(systemStoreState.loadCurrentUser).toHaveBeenCalled();
    });
    expect(onTaskEvent).toHaveBeenCalledWith('credit_update', expect.any(Object));
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
        approval_required: false,
        next_action: 'BeeGame is building',
        review_status: null,
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

  it('does not carry an active turn lock into another project', async () => {
    projectStoreState.projectStatus = {
      project_id: 'proj_1',
      phase: 'running',
      blocked: false,
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
    };
    const { result, rerender } = renderHook(() => useChat({ projectId: 'proj_1' }));

    await waitFor(() => expect(result.current.isLoading).toBe(true));

    projectStoreState.projectStatus = {
      project_id: 'proj_1',
      phase: 'paused',
      blocked: true,
      blocked_reason: 'Previous turn was interrupted.',
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
      type: 'tool',
      taskKind: 'tool_execution',
    }));
    expect(onTaskEvent).toHaveBeenCalledWith('tool_start', expect.any(Object));
    expect(projectStoreState.loadProjectStatus).not.toHaveBeenCalled();
    expect(projectStoreState.loadPendingReviews).not.toHaveBeenCalled();
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
        is_subagent_tool: false,
        timestamp: Date.now(),
      });
    });

    expect(chatStoreState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'tool-card-1',
      messageId: 'tool-card-1',
      type: 'tool',
      taskKind: 'tool_execution',
      toolName: 'Bash',
      toolStatus: 'completed',
      toolDetail: 'Command: game-engine build',
      toolOutput: 'Build passed',
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

  it('blocks sendMessage while waiting for an explicit review action', async () => {
    projectStoreState.projectStatus = {
      project_id: 'proj_1',
      phase: 'DESIGN_IN_PROGRESS',
      blocked: false,
      review_status: {
        workflow_id: 'review_flow',
        lane_id: 'internal_board_review',
        lane_status: 'awaiting_approval',
        decision_status: 'awaiting_user',
        message: { message_key: 'review.awaiting_user' },
        requires_user_action: true,
        user_action_kind: 'approve',
      },
    };
    const onError = vi.fn();
    const { result } = renderHook(() => useChat({ projectId: 'proj_1', onError }));

    await act(async () => {
      await result.current.sendMessage('please continue');
    });

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(chatStoreState.addMessage).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'system',
      content: 'Internal review passed and is waiting for user approval.',
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

    await act(async () => {
      await result.current.sendMessage('continue from paused state');
    });

    expect(api.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      content: 'continue from paused state',
      project_id: 'proj_1',
    }));
    await waitFor(() => {
      expect(projectStoreState.loadProjectRuntimeState).toHaveBeenCalledWith('proj_1');
      expect(api.getChatHistory).toHaveBeenCalledWith('proj_1');
    });
    expect(systemStoreState.loadPhases).not.toHaveBeenCalled();
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

  it('surfaces backend send failures in chat and toast', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const showToastError = vi.fn();
    const onError = vi.fn();
    vi.mocked(api.sendMessage).mockRejectedValue(new Error('Credit 不足。本次请求需要预扣 50 credits，你当前有 0 credits。'));
    const { result } = renderHook(() => useChat({ projectId: 'proj_1', onError, showToastError }));

    await act(async () => {
      await result.current.sendMessage('fix the issue');
    });

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
    expect(systemStoreState.loadPhases).not.toHaveBeenCalled();
    expect(systemStoreState.loadTokenUsage).not.toHaveBeenCalled();
  });

  it('removes the pending review immediately after a successful approve submission', async () => {
    projectStoreState.pendingReviews = [
      {
        gate_id: 'gate_approval',
        artifact_id: 'art_1',
        binding: { artifact_id: 'art_1' },
      },
    ];
    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    await act(async () => {
      await result.current.approvePlan({
        gate_id: 'gate_approval',
        artifact_id: 'art_1',
      } as any);
    });

    expect(api.approvePlan).toHaveBeenCalledTimes(1);
    expect(projectStoreState.removePendingReview).toHaveBeenCalledWith('gate_approval');
    expect(projectStoreState.loadProjectRuntimeState).toHaveBeenCalledWith('proj_1');
    expect(projectStoreState.upsertPendingReview).not.toHaveBeenCalled();
    expect(result.current.approvalState).toEqual({
      gateId: null,
      action: null,
      phase: 'idle',
      message: '',
    });
  });

  it('refreshes project visibility after successful manifest approval and revision actions', async () => {
    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    await act(async () => {
      await result.current.approveManifest({
        gate_id: 'gate_manifest',
        artifact_id: 'art_1',
      } as any);
    });

    await act(async () => {
      await result.current.reviseManifest('gate_manifest', 'needs edits');
    });

    expect(api.approveManifest).toHaveBeenCalledTimes(1);
    expect(api.reviseManifest).toHaveBeenCalledTimes(1);
    expect(projectStoreState.loadProjectRuntimeState).toHaveBeenCalledTimes(2);
    expect(projectStoreState.loadProjectRuntimeState).toHaveBeenNthCalledWith(1, 'proj_1');
  });

  it('restores the pending review when approve submission fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const review = {
      gate_id: 'gate_approval',
      artifact_id: 'art_1',
      binding: { artifact_id: 'art_1' },
    };
    projectStoreState.pendingReviews = [review];
    vi.mocked(api.approvePlan).mockRejectedValueOnce(new Error('approve failed'));
    const { result } = renderHook(() => useChat({ projectId: 'proj_1' }));

    await act(async () => {
      await result.current.approvePlan(review as any);
    });

    expect(projectStoreState.removePendingReview).not.toHaveBeenCalled();
    expect(projectStoreState.upsertPendingReview).toHaveBeenCalledWith(review);
    expect(result.current.approvalState.phase).toBe('failed');
    expect(errorLog).toHaveBeenCalledWith('[useChat] Failed to approve plan:', expect.any(Error));
    errorLog.mockRestore();
  });
});
