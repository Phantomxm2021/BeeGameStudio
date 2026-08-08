import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import {
  buildApiEnv,
  buildFrontendEnv,
  resolveDashboardDevOptions,
  resolveProductionApiBase,
} from './dashboard-dev-lib'

describe('dashboard dev launcher helpers', () => {
  test('uses stable defaults for local development', () => {
    const options = resolveDashboardDevOptions([], {
      cwd: '/repo',
      env: {},
    })

    expect(options.preferredApiPort).toBe(62174)
    expect(options.preferredFrontendPort).toBe(62173)
    expect(options.workspacePath).toBe(resolve('/repo', 'Projects'))
    expect(options.frontendDir).toBe(resolve('/repo', 'apps/frontend'))
  })

  test('injects the selected api port into the frontend dev server', () => {
    const env = buildFrontendEnv({
      apiPort: 4123,
      frontendPort: 5188,
      baseEnv: { EXISTING: '1' },
    })

    expect(env.EXISTING).toBe('1')
    expect(env.PORT).toBe('5188')
    expect(env.VITE_API_BASE_URL).toBe('http://127.0.0.1:4123')
    expect(env.VITE_WS_BASE_URL).toBe('ws://127.0.0.1:4123')
  })

  test('does not pass Supabase service-role secrets to the runtime host', () => {
    const env = buildApiEnv({
      apiPort: 62174,
      frontendPort: 62173,
      workspacePath: '/repo/Projects',
      baseEnv: {
        BEEGAME_SUPABASE_URL: 'https://project.supabase.co',
        BEEGAME_SUPABASE_ANON_KEY: 'anon-key',
        BEEGAME_SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
        SUPABASE_SERVICE_ROLE_KEY: 'generic-service-role-secret',
      },
    })

    expect(env.BEEGAME_SUPABASE_URL).toBe('https://project.supabase.co')
    expect(env.BEEGAME_SUPABASE_ANON_KEY).toBe('anon-key')
    expect(env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(env.AGENT_WORKFLOW_PORT).toBe('62174')
    expect(env.AGENT_WORKFLOW_WORKSPACE_PATH).toBe('/repo/Projects')
    expect(env.BEEGAME_API_CORS_ORIGINS).toBe('http://127.0.0.1:62173')
  })

  test('keeps production frontend on same-origin api by default', () => {
    expect(resolveProductionApiBase({ env: {} })).toBe('')
    expect(resolveProductionApiBase({
      env: { BEEGAME_DASHBOARD_API_BASE_URL: 'http://127.0.0.1:3040' },
    })).toBe('http://127.0.0.1:3040')
  })
})
