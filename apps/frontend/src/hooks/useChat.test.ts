import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let latestWebSocketOptions: { onMessage?: (message: any) => void } = {};
const { chatStoreState, useChatStoreMock, projectStoreState, useProjectStoreMock, systemStoreState } = vi.hoisted(() => {
  const state = {
    pendingReviews: [] as any[],
    projectStatus: null as any,
    removePendingReview: vi.fn(),
    upsertPendingReview: vi.fn(),
    loadProjectStatus: vi.fn().mockResolvedValue(undefined),
    loadPendingReviews: vi.fn().mockResolvedValue(undefined),
  };
  const chatState = {
    addMessage: vi.fn(),
    updateMessage: vi.fn(),
    updateThought: vi.fn(),
    finalizeMessage: vi.fn(),
    setCurrentSender: vi.fn(),
    setIsStreaming: vi.fn(),
    loadHistory: vi.fn(),
    clearMessages: vi.fn(),
  };
  const systemState = {
    updateTokenUsage: vi.fn(),
    updateLastP2PRoute: vi.fn(),
    loadTasks: vi.fn().mockResolvedValue(undefined),
    loadActivities: vi.fn().mockResolvedValue(undefined),
    loadPhases: vi.fn().mockResolvedValue(undefined),
    loadAgents: vi.fn().mockResolvedValue(undefined),
    loadTokenUsage: vi.fn().mockResolvedValue(undefined),
    setAgentStatus: vi.fn(),
    refreshAgents: vi.fn().mockResolvedValue(undefined),
    setIsSyncing: vi.fn(),
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
  useSystemStore: () => systemStoreState,
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
    Object.values(chatStoreState).forEach((value) => {
      if (typeof value === 'function' && 'mockClear' in value) {
        value.mockClear();
      }
    });
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

  it('does not expose clarification gates as generic continue state', () => {
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

  it('updates local token usage and refreshes project usage after usage messages', async () => {
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
    expect(systemStoreState.loadTokenUsage).toHaveBeenCalledWith('proj_1');
    expect(onTaskEvent).toHaveBeenCalledWith('usage', { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 });
  });

  it('refreshes project runtime visibility when a tool starts', async () => {
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
    expect(projectStoreState.loadProjectStatus).toHaveBeenCalledWith('proj_1');
    expect(projectStoreState.loadPendingReviews).toHaveBeenCalledWith('proj_1');
  });

  it('blocks sendMessage while waiting for gdd approval', async () => {
    projectStoreState.projectStatus = {
      project_id: 'proj_1',
      phase: 'DESIGN_IN_PROGRESS',
      blocked: false,
      review_status: {
        workflow_id: 'gdd_v2',
        lane_id: 'internal_board_review',
        lane_status: 'awaiting_approval',
        decision_status: 'awaiting_user',
        message: { message_key: 'review.gdd.internal_board.awaiting_user' },
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
      content: 'Internal review completed and is waiting for user approval.',
      type: 'error',
    }));
  });

  it('blocks sendMessage while governance blockers remain unresolved', async () => {
    projectStoreState.projectStatus = {
      project_id: 'proj_1',
      phase: 'build',
      blocked: true,
      governance: {
        blocked: true,
        blocked_phase: 'build',
        open_blocker_ids: ['issue_1'],
        unrevalidated_blocker_ids: ['issue_2'],
        unresolved_conflict_ids: ['conflict_1'],
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
      type: 'error',
      content: expect.stringContaining('blocker'),
    }));
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
    expect(projectStoreState.loadProjectStatus).toHaveBeenCalledWith('proj_1');
    expect(projectStoreState.loadPendingReviews).toHaveBeenCalledWith('proj_1');
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
    expect(projectStoreState.loadProjectStatus).toHaveBeenCalledTimes(2);
    expect(projectStoreState.loadPendingReviews).toHaveBeenCalledTimes(2);
    expect(projectStoreState.loadProjectStatus).toHaveBeenNthCalledWith(1, 'proj_1');
    expect(projectStoreState.loadPendingReviews).toHaveBeenNthCalledWith(1, 'proj_1');
  });

  it('restores the pending review when approve submission fails', async () => {
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
  });
});
