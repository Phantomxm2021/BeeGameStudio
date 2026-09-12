import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, lstat, link, unlink, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { z } from 'zod/v4'

/**
 * The bounded storage substrate is deliberately private to the Reviewer
 * module.  A wrapper supplies its own event schema, initial state, and
 * reducer; no stage-facing API can construct one of these journals.
 */
export type JournalEventMetadata = { path: string; digest: string; runId: string; ownerId?: string }

export type JournalRecord<Event> = {
  version: 1
  index: number
  previousDigest: string
  commandId: string
  commandDigest: string
  at: string
  event: Event
  digest: string
}

type JournalRecordSchema<Record> = { parse(value: unknown): Record }

export type JournalStorageOptions<State, Event, Record extends JournalRecord<Event>> = {
  workspacePath: string
  root: string
  runId: string
  ownerId?: string
  header: unknown
  readOnly?: boolean
  eventSchema: JournalRecordSchema<Record>
  parseEvent(value: unknown): Event
  initialState(): State
  /** Recovery requires proof that execution never started. */
  canRecoverUnstartedExecution?(state: State): boolean
  reduce(state: State, event: Event, at: string, evidence: JournalEventMetadata): State
  messages?: Partial<{
    parentMustBeDirectory: string
    invalidRecord: string
    recordTooLarge: string
    pathChanged: string
    eventPathChanged: string
    inputBindingChanged: string
    sequenceNotContiguous: string
    evidenceBindingMismatch: string
    repeatsCommand: string
    readOnly: string
    leaseNotOwned: string
  }>
}

const MAX_RECORD_BYTES = 32 * 1024 * 1024

export function journalCanonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(journalCanonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + journalCanonical((value as Record<string, unknown>)[key])).join(',') + '}'
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('review journal payload is not JSON')
  return serialized
}

export const journalDigest = (value: unknown) => createHash('sha256').update(journalCanonical(value)).digest('hex')

async function ensureDirectories(path: string, parentError = 'review journal parent must be a real directory') {
  const root = parse(path).root
  let cursor = root
  for (const segment of relative(root, path).split('/').filter(Boolean)) {
    cursor = join(cursor, segment)
    try {
      const entry = await lstat(cursor)
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(parentError)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      try { await mkdir(cursor) } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError
      }
      const entry = await lstat(cursor)
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(parentError)
    }
  }
}

async function assertDirectories(path: string, parentError = 'review journal parent must be a real directory') {
  let cursor = path
  while (cursor !== parse(cursor).root) {
    const entry = await lstat(cursor)
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(parentError)
    cursor = dirname(cursor)
  }
}

async function readJson(path: string, invalidRecord = 'review journal record has invalid size or kind') {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size > MAX_RECORD_BYTES) throw new Error(invalidRecord)
    return JSON.parse(await file.readFile('utf8')) as unknown
  } finally { await file.close() }
}

export class ReviewJournalConflictError extends Error {
  constructor() { super('review journal changed concurrently or immutable identity conflicts') }
}

