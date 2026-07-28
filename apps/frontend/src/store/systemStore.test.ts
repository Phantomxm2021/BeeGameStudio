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
  persist: <T,>(initializer: T) => initializer,
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
      authenticationStatus: 'initializing',
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
      input_tokens: 120,
      cached_input_tokens: 0,
      completion_tokens: 50,
      output_tokens: 50,
      total_tokens: 170,
    });
    expect(useSystemStore.getState().taskUsage.pipe_1).toEqual({
      prompt_tokens: 120,
      input_tokens: 120,
      cached_input_tokens: 0,
      completion_tokens: 50,
      output_tokens: 50,
      total_tokens: 170,
    });
  });

  it('keeps cached input and provider-neutral token aliases current', () => {
    useSystemStore.getState().updateTokenUsage(
      {
        input_tokens: 1_000,
        cached_input_tokens: 240,
        output_tokens: 320,
        total_tokens: 1_320,
        prompt_tokens: 1_000,
        completion_tokens: 320,
      },
      'proj_1',
    );

    expect(useSystemStore.getState().tokenUsage.proj_1).toMatchObject({
      input_tokens: 1_000,
      cached_input_tokens: 240,
      output_tokens: 320,
      total_tokens: 1_320,
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

  it('merges Supabase session profile details into the current user', async () => {
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'access-token',
      expiresAt: Date.now() + 3600_000,
      user: {
        id: 'oauth-user',
        email: 'oauth@example.com',
        displayName: 'OAuth Maker',
        avatarUrl: 'https://avatars.example.com/oauth.png',
      },
    }));
    vi.mocked(api.getCurrentUser).mockResolvedValue({
      id: 'oauth-user',
      role: 'owner',
      permissions: ['project.read'],
    });

    await useSystemStore.getState().loadCurrentUser();

    expect(useSystemStore.getState().currentUser).toEqual({
      id: 'oauth-user',
      role: 'owner',
      email: 'oauth@example.com',
      displayName: 'OAuth Maker',
      avatarUrl: 'https://avatars.example.com/oauth.png',
      permissions: ['project.read'],
    });
  });

  it('uses Supabase session profile details even when the backend user id differs', async () => {
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'access-token',
      expiresAt: Date.now() + 3600_000,
      user: {
        id: 'supabase-auth-user',
        email: 'player@example.com',
        displayName: 'Player One',
      },
    }));
    vi.mocked(api.getCurrentUser).mockResolvedValue({
      id: 'backend-owner-id',
      role: 'owner',
      permissions: ['project.read'],
    });

    await useSystemStore.getState().loadCurrentUser();

    expect(useSystemStore.getState().currentUser).toEqual({
      id: 'backend-owner-id',
      role: 'owner',
      email: 'player@example.com',
      displayName: 'Player One',
      permissions: ['project.read'],
    });
  });

  it('clears current user when loading permissions fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
    expect(errorLog).toHaveBeenCalledWith('Failed to load current user:', expect.any(Error));
    errorLog.mockRestore();
  });

  it('treats current-user 401 as a signed-out state without logging an error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    useSystemStore.setState({
      currentUser: {
        id: 'old-user',
        role: 'owner',
        permissions: ['project.delete'],
      },
    });
    const unauthorized = new Error('authentication required') as Error & { status?: number };
    unauthorized.status = 401;
    vi.mocked(api.getCurrentUser).mockRejectedValue(unauthorized);

    await useSystemStore.getState().loadCurrentUser();

    expect(useSystemStore.getState().currentUser).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('preserves the signed-in user while authentication is temporarily unavailable', async () => {
    const currentUser = {
      id: 'old-user',
      role: 'owner' as const,
      permissions: ['project.delete' as const],
    };
    useSystemStore.setState({
      currentUser,
      authenticationStatus: 'authenticated',
    });
    const unavailable = Object.assign(
      new Error('Authentication service is temporarily unavailable'),
      { status: 503, code: 'authentication_unavailable' },
    );
    vi.mocked(api.getCurrentUser).mockRejectedValue(unavailable);

    await expect(useSystemStore.getState().loadCurrentUser()).rejects.toBe(unavailable);

    expect(useSystemStore.getState().currentUser).toEqual(currentUser);
    expect(useSystemStore.getState().authenticationStatus).toBe('initializing');
  });

});
