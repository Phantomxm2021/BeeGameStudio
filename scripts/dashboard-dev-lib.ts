import { isAbsolute, resolve } from 'node:path'
import {
  BEEGAME_FIXED_SERVICE_PORTS,
  assertFixedServicePortConfiguration,
} from '../packages/agent-workflow-server/src/beegame/fixed-service-ports'

export const DEFAULT_DASHBOARD_API_PORT = BEEGAME_FIXED_SERVICE_PORTS.runtime
export const DEFAULT_DASHBOARD_FRONTEND_PORT = BEEGAME_FIXED_SERVICE_PORTS.frontend

export type DashboardDevOptions = {
  preferredApiPort: number
  preferredFrontendPort: number
  workspacePath: string
  frontendDir: string
}

type ResolveOptionsInput = {
  cwd: string
  env: Record<string, string | undefined>
}

type FrontendEnvInput = {
  apiPort: number
  frontendPort: number
  baseEnv: Record<string, string | undefined>
}

export function resolveDashboardDevOptions(
  argv: string[],
  input: ResolveOptionsInput,
): DashboardDevOptions {
  const values = parseArgs(argv)
  assertFixedServicePortConfiguration({ argv, env: input.env })
  if (values.workspace !== undefined)
    throw new Error(
      'BeeGame workspace root is server-managed; remove the --workspace override',
    )
  const preferredApiPort = DEFAULT_DASHBOARD_API_PORT
  const preferredFrontendPort = DEFAULT_DASHBOARD_FRONTEND_PORT
  const configuredWorkspace = String(
    input.env.AGENT_WORKFLOW_WORKSPACE_PATH || '',
  ).trim()
  if (!configuredWorkspace)
    throw new Error('AGENT_WORKFLOW_WORKSPACE_PATH is required')
  if (!isAbsolute(configuredWorkspace))
    throw new Error('AGENT_WORKFLOW_WORKSPACE_PATH must be absolute')
  const workspacePath = resolve(configuredWorkspace)
  const frontendDir = resolve(input.cwd, values.frontend || 'apps/frontend')
  return {
    preferredApiPort,
    preferredFrontendPort,
    workspacePath,
    frontendDir,
  }
}

export function buildFrontendEnv(input: FrontendEnvInput): Record<string, string> {
  return compactEnv({
    ...omitServiceRoleEnv(input.baseEnv),
    PORT: String(input.frontendPort),
    VITE_API_BASE_URL: `http://127.0.0.1:${input.apiPort}`,
  })
}

export function buildApiEnv(input: {
  apiPort: number
  frontendPort: number
  workspacePath: string
  baseEnv: Record<string, string | undefined>
}): Record<string, string> {
  return compactEnv({
    // The BGS host uses this credential only for V3 persistence RPCs. Native
    // tasks use their own allowlisted model environment, not this host env.
    ...input.baseEnv,
    AGENT_WORKFLOW_PORT: String(input.apiPort),
    AGENT_WORKFLOW_WORKSPACE_PATH: input.workspacePath,
    BEEGAME_API_CORS_ORIGINS: appendApiCorsOrigin(
      input.baseEnv.BEEGAME_API_CORS_ORIGINS,
      `http://127.0.0.1:${input.frontendPort}`,
    ),
  })
}

function appendApiCorsOrigin(value: string | undefined, origin: string): string {
  const origins = (value ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
  if (!origins.includes(origin)) origins.push(origin)
  return origins.join(',')
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

function compactEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const compacted: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) compacted[key] = value
  }
  return compacted
}

const SERVICE_ROLE_ENV = new Set([
  'BEEGAME_SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
])

function omitServiceRoleEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !SERVICE_ROLE_ENV.has(key)),
  )
}
