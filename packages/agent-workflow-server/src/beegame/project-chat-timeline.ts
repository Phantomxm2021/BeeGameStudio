import { createReadStream } from 'node:fs'
import { mkdir, open, truncate } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { BeeGameEvent } from './session-manager'
import { createChatTextIdentity } from './chat-text-identity'

/** A project cursor is an append position, never an index in a re-sorted list. */
export class ProjectChatTimeline {
  // Keep only cursor/byte offsets and recovered legacy text identities resident.
  // Tool output and streaming payloads stay in the existing journal.
  private records: Array<{ id: number; offset: number; end: number; textId?: string }> = []
  private keys = new Set<string>()
  private pending: Promise<unknown> = Promise.resolve()
  private readonly ready: Promise<void>
  private readonly identifyText = createChatTextIdentity()

  constructor(private readonly path: string) {
    this.ready = this.load()
  }

  private async load() {
    try { for await (const { line, offset, end, terminated } of journalLines(this.path)) {
      if (!line.trim()) continue
      let event: BeeGameEvent
      try { event = JSON.parse(line) }
      catch (error) {
        // A process can die during the last append. Never discard valid rows.
        if (!terminated) {
          await truncate(this.path, offset)
          break
        }
        throw error
      }
      this.index(event, offset, end)
      this.keys.add(sourceKey(event))
    } } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private index(event: BeeGameEvent, offset: number, end: number) {
    const normalized = this.identifyText(canonicalSource(event))
    const textId = normalized.payload?.assistantBlockId
    this.records.push({ id: event.id, offset, end,
      ...(typeof textId === 'string' && textId !== event.payload?.assistantBlockId ? { textId } : {}) })
  }

  private async readAfter(after: number): Promise<BeeGameEvent[]> {
    let low = 0, high = this.records.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (this.records[middle]!.id <= after) low = middle + 1
      else high = middle
    }
    const first = this.records[low]
    if (!first) return []
    const events: BeeGameEvent[] = []
    for await (const { line } of journalLines(this.path, first.offset, this.records.at(-1)!.end - 1)) {
      if (!line.trim()) continue
      const event = canonicalSource(JSON.parse(line))
      event.createdAt = new Date(event.createdAt)
      const { textId } = this.records[low++]!
      if (textId) event.payload = { ...event.payload!, assistantBlockId: textId }
      events.push(event)
    }
    return events
  }

  append(incoming: BeeGameEvent[], after = 0): Promise<BeeGameEvent[]> {
    const operation = this.pending.then(async () => {
      await this.ready
      const batch: BeeGameEvent[] = []
      const batchKeys = new Set<string>()
      for (const event of incoming) {
        const key = sourceKey(event)
        if (this.keys.has(key) || batchKeys.has(key)) continue
        batchKeys.add(key)
        batch.push({ ...event, id: (this.records.at(-1)?.id ?? 0) + batch.length + 1,
          payload: { ...(event.payload ?? { type: event.type }), projectSourceKey: key,
            projectSourceSessionId: event.sessionId, projectSourceEventId: event.id } })
      }
      if (batch.length) {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
        const file = await open(this.path, 'a', 0o600)
        const lines = batch.map(event => JSON.stringify(event))
        let offset: number
        try {
          const size = (await file.stat()).size
          offset = size + 1
          try { await file.writeFile('\n' + lines.join('\n') + '\n') }
          catch (error) {
            // A disk-full write can leave half a JSON row. Roll back only this
            // serialized append before allowing the same source batch to retry.
            await file.truncate(size)
            throw error
          }
        } finally { await file.close() }
        for (let i = 0; i < batch.length; i++) {
          const end = offset! + Buffer.byteLength(lines[i]!) + 1
          this.index(batch[i]!, offset!, end)
          offset = end
        }
        for (const key of batchKeys) this.keys.add(key)
      }
      return this.readAfter(after)
    })
    // A transient disk failure must reject this append without permanently
    // poisoning every future SSE reconnect. Failed records remain retryable.
    this.pending = operation.catch(() => undefined)
    return operation
  }
}

/** Bounded reads, including multi-byte characters split across IO chunks. */
async function* journalLines(path: string, start = 0, end?: number) {
  let offset = start
  let fragments: Buffer[] = []
  for await (const chunk of createReadStream(path, { start, end, highWaterMark: 256 * 1024 })) {
    const bytes = chunk as Buffer
    let from = 0
    for (let to = bytes.indexOf(10); to !== -1; to = bytes.indexOf(10, from)) {
      const line = Buffer.concat([...fragments, bytes.subarray(from, to)])
      const next = offset + line.length + 1
      yield { line: line.toString('utf8'), offset, end: next, terminated: true }
      offset = next
      fragments = []
      from = to + 1
    }
    if (from < bytes.length) fragments.push(bytes.subarray(from))
  }
  if (fragments.length) {
    const line = Buffer.concat(fragments)
    yield { line: line.toString('utf8'), offset, end: offset + line.length, terminated: false }
  }
}

export function projectChatEventsAfter(events: readonly BeeGameEvent[], after: number): BeeGameEvent[] {
  let low = 0, high = events.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (events[middle]!.id <= after) low = middle + 1
    else high = middle
  }
  return events.slice(low)
}

function sourceKey(event: BeeGameEvent): string {
  const payload = event.payload
  if (typeof payload?.projectSourceKey === 'string') return payload.projectSourceKey
  if (typeof payload?.workflowStageNativeKey === 'string') return `native:${payload.workflowStageNativeKey}`
  return `${payload?.workflowSourceSessionId ?? payload?.projectSourceSessionId ?? event.sessionId}:${payload?.workflowSourceEventId ?? payload?.projectSourceEventId ?? event.id}`
}

// Mirrored and direct worker records are the same stream, regardless of which
// transport wins the append race. Preserve journal cursors and source receipts.
function canonicalSource(event: BeeGameEvent): BeeGameEvent {
  const source = event.payload?.workflowSourceSessionId ?? event.payload?.projectSourceSessionId
  const turn = event.payload?.workflowSourceTurnId
  return { ...event, ...(typeof source === 'string' ? { sessionId: source } : {}),
    ...(typeof turn === 'string' ? { turnId: turn } : {}) }
}

const timelines = new Map<string, ProjectChatTimeline>()
export function appendProjectChatTimeline(workspacePath: string, events: BeeGameEvent[], after = 0) {
  const path = join(resolve(workspacePath), '.beegame', 'chat', 'project-events.jsonl')
  let timeline = timelines.get(path)
  if (!timeline) { timeline = new ProjectChatTimeline(path); timelines.set(path, timeline) }
  return timeline.append(events, after)
}
