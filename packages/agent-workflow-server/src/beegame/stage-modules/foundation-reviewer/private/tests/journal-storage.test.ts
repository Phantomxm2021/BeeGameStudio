import { expect, test } from 'bun:test'
import { mkdtemp, realpath, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { journalCanonical, openJournalStorage, type JournalRecord } from '../journal-storage'

const eventSchema = z.object({ kind: z.literal('set'), value: z.string().min(1) }).strict()
const recordSchema = z.object({
  version: z.literal(1), index: z.number().int().nonnegative(), previousDigest: z.string().regex(/^[a-f0-9]{64}$/),
  commandId: z.string().min(1).max(200), commandDigest: z.string().regex(/^[a-f0-9]{64}$/),
  at: z.string().datetime(), event: eventSchema, digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
type Event = z.infer<typeof eventSchema>
type State = { values: string[] }
type Record = JournalRecord<Event>

async function open(workspacePath: string, readOnly = false, allowUnstartedRecovery = false) {
  return openJournalStorage<State, Event, Record>({
    workspacePath,
    root: join(workspacePath, '.beegame/workflow/foundation-reviewer/state/generic-run'),
    runId: 'generic-run',
    header: { version: 1, owner: 'storage-test' },
    readOnly,
    eventSchema: recordSchema,
    parseEvent(value) { return eventSchema.parse(value) },
    initialState() { return { values: [] } },
    ...(allowUnstartedRecovery ? { canRecoverUnstartedExecution: (state: State) => state.values.length === 0 } : {}),
    reduce(state, event) { return { values: [...state.values, event.value] } },
  })
}

test('generic storage keeps immutable bytes and reducer ownership in the wrapper', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-journal-storage-')))
  try {
    const journal = await open(workspacePath)
    expect(journal.createdInput).toBe(true)
    expect((await open(workspacePath)).createdInput).toBe(false)
    expect((await open(workspacePath, true)).createdInput).toBe(false)
    await journal.append('first', { kind: 'set', value: 'one' })
    const root = join(workspacePath, '.beegame/workflow/foundation-reviewer/state/generic-run')
    const inputBytes = await readFile(join(root, 'input.json'), 'utf8')
    expect(inputBytes).toBe(journalCanonical({ version: 1, owner: 'storage-test' }) + '\n')
    expect(await journal.append('first', { kind: 'set', value: 'one' })).toEqual({ values: ['one'] })
    await expect(journal.append('first', { kind: 'set', value: 'different' })).rejects.toThrow('immutable identity')
    expect(await readdir(join(root, 'events'))).toEqual(['00000000.json'])
    expect(await (await open(workspacePath, true)).read()).toEqual({ values: ['one'] })
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('explicit unstarted recovery preserves stale lease bytes and elects one successor', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-unstarted-recovery-')))
  try {
    const journal = await open(workspacePath, false, true)
    const child = Bun.spawn([process.execPath, '--eval', ''], { stdout: 'ignore', stderr: 'ignore' })
    await child.exited
    const root = join(workspacePath, '.beegame/workflow/foundation-reviewer/state/generic-run')
    const oldBytes = journalCanonical({ version: 1, runId: journal.runId, pid: child.pid, token: randomUUID() }) + '\n'
    await writeFile(join(root, 'execution.lock'), oldBytes)
    const reader = await open(workspacePath, true, true)
    expect(await reader.leaseStatus()).toBe('stale')
    expect(await reader.canRecoverUnstartedExecution()).toBe(true)
    await expect(reader.recoverUnstartedExecution()).rejects.toThrow('read-only')
    expect(await journal.tryExecutionLease()).toEqual({ kind: 'stale' })
    expect(await readdir(root)).not.toContain('execution-generations')
    await Promise.all([journal.recoverUnstartedExecution(), (await open(workspacePath, false, true)).recoverUnstartedExecution()])
    const leases = await Promise.all([journal.tryExecutionLease(), (await open(workspacePath, false, true)).tryExecutionLease()])
    expect(leases.filter(lease => lease.kind === 'owned')).toHaveLength(1)
    expect(await reader.leaseStatus()).toBe('busy')
    const owned = leases.find(lease => lease.kind === 'owned')!
    if (owned.kind !== 'owned') throw new Error('no successor lease')
    await journal.append('claimed', { kind: 'set', value: 'worker' })
    await owned.assertOwned()
    await owned.release()
    expect(await reader.leaseStatus()).toBe('free')
    expect(await readFile(join(root, 'execution.lock'), 'utf8')).toBe(oldBytes)
    expect(await reader.read()).toEqual({ values: ['worker'] })
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('unstarted recovery fails closed without owner proof or after a worker claim', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-recovery-proof-')))
  try {
    const journal = await open(workspacePath)
    const child = Bun.spawn([process.execPath, '--eval', ''], { stdout: 'ignore', stderr: 'ignore' })
    await child.exited
    const root = join(workspacePath, '.beegame/workflow/foundation-reviewer/state/generic-run')
    await writeFile(join(root, 'execution.lock'), journalCanonical({ version: 1, runId: journal.runId, pid: child.pid, token: randomUUID() }))
    expect(await journal.canRecoverUnstartedExecution()).toBe(false)
    expect(await journal.recoverUnstartedExecution()).toBe(false)
    await journal.append('claimed', { kind: 'set', value: 'worker' })
    const permitted = await open(workspacePath, false, true)
    expect(await permitted.canRecoverUnstartedExecution()).toBe(false)
    expect(await permitted.recoverUnstartedExecution()).toBe(false)
    expect(await permitted.leaseStatus()).toBe('stale')
    expect(await readdir(root)).not.toContain('execution-generations')
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('generic storage preserves owned lease and explicit stale status without takeover', async () => {
  const workspacePath = await realpath(await mkdtemp(join(tmpdir(), 'reviewer-journal-lease-')))
  try {
    const journal = await open(workspacePath)
    const lease = await journal.tryExecutionLease()
    expect(lease.kind).toBe('owned')
    await expect((await open(workspacePath)).leaseStatus()).resolves.toBe('busy')
    if (lease.kind === 'owned') {
      await lease.assertOwned()
      await lease.release()
    }
    expect(await (await open(workspacePath)).leaseStatus()).toBe('free')
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})
