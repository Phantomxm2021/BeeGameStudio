import { createHash } from 'node:crypto'
import { appendFile, mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  commitAuthoredFoundationDocument,
  type AuthoredDocumentReceipt,
} from './authored-document-receipt'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'

export type FoundationMarkdownStreamContract = {
  workspacePath: string
  runId: string
  dispatchId: string
  targetPath: FoundationDocumentPath
  maxBytes: number
  updatedAt?: string
}

export type FoundationMarkdownStreamSink = {
  observe(message: Record<string, unknown>): void
  commit(): Promise<AuthoredDocumentReceipt>
  abort(reason: string): Promise<void>
}

type StreamState = {
  textBlockIndex?: number
  textBlockStarted: boolean
  textBlockClosed: boolean
  textBlocks: string[]
  terminalBody?: string
  terminal: boolean
  receivedBytes: number
  eventIds: Set<string>
  failure?: Error
}

export async function createFoundationMarkdownStreamSink(
  contract: FoundationMarkdownStreamContract,
): Promise<FoundationMarkdownStreamSink> {
  validateContract(contract)
  const pendingPath = foundationMarkdownPendingPath(
    contract.workspacePath,
    contract.runId,
    contract.dispatchId,
  )
  await mkdir(dirname(pendingPath), { recursive: true })
  await writeFile(pendingPath, '', 'utf8')
  const original = await readOptionalFile(
    resolve(contract.workspacePath, contract.targetPath),
  )
  const expectedOriginalDigest =
    original === undefined ? null : sha256(original)
  const state: StreamState = {
    textBlockStarted: false,
    textBlockClosed: false,
    textBlocks: [],
    terminal: false,
    receivedBytes: 0,
    eventIds: new Set(),
  }
  let writeTail = Promise.resolve()

  const fail = (message: string) => {
    state.failure ??= new Error(message)
  }

  return {
    observe(message) {
      if (state.failure) return
      const eventId = stringField(message, 'uuid')
      if (eventId) {
        if (state.eventIds.has(eventId)) {
          fail('foundation Markdown stream contains a replayed event')
          return
        }
        state.eventIds.add(eventId)
      }
      if (message.type === 'result') {
        if (message.is_error === true || message.subtype !== 'success')
          fail('foundation Markdown stream ended with an error result')
        else {
          state.terminal = true
          const result = stringField(message, 'result')
          if (result) {
            if (Buffer.byteLength(result) > contract.maxBytes)
              fail('foundation Markdown stream terminal body exceeds maximum bytes')
            else state.terminalBody = result
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
          fail('foundation Markdown stream cannot contain tool use')
          return
        }
        if (blockType !== 'text') return
        if (index === undefined) {
          fail('foundation Markdown stream text block index is missing')
          return
        }
        if (state.textBlockStarted && !state.textBlockClosed) {
          fail('foundation Markdown stream contains overlapping text blocks')
          return
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
        if (index === undefined || index !== state.textBlockIndex) {
          fail('foundation Markdown stream text delta has no owning block')
          return
        }
        const text = stringField(delta, 'text')
        const bytes = Buffer.byteLength(text)
        if (state.receivedBytes + bytes > contract.maxBytes) {
          fail('foundation Markdown stream exceeds maximum bytes')
          return
        }
        state.receivedBytes += bytes
        state.textBlocks[state.textBlocks.length - 1] += text
        writeTail = writeTail.then(() => appendFile(pendingPath, text, 'utf8'))
        return
      }
      if (
        eventType === 'content_block_stop' &&
        index !== undefined &&
        index === state.textBlockIndex
      ) {
        state.textBlockClosed = true
      }
    },
    async commit() {
      await writeTail
      if (state.failure) throw state.failure
      if (!state.terminal)
        throw new Error('foundation Markdown stream has no complete terminal response')
      if (!state.terminalBody) {
        if (!state.textBlockClosed)
          throw new Error('foundation Markdown stream has no complete terminal response')
        if (state.receivedBytes === 0)
          throw new Error('foundation Markdown stream is empty')
      }
      const authoredBody = state.terminalBody ?? mergeTextBlocks(state.textBlocks)
      await writeFile(pendingPath, authoredBody, 'utf8')
      await syncFile(pendingPath)
      return commitAuthoredFoundationDocument({
        workspacePath: contract.workspacePath,
        dispatchId: contract.dispatchId,
        targetPath: contract.targetPath,
        authoredBody,
        expectedOriginalDigest,
        ...(contract.updatedAt ? { updatedAt: contract.updatedAt } : {}),
      })
    },
    async abort(reason) {
      fail(reason.trim() || 'foundation Markdown stream was aborted')
      await writeTail
    },
  }
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

export function foundationMarkdownPendingPath(
  workspacePath: string,
  runId: string,
  dispatchId: string,
): string {
  validateIdentity(runId, 'run')
  validateIdentity(dispatchId, 'dispatch')
  return join(
    resolve(workspacePath),
    '.beegame',
    'workflow',
    'pending-documents',
    runId,
    `${dispatchId}.md`,
  )
}

function validateContract(contract: FoundationMarkdownStreamContract): void {
  validateIdentity(contract.runId, 'run')
  validateIdentity(contract.dispatchId, 'dispatch')
  if (!CANONICAL_FOUNDATION_DOCUMENTS.includes(contract.targetPath))
    throw new Error('foundation Markdown stream target is invalid')
  if (!Number.isSafeInteger(contract.maxBytes) || contract.maxBytes <= 0)
    throw new Error('foundation Markdown stream maximum bytes is invalid')
}

function validateIdentity(value: string, field: string): void {
  if (
    !value ||
    [...value].some(
      character =>
        !'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.includes(
          character,
        ),
    )
  )
    throw new Error(`foundation Markdown stream ${field} identity is invalid`)
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function objectField(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const field = value[key]
  return field && typeof field === 'object' && !Array.isArray(field)
    ? field as Record<string, unknown>
    : undefined
}

function stringField(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === 'string' ? value[key] : ''
}

function numberField(
  value: Record<string, unknown>,
  key: string,
): number | undefined {
  return typeof value[key] === 'number' ? value[key] : undefined
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
