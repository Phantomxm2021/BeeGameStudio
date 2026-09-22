import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import {
  buildBeeGameDevPlan,
  waitForBeeGameDevServices,
} from './beegame-dev-lib'

describe('BeeGame local dev launcher helpers', () => {
  test('a failed frontend is reported without terminating a surviving service', async () => {
    // Harmless, test-owned processes only. Never run pkill against live services.
    const frontend = Bun.spawn([process.execPath, '-e', 'process.exit(7)'], { stdout: 'ignore', stderr: 'ignore' })
    const runtime = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'], { stdout: 'ignore', stderr: 'ignore' })
    const events: Array<{ service: string; pid: number; exitCode: number | null; signal: string | null }> = []
    let complete = false
    const waiting = waitForBeeGameDevServices([
      { name: 'frontend', child: frontend }, { name: 'runtime', child: runtime },
    ], event => events.push(event)).then(() => { complete = true })
    try {
      await frontend.exited
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(events).toEqual([{ service: 'frontend', pid: frontend.pid, exitCode: 7, signal: null }])
      expect(runtime.exitCode).toBeNull()
      expect(complete).toBe(false)
    } finally {
      runtime.kill('SIGTERM')
      await waiting
    }
    expect(events.at(-1)).toMatchObject({ service: 'runtime', pid: runtime.pid, signal: 'SIGTERM' })
  })

  test('plans all local BeeGame services with stable default ports', () => {
    const plan = buildBeeGameDevPlan([], {
      cwd: '/repo',
      env: { AGENT_WORKFLOW_WORKSPACE_PATH: '/srv/beegame/projects' },
      ports: {
      runtime: 62174,
      frontend: 62173,
      billing: 62175,
      skills: 62176,
      resources: 62177,
      },
    })

    expect(plan.workspacePath).toBe('/srv/beegame/projects')
    expect(plan.frontendDir).toBe(resolve('/repo', 'apps/frontend'))
    expect(plan.urls).toEqual({
      frontend: 'http://127.0.0.1:62173',
      runtime: 'http://127.0.0.1:62174',
      billing: 'http://127.0.0.1:62175',
      skills: 'http://127.0.0.1:62176',
      resources: 'http://127.0.0.1:62177',
    })
    expect(plan.nativeRuntimeBuild).toEqual({
      command: ['bun', 'run', 'build.ts'],
      cwd: '/repo',
    })
    expect(plan.processes.map(process => process.name)).toEqual([
      'billing',
      'skills',
      'runtime',
      'resources',
      'frontend',
    ])
    expect(plan.processes.find(process => process.name === 'resources')?.command).toEqual([
      'bun', 'packages/beegame-resource-server/src/index.ts',
    ])
    expect(plan.processes.find(process => process.name === 'runtime')?.command).toEqual([
      'bun', 'scripts/dashboard-server-dev.ts',
    ])
  })

  test('injects service urls and keeps service-role secrets out of runtime and frontend', () => {
    const plan = buildBeeGameDevPlan([], {
      cwd: '/repo',
      env: {
        AGENT_WORKFLOW_WORKSPACE_PATH: '/srv/beegame/projects',
        BEEGAME_SUPABASE_URL: 'https://project.supabase.co',
        BEEGAME_SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
        SUPABASE_SERVICE_ROLE_KEY: 'generic-service-secret',
        BEEGAME_CREDIT_CONTROL_TOKEN: 'credit-token',
        BEEGAME_SKILLS_SERVICE_TOKEN: 'skills-token',
        NO_PROXY: '127.0.0.1',
        no_proxy: 'localhost',
      },
      ports: {
        runtime: 62174,
        frontend: 62173,
        billing: 62175,
        skills: 62176,
        resources: 62177,
      },
    })

    const runtime = plan.processes.find(process => process.name === 'runtime')
    const frontend = plan.processes.find(process => process.name === 'frontend')
    const billing = plan.processes.find(process => process.name === 'billing')
    const skills = plan.processes.find(process => process.name === 'skills')
    const resources = plan.processes.find(process => process.name === 'resources')

    expect(runtime?.env).toMatchObject({
      NODE_ENV: 'development',
      BEEGAME_BILLING_MODE: 'remote',
      BEEGAME_BILLING_API_BASE_URL: 'http://127.0.0.1:62175',
      BEEGAME_SKILLS_API_BASE_URL: 'http://127.0.0.1:62176',
      BEEGAME_RESOURCE_SERVER_URL: 'http://127.0.0.1:62177',
      BEEGAME_RESOURCE_SERVICE_TOKEN: 'beegame-local-resource-selection',
      BEEGAME_API_CORS_ORIGINS: 'http://127.0.0.1:62173',
      BEEGAME_CREDIT_CONTROL_TOKEN: 'credit-token',
      BEEGAME_SKILLS_SERVICE_TOKEN: 'skills-token',
      NO_PROXY: '127.0.0.1,project.supabase.co',
      no_proxy: 'localhost,project.supabase.co',
    })
    expect(runtime?.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(runtime?.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(frontend?.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(frontend?.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(frontend?.env).toMatchObject({
      PORT: '62173',
      VITE_API_BASE_URL: 'http://127.0.0.1:62174',
      VITE_WS_BASE_URL: 'ws://127.0.0.1:62174',
    })
    expect(frontend?.env.VITE_RESOURCE_API_BASE_URL).toBeUndefined()
    expect(billing?.env).toMatchObject({
      BEEGAME_BILLING_MODE: 'server',
      BEEGAME_BILLING_HOST: '127.0.0.1',
      BEEGAME_BILLING_PORT: '62175',
      BEEGAME_CREDIT_CONTROL_TOKEN: 'credit-token',
      NO_PROXY: '127.0.0.1,project.supabase.co',
      no_proxy: 'localhost,project.supabase.co',
    })
    expect(skills?.env).toMatchObject({
      BEEGAME_SKILLS_HOST: '127.0.0.1',
      BEEGAME_SKILLS_PORT: '62176',
      BEEGAME_SKILLS_SERVICE_TOKEN: 'skills-token',
      NO_PROXY: '127.0.0.1,project.supabase.co',
      no_proxy: 'localhost,project.supabase.co',
    })
    expect(resources?.env).toMatchObject({
      BEEGAME_RESOURCE_HOST: '127.0.0.1',
      BEEGAME_RESOURCE_PORT: '62177',
      BEEGAME_RESOURCE_SERVICE_TOKEN: 'beegame-local-resource-selection',
      NO_PROXY: '127.0.0.1,project.supabase.co',
      no_proxy: 'localhost,project.supabase.co',
    })
    expect(frontend?.env.BEEGAME_RESOURCE_SERVICE_TOKEN).toBeUndefined()
  })

  test('rejects command-line and programmatic port overrides', () => {
    const base = {
      cwd: '/repo',
      env: { AGENT_WORKFLOW_WORKSPACE_PATH: '/srv/beegame/projects' },
      ports: {
        runtime: 62174,
        frontend: 62173,
        billing: 62175,
        skills: 62176,
        resources: 62177,
      },
    }
    expect(() => buildBeeGameDevPlan(['--runtime-port', '50174'], base))
      .toThrow('fixed runtime port is 62174')
    expect(() => buildBeeGameDevPlan([], {
      ...base,
      ports: { ...base.ports, runtime: 50174 },
    })).toThrow('runtime must use fixed port 62174')
  })

  test('fails closed when the server-managed workspace root is missing', () => {
    expect(() => buildBeeGameDevPlan([], {
      cwd: '/repo',
      env: {},
      ports: {
        runtime: 62174,
        frontend: 62173,
        billing: 62175,
        skills: 62176,
        resources: 62177,
      },
    })).toThrow('AGENT_WORKFLOW_WORKSPACE_PATH is required')
  })

  test('rejects the removed workspace command-line override', () => {
    expect(() => buildBeeGameDevPlan(['--workspace', 'BeeProjects'], {
      cwd: '/repo',
      env: { AGENT_WORKFLOW_WORKSPACE_PATH: '/srv/beegame/projects' },
      ports: {
        runtime: 62174,
        frontend: 62173,
        billing: 62175,
        skills: 62176,
        resources: 62177,
      },
    })).toThrow('workspace root is server-managed')
  })
})
