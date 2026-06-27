import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/api', () => ({
  api: {
    getStatus: vi.fn(),
    getAgents: vi.fn(),
    getActivity: vi.fn(),
    getCurrentUser: vi.fn(),
    getWorkflowPhases: vi.fn(),
    getTasks: vi.fn(),
    getProjectTokenUsage: vi.fn(),
  },
}));

vi.mock('zustand/middleware', () => ({
  createJSONStorage: vi.fn(),
  persist: (initializer: any) => initializer,
}));

import { useSystemStore } from './systemStore';
import { api } from '../services/api';

describe('systemStore token usage', () => {
  beforeEach(() => {
    localStorage.clear();
    useSystemStore.setState({
      tokenUsage: {},
      taskUsage: {},
      currentUser: null,
    });
    vi.clearAllMocks();
  });

  it('keeps project and task token usage monotonic for cumulative snapshots', () => {
    const store = useSystemStore.getState();

    store.updateTokenUsage({ prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 }, 'proj_1', 'pipe_1');
    store.updateTokenUsage({ prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 }, 'proj_1', 'pipe_1');
    store.updateTokenUsage({ prompt_tokens: 120, completion_tokens: 50, total_tokens: 170 }, 'proj_1', 'pipe_1');

    expect(useSystemStore.getState().tokenUsage.proj_1).toEqual({
      prompt_tokens: 120,
      completion_tokens: 50,
      total_tokens: 170,
    });
    expect(useSystemStore.getState().taskUsage.pipe_1).toEqual({
      prompt_tokens: 120,
      completion_tokens: 50,
      total_tokens: 170,
    });
  });

  it('loads the current user and checks named permissions', async () => {
    vi.mocked(api.getCurrentUser).mockResolvedValue({
      id: 'developer-user',
      role: 'developer',
      permissions: ['project.read', 'agent.send_message'],
    });

    await useSystemStore.getState().loadCurrentUser();

    expect(useSystemStore.getState().currentUser).toEqual({
      id: 'developer-user',
      role: 'developer',
      permissions: ['project.read', 'agent.send_message'],
    });
    expect(useSystemStore.getState().hasPermission('agent.send_message')).toBe(true);
    expect(useSystemStore.getState().hasPermission('project.delete')).toBe(false);
  });

  it('clears current user when loading permissions fails', async () => {
    useSystemStore.setState({
      currentUser: {
        id: 'old-user',
        role: 'owner',
        permissions: ['project.delete'],
      },
    });
    vi.mocked(api.getCurrentUser).mockRejectedValue(new Error('offline'));

    await useSystemStore.getState().loadCurrentUser();

    expect(useSystemStore.getState().currentUser).toBeNull();
    expect(useSystemStore.getState().hasPermission('project.delete')).toBe(false);
  });

});
