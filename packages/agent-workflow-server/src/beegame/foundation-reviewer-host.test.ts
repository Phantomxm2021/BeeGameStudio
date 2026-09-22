import { expect, test } from 'bun:test'
import { createFoundationReviewerHost, type FoundationReviewerHostOptions } from './foundation-reviewer-host'

// Assembly-only checks: no stage start, worker, service or billing call.
function fixture() {
  let accesses = 0
  const unexpected = () => { accesses++; throw new Error('unexpected infrastructure access') }
  const options: FoundationReviewerHostOptions = {
    ownerId: 'offline-host-owner', workspacePath: process.cwd(), dataDir: '/unused-offline-data',
    command: ['must-not-run'], getCredential: unexpected,
    getRuntimeEnv: async () => unexpected(),
    billingClient: { recordUsage: async () => unexpected(), debitRealTimeUsage: async () => unexpected() },
  }
  return { options, accesses: () => accesses }
}

test('reviewer host exposes four frozen operations without infrastructure access', async () => {
  const f = fixture()
  let resolutions = 0
  const host = createFoundationReviewerHost({ ...f.options, command: undefined,
    language: 'zh',
    getCommand() { resolutions++; return ['must-not-run'] },
  })
  expect(Object.keys(host).sort()).toEqual(['getResult', 'resume', 'start', 'stop'])
  expect(Object.isFrozen(host)).toBe(true)
  expect(resolutions).toBe(0)
  await expect(host.getResult({} as never)).rejects.toThrow('could not be accepted')
  await expect(host.getResult({} as never)).rejects.toThrow('could not be accepted')
  expect(resolutions).toBe(1)
  expect(f.accesses()).toBe(0)
})

test('reviewer host retries only failed assembly on a later explicit operation', async () => {
  const f = fixture()
  let resolutions = 0
  const host = createFoundationReviewerHost({ ...f.options, command: undefined,
    getCommand() {
      if (++resolutions === 1) throw new Error('command not ready')
      return ['must-not-run']
    },
  })
  await expect(host.getResult({} as never)).rejects.toThrow('command not ready')
  await expect(host.getResult({} as never)).rejects.toThrow('could not be accepted')
  expect(resolutions).toBe(2)
  expect(f.accesses()).toBe(0)
})

test('reviewer host rejects extra authority and invalid command wiring', () => {
  const f = fixture()
  expect(() => createFoundationReviewerHost({ ...f.options, workerPort: {} } as never)).toThrow('unexpected fields')
  expect(() => createFoundationReviewerHost({ ...f.options, command: undefined })).toThrow('exactly one')
  expect(() => createFoundationReviewerHost({ ...f.options, getCommand: () => ['unused'] })).toThrow('exactly one')
  expect(() => createFoundationReviewerHost({ ...f.options, command: [] })).toThrow('command is invalid')
  expect(() => createFoundationReviewerHost({ ...f.options, ownerId: '' })).toThrow('ownerId')
  expect(() => createFoundationReviewerHost({ ...f.options, language: '' })).toThrow('language')
  expect(f.accesses()).toBe(0)
})
