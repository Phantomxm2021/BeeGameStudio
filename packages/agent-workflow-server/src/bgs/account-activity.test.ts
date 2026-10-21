import { expect, test, spyOn } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Hono } from 'hono'
import { withBgsAccountUse, assertBgsAccountIdle } from './account-activity'
import { createProcessIsolatedModelRuntimeHost } from '../beegame/model-runtime-host'
import { registerModelConnectionRoutes } from '../model-connection-routes'
import { ModelConnectionLogins, disconnectAccount } from '../model-connections'
import { BgsClient, type BgsClientOptions } from './client'
import { getValidChatGPTAuth, bgsHome } from './auth'
import { loadReasoningCapabilities } from './preferences'
import type { PublicModelConfig } from '@bee-game-studio/agent-workflow'

function deferred() {
  let resolve!: () => void
  return { promise: new Promise<void>(done => { resolve = done }), resolve: () => resolve() }
}

test('isolated auxiliary requests block account replacement and logout until every request settles', async () => {
  const root = await mkdtemp('/private/tmp/bgs-account-worker-'), directory = join(root, '.runtime', 'app')
  const path = join(bgsHome(root), 'auth.json'), auth = JSON.stringify({ tokens: { access_token: 'old', refresh_token: 'old' } })
  await mkdir(bgsHome(root), { recursive: true }); await writeFile(path, auth)
  const gates = [deferred(), deferred()], entered = deferred()
  let calls = 0
  const host = createProcessIsolatedModelRuntimeHost({ outboundTargetPolicyOptions: {},
    resolveOutboundTarget: async value => ({ url: new URL(value), addresses: ['93.184.216.34'], lookup: () => {} }),
    runWorker: async () => { const index = calls++; if (calls === 2) entered.resolve(); await gates[index]!.promise
      if (index === 1) throw Error('Synthetic worker failure')
      return 'Synthetic response' },
  })
  const staged: BgsClientOptions[] = []
  const connect = spyOn(BgsClient, 'connect').mockImplementation(async options => {
    staged.push(options)
    return { async request() { return { type: 'chatgptDeviceCode', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'SYNTHETIC' } }, async close() {} } as unknown as BgsClient
  })
  const config = { id: 'fixture', provider: 'openai-compatible', published: true, authMethods: ['chatgpt-subscription'] } as PublicModelConfig
  const logins = new ModelConnectionLogins()
  const app = new Hono()
  registerModelConnectionRoutes(app, { repository: {} as any, getUser: () => ({ id: 'owner', role: 'owner' }), getRoot: () => root, changed() {} })
  const input = { cwd: root, runtimeEnv: { OPENAI_AUTH_MODE: 'chatgpt', BEEGAME_CONFIG_DIR: directory }, systemPrompt: 'Offline', messages: [], querySource: 'offline' }
  const first = host.generate(input), second = host.generate(input)
  void second.catch(() => {})
  try {
    await entered.promise
    expect((await app.request('/api/model-accounts/chatgpt', { method: 'DELETE' })).status).toBe(409)
    const flow = await logins.start('owner', root, config, 'chatgpt-subscription')
    await writeFile(join(staged[0]!.cwd, 'auth.json'), JSON.stringify({ tokens: { access_token: 'new', refresh_token: 'new' } }))
    await staged[0]!.onNotification!('account/login/completed', { success: true })
    expect(logins.status(flow.id, 'owner').status).toBe('failed')
    expect(await readFile(path, 'utf8')).toBe(auth)
    gates[0]!.resolve(); await first
    expect(() => disconnectAccount(root, 'chatgpt')).toThrow('running model requests')
    // A different owner's account is independent.
    expect(() => disconnectAccount(join(root, 'another-owner'), 'chatgpt')).not.toThrow()
    gates[1]!.resolve(); await expect(second).rejects.toThrow('Synthetic worker failure')
    const fresh = await logins.start('owner', root, config, 'chatgpt-subscription')
    await writeFile(join(staged[1]!.cwd, 'auth.json'), JSON.stringify({ tokens: { access_token: 'new', refresh_token: 'new' } }))
    await staged[1]!.onNotification!('account/login/completed', { success: true })
    expect(logins.status(fresh.id, 'owner').status).toBe('complete')
    expect((await app.request('/api/model-accounts/chatgpt', { method: 'DELETE' })).status).toBe(200)
  } finally { gates.forEach(gate => gate.resolve()); await Promise.allSettled([first, second]); logins.dispose(); connect.mockRestore(); await rm(root, { recursive: true, force: true }) }
})

test('native token refresh and model catalog reads keep account replacement blocked through client cleanup', async () => {
  const root = await mkdtemp('/private/tmp/bgs-account-refresh-'), directory = join(root, '.runtime', 'app')
  await mkdir(bgsHome(root), { recursive: true })
  const auth = JSON.stringify({ tokens: { access_token: 'fixture.' + Buffer.from('{"exp":1}').toString('base64url') + '.signature', refresh_token: 'fixture', account_id: 'old' } })
  await writeFile(join(bgsHome(root), 'auth.json'), auth)
  const requested = deferred(), finish = deferred(), closing = deferred(), closed = deferred()
  const connect = spyOn(BgsClient, 'connect').mockImplementation(async () => ({
    async request(method: string) { requested.resolve(); await finish.promise
      return method === 'account/read' ? { account: { type: 'chatgpt' } } : { data: [] } },
    async close() { closing.resolve(); await closed.promise },
  }) as unknown as BgsClient)
  try {
    const refreshing = getValidChatGPTAuth(directory)
    await requested.promise
    expect(() => disconnectAccount(root, 'chatgpt')).toThrow('running model requests')
    finish.resolve(); await closing.promise
    expect(() => disconnectAccount(root, 'chatgpt')).toThrow('running model requests')
    closed.resolve(); await refreshing
    expect(() => assertBgsAccountIdle(directory)).not.toThrow()

    const catalog = loadReasoningCapabilities({ OPENAI_AUTH_MODE: 'chatgpt', BEEGAME_CONFIG_DIR: directory })
    expect(() => disconnectAccount(root, 'chatgpt')).toThrow('running model requests')
    await catalog
    expect(() => assertBgsAccountIdle(directory)).not.toThrow()
  } finally { finish.resolve(); closed.resolve(); connect.mockRestore(); await rm(root, { recursive: true, force: true }) }
})

test('a failed account operation releases its usage count', async () => {
  const directory = '/private/tmp/synthetic-account-failure'
  await expect(withBgsAccountUse(directory, async () => { throw Error('Synthetic failure') })).rejects.toThrow('Synthetic failure')
  expect(() => assertBgsAccountIdle(directory)).not.toThrow()
})
