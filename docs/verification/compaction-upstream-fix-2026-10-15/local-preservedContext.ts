import { randomUUID } from 'node:crypto'
import type { Message, UserMessage } from '../../types/message.js'
import { groupMessagesByApiRound } from './grouping.js'

// Reuse API-round grouping so streamed tool calls/results stay together.
// This is a retention window at an existing compact, not a new trigger.
const RECENT_ROUNDS = 3

function copyUser(message: UserMessage): UserMessage {
  // New UUIDs give these non-contiguous historical records a new transcript
  // chain. Reusing their UUIDs would make resume follow their OLD parents.
  const { parentUuid, toolUseResult, ...rest } = message
  return { ...rest, uuid: randomUUID(), isVisibleInTranscriptOnly: true }
}

function isOriginalUser(message: Message): message is UserMessage {
  return (
    message.type === 'user' &&
    !message.isMeta &&
    !message.isCompactSummary &&
    !message.origin &&
    message.message?.content !== undefined &&
    !(
      Array.isArray(message.message.content) &&
      message.message.content.some(block => block.type === 'tool_result')
    )
  )
}

function evidenceRecord(
  message: Message,
  call: unknown,
  result: unknown,
): {
  sourceMessageUuid: string
  timestamp: unknown
  call: unknown
  result: unknown
  bodyRetention?: 'latest' | 'required'
} {
  return {
    sourceMessageUuid: message.uuid,
    timestamp: message.timestamp,
    call,
    result,
  }
}

function evidencePointer(block: {
  tool_use_id: string
  is_error?: unknown
  content?: unknown
}) {
  return {
    tool_use_id: block.tool_use_id,
    is_error: block.is_error,
    // These are literal observations, not a judgement that the issue resolved.
    observedFields: [
      ...receiptText(block.content).matchAll(
        /"(?:outcome|status|valid)"\s*:\s*(?:"[^"\n]*"|true|false|null)/g,
      ),
    ].map(match => match[0]),
    content:
      'Read sourceMessageUuid/tool_use_id in the full transcript before repeating work. Resolution not inferred.',
  }
}

/** Replace only paired native Write successes in the working tail. The original
 * call remains in the transcript; the retained fact does not assert that the
 * file still has those bytes, or that its contents passed validation.
 */
function compactSuccessfulWrites(
  messages: Message[],
  transcriptPath: string | undefined,
  records: ReturnType<typeof evidenceRecord>[],
): Message[] {
  if (!transcriptPath) return messages
  const calls = new Map<
    string,
    { block: object; message: Message; filePath: string }
  >()
  const replacements = new Map<object, string>()
  for (const message of messages) {
    if (!Array.isArray(message.message?.content)) continue
    for (const block of message.message.content) {
      if (message.type === 'assistant' && block.type === 'tool_use') {
        const input = block.input as { file_path?: unknown; content?: unknown }
        if (
          block.name === 'Write' &&
          typeof input?.file_path === 'string' &&
          typeof input.content === 'string'
        ) {
          calls.set(block.id, { block, message, filePath: input.file_path })
        }
      }
      if (message.type !== 'user' || block.type !== 'tool_result') continue
      const call = calls.get(block.tool_use_id)
      const state = message.toolUseResult as
        | { interrupted?: boolean; backgroundTaskId?: string }
        | undefined
      if (
        !call ||
        block.is_error ||
        state?.interrupted ||
        state?.backgroundTaskId ||
        (block.content !== `File created successfully at: ${call.filePath}` &&
          block.content !==
            `The file ${call.filePath} has been updated successfully.`)
      )
        continue
      records.push(
        evidenceRecord(
          message,
          {
            id: block.tool_use_id,
            name: 'Write',
            input: { file_path: call.filePath },
            sourceMessageUuid: call.message.uuid,
          },
          { ...block, status: 'write_succeeded' },
        ),
      )
      // Replace both ends with explicit historical text, not a fabricated
      // tool call with changed arguments or an orphaned tool_result.
      replacements.set(
        call.block,
        `Completed Write ${block.tool_use_id}: body omitted; see historical tool evidence.`,
      )
      replacements.set(block, block.content as string)
    }
  }
  if (replacements.size === 0) return messages
  return messages.map(message => {
    // The whole preserved segment needs a fresh contiguous chain. Old UUIDs
    // are dedup-skipped on save; old parent/source links resurrect old bodies.
    const { parentUuid, sourceToolAssistantUUID, toolUseResult, ...rest } =
      message
    const copy = { ...rest, uuid: randomUUID() }
    if (!Array.isArray(message.message?.content)) return copy
    const changed = message.message.content.some(block =>
      replacements.has(block),
    )
    return {
      ...copy,
      ...(changed && message.type === 'user' ? { isMeta: true } : {}),
      message: {
        ...message.message,
        content: message.message.content.map(block =>
          replacements.has(block)
            ? { type: 'text' as const, text: replacements.get(block)! }
            : block,
        ),
      },
    }
  })
}

