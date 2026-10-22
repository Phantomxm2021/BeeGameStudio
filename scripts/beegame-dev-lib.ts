import { isAbsolute, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import {
  BEEGAME_FIXED_SERVICE_PORTS,
  assertFixedServicePortConfiguration,
} from '../packages/agent-workflow-server/src/beegame/fixed-service-ports'

export const DEFAULT_BEEGAME_RUNTIME_PORT = BEEGAME_FIXED_SERVICE_PORTS.runtime
export const DEFAULT_BEEGAME_FRONTEND_PORT = BEEGAME_FIXED_SERVICE_PORTS.frontend
export const DEFAULT_BEEGAME_BILLING_PORT = BEEGAME_FIXED_SERVICE_PORTS.billing
export const DEFAULT_BEEGAME_SKILLS_PORT = BEEGAME_FIXED_SERVICE_PORTS.skills
export const DEFAULT_BEEGAME_RESOURCE_PORT = BEEGAME_FIXED_SERVICE_PORTS.resources

// This value is intentionally limited to the loopback-only `beegame:dev`
// process group. Production must provide a distinct service credential.
const LOCAL_RESOURCE_SELECTION_TOKEN = 'beegame-local-resource-selection'

export type BeeGameDevPorts = {
  runtime: number
  frontend: number
  billing: number
  skills: number
  resources: number
}

export type BeeGameDevProcessName = 'billing' | 'skills' | 'resources' | 'runtime' | 'frontend'

/** Give the runtime its existing drain/receipt/settlement opportunity before
 * the launcher exits. This does not claim safety after SIGKILL or a crash. */
export async function stopBeeGameDevServices(services: Array<{ child: {
  kill(signal: 'SIGTERM'): unknown; exited: Promise<number>; exitCode?: number | null
} }>): Promise<void> {
  const results = await Promise.allSettled(services.map(async ({ child }) => {
    if (child.exitCode == null) child.kill('SIGTERM')
    await child.exited
  }))
  const failures = results.filter(result => result.status === 'rejected')
  if (failures.length) throw new Error('Some local services did not confirm shutdown')
}

/** A failed service is observable, not an instruction to stop its siblings. */
export async function waitForBeeGameDevServices(
  services: Array<{ name: BeeGameDevProcessName; child: {
    pid: number
    exited: Promise<number>
    signalCode: string | null
  } }>,
  report: (event: { service: BeeGameDevProcessName; pid: number; exitCode: number | null; signal: string | null; error?: string }) => void,
): Promise<void> {
  await Promise.all(services.map(async ({ name, child }) => {
    try {
      const exitCode = await child.exited
      report({ service: name, pid: child.pid, exitCode, signal: child.signalCode })
    } catch (error) {
      report({ service: name, pid: child.pid, exitCode: null, signal: child.signalCode, error: String(error) })
    }
  }))
}

export type BeeGameDevProcessPlan = {
  name: BeeGameDevProcessName
  command: string[]
  cwd: string
  env: Record<string, string>
}

export type BeeGameDevPlan = {
  workspacePath: string
  frontendDir: string
  runtimePreflight: {
    command: string[]
    cwd: string
    env: Record<string, string>
  }
  ports: BeeGameDevPorts
  urls: {
    frontend: string
    runtime: string
    billing: string
    skills: string
    resources: string
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
  assertFixedServicePortConfiguration({ argv, env: input.env })
  if (values.workspace !== undefined)
    throw new Error(
      'BeeGame workspace root is server-managed; remove the --workspace override',
    )
  assertProgrammaticPorts(input.ports)
  const ports: BeeGameDevPorts = { ...BEEGAME_FIXED_SERVICE_PORTS }
  const configuredWorkspace = String(
    input.env.AGENT_WORKFLOW_WORKSPACE_PATH || '',
  ).trim()
  if (!configuredWorkspace)
    throw new Error('AGENT_WORKFLOW_WORKSPACE_PATH is required')
  if (!isAbsolute(configuredWorkspace))
    throw new Error('AGENT_WORKFLOW_WORKSPACE_PATH must be absolute')
  const workspacePath = resolve(configuredWorkspace)
  const frontendDir = resolve(input.cwd, values.frontend || 'apps/frontend')
  const bunExecutable = input.bunExecutable ?? 'bun'
  const frontendCommand = [
    bunExecutable,
    'run',
    'dev',
    '--',
    '--host',
    '127.0.0.1',
    '--port',
    String(ports.frontend),
    ...(needsViteDependencyRefresh(frontendDir) ? ['--force'] : []),
  ]
  const urls = {
    frontend: `http://127.0.0.1:${ports.frontend}`,
    runtime: `http://127.0.0.1:${ports.runtime}`,
    billing: `http://127.0.0.1:${ports.billing}`,
    skills: `http://127.0.0.1:${ports.skills}`,
    resources: `http://127.0.0.1:${ports.resources}`,
  }

  return {
    workspacePath,
    frontendDir,
    runtimePreflight: {
      command: [bunExecutable, 'run', 'scripts/check-bgs.ts'],
      cwd: input.cwd,
      // Capabilities stay in the binary; the runtime settings panel selects usage.
      env: {},
    },
    ports,
    urls,
    processes: ([
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
        name: 'resources',
        // The resource worker owns its queue and uses the runtime model bridge.
        command: [bunExecutable, 'packages/beegame-resource-server/src/index.ts'],
        cwd: input.cwd,
        env: buildResourceEnv(input.env, ports),
      },
      {
        name: 'frontend',
        command: frontendCommand,
        cwd: frontendDir,
        env: buildFrontendEnv({
          baseEnv: input.env,
          ports,
        }),
      },
    ] satisfies BeeGameDevProcessPlan[]).map(process=>{
      // This per-project authorization belongs only to the execution host.
      if(process.name!=='runtime')delete process.env.BEEGAME_PROJECT_TOOL_READ_PATHS
      return process
    }),
  }
}

/**
 * A partially written Vite dependency manifest makes lazy route imports fail
 * with an opaque "Failed to fetch dynamically imported module" error. This
 * only forces Vite's normal optimizer when its cache is absent or empty; a
 * healthy cache keeps the regular fast startup path.
 */
function needsViteDependencyRefresh(frontendDir: string): boolean {
  const metadataPath = resolve(frontendDir, 'node_modules/.vite/deps/_metadata.json')
  if (!existsSync(metadataPath)) return true
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as {
      optimized?: Record<string, unknown>
    }
    return !metadata.optimized || Object.keys(metadata.optimized).length === 0
  } catch {
    return true
  }
}

