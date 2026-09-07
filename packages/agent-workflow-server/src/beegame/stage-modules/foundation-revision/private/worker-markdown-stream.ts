import { z } from 'zod/v4'
import { revisionCanonicalJson } from './json-digest'

const scopeSchema = z.enum(['document', 'section'])
const streamInputSchema = z.object({ scope: scopeSchema, maxBytes: z.number().int().positive().safe() }).strict()

export type RevisionWorkerMarkdownStreamInput = z.infer<typeof streamInputSchema>
export type RevisionWorkerMarkdownStream = {
  observe(message: Record<string, unknown>): void
  finish(): string
  abort(reason: string): void
}

type StreamState = {
  textBlockIndex?: number
  textBlockStarted: boolean
  textBlockClosed: boolean
  textBlocks: string[]
  terminal: boolean
  terminalText?: string
  receivedBytes: number
  eventIds: Set<string>
  failure?: Error
  finished?: string
}

function captureInput(value: unknown): RevisionWorkerMarkdownStreamInput {
  revisionCanonicalJson(value)
  return streamInputSchema.parse(structuredClone(value))
}

function captureMessage(value: unknown): Record<string, unknown> {
  // Validate descriptors and JSON shape before reading any event field. The
  // parser handles one already-forwarded native response, not raw transport.
  const canonical = revisionCanonicalJson(value)
  const message = JSON.parse(canonical) as unknown
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Revision Markdown stream event must be an object')
  return message as Record<string, unknown>
}

function objectField(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const field = value[key]
  return field && typeof field === 'object' && !Array.isArray(field) ? field as Record<string, unknown> : undefined
}

function stringField(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === 'string' ? value[key] : ''
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === 'number' ? value[key] : undefined
}

function mergeTextBlocks(blocks: readonly string[]): string {
  return blocks.reduce((document, block) => {
    if (!document) return block
    const trailingLineStart = document.lastIndexOf('\n') + 1
    const trailingLine = document.slice(trailingLineStart)
    return trailingLine && block.startsWith(trailingLine)
      ? document.slice(0, trailingLineStart) + block
      : document + block
  }, '')
}

/**
 * Pure in-memory parser for one already-forwarded Revision worker response.
 * It performs no file IO, receipt work, model calls, or tool authorization;
 * native execution owns those boundaries before/after this parser.
 */
export function createRevisionWorkerMarkdownStream(value: unknown): RevisionWorkerMarkdownStream {
  const input = captureInput(value)
  const state: StreamState = {
    textBlockStarted: false,
    textBlockClosed: false,
    textBlocks: [],
    terminal: false,
    receivedBytes: 0,
    eventIds: new Set(),
  }
  const fail = (message: string): void => { state.failure ??= new Error(message) }

  return {
    observe(rawMessage) {
      if (state.finished !== undefined) throw new Error('Revision Markdown stream received an event after finish')
      if (state.failure) return
      let message: Record<string, unknown>
      try { message = captureMessage(rawMessage) } catch (error) {
        state.failure ??= error instanceof Error ? error : new Error('Revision Markdown stream event is invalid')
        throw state.failure
      }
      if (state.terminal) { fail('Revision Markdown stream received an event after terminal response'); return }
      const eventId = stringField(message, 'uuid')
      if (eventId) {
        if (state.eventIds.has(eventId)) { fail('Revision Markdown stream contains a replayed event'); return }
        state.eventIds.add(eventId)
      }
      if (message.type === 'result') {
        if (message.is_error === true || message.subtype !== 'success') {
          fail('Revision Markdown stream ended with an error result')
        } else {
          state.terminal = true
          const terminalText = stringField(message, 'result')
          if (terminalText) {
            if (Buffer.byteLength(terminalText, 'utf8') > input.maxBytes)
              fail('Revision Markdown terminal result exceeds maximum bytes')
            else state.terminalText = terminalText
          }
        }
        return
      }
      if (message.type !== 'stream_event') return
      const event = objectField(message, 'event') ?? message
      const eventType = stringField(event, 'type')
      const index = numberField(event, 'index')
      if (eventType === 'content_block_start') {
        const block = objectField(event, 'content_block')
        const blockType = block ? stringField(block, 'type') : ''
        if (blockType === 'tool_use' || blockType === 'server_tool_use') {
          if (input.scope !== 'document' || stringField(block!, 'name') !== 'ReadAssignedFoundationRevision')
            fail('Revision Markdown stream cannot contain mutation tools')
          return
        }
        if (blockType !== 'text') return
        if (index === undefined) { fail('Revision Markdown text block index is missing'); return }
        if (state.textBlockStarted && !state.textBlockClosed) {
          fail('Revision Markdown contains overlapping text blocks'); return
        }
        state.textBlockStarted = true
        state.textBlockClosed = false
        state.textBlockIndex = index
        state.textBlocks.push('')
        return
      }
      if (eventType === 'content_block_delta') {
        const delta = objectField(event, 'delta')
        if (!delta || stringField(delta, 'type') !== 'text_delta') return
        if (state.textBlockClosed) { fail('Revision Markdown text delta arrived after its block was closed'); return }
        if (index === undefined || index !== state.textBlockIndex) {
          fail('Revision Markdown text delta has no owning block'); return
        }
        const text = stringField(delta, 'text')
        const bytes = Buffer.byteLength(text, 'utf8')
        if (state.receivedBytes + bytes > input.maxBytes) {
          fail('Revision Markdown exceeds infrastructure boundary'); return
        }
        state.receivedBytes += bytes
        state.textBlocks[state.textBlocks.length - 1] += text
        return
      }
      if (eventType === 'content_block_stop' && index !== undefined && index === state.textBlockIndex)
        state.textBlockClosed = true
    },
    finish() {
      if (state.finished !== undefined) return state.finished
      if (state.failure) throw state.failure
      if (!state.terminal || (!state.terminalText && !state.textBlockClosed)) {
        fail('Revision Markdown stream has no complete terminal response'); throw state.failure
      }
      const output = (state.terminalText ?? mergeTextBlocks(state.textBlocks)).replaceAll('\r\n', '\n').trim()
      if (!output) { fail('Revision Markdown stream is empty'); throw state.failure }
      state.finished = output
      return output
    },
    abort(reason) {
      if (state.failure || state.finished !== undefined) return
      fail(typeof reason === 'string' && reason.trim() ? reason.trim() : 'Revision Markdown stream was aborted')
    },
  }
}