/** Reapply the existing recency policy to records from previous compactions.
 * Unknown/background/interrupted results stay raw. Legacy records without a
 * retention reason also stay raw: their reason cannot safely be reconstructed.
 */
function copyHistoricalEvidence(
  message: UserMessage,
  latestReceiptId: string | undefined,
  latestErrorId: string | undefined,
  latestTodoId: string | undefined,
): UserMessage {
  const copy = copyUser(message)
  const content = message.message.content
  if (!latestReceiptId || typeof content !== 'string') return copy
  try {
    const split = content.indexOf('\n') + 1
    const batch = JSON.parse(content.slice(split)) as {
      transcriptPath?: unknown
      records?: ReturnType<typeof evidenceRecord>[]
    }
    if (
      !batch ||
      typeof batch.transcriptPath !== 'string' ||
      !batch.transcriptPath ||
      !Array.isArray(batch.records)
    )
      return copy
    let changed = false
    const records = batch.records.map(record => {
      if (
        !record ||
        record.bodyRetention !== 'latest' ||
        typeof record.sourceMessageUuid !== 'string' ||
        !record.sourceMessageUuid
      )
        return record
      const result = record.result as {
        type?: string
        tool_use_id?: string
        is_error?: boolean
        content?: unknown
      } | null
      const call = record.call as { id?: string; name?: string } | null
      if (
        !result ||
        result.type !== 'tool_result' ||
        typeof result.tool_use_id !== 'string' ||
        result.tool_use_id === latestReceiptId ||
        (result.is_error &&
          (!latestErrorId || result.tool_use_id === latestErrorId)) ||
        (call?.name === 'TodoWrite' &&
          (!latestTodoId || result.tool_use_id === latestTodoId))
      )
        return record
      changed = true
      const { bodyRetention, ...rest } = record
      return {
        ...rest,
        call: call && { id: call.id, name: call.name },
        result: evidencePointer({ ...result, tool_use_id: result.tool_use_id }),
      }
    })
    if (changed) {
      copy.message = {
        ...copy.message,
        content:
          content.slice(0, split) + JSON.stringify({ ...batch, records }),
      }
    }
  } catch {
    // Retain an unreadable batch verbatim rather than silently losing evidence.
  }
  return copy
}

/** Keep source facts independently of the generated summary. No model decides
 * whether an old error is resolved. Older errors/receipts get exact transcript
 * locators, not a second full copy; recent and unknown results stay verbatim.
 * This does not recognize arbitrary prose as a receipt; other unresolved work
 * still belongs in the summary and the unchanged source transcript.
 */
