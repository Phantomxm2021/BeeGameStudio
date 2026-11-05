import { liveProjectConversationEvents, type BeeGameEvent } from './session-manager'
import { ChatJsonlReader, type JsonlEntry } from './chat-jsonl-reader'

export function chatHistoryBlockKey(event: Pick<BeeGameEvent, 'id' | 'type' | 'sessionId' | 'turnId' | 'payload'>): string {
  const payload = event.payload ?? { type: event.type }
  const scope = `${event.sessionId}:${payload.parentToolUseID ?? payload.parent_tool_use_id ?? ''}`
  const body = payload.message as { id?: string } | undefined
  const messageId = payload.assistantBlockId ?? payload.messageId ?? body?.id
  if (event.type === 'assistant.thinking') return `thinking:${scope}:${payload.thinkingBlockId ?? event.turnId ?? 'default'}:${payload.thinkingStartedAt ?? ''}`
  if (['assistant.partial', 'assistant.message'].includes(event.type) && messageId) return `text:${scope}:${messageId}`
  if (['tool.started', 'tool.progress', 'tool.completed', 'tool.failed'].includes(event.type) && payload.toolUseID) return `tool:${scope}:${payload.toolUseID}`
  return `event:${scope}:${event.id}`
}

export function paginateTranscriptEvents<T extends { id: number; createdAt: Date | string }>(
  events: T[],
  options: { limit: number; beforeId?: number },
): {
  events: T[]
  page: { hasMore: boolean; nextBeforeId: number | null }
} {
  // IDs are project-wide append cursors. Provider timestamps can arrive out
  // of order; use time for presentation and the ID for ties and page cursors.
  const ordered = [...events].sort((a, b) => {
    const time = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    return time || a.id - b.id
  })
  const beforeIndex = options.beforeId === undefined
    ? ordered.length
    : ordered.findIndex(event => event.id === options.beforeId)
  const eligible =
    options.beforeId === undefined
      ? ordered
      : ordered.slice(0, Math.max(0, beforeIndex))
  const pageEvents = eligible.slice(
    Math.max(0, eligible.length - options.limit),
  )
  return {
    events: pageEvents,
    page: {
      hasMore: eligible.length > pageEvents.length,
      nextBeforeId: pageEvents[0]?.id ?? null,
    },
  }
}

export function findTodoWriteEvents<
  T extends {
    type: BeeGameEvent['type']
    payload?: BeeGameEvent['payload']
  },
>(events: T[]): T[] {
  return events.filter(event => {
    if (
      event.type !== 'tool.started' &&
      event.type !== 'tool.progress' &&
      event.type !== 'tool.completed' &&
      event.type !== 'tool.failed'
    ) return false
    const toolName =
      typeof event.payload?.toolName === 'string'
        ? event.payload.toolName.trim().toLowerCase()
        : ''
    if (toolName !== 'todowrite' && toolName !== 'todo_write') return false
    const input = event.payload?.input
    return Boolean(
      input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      Array.isArray((input as { todos?: unknown }).todos),
    )
  })
}

export function compactTranscriptForChatHistory<
  T extends {
    id: number
    sessionId?: string
    turnId?: string
    type: BeeGameEvent['type']
    text: string
    createdAt: BeeGameEvent['createdAt']
    payload?: BeeGameEvent['payload']
  },
