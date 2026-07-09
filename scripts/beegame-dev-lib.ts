import { resolve } from 'node:path'

export const DEFAULT_BEEGAME_RUNTIME_PORT = 62174
export const DEFAULT_BEEGAME_FRONTEND_PORT = 62173
export const DEFAULT_BEEGAME_BILLING_PORT = 62175
export const DEFAULT_BEEGAME_SKILLS_PORT = 62176

export type BeeGameDevPorts = {
  runtime: number
  frontend: number
  billing: number
  skills: number
}

export type BeeGameDevProcessName = 'billing' | 'skills' | 'runtime' | 'frontend'

export type BeeGameDevProcessPlan = {
  name: BeeGameDevProcessName
  command: string[]
  cwd: string
  env: Record<string, string>
}

export type BeeGameDevPlan = {
  workspacePath: string
  frontendDir: string
  ports: BeeGameDevPorts
  urls: {
    frontend: string
    runtime: string
    billing: string
    skills: string
  }
  processes: BeeGameDevProcessPlan[]
}

type BeeGameDevPlanInput = {
  cwd: string
  env: Record<string, string | undefined>
  ports: BeeGameDevPorts
  bunExecutable?: string
}

export function buildBeeGameDevPlan(
  argv: string[],
  input: BeeGameDevPlanInput,
): BeeGameDevPlan {
  const values = parseArgs(argv)
  const ports = {
    runtime: parsePort(
      values['runtime-port'] || values['api-port'] || input.env.AGENT_WORKFLOW_PORT,
      input.ports.runtime,
    ),
    frontend: parsePort(
      values['frontend-port'] || input.env.VITE_PORT || input.env.PORT,
      input.ports.frontend,
    ),
    billing: parsePort(
      values['billing-port'] || input.env.BEEGAME_BILLING_PORT,
      input.ports.billing,
    ),
    skills: parsePort(
      values['skills-port'] || input.env.BEEGAME_SKILLS_PORT,
      input.ports.skills,
    ),
  }
  const workspacePath = resolve(
    input.cwd,
    values.workspace ||
      input.env.AGENT_WORKFLOW_WORKSPACE_PATH ||
      input.env.VITE_BEEGAME_WORKSPACE_PATH ||
      'Projects',
  )
  const frontendDir = resolve(input.cwd, values.frontend || 'apps/frontend')
  const bunExecutable = input.bunExecutable ?? 'bun'
  const urls = {
    frontend: `http://127.0.0.1:${ports.frontend}`,
    runtime: `http://127.0.0.1:${ports.runtime}`,
    billing: `http://127.0.0.1:${ports.billing}`,
    skills: `http://127.0.0.1:${ports.skills}`,
  }

  return {
    workspacePath,
    frontendDir,
    ports,
    urls,
    processes: [
      {
        name: 'billing',
        command: [bunExecutable, 'packages/beegame-billing-server/src/index.ts'],
        cwd: input.cwd,
        env: buildBillingEnv(input.env, ports),
      },
      {
        name: 'skills',
        command: [bunExecutable, 'packages/beegame-skills-server/src/index.ts'],
        cwd: input.cwd,
        env: buildSkillsEnv(input.env, ports),
      },
      {
        name: 'runtime',
        command: [bunExecutable, 'scripts/dashboard-server-dev.ts'],
        cwd: input.cwd,
        env: buildRuntimeEnv({
          baseEnv: input.env,
          ports,
          workspacePath,
        }),
      },
      {
        name: 'frontend',
        command: [
          bunExecutable,
          'run',
          'dev',
          '--',
          '--host',
          '127.0.0.1',
          '--port',
          String(ports.frontend),
        ],
        cwd: frontendDir,
        env: buildFrontendEnv({
          baseEnv: input.env,
          ports,
        }),
      },
    ],
  }
}

function buildBillingEnv(
  baseEnv: Record<string, string | undefined>,
  ports: BeeGameDevPorts,
): Record<string, string> {
  return compactEnv({
    ...baseEnv,
    BEEGAME_BILLING_MODE: 'server',
    BEEGAME_BILLING_HOST: '127.0.0.1',
    BEEGAME_BILLING_PORT: String(ports.billing),
  })
}

function buildSkillsEnv(
  baseEnv: Record<string, string | undefined>,
  ports: BeeGameDevPorts,
): Record<string, string> {
  return compactEnv({
    ...baseEnv,
    BEEGAME_SKILLS_HOST: '127.0.0.1',
    BEEGAME_SKILLS_PORT: String(ports.skills),
  })
}

function buildRuntimeEnv(input: {
  baseEnv: Record<string, string | undefined>
  ports: BeeGameDevPorts
  workspacePath: string
}): Record<string, string> {
  return compactEnv({
    ...omitFrontendAndRuntimeForbiddenEnv(input.baseEnv),
    AGENT_WORKFLOW_PORT: String(input.ports.runtime),
    AGENT_WORKFLOW_WORKSPACE_PATH: input.workspacePath,
    BEEGAME_BILLING_MODE: 'remote',
    BEEGAME_BILLING_API_BASE_URL: `http://127.0.0.1:${input.ports.billing}`,
    BEEGAME_SKILLS_API_BASE_URL: `http://127.0.0.1:${input.ports.skills}`,
  })
}

function buildFrontendEnv(input: {
  baseEnv: Record<string, string | undefined>
  ports: BeeGameDevPorts
}): Record<string, string> {
  return compactEnv({
    ...omitFrontendAndRuntimeForbiddenEnv(input.baseEnv),
    PORT: String(input.ports.frontend),
    VITE_API_BASE_URL: `http://127.0.0.1:${input.ports.runtime}`,
    VITE_WS_BASE_URL: `ws://127.0.0.1:${input.ports.runtime}`,
  })
}

function parseArgs(argv: string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const withoutPrefix = arg.slice(2)
    const inlineValueIndex = withoutPrefix.indexOf('=')
    if (inlineValueIndex !== -1) {
      values[withoutPrefix.slice(0, inlineValueIndex)] = withoutPrefix.slice(
        inlineValueIndex + 1,
      )
      continue
    }
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      values[withoutPrefix] = next
      index += 1
    } else {
      values[withoutPrefix] = '1'
    }
  }
  return values
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback
  }
  return parsed
}

function compactEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const compacted: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) compacted[key] = value
  }
  return compacted
}

const FRONTEND_AND_RUNTIME_FORBIDDEN_ENV = new Set([
  'BEEGAME_SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'BEEGAME_STRIPE_SECRET_KEY',
  'BEEGAME_STRIPE_WEBHOOK_SECRET',
])

function omitFrontendAndRuntimeForbiddenEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !FRONTEND_AND_RUNTIME_FORBIDDEN_ENV.has(key)),
  )
}
