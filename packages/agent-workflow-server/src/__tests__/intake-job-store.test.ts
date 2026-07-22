import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  deleteBeeGameIntakeJob,
  loadBeeGameIntakeJob,
  saveBeeGameIntakeJob,
} from '../beegame/intake-job-store'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('intake job store', () => {
  test('persists a terminal result across process-local app state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-intake-jobs-'))
    roots.push(root)
    const job = {
      ownerId: 'owner-a',
      runtimeId: 'runtime-a',
      status: 'completed' as const,
      result: { options: [{ id: 'mode-a' }] },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await saveBeeGameIntakeJob(root, 'intake_persisted', job)

    await expect(loadBeeGameIntakeJob(root, 'intake_persisted')).resolves.toEqual(job)
  })

  test('preserves a failed job HTTP status across process-local app state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-intake-jobs-'))
    roots.push(root)
    const job = {
      ownerId: 'owner-a',
      runtimeId: 'runtime-a',
      status: 'failed' as const,
      error: 'provider unavailable',
      errorStatus: 503,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await saveBeeGameIntakeJob(root, 'intake_failed', job)

    await expect(loadBeeGameIntakeJob(root, 'intake_failed')).resolves.toEqual(job)
  })

  test('rejects path-like job ids and ignores corrupt persisted data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-intake-jobs-'))
    roots.push(root)
    await expect(saveBeeGameIntakeJob(root, '../intake_escape', {
      ownerId: 'owner-a',
      runtimeId: 'runtime-a',
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })).rejects.toThrow('Invalid intake job id')

    const jobsRoot = join(root, 'intake-jobs')
    await saveBeeGameIntakeJob(root, 'intake_corrupt', {
      ownerId: 'owner-a',
      runtimeId: 'runtime-a',
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await writeFile(join(jobsRoot, 'intake_corrupt.json'), '{not-json', 'utf8')

    await expect(loadBeeGameIntakeJob(root, 'intake_corrupt')).resolves.toBeUndefined()
    await expect(deleteBeeGameIntakeJob(root, 'intake_corrupt')).resolves.toBeUndefined()
  })
})
