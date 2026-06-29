import { resolve } from 'node:path'

export const DEFAULT_DASHBOARD_API_PORT = 62174
export const DEFAULT_DASHBOARD_FRONTEND_PORT = 62173

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

type ProductionApiBaseInput = {
  env: Record<string, string | undefined>
}

export function resolveDashboardDevOptions(
  argv: string[],
  input: ResolveOptionsInput,
): DashboardDevOptions {
  const values = parseArgs(argv)
  const preferredApiPort = parsePort(
    values['api-port'] || input.env.AGENT_WORKFLOW_PORT,
    DEFAULT_DASHBOARD_API_PORT,
  )
  const preferredFrontendPort = parsePort(
    values['frontend-port'] || input.env.VITE_PORT || input.env.PORT,
    DEFAULT_DASHBOARD_FRONTEND_PORT,
  )
  const workspacePath = resolve(
    input.cwd,
    values.workspace ||
      input.env.AGENT_WORKFLOW_WORKSPACE_PATH ||
      input.env.VITE_BEEGAME_WORKSPACE_PATH ||
      'Projects',
  )
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
    ...input.baseEnv,
    PORT: String(input.frontendPort),
    VITE_API_BASE_URL: `http://127.0.0.1:${input.apiPort}`,
    VITE_WS_BASE_URL: `ws://127.0.0.1:${input.apiPort}`,
  })
}

export function buildApiEnv(input: {
  apiPort: number
  workspacePath: string
  baseEnv: Record<string, string | undefined>
}): Record<string, string> {
  return compactEnv({
    ...omitRuntimeHostForbiddenEnv(input.baseEnv),
    AGENT_WORKFLOW_PORT: String(input.apiPort),
    AGENT_WORKFLOW_WORKSPACE_PATH: input.workspacePath,
  })
}

export function resolveProductionApiBase(input: ProductionApiBaseInput): string {
  return String(input.env.BEEGAME_DASHBOARD_API_BASE_URL || '').trim()
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

const RUNTIME_HOST_FORBIDDEN_ENV = new Set([
  'BEEGAME_SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
])

function omitRuntimeHostForbiddenEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !RUNTIME_HOST_FORBIDDEN_ENV.has(key)),
  )
}
