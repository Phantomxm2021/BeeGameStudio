import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildUnauthorizedMessage,
  normalizePendingToolPermissionsResponse,
  normalizeProjectBaselineStatusPayload,
  resolveAuthToken,
} from './api'

describe('API normalization', () => {
  beforeEach(() => stubLocalStorage())

  afterEach(() => {
    vi.unstubAllEnvs()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('prefers the authenticated Supabase session token', () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', 'development-token')
    localStorage.setItem('beegame_supabase_session', JSON.stringify({
      accessToken: 'session-token',
      expiresAt: Date.now() + 3_600_000,
      user: { id: 'user-1' },
    }))
    expect(resolveAuthToken()).toBe('session-token')
  })

  it('reports authentication failures without a configured token', () => {
    vi.stubEnv('VITE_API_AUTH_TOKEN', '')
    expect(buildUnauthorizedMessage()).toBe('请先登录 BeeGame')
  })

  it('normalizes the canonical project runtime state', () => {
    expect(normalizeProjectBaselineStatusPayload({
      project_id: ' project-1 ',
      phase: ' IMPLEMENTATION ',
      blocked: false,
      active_agents: [' worker '],
      acceptance: { status: 'not_run' },
      workflow: { runId: 'run-1', status: 'running' },
    })).toMatchObject({
      project_id: 'project-1',
      phase: 'IMPLEMENTATION',
      blocked: false,
      active_agents: ['worker'],
      acceptance: { status: 'not_run' },
      workflow: { runId: 'run-1', status: 'running' },
    })
  })

  it('keeps only canonical tool-permission fields', () => {
    const response = normalizePendingToolPermissionsResponse({
      items: [{
        gate_id: ' permission-1 ',
        type: 'BEEGAME_PERMISSION' as const,
        title: ' Bash permission ',
        permission_tool_name: ' Bash ',
        artifact: { input: { command: 'npm test' } },
      }],
    })
    expect(response.items).toEqual([{
      gate_id: 'permission-1',
      type: 'BEEGAME_PERMISSION',
      task_id: undefined,
      title: 'Bash permission',
      permission_tool_name: 'Bash',
      created_at: undefined,
      artifact: { input: { command: 'npm test' } },
      summary: undefined,
    }])
  })
})

function stubLocalStorage(): void {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: vi.fn(() => values.clear()),
  })
}
