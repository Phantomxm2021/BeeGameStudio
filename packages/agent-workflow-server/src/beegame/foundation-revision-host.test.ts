import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BeeGameSessionCredential } from '../auth/session-routes'
import { createFoundationRevisionHost, type FoundationRevisionHostOptions } from './foundation-revision-host'
import { foundationRevisionInputDigest, type RevisionHandle, type RevisionResult,
  type RevisionStartInput } from './stage-modules/foundation-revision/public'
import fixtures from './stage-modules/foundation-revision/private/tests/fixtures/public-initial-inputs.json'

const ownerId = fixtures.infrastructure.start.ownerId
const roots: string[] = []
const live: { host: ReturnType<typeof createFoundationRevisionHost>; handle: RevisionHandle }[] = []

// These tests stop at authentication/configuration failure. No native worker,
// model service or billing authority is started by any test.
afterEach(async () => {
  for (const { host, handle } of live.splice(0)) {
    await host.stop({ handle, requestId: 'host-cleanup-' + crypto.randomUUID(), reason: 'shutdown' })
    await waitFor(host, handle, value => value.status === 'stopped')
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'revision-host-contract-')))
  roots.push(workspacePath)
  let billingCalls = 0
  let credentialCalls = 0
  let configurationCalls = 0
  const options: FoundationRevisionHostOptions = {
    ownerId,
    workspacePath,
    dataDir: join(workspacePath, 'offline-data'),
    command: ['native-must-not-be-dispatched'],
    getCredential() { credentialCalls++; return undefined },
    async getRuntimeEnv() { configurationCalls++; throw new Error('offline configuration unavailable') },
    billingClient: {
      async recordUsage() { billingCalls++; throw new Error('offline billing must not execute') },
      async debitRealTimeUsage() { billingCalls++; throw new Error('offline billing must not execute') },
    },
  }
  return { options, counts: () => ({ billingCalls, credentialCalls, configurationCalls }) }
}

function startInput(requestId: string): RevisionStartInput {
  const start = structuredClone(fixtures.infrastructure.start) as RevisionStartInput
  start.requestId = requestId
  return start
}