async function publishJson(path: string, value: unknown, tooLarge = 'review journal record is too large') {
  const body = journalCanonical(value) + '\n'
  if (Buffer.byteLength(body, 'utf8') > MAX_RECORD_BYTES) throw new Error(tooLarge)
  const temporary = join(dirname(path), `.pending-${randomUUID()}`)
  const file = await open(temporary, 'wx', 0o600)
  try { await file.writeFile(body); await file.sync() } finally { await file.close() }
  let created = true
  try {
    try { await link(temporary, path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (journalCanonical(await readJson(path)) !== journalCanonical(value)) throw new ReviewJournalConflictError()
      created = false
    }
    const directory = await open(dirname(path), constants.O_RDONLY)
    try { await directory.sync() } finally { await directory.close() }
  } finally { await unlink(temporary) }
  return created
}

/** Module-private immutable file primitives; wrappers may retain their own alias. */
export const journalImmutableFiles = Object.freeze({ ensureDirectories, assertDirectories, readJson, publishJson })

type OwnedLease = {
  kind: 'owned'
  runId: string
  scope: string
  leaseDigest: string
  assertOwned(): Promise<void>
  release(): Promise<void>
}

export async function openJournalStorage<State, Event, Record extends JournalRecord<Event>>(options: JournalStorageOptions<State, Event, Record>) {
  if (!isAbsolute(options.workspacePath)) throw new Error('review workspace must be absolute')
  const workspace = resolve(options.workspacePath)
  const root = resolve(options.root)
  const workspaceEntry = await lstat(workspace)
  if (!workspaceEntry.isDirectory() || workspaceEntry.isSymbolicLink()) throw new Error('review workspace must be a real directory')
  const messages = {
    parentMustBeDirectory: 'review journal parent must be a real directory',
    invalidRecord: 'review journal record has invalid size or kind',
    recordTooLarge: 'review journal record is too large',
    pathChanged: 'review journal path changed',
    eventPathChanged: 'review event path changed',
    inputBindingChanged: 'review input binding changed',
    sequenceNotContiguous: 'review journal sequence is not contiguous',
    evidenceBindingMismatch: 'review journal evidence binding mismatch',
    repeatsCommand: 'review journal repeats command identity',
    readOnly: 'read-only review journal cannot append',
    leaseNotOwned: 'review execution lease is not owned',
    ...options.messages,
  }

  if (options.readOnly) await assertDirectories(root, messages.parentMustBeDirectory)
  else await ensureDirectories(root, messages.parentMustBeDirectory)
  const inputPath = join(root, 'input.json')
  let createdInput = false
  if (options.readOnly) {
    if (journalCanonical(await readJson(inputPath, messages.invalidRecord)) !== journalCanonical(options.header)) throw new Error(messages.inputBindingChanged)
  } else createdInput = await publishJson(inputPath, options.header, messages.recordTooLarge)
  const headerDigest = journalDigest(options.header)
  const eventsPath = join(root, 'events')
  if (options.readOnly) await assertDirectories(eventsPath, messages.parentMustBeDirectory)
  else await ensureDirectories(eventsPath, messages.parentMustBeDirectory)

  async function leaseLocation() {
    let path = join(root, 'execution.lock')
    const seen = new Set<string>()
    for (;;) {
      let record: ReturnType<typeof parseLease>
      try { record = parseLease(await readJson(path, messages.invalidRecord), options.runId) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path }; throw error }
      const predecessorDigest = journalDigest(record)
      if (seen.has(predecessorDigest)) throw new Error('review execution recovery chain repeats')
      seen.add(predecessorDigest)
      const generation = join(root, 'execution-generations', predecessorDigest)
      try {
        await assertDirectories(generation, messages.parentMustBeDirectory)
        const marker = z.object({ version: z.literal(1), runId: z.literal(options.runId), headerDigest: z.literal(headerDigest),
          predecessorDigest: z.literal(predecessorDigest), head: z.string().regex(/^[a-f0-9]{64}$/),
          proof: z.literal('no-worker-ever-claimed') }).strict().parse(await readJson(join(generation, 'RECOVERED.json'), messages.invalidRecord))
        const evidence = await recover()
        const boundary = marker.head === headerDigest ? -1 : evidence.records.findIndex(item => item.digest === marker.head)
        if (boundary === -1 && marker.head !== headerDigest) throw new Error('review recovery marker head is missing')
        let priorState = options.initialState()
        for (const record of evidence.records.slice(0, boundary + 1)) priorState = options.reduce(priorState, record.event, record.at,
          { path: relative(workspace, join(eventsPath, `${String(record.index).padStart(8, '0')}.json`)), digest: record.digest,
            runId: options.runId, ...(options.ownerId ? { ownerId: options.ownerId } : {}) })
        if (options.canRecoverUnstartedExecution?.(priorState) !== true) throw new Error('review recovery marker lacks owner proof')
        path = join(generation, 'execution.lock')
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, record }; throw error }
    }
  }
  function ownerAlive(record: ReturnType<typeof parseLease>) {
    try { process.kill(record.pid, 0); return true }
    catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
  }
  async function leaseStatus() {
    await assertDirectories(root, messages.parentMustBeDirectory)
    try {
      const { record } = await leaseLocation()
      return !record ? 'free' as const : ownerAlive(record) ? 'busy' as const : 'stale' as const
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'free' as const
      throw error
    }
  }

  async function recover() {
    let cursor = root
    while (cursor !== parse(cursor).root) {
      const entry = await lstat(cursor)
      if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(messages.pathChanged)
      cursor = dirname(cursor)
    }
    const eventDirectory = await lstat(eventsPath)
    if (eventDirectory.isSymbolicLink() || !eventDirectory.isDirectory()) throw new Error(messages.eventPathChanged)
    if (journalCanonical(await readJson(inputPath, messages.invalidRecord)) !== journalCanonical(options.header)) throw new Error(messages.inputBindingChanged)
    const names = (await readdir(eventsPath)).filter(name => !name.startsWith('.pending-')).sort()
    let state = options.initialState()
    let previousDigest = headerDigest
    const records: Record[] = []
    for (const [index, name] of names.entries()) {
      if (name !== `${String(index).padStart(8, '0')}.json`) throw new Error(messages.sequenceNotContiguous)
      const record = options.eventSchema.parse(await readJson(join(eventsPath, name), messages.invalidRecord))
      const { digest: recordDigest, ...body } = record
      if (record.index !== index || record.previousDigest !== previousDigest || journalDigest(body) !== recordDigest || journalDigest(record.event) !== record.commandDigest)
        throw new Error(messages.evidenceBindingMismatch)
      if (records.some(item => item.commandId === record.commandId)) throw new Error(messages.repeatsCommand)
      state = options.reduce(state, record.event, record.at, { path: relative(workspace, join(eventsPath, name)), digest: record.digest, runId: options.runId, ...(options.ownerId ? { ownerId: options.ownerId } : {}) })
      previousDigest = recordDigest
      records.push(record)
    }
    return { state, records, head: previousDigest }
  }

  return Object.freeze({
    runId: options.runId,
    createdInput,
    leaseScope: journalDigest(root),
    async read() { return (await recover()).state },
    leaseStatus,
    async canRecoverUnstartedExecution() {
      const current = await recover()
      return options.canRecoverUnstartedExecution?.(current.state) === true && await leaseStatus() === 'stale'
    },
    async recoverUnstartedExecution() {
      if (options.readOnly) throw new Error('read-only review journal cannot recover execution')
      const current = await recover()
      if (options.canRecoverUnstartedExecution?.(current.state) !== true) return false
      const prior = await leaseLocation()
      if (!prior.record || ownerAlive(prior.record)) return false
      const predecessorDigest = journalDigest(prior.record)
      const generation = join(root, 'execution-generations', predecessorDigest)
      await ensureDirectories(generation, messages.parentMustBeDirectory)
      // Preserve the old lease. A deterministic, immutable successor marker
      // elects one next slot; concurrent recovery cannot unlink a new owner.
      const rechecked = await leaseLocation()
      const latest = await recover()
      if (rechecked.path !== prior.path || !rechecked.record || journalDigest(rechecked.record) !== predecessorDigest ||
        ownerAlive(rechecked.record) || latest.head !== current.head || options.canRecoverUnstartedExecution?.(latest.state) !== true) return false
      await publishJson(join(generation, 'RECOVERED.json'), { version: 1, runId: options.runId, headerDigest,
        predecessorDigest, head: current.head, proof: 'no-worker-ever-claimed' }, messages.recordTooLarge)
      return true
    },
    async tryExecutionLease(): Promise<OwnedLease | { kind: 'busy' | 'stale' }> {
      if (options.readOnly) throw new Error('read-only review journal cannot acquire execution')
      await recover()
      const { path } = await leaseLocation()
      const owner = { version: 1 as const, runId: options.runId, pid: process.pid, token: randomUUID() }
      try { await publishJson(path, owner, messages.recordTooLarge) } catch (error) {
        if (!(error instanceof ReviewJournalConflictError)) throw error
        let record: { version: 1; runId: string; pid: number; token: string }
        try { record = parseLease(await readJson(path, messages.invalidRecord), options.runId) }
        catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'busy' as const }
          throw readError
        }
        let alive = true
        try { process.kill(record.pid, 0) } catch (pidError) { alive = (pidError as NodeJS.ErrnoException).code !== 'ESRCH' }
        return { kind: alive ? 'busy' as const : 'stale' as const }
      }
      let released = false
      const assertOwned = async () => {
        if (released || (await leaseLocation()).path !== path || journalCanonical(await readJson(path, messages.invalidRecord)) !== journalCanonical(owner)) throw new Error(messages.leaseNotOwned)
      }
      return { kind: 'owned' as const, runId: options.runId, scope: journalDigest(root), leaseDigest: journalDigest(owner), async assertOwned() { await assertOwned() }, async release() {
        if (released) return
        await assertOwned()
        await unlink(path)
        released = true
        const directory = await open(dirname(path), constants.O_RDONLY)
        try { await directory.sync() } finally { await directory.close() }
      } }
    },
    async append(commandId: string, command: unknown) {
      if (options.readOnly) throw new Error(messages.readOnly)
      const event = options.parseEvent(JSON.parse(journalCanonical(command)))
      const current = await recover()
      const existing = current.records.find(item => item.commandId === commandId)
      if (existing) {
        if (existing.commandDigest !== journalDigest(event)) throw new ReviewJournalConflictError()
        return current.state
      }
      const body = {
        version: 1 as const, index: current.records.length, previousDigest: current.head,
        commandId, commandDigest: journalDigest(event), at: new Date().toISOString(), event,
      }
      const record = options.eventSchema.parse({ ...body, digest: journalDigest(body) })
      const path = join(eventsPath, `${String(record.index).padStart(8, '0')}.json`)
      const next = options.reduce(current.state, event, record.at, { path: relative(workspace, path), digest: record.digest, runId: options.runId, ...(options.ownerId ? { ownerId: options.ownerId } : {}) })
      try { await publishJson(path, record, messages.recordTooLarge) } catch (error) {
        if (!(error instanceof ReviewJournalConflictError)) throw error
        const raced = await recover()
        if (!raced.records.some(item => item.commandId === commandId && item.commandDigest === journalDigest(event))) throw error
        return raced.state
      }
      return next
    },
  })
}

function parseLease(value: unknown, runId: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('review execution lease is invalid')
  const record = value as Record<string, unknown>
  return z.object({ version: z.literal(1), runId: z.literal(runId), pid: z.number().int().positive(), token: z.string().uuid() }).strict().parse(record)
}
