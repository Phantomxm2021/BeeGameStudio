import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import {
  buildBeeGameDevPlan,
} from './beegame-dev-lib'

describe('BeeGame local dev launcher helpers', () => {
  test('plans all local BeeGame services with stable default ports', () => {
    const plan = buildBeeGameDevPlan([], {
      cwd: '/repo',
      env: {},
      ports: {
      runtime: 62174,
      frontend: 62173,
      billing: 62175,
      skills: 62176,
      resources: 62177,
      },
    })

    expect(plan.workspacePath).toBe(resolve('/repo', 'Projects'))
    expect(plan.frontendDir).toBe(resolve('/repo', 'apps/frontend'))
    expect(plan.urls).toEqual({
      frontend: 'http://127.0.0.1:62173',
      runtime: 'http://127.0.0.1:62174',
      billing: 'http://127.0.0.1:62175',
      skills: 'http://127.0.0.1:62176',
      resources: 'http://127.0.0.1:62177',
    })
    expect(plan.processes.map(process => process.name)).toEqual([
      'billing',
      'skills',
      'resources',
      'runtime',
      'frontend',
    ])
  })

  test('injects service urls and keeps service-role secrets out of runtime and frontend', () => {
    const plan = buildBeeGameDevPlan([], {
      cwd: '/repo',
      env: {
        BEEGAME_SUPABASE_URL: 'https://project.supabase.co',
        BEEGAME_SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
        SUPABASE_SERVICE_ROLE_KEY: 'generic-service-secret',
        BEEGAME_CREDIT_CONTROL_TOKEN: 'credit-token',
        BEEGAME_SKILLS_SERVICE_TOKEN: 'skills-token',
      },
      ports: {
        runtime: 41174,
        frontend: 41173,
        billing: 41175,
      skills: 41176,
      resources: 41177,
      },
    })

    const runtime = plan.processes.find(process => process.name === 'runtime')
    const frontend = plan.processes.find(process => process.name === 'frontend')
    const billing = plan.processes.find(process => process.name === 'billing')
    const skills = plan.processes.find(process => process.name === 'skills')
    const resources = plan.processes.find(process => process.name === 'resources')

    expect(runtime?.env).toMatchObject({
      BEEGAME_BILLING_MODE: 'remote',
      BEEGAME_BILLING_API_BASE_URL: 'http://127.0.0.1:41175',
      BEEGAME_SKILLS_API_BASE_URL: 'http://127.0.0.1:41176',
      BEEGAME_CREDIT_CONTROL_TOKEN: 'credit-token',
      BEEGAME_SKILLS_SERVICE_TOKEN: 'skills-token',
    })
    expect(runtime?.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(runtime?.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(frontend?.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(frontend?.env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(frontend?.env).toMatchObject({
      PORT: '41173',
      VITE_API_BASE_URL: 'http://127.0.0.1:41174',
      VITE_WS_BASE_URL: 'ws://127.0.0.1:41174',
    })
    expect(billing?.env).toMatchObject({
      BEEGAME_BILLING_MODE: 'server',
      BEEGAME_BILLING_HOST: '127.0.0.1',
      BEEGAME_BILLING_PORT: '41175',
      BEEGAME_CREDIT_CONTROL_TOKEN: 'credit-token',
    })
    expect(skills?.env).toMatchObject({
      BEEGAME_SKILLS_HOST: '127.0.0.1',
      BEEGAME_SKILLS_PORT: '41176',
      BEEGAME_SKILLS_SERVICE_TOKEN: 'skills-token',
    })
    expect(resources?.env).toMatchObject({
      BEEGAME_RESOURCE_HOST: '127.0.0.1',
      BEEGAME_RESOURCE_PORT: '41177',
    })
  })

  test('supports cli port and path overrides', () => {
    const plan = buildBeeGameDevPlan([
      '--runtime-port',
      '50174',
      '--frontend-port=50173',
      '--billing-port',
      '50175',
      '--skills-port',
      '50176',
      '--workspace',
      'BeeProjects',
      '--frontend',
      'custom/frontend',
    ], {
      cwd: '/repo',
      env: {},
      ports: {
        runtime: 50174,
        frontend: 50173,
        billing: 50175,
        skills: 50176,
      },
    })

    expect(plan.workspacePath).toBe(resolve('/repo', 'BeeProjects'))
    expect(plan.frontendDir).toBe(resolve('/repo', 'custom/frontend'))
    expect(plan.urls.frontend).toBe('http://127.0.0.1:50173')
    expect(plan.urls.runtime).toBe('http://127.0.0.1:50174')
    expect(plan.urls.billing).toBe('http://127.0.0.1:50175')
    expect(plan.urls.skills).toBe('http://127.0.0.1:50176')
  })
})
