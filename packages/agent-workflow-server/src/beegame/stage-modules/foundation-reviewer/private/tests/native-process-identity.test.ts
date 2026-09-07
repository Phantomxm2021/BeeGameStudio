import { expect, test } from 'bun:test'
import {
  nativeProcessIdentityErrorReason,
  observeNativeProcessIdentity,
  readNativeProcessIdentity,
  sameNativeProcessIdentity,
} from '../native-process-identity'

const supported = process.platform === 'darwin' || process.platform === 'linux'

test('reads only stable process and process-group identity fields for itself', async () => {
  if (!supported) return
  const identity = await readNativeProcessIdentity(process.pid)
  expect(identity.pid).toBe(process.pid)
  expect(identity.ppid).toBeGreaterThanOrEqual(0)
  expect(identity.pgid).toBeGreaterThan(0)
  expect(identity.sessionId).toBeGreaterThanOrEqual(0)
  expect(identity.birth.bootId.length).toBeGreaterThan(0)
  expect(sameNativeProcessIdentity(identity, identity)).toBe(true)
  const observation = await observeNativeProcessIdentity(identity)
  expect(observation.status).toBe('matched')
  if (observation.status === 'matched') {
    expect(observation.identity).toEqual(identity)
    expect(observation.safeForCleanup).toBe(false)
  }
})

test('matching Linux tick identity remains diagnostic and never grants cleanup authority', async () => {
  if (process.platform !== 'linux') return
  const identity = await readNativeProcessIdentity(process.pid)
  expect(identity.birth.platform).toBe('linux')
  expect(identity.birth.precision).toBe('clock-ticks')
  expect(identity.birth.reuseSafe).toBe(false)
  await expect(observeNativeProcessIdentity(identity)).resolves.toMatchObject({
    status: 'matched', safeForCleanup: false,
  })
})

test('rejects a PID identity whose birth marker no longer matches', async () => {
  if (!supported) return
  const identity = await readNativeProcessIdentity(process.pid)
  const changed = {
    ...identity,
    birth: identity.birth.platform === 'linux'
      ? { ...identity.birth, startTimeTicks: `${BigInt(identity.birth.startTimeTicks) + 1n}` }
      : { ...identity.birth, startTimeSeconds: identity.birth.startTimeSeconds + 1 },
  }
  const observation = await observeNativeProcessIdentity(changed)
  expect(observation.status).toBe('mismatch')
  expect(observation.safeForCleanup).toBe(false)
  expect(sameNativeProcessIdentity(identity, changed)).toBe(false)
})

test('rejects a process-group identity mismatch even when the PID is unchanged', async () => {
  if (!supported) return
  const identity = await readNativeProcessIdentity(process.pid)
  const changed = { ...identity, pgid: identity.pgid + 1 }
  const observation = await observeNativeProcessIdentity(changed)
  expect(observation.status).toBe('mismatch')
  expect(observation.safeForCleanup).toBe(false)
})

test('a short-lived child is observed while present and never reported alive after exit', async () => {
  if (!supported) return
  const child = Bun.spawn([process.execPath, '-e', 'setTimeout(() => {}, 250)'], {
    stdin: 'ignore', stdout: 'ignore', stderr: 'ignore',
  })
  try {
    const identity = await readNativeProcessIdentity(child.pid)
    const present = await observeNativeProcessIdentity(identity)
    expect(present.status).toBe('matched')
    await child.exited
    const afterExit = await observeNativeProcessIdentity(identity)
    expect(['missing', 'unknown']).toContain(afterExit.status)
    expect(afterExit.status).not.toBe('matched')
  } finally {
    await child.exited
  }
})

test('unsupported platforms fail closed instead of treating a PID as live', async () => {
  const unsupported = 'freebsd' as NodeJS.Platform
  try {
    await readNativeProcessIdentity(process.pid, unsupported)
    throw new Error('unsupported platform unexpectedly succeeded')
  } catch (error) {
    expect(nativeProcessIdentityErrorReason(error)).toBe('unsupported')
  }
  const identity = supported ? await readNativeProcessIdentity(process.pid) : undefined
  if (identity) {
    await expect(observeNativeProcessIdentity(identity, unsupported)).resolves.toMatchObject({
      status: 'unknown', reason: 'unsupported', safeForCleanup: false,
    })
  }
})