async function waitFor(host: ReturnType<typeof createFoundationRevisionHost>, handle: RevisionHandle,
  predicate: (value: RevisionResult) => boolean) {
  const deadline = Date.now() + 5000
  let latest: RevisionResult | undefined
  while (Date.now() < deadline) {
    latest = await host.getResult(handle)
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Revision host did not reach expected public state: ' + latest?.status)
}

test('host assembly exposes only four frozen public operations and stays lazy', async () => {
  const f = await fixture()
  let commandCalls = 0
  const host = createFoundationRevisionHost({
    ...f.options,
    command: undefined,
    getCommand() { commandCalls++; return ['native-must-not-be-dispatched'] },
  })
  expect(Object.keys(host).sort()).toEqual(['getResult', 'resume', 'start', 'stop'])
  expect(Object.isFrozen(host)).toBe(true)
  expect(commandCalls).toBe(0)
  expect(f.counts()).toEqual({ billingCalls: 0, credentialCalls: 0, configurationCalls: 0 })
  await expect(host.getResult({} as never)).rejects.toThrow('could not be accepted')
  await expect(host.getResult({} as never)).rejects.toThrow('could not be accepted')
  expect(commandCalls).toBe(1)
  expect(f.counts()).toEqual({ billingCalls: 0, credentialCalls: 0, configurationCalls: 0 })
})

test('a failed lazy assembly can be attempted again by a later explicit call', async () => {
  const f = await fixture()
  let calls = 0
  const host = createFoundationRevisionHost({
    ...f.options,
    command: undefined,
    getCommand() {
      calls++
      if (calls === 1) throw new Error('offline command not ready')
      return ['native-must-not-be-dispatched']
    },
  })
  await expect(host.getResult({} as never)).rejects.toThrow('offline command not ready')
  await expect(host.getResult({} as never)).rejects.toThrow('could not be accepted')
  expect(calls).toBe(2)
  expect(f.counts()).toEqual({ billingCalls: 0, credentialCalls: 0, configurationCalls: 0 })
})

test('missing credentials produce needs_action without configuration or billing calls', async () => {
  const f = await fixture()
  const host = createFoundationRevisionHost(f.options)
  const handle = await host.start(startInput('host-auth-missing'))
  live.push({ host, handle })
  const result = await waitFor(host, handle, value => value.status === 'needs_action')
  expect(result).toMatchObject({ status: 'needs_action', resumable: true, billingStatus: 'settled' })
  expect(f.counts()).toEqual({ billingCalls: 0, credentialCalls: 1, configurationCalls: 0 })
  await host.getResult(handle)
  expect(f.counts().credentialCalls).toBe(1)
})

test('bound configuration is snapshotted while the credential getter stays dynamic', async () => {
  const f = await fixture()
  let currentCredential: BeeGameSessionCredential = { async getValidAccessToken() { return 'offline-token-one' } }
  const seen: Array<{ dataDir: string | undefined; owner: string | undefined; token: string | undefined; model: string | undefined }> = []
  const options: FoundationRevisionHostOptions = {
    ...f.options,
    modelConfigId: 'original-model',
    getCredential: () => currentCredential,
    async getRuntimeEnv(dataDir, owner, token, model) {
      seen.push({ dataDir, owner, token, model })
      throw new Error('offline configuration unavailable')
    },
  }
  const host = createFoundationRevisionHost(options)
  ;(options.command as string[])[0] = ''
  options.ownerId = 'mutated-owner'
  options.workspacePath = '/not-used-mutated-workspace'
  options.dataDir = '/not-used-mutated-data'
  options.modelConfigId = 'mutated-model'
  options.getCredential = () => { throw new Error('mutated getter must not run') }
  options.getRuntimeEnv = async () => { throw new Error('mutated reader must not run') }

  const handle = await host.start(startInput('host-snapshot'))
  live.push({ host, handle })
  await waitFor(host, handle, value => value.status === 'needs_action')
  currentCredential = { async getValidAccessToken() { return 'offline-token-two' } }
  await host.resume({ handle, requestId: 'host-credential-refresh' })
  await waitFor(host, handle, value => value.status === 'needs_action' && seen.length === 2)
  expect(seen).toEqual([
    { dataDir: f.options.dataDir, owner: ownerId, token: 'offline-token-one', model: 'original-model' },
    { dataDir: f.options.dataDir, owner: ownerId, token: 'offline-token-two', model: 'original-model' },
  ])
  expect(f.counts().billingCalls).toBe(0)
})

test('wrong-owner calls are rejected before credential, configuration or billing access', async () => {
  const f = await fixture()
  const host = createFoundationRevisionHost(f.options)
  const input = startInput('host-foreign-owner')
  input.ownerId = 'other-owner'
  input.inputDigest = foundationRevisionInputDigest({ ownerId: input.ownerId, projectId: input.projectId, input: input.input })
  await expect(host.start(input)).rejects.toThrow('could not be accepted')
  expect(f.counts()).toEqual({ billingCalls: 0, credentialCalls: 0, configurationCalls: 0 })
})

test('rejects extra host authority and ambiguous or malformed command sources', async () => {
  const f = await fixture()
  expect(() => createFoundationRevisionHost({ ...f.options, workerPort: {} } as never)).toThrow('unexpected fields')
  expect(() => createFoundationRevisionHost({ ...f.options, getCommand: () => ['native'] })).toThrow('exactly one')
  expect(() => createFoundationRevisionHost({ ...f.options, command: undefined })).toThrow('exactly one')
  expect(() => createFoundationRevisionHost({ ...f.options, command: [] })).toThrow('command is invalid')
  expect(() => createFoundationRevisionHost({ ...f.options, ownerId: '' })).toThrow('ownerId')
  expect(f.counts()).toEqual({ billingCalls: 0, credentialCalls: 0, configurationCalls: 0 })
})
