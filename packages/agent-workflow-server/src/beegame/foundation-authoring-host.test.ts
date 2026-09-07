import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BeeGameUsageBillingClient } from '@bee-game-studio/beegame-billing-core/usage-control-client'
import type { BeeGameSessionCredential } from '../auth/session-routes'
import { authorDigest } from './stage-modules/foundation-authoring/private/contract'
import { createFoundationAuthoringHost } from './foundation-authoring-host'

const billingClient = {
  async recordUsage() { throw new Error('billing should not be reached in this fixture') },
  async debitRealTimeUsage() { throw new Error('billing should not be reached in this fixture') },
} as BeeGameUsageBillingClient

function startInput(ownerId: string, requestId: string) {
  const input = {
    confirmedBrief: 'Host assembly fixture',
    confirmedBriefDigest: createHash('sha256').update('Host assembly fixture').digest('hex'),
  }
  return {
    protocolVersion: 1 as const,
    requestId,
    ownerId,
    projectId: 'project-1',
    input,
    inputDigest: authorDigest({ ownerId, projectId: 'project-1', input }),
  }
}

function hostOptions(overrides: Record<string, unknown> = {}) {
  const ownerId = 'owner-1'
  const base = {
    ownerId,
    workspacePath: '/tmp/foundation-authoring-host-fixture',
    dataDir: '/tmp/foundation-authoring-host-data',
    command: ['native-model'],
    getCredential: () => undefined as BeeGameSessionCredential | undefined,
    getRuntimeEnv: async () => ({}),
    billingClient,
    ...overrides,
  }
  return base
}

async function waitForSettled(host: ReturnType<typeof createFoundationAuthoringHost>, handle: unknown) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await host.getResult(handle as never)
    if (result.status !== 'running') return result
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('host fixture did not settle')
}

test('returns a lazy four-method public port and does not execute command at assembly', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-authoring-host-lazy-'))
  let commandCalls = 0
  const host = createFoundationAuthoringHost(hostOptions({
    workspacePath,
    getCommand: () => {
      commandCalls += 1
      return ['native-model']
    },
    command: undefined,
  }))

  expect(Object.keys(host).sort()).toEqual(['getResult', 'resume', 'start', 'stop'])
  expect(Object.isFrozen(host)).toBe(true)
  expect(commandCalls).toBe(0)
  await expect(host.getResult({} as never)).rejects.toThrow('could not be accepted')
  expect(commandCalls).toBe(1)
})

test('snapshots bound options and command before the first lazy operation', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-authoring-host-snapshot-'))
  const runtimeCalls: Array<{ token: string | undefined; modelConfigId: string | undefined }> = []
  const credential: BeeGameSessionCredential = {
    async getValidAccessToken() { return 'snapshot-token' },
  }
  const fixture = hostOptions({
    workspacePath,
    command: ['/definitely/missing/native-model'],
    modelConfigId: 'model-original',
    getCredential: () => credential,
    getRuntimeEnv: async (_dataDir: string | undefined, _ownerId: string | undefined, token: string | undefined, modelConfigId: string | undefined) => {
      runtimeCalls.push({ token, modelConfigId })
      return {}
    },
  }) as ReturnType<typeof hostOptions> & { command: string[]; modelConfigId?: string }
  const host = createFoundationAuthoringHost(fixture)
  fixture.command[0] = ''
  fixture.modelConfigId = 'model-mutated'
  fixture.getRuntimeEnv = async () => { throw new Error('mutated reader must not be used') }

  const handle = await host.start(startInput('owner-1', 'snapshot-start'))
  await waitForSettled(host, handle)
  expect(runtimeCalls).toEqual([{ token: 'snapshot-token', modelConfigId: 'model-original' }])
})

test('clears a failed lazy assembly so a later explicit operation can retry', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-authoring-host-retry-'))
  let commandCalls = 0
  const host = createFoundationAuthoringHost(hostOptions({
    workspacePath,
    getCommand: () => {
      commandCalls += 1
      if (commandCalls === 1) throw new Error('native command is not ready')
      return ['/definitely/missing/native-model']
    },
    command: undefined,
  }))

  await expect(host.getResult({} as never)).rejects.toThrow('native command is not ready')
  await expect(host.getResult({} as never)).rejects.toThrow('could not be accepted')
  expect(commandCalls).toBe(2)
})

test('binds owner and dynamically delegates the current credential on each start', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-authoring-host-'))
  let currentToken = 'token-one'
  const credentialCalls: Array<string | undefined> = []
  const runtimeCalls: Array<{ token: string | undefined; modelConfigId: string | undefined }> = []
  const credential: BeeGameSessionCredential = {
    async getValidAccessToken() {
      credentialCalls.push(currentToken)
      return currentToken
    },
  }
  const host = createFoundationAuthoringHost(hostOptions({
    workspacePath,
    dataDir: join(workspacePath, 'data'),
    modelConfigId: 'model-1',
    command: ['/definitely/missing/native-model'],
    getCredential: () => credential,
    getRuntimeEnv: async (_dataDir: string | undefined, _ownerId: string | undefined, token: string | undefined, modelConfigId: string | undefined) => {
      runtimeCalls.push({ token, modelConfigId })
      return {}
    },
  }))

  const firstHandle = await host.start(startInput('owner-1', 'host-start-1'))
  await waitForSettled(host, firstHandle)
  currentToken = 'token-two'
  const secondHandle = await host.start(startInput('owner-1', 'host-start-2'))
  await waitForSettled(host, secondHandle)
  expect(credentialCalls).toEqual(['token-one', 'token-two'])
  expect(runtimeCalls).toEqual([
    { token: 'token-one', modelConfigId: 'model-1' },
    { token: 'token-two', modelConfigId: 'model-1' },
  ])
})

test('defaults to required authentication and fails closed when the current credential is absent', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-authoring-host-auth-'))
  let repositoryCalls = 0
  const host = createFoundationAuthoringHost(hostOptions({
    workspacePath,
    command: ['/definitely/missing/native-model'],
    getCredential: () => undefined,
    getRuntimeEnv: async () => {
      repositoryCalls += 1
      return {}
    },
  }))

  const handle = await host.start(startInput('owner-1', 'missing-credential'))
  const result = await waitForSettled(host, handle)
  expect(result.status).toBe('needs_action')
  expect(repositoryCalls).toBe(0)
})

test('rejects old worker/session callback injection and foreign owners at the public boundary', async () => {
  expect(() => createFoundationAuthoringHost(hostOptions({
    workerPort: {},
  }))).toThrow('unexpected fields')
  const host = createFoundationAuthoringHost(hostOptions({
    workspacePath: await mkdtemp(join(tmpdir(), 'foundation-authoring-host-owner-')),
  }))
  await expect(host.start(startInput('other-owner', 'foreign-owner'))).rejects.toThrow('could not be accepted')
})
