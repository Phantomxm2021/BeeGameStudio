import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/api', () => ({
  api: {
    getStatus: vi.fn(),
    getAgents: vi.fn(),
    getActivity: vi.fn(),
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

describe('systemStore token usage', () => {
  beforeEach(() => {
    localStorage.clear();
    useSystemStore.setState({
      tokenUsage: {},
      taskUsage: {},
    });
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
});
