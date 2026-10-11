import { mock } from 'bun:test'
import { getMacroDefines } from '../../../../scripts/defines.js'

Object.assign(globalThis, {
  MACRO: Object.fromEntries(
    Object.entries(getMacroDefines()).map(([key, value]) => [
      key.replace('MACRO.', ''),
      JSON.parse(value),
    ]),
  ),
})
process.env.NODE_ENV = 'test'
process.env.BGS_SIMPLE = '1'
process.env.BGS_DISABLE_NONESSENTIAL_TRAFFIC = '1'
process.env.BEEGAME_CONFIG_DIR = `/private/tmp/bgs-acp-context-${process.pid}`
const state = await import('../../../bootstrap/state.js')
const initialCwd = state.getOriginalCwd()
const initialSession = state.getSessionId()
const configs: { cwd: string }[] = []
const historyContexts: { cwd: string; projectDir: string | null }[] = []
const observations: {
  cwd: string
  originalCwd: string
  projectRoot: string
  sessionId: string
  projectDir: string | null
  flag?: string
}[] = []
let hold: Promise<void> | undefined
let release!: () => void
let entered!: () => void
let fail = false
async function patch(path: string, overrides: Record<string, unknown>) {
  const original = await import(path)
  mock.module(path, () => ({ ...original, ...overrides }))
}
await patch('../../../QueryEngine.js', {
  QueryEngine: class {
    constructor(readonly config: { cwd: string }) {
      configs.push(config)
    }
    setModel() {}
    resetAbortController() {}
    interrupt() {}
    getAbortSignal() {
      return new AbortController().signal
    }
    async *submitMessage() {
      observations.push({
        cwd: this.config.cwd,
        originalCwd: state.getOriginalCwd(),
        projectRoot: state.getProjectRoot(),
        sessionId: state.getSessionId(),
        projectDir: state.getSessionProjectDir(),
        flag: process.env.BGS_ACP_FIXTURE_FLAG,
      })
      entered?.()
      if (hold) await hold
      if (fail) throw new Error('fixture failure')
      yield { type: 'fixture' }
    }
  },
})
await patch('../../../tools.js', { getTools: () => [] })
await patch('../../../utils/config.js', { enableConfigs() {} })
await patch('../../../utils/settings/settingsCache.js', {
  resetSettingsCache() {},
})
await patch('../../../utils/settings/settings.js', {
  getSettings_DEPRECATED: () => ({}),
})
await patch('../../../utils/managedEnv.js', {
  applySafeConfigEnvironmentVariables() {
    if (
      state.getOriginalCwd() === process.cwd() &&
      process.cwd() !== '/private/tmp'
    ) {
      process.env.BGS_ACP_FIXTURE_FLAG = 'project-A'
    }
  },
})
await patch('../../../commands.js', { getCommands: async () => [] })
await patch(
  '../../../../packages/builtin-tools/src/tools/AgentTool/loadAgentsDir.js',
  {
    getAgentDefinitionsWithOverrides: async () => ({
      activeAgents: [],
      allAgents: [],
    }),
  },
)
await patch('../../../utils/model/model.js', {
  getMainLoopModel: () => 'fixture',
})
await patch('../../../utils/model/modelOptions.js', {
  getModelOptions: () => [],
})
await patch('../../../utils/sessionStoragePortable.js', {
  resolveSessionFilePath: async () => ({
    filePath: '/fixture/resumed/session.jsonl',
  }),
})
await patch('../../../utils/sessionStorage.js', {
  getLastSessionLog: async () => {
    historyContexts.push({
      cwd: state.getOriginalCwd(),
      projectDir: state.getSessionProjectDir(),
    })
    return null
  },
})
await patch('../bridge.js', {
  forwardSessionUpdates: async (
    _id: string,
    stream: AsyncIterable<unknown>,
  ) => {
    for await (const _message of stream) {
      /* consume actual query submission */
    }
    return { stopReason: 'end_turn' }
  },
})
const { AcpAgent } = await import('../agent.js')
const conn = {
  sessionUpdate: async () => {},
  requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
}
const agent = new AcpAgent(conn as any)
const init = await agent.initialize({
  protocolVersion: 1,
  clientCapabilities: {},
})
const a = await agent.createSession({ cwd: process.cwd(), mcpServers: [] })
const b = await agent.createSession({ cwd: '/private/tmp', mcpServers: [] })
state.setPlanSlugCacheEntry(a.sessionId, 'plan-A')
state.setPlanSlugCacheEntry(b.sessionId, 'plan-B')
const send = (sessionId: string) =>
  agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'fixture' }] })