function buildBillingEnv(
  baseEnv: Record<string, string | undefined>,
  ports: BeeGameDevPorts,
): Record<string, string> {
  const serviceEnv = withDirectSupabaseConnection(baseEnv)
  return compactEnv({
    ...serviceEnv,
    BEEGAME_BILLING_MODE: 'server',
    BEEGAME_BILLING_HOST: '127.0.0.1',
    BEEGAME_BILLING_PORT: String(ports.billing),
  })
}

function buildSkillsEnv(
  baseEnv: Record<string, string | undefined>,
  ports: BeeGameDevPorts,
): Record<string, string> {
  const serviceEnv = withDirectSupabaseConnection(baseEnv)
  return compactEnv({
    ...serviceEnv,
    BEEGAME_SKILLS_HOST: '127.0.0.1',
    BEEGAME_SKILLS_PORT: String(ports.skills),
  })
}

function buildResourceEnv(
  baseEnv: Record<string, string | undefined>,
  ports: BeeGameDevPorts,
): Record<string, string> {
  const serviceEnv = withDirectSupabaseConnection(baseEnv)
  return compactEnv({
    ...serviceEnv,
    BEEGAME_RESOURCE_HOST: '127.0.0.1',
    BEEGAME_RESOURCE_PORT: String(ports.resources),
    BEEGAME_RUNTIME_SERVER_URL: `http://127.0.0.1:${ports.runtime}`,
    BEEGAME_RESOURCE_SERVICE_TOKEN:
      baseEnv.BEEGAME_RESOURCE_SERVICE_TOKEN || LOCAL_RESOURCE_SELECTION_TOKEN,
  })
}

