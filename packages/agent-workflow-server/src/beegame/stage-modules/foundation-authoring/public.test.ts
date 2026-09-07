import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFoundationAuthoring } from './public'
import { authorDigest } from './private/contract'
import { createAuthenticationClient } from '../../../auth/public'
import { createRuntimeConfigurationClient } from '../../../runtime-configuration/public'
import type { UsageBillingClient } from '../../../billing/public'

test('production public API completes against an offline executable, with no injected worker callbacks', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'author-public-native-')))
  let tokenCalls = 0
  const authentication = createAuthenticationClient({ ownerId: 'fixture-owner', credential: {
    async getValidAccessToken() { tokenCalls++; return 'offline-fixture-token' },
  } })
  const runtimeConfiguration = createRuntimeConfigurationClient({ ownerId: 'fixture-owner', dataDir: workspacePath,
    authentication, repository: { async getRuntimeEnv(_dataDir, ownerId, token) {
      expect(ownerId).toBe('fixture-owner'); expect(token).toBe('offline-fixture-token'); return {}
    } }, command: [process.execPath, fileURLToPath(new URL('./private/test-fixtures/native-author.ts', import.meta.url))] })
  const billing: UsageBillingClient = { protocolVersion: 1, ownerId: 'fixture-owner', async submitUsage(input) {
    return { protocolVersion: 1, ownerId: input.ownerId, eventId: input.eventId, idempotencyKey: input.eventId,
      pricingVersion: 'weighted-v1', usageSource: 'runtime_snapshot', usage: input.usage, duplicate: false, skipped: true }
  } }
  const stage = createFoundationAuthoring({ workspacePath,
    privateRootPath: join(workspacePath, '.beegame/workflow/foundation-authoring/state') }, { runtimeConfiguration, billing })
  expect(Object.keys(stage).sort()).toEqual(['getResult', 'resume', 'start', 'stop'])
  const input = { confirmedBrief: 'Public offline fixture', confirmedBriefDigest: createHash('sha256').update('Public offline fixture').digest('hex') }
  const handle = await stage.start({ protocolVersion: 1, requestId: 'native-fixture', ownerId: 'fixture-owner', projectId: 'fixture-project', input,
    inputDigest: authorDigest({ ownerId: 'fixture-owner', projectId: 'fixture-project', input }) })
  for (let attempt = 0; attempt < 400; attempt++) {
    const result = await stage.getResult(handle)
    if (result.status !== 'running') {
      expect(result.status).toBe('completed')
      expect(result.status === 'completed' && result.result.documents.length).toBe(8)
      expect(result.billingStatus).toBe('settled')
      expect(tokenCalls).toBe(8)
      return
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  await stage.stop({ handle, requestId: 'timeout-stop', reason: 'Offline fixture timed out' })
  throw new Error('Public author executable fixture timed out')
}, 10_000)

test('public author has no implicit unauthenticated or unmetered production path', () => {
  expect(() => createFoundationAuthoring({ workspacePath: '/unused', privateRootPath: '/unused' }, undefined as never)).toThrow('requires owner-bound')
})