await send(a.sessionId)
await send(b.sessionId)
const sequential = observations.splice(0)
const planSlugs = [
  state.getPlanSlugCache().get(a.sessionId),
  state.getPlanSlugCache().get(b.sessionId),
]
const observedRestoration =
  state.getOriginalCwd() === initialCwd &&
  state.getSessionId() === initialSession &&
  process.env.BGS_ACP_FIXTURE_FLAG === undefined

// While A is running, neither B's prompt nor session creation may change globals.
hold = new Promise<void>(resolve => {
  release = resolve
})
const started = new Promise<void>(resolve => {
  entered = resolve
})
const first = send(a.sessionId)
await started
const second = send(b.sessionId)
let created = false
const creation = agent
  .createSession({ cwd: '/private/tmp', mcpServers: [] })
  .then(() => {
    created = true
  })
await Promise.resolve()
const during = {
  originalCwd: state.getOriginalCwd(),
  sessionId: state.getSessionId(),
  created,
  submitted: observations.length,
}
await agent.cancel({ sessionId: b.sessionId })
release()
const queuedResult = await second
await first
await creation
hold = undefined
const concurrent = observations.splice(0)

// A failed operation must release the slot and restore process state.
fail = true
let failed = false
try {
  await send(a.sessionId)
} catch {
  failed = true
}
fail = false
await send(b.sessionId)
observations.splice(0)
const afterFailure =
  state.getOriginalCwd() === initialCwd &&
  process.env.BGS_ACP_FIXTURE_FLAG === undefined

await agent.unstable_resumeSession({
  sessionId: 'resumed',
  cwd: '/private/tmp',
  mcpServers: [],
})
await send('resumed')
const resumed = observations.splice(0)
const fresh = await agent.createSession({ cwd: process.cwd(), mcpServers: [] })
await send(fresh.sessionId)
const freshAfterResume = observations.splice(0)
await agent.unstable_forkSession({
  sessionId: 'resumed',
  cwd: '/private/tmp',
  mcpServers: [],
})
const forkHistoryContext = historyContexts.at(-1)
const defaultSessionCwd = agent.defaultSessionCwd
const beforeRejected = configs.length
let rejected = 0
for (const request of [
  () =>
    agent.createSession({
      cwd: process.cwd(),
      mcpServers: [
        {
          type: 'http',
          name: 'fixture',
          url: 'http://127.0.0.1:1/mcp',
          headers: [],
        },
      ],
    }),
  () =>
    agent.unstable_resumeSession({
      sessionId: a.sessionId,
      cwd: process.cwd(),
      mcpServers: [{ name: 'fixture', command: 'unused', args: [], env: [] }],
    }),
]) {
  try {
    await request()
  } catch (error) {
    if ((error as { code?: number }).code === -32602) rejected++
  }
}
console.log(
  JSON.stringify({
    a: a.sessionId,
    b: b.sessionId,
    cwd: process.cwd(),
    sequential,
    planSlugs,
    observedRestoration,
    during,
    concurrent,
    queuedResult,
    failed,
    afterFailure,
    resumed,
    freshAfterResume,
    forkHistoryContext,
    defaultSessionCwd,
    mcpCapabilities: init.agentCapabilities?.mcpCapabilities,
    rejected,
    enginesCreatedOnRejection: configs.length - beforeRejected,
  }),
)