export function buildRuntimeEnv(input: {
  baseEnv: Record<string, string | undefined>
  ports: BeeGameDevPorts
  workspacePath: string
}): Record<string, string> {
  const serviceEnv = withDirectSupabaseConnection(
    omitFrontendAndRuntimeForbiddenEnv(input.baseEnv),
  )
  return compactEnv({
    ...serviceEnv,
    // V3 persistence is host-only. Native model environments still use their
    // separate allowlist, and the frontend never receives these credentials.
    BEEGAME_SUPABASE_SERVICE_ROLE_KEY: input.baseEnv.BEEGAME_SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: input.baseEnv.SUPABASE_SERVICE_ROLE_KEY,
    NODE_ENV: input.baseEnv.NODE_ENV || 'development',
    AGENT_WORKFLOW_PORT: String(input.ports.runtime),
    AGENT_WORKFLOW_WORKSPACE_PATH: input.workspacePath,
    // The local runtime serves measured V3 Preview on isolated *.localhost
    // hosts. Production still requires its explicitly configured HTTPS origin.
    BEEGAME_WORKFLOW_V3_PREVIEW_ORIGIN:
      input.baseEnv.BEEGAME_WORKFLOW_V3_PREVIEW_ORIGIN || `http://localhost:${input.ports.runtime}`,
    BEEGAME_API_CORS_ORIGINS: appendApiCorsOrigin(
      input.baseEnv.BEEGAME_API_CORS_ORIGINS,
      `http://127.0.0.1:${input.ports.frontend}`,
    ),
    BEEGAME_BILLING_MODE: 'remote',
    BEEGAME_BILLING_API_BASE_URL: `http://127.0.0.1:${input.ports.billing}`,
    BEEGAME_SKILLS_API_BASE_URL: `http://127.0.0.1:${input.ports.skills}`,
    BEEGAME_RESOURCE_SERVER_URL:
      input.baseEnv.BEEGAME_RESOURCE_SERVER_URL || `http://127.0.0.1:${input.ports.resources}`,
    BEEGAME_RESOURCE_SERVICE_TOKEN:
      input.baseEnv.BEEGAME_RESOURCE_SERVICE_TOKEN || LOCAL_RESOURCE_SELECTION_TOKEN,
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

/**
 * Local development often uses a general-purpose HTTPS proxy for model
 * providers. Supabase is the platform control plane and must retain its own
 * end-to-end TLS identity instead of being sent through that proxy.
 */
function withDirectSupabaseConnection(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const rawUrl =
    env.BEEGAME_SUPABASE_URL ??
    env.SUPABASE_URL ??
    env.VITE_SUPABASE_URL
  if (!rawUrl) return env

  let hostname: string
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return env
    hostname = url.hostname
  } catch {
    return env
  }
  if (!hostname) return env

  return {
    ...env,
    NO_PROXY: appendNoProxyHost(env.NO_PROXY, hostname),
    no_proxy: appendNoProxyHost(env.no_proxy, hostname),
  }
}

function appendNoProxyHost(
  value: string | undefined,
  hostname: string,
): string {
  const entries = (value ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
  if (!entries.includes(hostname)) entries.push(hostname)
  return entries.join(',')
}

function buildFrontendEnv(input: {
  baseEnv: Record<string, string | undefined>
  ports: BeeGameDevPorts
}): Record<string, string> {
  return compactEnv({
    ...omitFrontendAndRuntimeForbiddenEnv(input.baseEnv),
    PORT: String(input.ports.frontend),
    VITE_API_BASE_URL: `http://127.0.0.1:${input.ports.runtime}`,
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

function assertProgrammaticPorts(ports: BeeGameDevPorts): void {
  for (const service of Object.keys(BEEGAME_FIXED_SERVICE_PORTS) as Array<keyof BeeGameDevPorts>) {
    const expected = BEEGAME_FIXED_SERVICE_PORTS[service]
    if (ports[service] !== expected)
      throw new Error(`${service} must use fixed port ${expected}`)
  }
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
  'BEEGAME_RESOURCE_SERVICE_TOKEN',
])

function omitFrontendAndRuntimeForbiddenEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !FRONTEND_AND_RUNTIME_FORBIDDEN_ENV.has(key)),
  )
}
