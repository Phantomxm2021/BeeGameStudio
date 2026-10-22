import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import {
  buildApiEnv,
  buildFrontendEnv,
  resolveDashboardDevOptions,
} from './dashboard-dev-lib'

describe('dashboard dev launcher helpers', () => {
  test('uses stable defaults for local development', () => {
    const options = resolveDashboardDevOptions([], {
      cwd: '/repo',
      env: { AGENT_WORKFLOW_WORKSPACE_PATH: '/srv/beegame/projects' },
    })

    expect(options.preferredApiPort).toBe(62174)
    expect(options.preferredFrontendPort).toBe(62173)
    expect(options.workspacePath).toBe('/srv/beegame/projects')
    expect(options.frontendDir).toBe(resolve('/repo', 'apps/frontend'))
  })

  test('fails closed without the server-managed workspace root', () => {
    expect(() => resolveDashboardDevOptions([], {
      cwd: '/repo',
      env: {},
    })).toThrow('AGENT_WORKFLOW_WORKSPACE_PATH is required')
  })

  test('rejects the removed workspace command-line override', () => {
    expect(() => resolveDashboardDevOptions(['--workspace', 'OtherProjects'], {
      cwd: '/repo',
      env: { AGENT_WORKFLOW_WORKSPACE_PATH: '/srv/beegame/projects' },
    })).toThrow('workspace root is server-managed')
  })

  test('injects the fixed api port into the frontend dev server', () => {
    const env = buildFrontendEnv({
      apiPort: 62174,
      frontendPort: 62173,
      baseEnv: { EXISTING: '1' },
    })

    expect(env.EXISTING).toBe('1')
    expect(env.PORT).toBe('62173')
    expect(env.VITE_API_BASE_URL).toBe('http://127.0.0.1:62174')
  })

  test('keeps V3 service-role credentials on the runtime host and strips them from the frontend', () => {
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
    expect(env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY).toBe('service-role-secret')
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('generic-service-role-secret')
    const frontend = buildFrontendEnv({ apiPort: 62174, frontendPort: 62173, baseEnv: env })
    expect(frontend.BEEGAME_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(frontend.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(env.AGENT_WORKFLOW_PORT).toBe('62174')
    expect(env.AGENT_WORKFLOW_WORKSPACE_PATH).toBe('/repo/Projects')
    expect(env.BEEGAME_API_CORS_ORIGINS).toBe('http://127.0.0.1:62173')
  })

})