>(events: T[]): T[] {
  const result: T[] = []
  const positions = new Map<string, number>()
  for (const event of events) {
    const payload: NonNullable<BeeGameEvent['payload']> = event.payload ?? { type: event.type }
    if (event.type === 'system.status' &&
      !['task_started', 'task_progress', 'task_notification', 'compact_boundary', 'delivery_phase', 'delivery_error', 'design_revision', 'runtime_notice', 'host_evidence'].includes(String(payload.subtype)) &&
      !(payload.subtype === 'status' && payload.status === 'compacting') &&
      typeof payload.childStatus !== 'string' && payload.willRetry !== true) continue
    const thinking = event.type === 'assistant.thinking'
    const text = event.type === 'assistant.partial' || event.type === 'assistant.message'
    const tool = ['tool.started', 'tool.progress', 'tool.completed', 'tool.failed'].includes(event.type)
    const key = chatHistoryBlockKey(event as BeeGameEvent)
    const position = key ? positions.get(key) : undefined
    const previous = position === undefined ? undefined : result[position]
    // A terminal snapshot owns its block. Delayed checkpoints cannot reopen it.
    if (previous && text && previous.type === 'assistant.message' && event.type === 'assistant.partial') continue
    if (previous && thinking && previous.payload?.status === 'ended' && payload.status !== 'ended') continue
    const content = thinking && event.text === 'Thinking' ? '' : event.text
    const snapshot = payload.contentMode === 'snapshot' || event.type === 'assistant.message'
    const mergedText = thinking || text
      ? thinking && !content ? previous?.text ?? '' : snapshot ? content : (previous?.text ?? '') + content
      : event.text
    const merged = {
      ...event,
      text: mergedText,
      payload: {
        ...(previous?.payload ?? {}),
        ...payload,
        type: event.type,
        sourceSequence: previous?.payload?.sourceSequence ?? event.id,
        ...(thinking || text ? { contentMode: 'snapshot' } : {}),
        ...(thinking ? {
          ...(previous?.payload?.status === 'ended' ? { status: 'ended' } : {}),
          thinkingStartedAt: previous?.payload?.thinkingStartedAt ?? payload.thinkingStartedAt ??
            new Date(event.createdAt).toISOString(),
        } : {}),
        ...(tool ? { toolStartedAt: previous?.payload?.toolStartedAt ??
          (event.type === 'tool.started' ? new Date(event.createdAt).toISOString() : undefined) } : {}),
      },
    } as T
    if (position === undefined) {
      if (key) positions.set(key, result.length)
      result.push(merged)
    } else result[position] = merged
  }
  // IDs remain cursor positions; sourceSequence retains first appearance order.
  return result
}



export async function readChatHistoryPage<T extends Omit<BeeGameEvent, 'createdAt'> & { createdAt: Date | string }>(
  path: string, reader: ChatJsonlReader<T>, options: { limit: number; beforeId?: number; sessionId?: string },
) {
  const entries = (await reader.entries(path)).filter(entry => !options.sessionId || entry.header.sessionId === options.sessionId)
  // Branch selection, grouping and time ordering operate on small metadata.
  // Materialize bodies only for the selected logical blocks, not every delta.
  const live = liveProjectConversationEvents(entries.map(displayHeader))
  const compact = compactTranscriptForChatHistory(live)
  const selected = paginateTranscriptEvents(compact, options)
  // Compaction can fill a missing thinkingStartedAt. sourceSequence ties that
  // derived snapshot back to its original block identity.
  const originalKeys = new Map(live.map(event => [event.id, chatHistoryBlockKey(event)]))
  const blockKey = (event: BeeGameEvent) => originalKeys.get(Number(event.payload?.sourceSequence)) ?? chatHistoryBlockKey(event)
  const selectedKeys = new Set(selected.events.map(blockKey))
  const todoKeys = new Set(compact.filter(e => ['todowrite', 'todo_write'].includes(String(e.payload?.toolName).toLowerCase())).map(blockKey))
  const liveIds = new Set(live.map(event => event.id))
  const groups = new Map<string, JsonlEntry[]>()
  for (const entry of entries) {
    if (!liveIds.has(entry.header.id!)) continue
    const key = chatHistoryBlockKey(displayHeader(entry))
    if (!selectedKeys.has(key) && !todoKeys.has(key)) continue
    const group = groups.get(key) ?? []
    group.push(entry); groups.set(key, group)
  }
  const requested: JsonlEntry[] = []
  for (const group of groups.values()) {
    const last = group.at(-1)!
    if (last.header.type?.startsWith('tool.')) {
      // The final native receipt owns the result. Start supplies any omitted
      // input/cwd; intermediate cumulative snapshots are never reread.
      const start = group.find(entry => entry.header.type === 'tool.started')
      if (start && start !== last) requested.push(start)
      requested.push(last)
    } else requested.push(...group)
  }
  requested.sort((a, b) => a.offset - b.offset)
  const rows = (await reader.readEntries(path, requested)).map(event => ({ ...event, createdAt: new Date(event.createdAt) } as BeeGameEvent))
  const projected = compactTranscriptForChatHistory(rows)
  const byKey = new Map(projected.map(event => [blockKey(event), event]))
  return { events: selected.events.flatMap(event => {
      const body = byKey.get(blockKey(event))
      return body ? [{ ...body, payload: { ...body.payload, type: body.payload?.type ?? body.type,
        sourceSequence: event.payload?.sourceSequence ?? event.id } }] : []
    }),
    todoEvents: findTodoWriteEvents(projected), page: selected.page }
}

function displayHeader(entry: JsonlEntry): BeeGameEvent {
  const { header } = entry
  if (!Number.isSafeInteger(header.id) || typeof header.type !== 'string' || typeof header.sessionId !== 'string')
    throw Error(`Invalid Chat journal header at byte ${entry.offset}`)
  return { ...header, createdAt: new Date(header.createdAt ?? 0) } as BeeGameEvent
}
