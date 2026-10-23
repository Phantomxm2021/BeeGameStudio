import { test, expect } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { paidDebugRuntimeConfig } from './workflow-v3-paid-debug-config'
import { buildBeeGameDevPlan } from './beegame-dev-lib'
import { BEEGAME_FIXED_SERVICE_PORTS } from '../packages/agent-workflow-server/src/beegame/fixed-service-ports'
import { openAgentTools } from '../packages/agent-workflow-server/src/beegame/workflow-v3/agent-tools'

test('paid debug shares normal local resource/skills/billing wiring without starting services', async () => {
  const base = { AGENT_WORKFLOW_WORKSPACE_PATH: '/synthetic/projects', NODE_ENV: 'development' }
  const copy = { ...base }, config = paidDebugRuntimeConfig(base)
  const normal = buildBeeGameDevPlan([], { cwd: '/synthetic/repo', env: base, ports: BEEGAME_FIXED_SERVICE_PORTS })
    .processes.find(process => process.name === 'runtime')!
  expect(config.env).toEqual(normal.env)
  expect(config.resources.baseUrl).toBe(normal.env.BEEGAME_RESOURCE_SERVER_URL!)
  expect(config.resources.serviceToken).toBe(normal.env.BEEGAME_RESOURCE_SERVICE_TOKEN!)
  expect(base).toEqual(copy)
  const source = await readFile(new URL('./serve-workflow-v3-paid-debug.ts', import.meta.url), 'utf8')
  expect(source).toContain('resourceSelectionRuntimeConfig: runtimeConfig.resources')
  expect(source).toContain('Object.assign(process.env, runtimeConfig.env)')
})

test('explicit resource config is preserved and partial/invalid config is not silently replaced', () => {
  const base = { AGENT_WORKFLOW_WORKSPACE_PATH: '/synthetic/projects', NODE_ENV: 'development' }
  const explicit = { ...base, BEEGAME_RESOURCE_SERVER_URL: 'https://resources.example.invalid', BEEGAME_RESOURCE_SERVICE_TOKEN: 'synthetic-service-secret' }
  expect(paidDebugRuntimeConfig(explicit).resources).toEqual({ baseUrl: explicit.BEEGAME_RESOURCE_SERVER_URL, serviceToken: explicit.BEEGAME_RESOURCE_SERVICE_TOKEN })
  expect(() => paidDebugRuntimeConfig({ ...base, BEEGAME_RESOURCE_SERVER_URL: explicit.BEEGAME_RESOURCE_SERVER_URL })).toThrow('configured together')
  expect(() => paidDebugRuntimeConfig({ ...base, BEEGAME_RESOURCE_SERVICE_TOKEN: explicit.BEEGAME_RESOURCE_SERVICE_TOKEN })).toThrow('configured together')
  expect(() => paidDebugRuntimeConfig({ ...explicit, BEEGAME_RESOURCE_SERVER_URL: 'file:///secret' })).toThrow('HTTP(S)')
  expect(() => paidDebugRuntimeConfig({})).toThrow('WORKSPACE_PATH')
})

test('configured acceptance bridge queries real catalog transport; no auth/error is not an empty result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-paid-config-'))
  const calls: string[] = []; let credential: string | undefined = 'synthetic-user', failing = false
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    calls.push(request.headers.get('authorization') ?? '')
    return failing ? Response.json({ error: 'Synthetic upstream unavailable' }, { status: 503 })
      : Response.json({ items: [{ packId: 'synthetic-pack' }] })
  } })
  const config = paidDebugRuntimeConfig({ NODE_ENV: 'development', AGENT_WORKFLOW_WORKSPACE_PATH: root,
    BEEGAME_RESOURCE_SERVER_URL: server.url.origin, BEEGAME_RESOURCE_SERVICE_TOKEN: 'synthetic-service-secret' })
  const tools = await openAgentTools({ workspacePath: root, libraryBaseUrl: config.resources.baseUrl, getAuthToken: () => credential })
  const catalog = async () => {
    const child = Bun.spawn([process.execPath, join(root, tools.directory, 'assets.mjs'), 'catalog'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { out, err, code }
  }
  try {
    expect(calls).toHaveLength(0) // preparation is not acquisition/generation
    expect(tools.turnContext).toContain('bridge is configured')
    const success = await catalog()
    expect(success.code, success.err).toBe(0)
    expect(JSON.parse(success.out).items[0].packId).toBe('synthetic-pack')
    expect(calls).toEqual(['Bearer synthetic-user'])
    expect(await readFile(join(root, tools.directory, 'assets.mjs'), 'utf8')).not.toContain('synthetic-service-secret')
    credential = undefined
    const unauthorized = await catalog()
    expect(unauthorized.code).toBe(1); expect(unauthorized.err).toContain('not an empty search result')
    expect(calls).toHaveLength(1)
    credential = 'synthetic-user'; failing = true
    const failure = await catalog()
    expect(failure.code).toBe(1); expect(failure.err).toContain('Synthetic upstream unavailable')
  } finally { await tools.close(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 30000)
