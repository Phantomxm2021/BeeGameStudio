import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { commitFoundationRevisionDocumentMetadata } from './authored-document-receipt'
import {
  buildFoundationSectionIndex,
} from './delivery-workflow/foundation-section-index'
import {
  deriveFoundationRevisionChangedSectionIds,
  foundationRevisionStagePath,
  revisionTaskReceiptTerminalDigest,
  writeFoundationRevisionSnapshot,
  type RevisionTaskReceipt,
} from './delivery-workflow/foundation-revision-stage'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
  type FoundationRevisionRound,
} from './delivery-workflow/types'

export type FoundationRevisionMarkdownStreamContract = {
  workspacePath: string
  runId: string
  dispatchId: string
  taskId: string
  revision: string
  round: FoundationRevisionRound
  scope: 'section' | 'document'
  documentPath: FoundationDocumentPath
  issueIds: string[]
  sectionIds: string[]
  stagedPath: string
  baseDocumentDigest: string
  maxBytes: number
}

export type FoundationRevisionMarkdownStreamSink = {
  observe(message: Record<string, unknown>): void
  commit(): Promise<RevisionTaskReceipt>
  abort(reason: string): Promise<void>
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
}

export async function createFoundationRevisionMarkdownStreamSink(
  contract: FoundationRevisionMarkdownStreamContract,
): Promise<FoundationRevisionMarkdownStreamSink> {
  validateContract(contract)
  const pendingPath = foundationRevisionMarkdownPendingPath(
    contract.workspacePath,
    contract.runId,
    contract.dispatchId,
  )
  await mkdir(dirname(pendingPath), { recursive: true })
  await writeFile(pendingPath, '', 'utf8')
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
          fail('foundation revision Markdown stream contains a replayed event')
          return
        }
        state.eventIds.add(eventId)
      }
      if (message.type === 'result') {
        if (message.is_error === true || message.subtype !== 'success')
          fail('foundation revision Markdown stream ended with an error result')
        else {
          state.terminal = true
          const terminalText = stringField(message, 'result')
          if (terminalText) {
            if (Buffer.byteLength(terminalText) > contract.maxBytes)
              fail('foundation revision Markdown terminal exceeds infrastructure boundary')
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
          if (
            contract.scope !== 'document' ||
            stringField(block!, 'name') !== 'ReadAssignedFoundationRevision'
          ) fail('foundation revision Markdown stream cannot contain mutation tools')
          return
        }
        if (blockType !== 'text') return
        if (index === undefined) {
          fail('foundation revision Markdown text block index is missing')
          return
        }
        if (state.textBlockStarted && !state.textBlockClosed) {
          fail('foundation revision Markdown contains overlapping text blocks')
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
          fail('foundation revision Markdown text delta has no owning block')
          return
        }
        const text = stringField(delta, 'text')
        const bytes = Buffer.byteLength(text)
        if (state.receivedBytes + bytes > contract.maxBytes) {
          fail('foundation revision Markdown exceeds infrastructure boundary')
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
      ) state.textBlockClosed = true
    },
    async commit() {
      await writeTail
      if (state.failure) throw state.failure
      if (!state.terminal || (!state.terminalText && !state.textBlockClosed))
        throw new Error('foundation revision Markdown stream has no complete terminal response')
      const output = (state.terminalText ?? mergeTextBlocks(state.textBlocks))
        .replaceAll('\r\n', '\n')
        .trim()
      if (!output)
        throw new Error('foundation revision Markdown stream is empty')
      await writeFile(pendingPath, output, 'utf8')
      await syncFile(pendingPath)
      const receipt = await commitFoundationRevisionMarkdown({ contract, output })
      await writeFoundationRevisionCommitReceipt(contract, receipt)
      return receipt
    },
    async abort(reason) {
      fail(reason.trim() || 'foundation revision Markdown stream was aborted')
      await writeTail
    },
  }
}