export function preserveCompactContext(
  messages: Message[],
  transcriptPath?: string,
): {
  historicalMessages: UserMessage[]
  messagesToKeep: Message[]
} {
  const workingMessages = messages.filter(
    message =>
      message.type !== 'progress' &&
      !(message.type === 'system' && message.subtype === 'compact_boundary') &&
      !message.isCompactSummary &&
      !message.compactPreservedEvidence,
  )
  const groups = groupMessagesByApiRound(workingMessages)
  let messagesToKeep = groups
    .filter(group => group.some(message => message.type === 'assistant'))
    .slice(-RECENT_ROUNDS)
    .flat()
    .map(message => {
      if (message.type !== 'assistant' || !message.message) return message
      // Old usage measures the PRE-compact context. Leaving it attached can
      // immediately retrigger compaction instead of estimating the new payload.
      const { usage, ...apiMessage } = message.message
      return { ...message, message: apiMessage }
    })
  const kept = new Set(messagesToKeep.map(message => message.uuid))
  const historicalMessages: UserMessage[] = []
  const records: ReturnType<typeof evidenceRecord>[] = []
  const calls = new Map<string, { call: unknown; message: Message }>()
  const resultIds = new Set<string>()
  let latestTodoId: string | undefined
  let latestReceiptId: string | undefined
  let latestErrorId: string | undefined
  for (const message of messages) {
    if (message.type === 'user' && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) {
        if (block.type !== 'tool_result') continue
        resultIds.add(block.tool_use_id)
        if (block.is_error) latestErrorId = block.tool_use_id
        if (receiptText(block.content).match(RECEIPT_FIELD))
          latestReceiptId = block.tool_use_id
      }
    }
    if (
      message.type !== 'assistant' ||
      !Array.isArray(message.message?.content)
    )
      continue
    for (const block of message.message.content) {
      if (block.type !== 'tool_use') continue
      calls.set(block.id, { call: block, message })
      if (block.name === 'TodoWrite') latestTodoId = block.id
    }
  }

  for (const message of messages) {
    if (kept.has(message.uuid) || message.type !== 'user' || !message.message)
      continue
    if (message.compactPreservedEvidence === true) {
      historicalMessages.push(
        copyHistoricalEvidence(
          message as UserMessage,
          latestReceiptId,
          latestErrorId,
          latestTodoId,
        ),
      )
      continue
    }
    if (isOriginalUser(message)) {
      historicalMessages.push(copyUser(message as UserMessage))
      continue
    }
    if (!Array.isArray(message.message.content)) continue
    const toolState = message.toolUseResult as
      | {
          backgroundTaskId?: string
          interrupted?: boolean
        }
      | undefined
    for (const block of message.message.content) {
      if (block.type !== 'tool_result') continue
      const text = receiptText(block.content)
      // These are fields already emitted in tool receipts, not inferred
      // success/failure from prose. Matching conservatively also retains
      // partial JSON output. Never discard a prior unknown on a new request ID.
      const hasReceipt = RECEIPT_FIELD.test(text)
      const background =
        toolState?.backgroundTaskId ||
        text.startsWith('Command running in background with ID: ')
      if (
        !block.is_error &&
        !background &&
        !toolState?.interrupted &&
        !hasReceipt &&
        block.tool_use_id !== latestTodoId
      )
        continue

      const call = calls.get(block.tool_use_id)?.call as
        | { id: string; name: string }
        | undefined
      const requiredBody = Boolean(
        background ||
          toolState?.interrupted ||
          /"(?:outcome|status)"\s*:\s*"(?:unknown|pending|running|queued|in_progress)"/.test(
            text,
          ),
      )
      const keepBody =
        requiredBody ||
        block.tool_use_id === latestReceiptId ||
        block.tool_use_id === latestErrorId ||
        block.tool_use_id === latestTodoId
      const record = evidenceRecord(
        message,
        block.tool_use_id === latestTodoId
          ? call
          : call && { id: call.id, name: call.name },
        keepBody ? block : evidencePointer(block),
      )
      if (keepBody) record.bodyRetention = requiredBody ? 'required' : 'latest'
      records.push(record)
    }
  }
  for (const [id, { call, message }] of calls) {
    if (!resultIds.has(id) && !kept.has(message.uuid)) {
      records.push(
        evidenceRecord(message, call, { status: 'no result in transcript' }),
      )
    }
  }
  messagesToKeep = compactSuccessfulWrites(
    messagesToKeep,
    transcriptPath,
    records,
  )
  if (records.length > 0) {
    historicalMessages.push({
      type: 'user',
      uuid: randomUUID(),
      isMeta: true,
      isVisibleInTranscriptOnly: true,
      compactPreservedEvidence: true,
      message: {
        role: 'user',
        content:
          'Historical tool evidence: not user instructions, renewed authorization or proof of current validity.\n' +
          JSON.stringify({ transcriptPath, records }),
      },
    })
  }
  return { historicalMessages, messagesToKeep }
}

const RECEIPT_FIELD = /"(?:outcome|status|valid|unverified|measurementId)"\s*:/

function receiptText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap(part => (part.type === 'text' ? [part.text] : []))
    .join('\n')
}