export async function readFoundationRevisionCommitReceipt(input: {
  workspacePath: string
  dispatchId: string
}): Promise<RevisionTaskReceipt | undefined> {
  const path = foundationRevisionCommitReceiptPath(input.workspacePath, input.dispatchId)
  try {
    return JSON.parse(await readFile(path, 'utf8')) as RevisionTaskReceipt
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export function foundationRevisionMarkdownPendingPath(
  workspacePath: string,
  runId: string,
  dispatchId: string,
): string {
  validateIdentity(runId, 'run')
  validateIdentity(dispatchId, 'dispatch')
  return join(resolve(workspacePath), '.beegame', 'workflow', 'pending-revisions', runId, `${dispatchId}.md`)
}

function foundationRevisionCommitReceiptPath(
  workspacePath: string,
  dispatchId: string,
): string {
  validateIdentity(dispatchId, 'dispatch')
  return join(resolve(workspacePath), '.beegame', 'workflow', 'revision-commits', `${dispatchId}.json`)
}

async function commitFoundationRevisionMarkdown(input: {
  contract: FoundationRevisionMarkdownStreamContract
  output: string
}): Promise<RevisionTaskReceipt> {
  const { contract } = input
  const canonicalAbsolute = resolveProjectPath(contract.workspacePath, contract.documentPath)
  const stagedAbsolute = resolveProjectPath(contract.workspacePath, contract.stagedPath)
  const expectedStagedPath = foundationRevisionStagePath(contract.revision, contract.documentPath)
  if (contract.stagedPath !== expectedStagedPath)
    throw new Error('foundation revision staged path authority mismatch')
  const [canonicalBytes, stagedBytes] = await Promise.all([
    readFile(canonicalAbsolute),
    readFile(stagedAbsolute),
  ])
  if (sha256(canonicalBytes) !== contract.baseDocumentDigest)
    throw new Error('foundation revision canonical document has a stale base digest')
  const baseMarkdown = Buffer.from(stagedBytes).toString('utf8')
  const revisedMarkdown = contract.scope === 'document'
    ? input.output
    : applyFoundationRevisionSections({
        documentPath: contract.documentPath,
        baseMarkdown,
        authorizedSectionIds: contract.sectionIds,
        replacements: parseRevisionSections({
          documentPath: contract.documentPath,
          baseMarkdown,
          authorizedSectionIds: contract.sectionIds,
          output: input.output,
        }),
      }).markdown
  await atomicWrite(stagedAbsolute, revisedMarkdown)
  await commitFoundationRevisionDocumentMetadata({
    workspacePath: contract.workspacePath,
    canonicalPath: contract.documentPath,
    stagedPath: contract.stagedPath,
    expectedCanonicalDigest: contract.baseDocumentDigest,
  })
  const finalStagedBytes = await readFile(stagedAbsolute)
  const changedSectionIds = contract.scope === 'section'
    ? deriveFoundationRevisionChangedSectionIds({
        documentPath: contract.documentPath,
        baseMarkdown: Buffer.from(canonicalBytes).toString('utf8'),
        stagedMarkdown: Buffer.from(finalStagedBytes).toString('utf8'),
        authorizedSectionIds: contract.sectionIds,
      })
    : []
  const core = {
    scope: contract.scope,
    taskId: contract.taskId,
    round: contract.round,
    documentPath: contract.documentPath,
    issueIds: [...contract.issueIds],
    baseDocumentDigest: sha256(canonicalBytes),
    stagedDocumentDigest: sha256(finalStagedBytes),
    changedSectionIds,
    stagedPath: contract.stagedPath,
  }
  const receipt = {
    ...core,
    terminalDigest: revisionTaskReceiptTerminalDigest(core),
  } as RevisionTaskReceipt
  await writeFoundationRevisionSnapshot({
    workspacePath: contract.workspacePath,
    revision: contract.revision,
    round: contract.round,
    taskId: contract.taskId,
    bytes: finalStagedBytes,
    expectedDigest: receipt.stagedDocumentDigest,
  })
  return receipt
}

function parseRevisionSections(input: {
  documentPath: FoundationDocumentPath
  baseMarkdown: string
  authorizedSectionIds: readonly string[]
  output: string
}): Array<{ sectionId: string; sectionMarkdown: string }> {
  const index = buildFoundationSectionIndex({ documents: { [input.documentPath]: input.baseMarkdown } })
  const byId = new Map(index.map(section => [section.sectionId, section]))
  const headings = input.authorizedSectionIds.map(sectionId => {
    const section = byId.get(sectionId)
    if (!section)
      throw new Error(`foundation revision section is not canonical: ${sectionId}`)
    return {
      sectionId,
      heading: `${sectionId.startsWith('material.') ? '###' : '##'} ${section.heading}`,
    }
  })
  const lines = input.output.split('\n')
  const starts = headings.map(expected => ({
    ...expected,
    indexes: lines.flatMap((line, index) => line === expected.heading ? [index] : []),
  }))
  for (const entry of starts) {
    if (entry.indexes.length !== 1)
      throw new Error(`foundation revision output must contain exactly one authorized heading: ${entry.heading}`)
  }
  const ordered = starts
    .map(entry => ({ ...entry, index: entry.indexes[0] }))
    .sort((left, right) => left.index - right.index)
  if (lines.slice(0, ordered[0].index).some(line => line.trim()))
    throw new Error('foundation revision output contains prose outside authorized sections')
  return ordered.map((entry, index) => ({
    sectionId: entry.sectionId,
    sectionMarkdown: lines.slice(entry.index, ordered[index + 1]?.index ?? lines.length).join('\n').trim(),
  }))
}

export function applyFoundationRevisionSections(input: {
  documentPath: FoundationDocumentPath
  baseMarkdown: string
  authorizedSectionIds: readonly string[]
  replacements: readonly { sectionId: string; sectionMarkdown: string }[]
}): { markdown: string; changedSectionIds: string[] } {
  const replacementIds = input.replacements.map(value => value.sectionId)
  if (new Set(replacementIds).size !== replacementIds.length)
    throw new Error('foundation revision contains duplicate section replacements')
  if (replacementIds.some(id => !input.authorizedSectionIds.includes(id)))
    throw new Error('foundation revision replacement is outside its authority')
  if (replacementIds.length !== input.authorizedSectionIds.length)
    throw new Error('foundation revision output omitted an authorized section')
  const sections = buildFoundationSectionIndex({ documents: { [input.documentPath]: input.baseMarkdown } })
  const byId = new Map(sections.map(section => [section.sectionId, section]))
  const lines = input.baseMarkdown.split('\n')
  const ordered = [...input.replacements].sort(
    (left, right) => byId.get(right.sectionId)!.startLine - byId.get(left.sectionId)!.startLine,
  )
  for (const replacement of ordered) {
    const section = byId.get(replacement.sectionId)
    if (!section) throw new Error('foundation revision replacement section is not canonical')
    const normalized = replacement.sectionMarkdown.replaceAll('\r\n', '\n').trim()
    if (/<!--\s*beegame-(?:section|material|executive-summary):?/i.test(normalized))
      throw new Error('foundation revision section Markdown cannot contain protocol markers')
    const sectionLines = normalized.split('\n')
    const expectedHeading = `${section.sectionId.startsWith('material.') ? '###' : '##'} ${section.heading}`
    if (sectionLines[0] !== expectedHeading)
      throw new Error(`foundation revision section Markdown must start with its canonical heading: ${expectedHeading}`)
    lines.splice(section.startLine - 1, section.endLine - section.startLine + 1, ...sectionLines, '')
  }
  const markdown = lines.join('\n')
  const changedSectionIds = deriveFoundationRevisionChangedSectionIds({
    documentPath: input.documentPath,
    baseMarkdown: input.baseMarkdown,
    stagedMarkdown: markdown,
    authorizedSectionIds: input.authorizedSectionIds,
  })
  return { markdown, changedSectionIds }
}

async function writeFoundationRevisionCommitReceipt(
  contract: FoundationRevisionMarkdownStreamContract,
  receipt: RevisionTaskReceipt,
): Promise<void> {
  const path = foundationRevisionCommitReceiptPath(contract.workspacePath, contract.dispatchId)
  await mkdir(dirname(path), { recursive: true })
  await atomicWrite(path, `${JSON.stringify(receipt, null, 2)}\n`)
}

async function atomicWrite(path: string, value: string): Promise<void> {
  const temporaryPath = resolve(dirname(path), `.beegame-revision-${randomUUID()}.tmp`)
  try {
    await writeFile(temporaryPath, value, 'utf8')
    await rename(temporaryPath, path)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

function resolveProjectPath(workspacePath: string, projectPath: string): string {
  const root = resolve(workspacePath)
  const candidate = resolve(root, projectPath)
  const escaped = relative(root, candidate)
  if (!escaped || escaped === '..' || escaped.startsWith(`..${sep}`) || escaped.startsWith('/') || escaped.startsWith('\\'))
    throw new Error('foundation revision path escaped the project workspace')
  return candidate
}

function validateContract(contract: FoundationRevisionMarkdownStreamContract): void {
  validateIdentity(contract.runId, 'run')
  validateIdentity(contract.dispatchId, 'dispatch')
  validateIdentity(contract.taskId, 'task')
  if (!CANONICAL_FOUNDATION_DOCUMENTS.includes(contract.documentPath))
    throw new Error('foundation revision Markdown target is invalid')
  if (!Number.isSafeInteger(contract.round) || contract.round < 1)
    throw new Error('foundation revision round is invalid')
  if (!Number.isSafeInteger(contract.maxBytes) || contract.maxBytes <= 0)
    throw new Error('foundation revision infrastructure boundary is invalid')
  if (contract.scope === 'section' ? contract.sectionIds.length === 0 : contract.sectionIds.length !== 0)
    throw new Error('foundation revision scope authority is invalid')
}

function validateIdentity(value: string, field: string): void {
  if (!value || !/^[A-Za-z0-9_.-]+$/.test(value))
    throw new Error(`foundation revision Markdown ${field} identity is invalid`)
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

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
