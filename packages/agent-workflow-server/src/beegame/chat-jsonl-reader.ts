import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { basename } from 'node:path'

const CHUNK_BYTES = 256 * 1024
const HEADER_BYTES = 64 * 1024
export const CHAT_RECORD_BYTES = 4 * 1024 * 1024
export const CHAT_PAGE_BYTES = 8 * 1024 * 1024
export const CHAT_PAGE_ROWS = 500

export type JsonlHeader = {
  id?: number; sessionId?: string; turnId?: string; type?: string; createdAt?: string
  text: string; payload?: Record<string, unknown>
}
export type JsonlEntry = { offset: number; end: number; header: JsonlHeader }
export type JsonlSelection = {
  afterId?: number; beforeId?: number; sessionId?: string; turnId?: string; types?: readonly string[]
  limit?: number; newestFirst?: boolean
}

/** Only routing/display metadata is indexed. Never use this projection as a
 * permission, billing, or tool-success receipt: those readers parse the row. */
function headerOf(head: Buffer, tail: Buffer, includeText = false): JsonlHeader {
  const prefix = head.toString('utf8'), suffix = tail.toString('utf8')
  const textAt = prefix.search(/,\s*"text"\s*:/)
  let top: Record<string, unknown> = {}, complete = false
  try { top = JSON.parse(prefix); complete = true }
  catch { try { top = JSON.parse(textAt >= 0 ? prefix.slice(0, textAt) + '}' : prefix) } catch { /* selected rows are validated on read */ } }
  const originalPayload = complete && top.payload && typeof top.payload === 'object' ? top.payload as Record<string, unknown> : undefined
  const scalar = (source: string, key: string) => {
    const match = new RegExp('(?<!\\\\)"' + key + '"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|true|false|null|-?\\d+)', 'g')
    const matches = [...source.matchAll(match)]
    if (!matches.length) return undefined
    try { return JSON.parse(matches.at(-1)![1]!) } catch { return undefined }
  }
  const header: JsonlHeader = { text: '' }
  for (const key of ['id', 'sessionId', 'turnId', 'type'] as const) {
    const value = top[key]
    if (value !== undefined) (header as Record<string, unknown>)[key] = value
  }
  const at = top.createdAt ?? scalar(suffix, 'createdAt') ?? scalar(prefix, 'createdAt')
  if (typeof at === 'string') header.createdAt = at
  // A progress row can contain a huge output but a small,
  // complete delta in text. Keep that delta without decoding its output again.
  const text = complete ? top.text : scalar(prefix, 'text')
  if (includeText && typeof text === 'string') header.text = text
  const payload: Record<string, unknown> = {}
  // Unparsed output bodies contain no routing fields. Avoid searching a long
  // escaped output string once for each metadata key.
  const outputAt = prefix.search(/(?<!\\)"output"\s*:/)
  const routingPrefix = outputAt >= 0 ? prefix.slice(0, outputAt) : prefix
  const routingSuffix = suffix.slice(-4096)
  for (const key of ['toolUseID', 'toolName', 'parentToolUseID', 'parent_tool_use_id', 'messageId',
    'assistantBlockId', 'thinkingBlockId', 'thinkingStartedAt', 'contentMode', 'status', 'subtype',
    'sourceSequence', 'childThreadId', 'childStatus', 'willRetry',
    'clientMessageId', 'supersedesMessageId', 'displayKind', 'displayText', 'language']) {
    const value = complete ? originalPayload?.[key] : scalar(routingPrefix, key) ?? scalar(routingSuffix, key)
    if (value !== undefined && (typeof value !== 'string' || value.length <= 4096)) payload[key] = value
  }
  const message = originalPayload?.message as { id?: unknown } | undefined
  if (typeof message?.id === 'string') payload.message = { id: message.id }
  if (Object.keys(payload).length) header.payload = payload
  return header
}

/** Shell output is not a host receipt. For oversized terminal rows only, retain
 * every other byte under the existing limit, then validate the complete JSON
 * and tool identity. A lexer is needed because output can contain escaped JSON,
 * precede toolName, or cross read chunks; a header/regex cannot establish facts. */
function shellFactProjection(path: string, entry: JsonlEntry) {
  const bounded = () => Error(`Chat record exceeds bounded read limit in ${basename(path)} at byte ${entry.offset}`)
  const invalid = () => Error(`Invalid Chat JSONL record in ${basename(path)} at byte ${entry.offset}`)
  const retained = Buffer.alloc(CHAT_RECORD_BYTES)
  type Frame = { object: boolean; keyExpected: boolean; key?: string; payload: boolean }
  // Only the root and its immediate values can contain the projected path.
  // Deeper containers need a depth counter, not an unbounded frame stack.
  const frames: Frame[] = []
  let depth = 0
  let length = 0, inString = false, keyString = false, skip = false, escaped = false, unicode = 0
  let stringStart = 0, payloadKeys = 0, outputKeys = 0, typeKeys = 0, toolNameKeys = 0, omitted = false
  const retain = (byte: number) => {
    if (length === retained.length) throw bounded()
    retained[length++] = byte
  }
  return {
    get byteLength() { return length },
    push(bytes: Buffer) {
      for (const byte of bytes) {
        const frame = depth <= 2 ? frames[depth - 1] : undefined
        if (inString) {
          const closing = byte === 34 && !escaped && !unicode
          if (!skip || closing) retain(byte)
          // JSON.parse below validates retained syntax; validate the omitted
          // string too, so malformed output cannot become a valid receipt.
          if (unicode) {
            if (!(byte >= 48 && byte <= 57 || byte >= 65 && byte <= 70 || byte >= 97 && byte <= 102)) throw invalid()
            unicode--; continue
          }
          if (escaped) {
            escaped = false
            if (byte === 117) unicode = 4
            else if (![34, 92, 47, 98, 102, 110, 114, 116].includes(byte)) throw invalid()
          } else if (byte === 92) escaped = true
          else if (closing) {
            inString = false
            if (keyString) {
              try { frame!.key = JSON.parse(retained.subarray(stringStart, length).toString('utf8')) }
              catch { throw invalid() }
              frame!.keyExpected = false
              // Duplicate projected paths could hide a second payload/output.
              if (depth === 1 && frame!.key === 'payload' && ++payloadKeys > 1) throw invalid()
              if (depth === 1 && frame!.key === 'type' && ++typeKeys > 1) throw invalid()
              if (frame!.payload && frame!.key === 'output' && ++outputKeys > 1) throw invalid()
              if (frame!.payload && frame!.key === 'toolName' && ++toolNameKeys > 1) throw invalid()
            }
            skip = false
          } else if (byte < 32) throw invalid()
          continue
        }
        retain(byte)
        if (byte === 34) {
          inString = true; keyString = Boolean(frame?.object && frame.keyExpected)
          stringStart = length - 1
          skip = !keyString && Boolean(frame?.payload && frame.key === 'output')
          if (skip) omitted = true
        } else if (byte === 123 || byte === 91) {
          depth++
          if (depth <= 2) frames[depth - 1] = { object: byte === 123, keyExpected: byte === 123,
            payload: byte === 123 && depth === 2 && Boolean(frame?.object && frame.key === 'payload') }
        } else if (byte === 125 || byte === 93) {
          if (depth <= 2) frames.pop()
          depth--
        } else if (byte === 44 && frame?.object) { frame.keyExpected = true; frame.key = undefined }
      }
    },
    finish() {
      if (inString) throw invalid()
      let row: Record<string, any>
      try { row = JSON.parse(retained.subarray(0, length).toString('utf8')) }
      catch { throw invalid() }
      if (!omitted || !['tool.completed', 'tool.failed'].includes(row?.type) || row?.payload?.toolName !== 'Shell') throw bounded()
      delete row.payload.output
      return row
    },
  }
}

/** A byte-offset index, not a cache of historical payloads. The first opening of
 * an old journal scans it once in bounded chunks; later polls scan only appends.
 * Incomplete final lines and failed scans never advance the committed offset. */
export class ChatJsonlReader<T> {
  private records: JsonlEntry[] = []
  private offset = 0
  private identity?: string
  private size = 0
  private modified = 0
  private pending?: Promise<void>
  private facts?: { offset: number; project: (row: T) => T | undefined; sessionId?: string; rows: T[] }

  private scanState(info: { dev: number; ino: number; size: number; mtimeMs: number }) {
    const identity = `${info.dev}:${info.ino}`
    const reset = identity !== this.identity || info.size < this.size ||
      (info.size === this.size && info.mtimeMs !== this.modified)
    return { identity, reset, unchanged: !reset && info.size === this.size && info.mtimeMs === this.modified,
      position: reset ? 0 : this.offset }
  }

  private scanner(start: number) {
    let offset = start, head = Buffer.alloc(0), tail = Buffer.alloc(0)
    const records: JsonlEntry[] = []
    const part = (bytes: Buffer) => {
      if (head.length < HEADER_BYTES) head = Buffer.concat([head, bytes.subarray(0, HEADER_BYTES - head.length)])
      tail = bytes.length >= HEADER_BYTES ? Buffer.from(bytes.subarray(-HEADER_BYTES)) : Buffer.concat([tail, bytes]).subarray(-HEADER_BYTES)
    }
    return { records,
      push(bytes: Buffer, position: number) {
        let from = 0
        for (let to = bytes.indexOf(10); to >= 0; to = bytes.indexOf(10, from)) {
          part(bytes.subarray(from, to))
          const end = position + to + 1
          if (head.toString('utf8').trim()) records.push({ offset, end, header: headerOf(head, tail) })
          offset = end; head = Buffer.alloc(0); tail = Buffer.alloc(0); from = to + 1
        }
        part(bytes.subarray(from))
      },
      committed: () => offset,
    }
  }

  private commit(info: { size: number; mtimeMs: number }, state: ReturnType<ChatJsonlReader<T>['scanState']>, scanner: ReturnType<ChatJsonlReader<T>['scanner']>) {
    this.records = state.reset ? scanner.records : this.records.concat(scanner.records)
    this.offset = scanner.committed(); this.identity = state.identity; this.size = info.size; this.modified = info.mtimeMs
    if (state.reset || scanner.records.length) this.facts = undefined
  }

  async entries(path: string): Promise<readonly JsonlEntry[]> {
    if (!this.pending) this.pending = this.refresh(path).finally(() => { this.pending = undefined })
    await this.pending
    return this.records
  }

  private async refresh(path: string) {
    const file = await open(path, 'r')
    try {
      const info = await file.stat(), state = this.scanState(info)
      if (state.unchanged) return
      const scanner = this.scanner(state.position), buffer = Buffer.alloc(CHUNK_BYTES)
      for (let position = state.position; position < info.size;) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, info.size - position), position)
        if (!bytesRead) break
        scanner.push(buffer.subarray(0, bytesRead), position); position += bytesRead
      }
      this.commit(info, state, scanner)
    } finally { await file.close() }
  }

  entriesSync(path: string): readonly JsonlEntry[] {
    const file = openSync(path, 'r')
    try {
      const info = fstatSync(file), state = this.scanState(info)
      if (!state.unchanged) {
        const scanner = this.scanner(state.position), buffer = Buffer.alloc(CHUNK_BYTES)
        for (let position = state.position; position < info.size;) {
          const bytesRead = readSync(file, buffer, 0, Math.min(buffer.length, info.size - position), position)
          if (!bytesRead) break
          scanner.push(buffer.subarray(0, bytesRead), position); position += bytesRead
        }
        this.commit(info, state, scanner)
      }
      return this.records
    } finally { closeSync(file) }
  }

  assertCompleteForAppend(): void {
    if (this.offset !== this.size) throw Error('Chat transcript has an incomplete final record; cannot append')
  }

  private parse(path: string, entry: JsonlEntry, bytes: Buffer): T {
    try { return JSON.parse(bytes.toString('utf8')) as T }
    catch { throw Error(`Invalid Chat JSONL record in ${basename(path)} at byte ${entry.offset}`) }
  }

  /** Display omission is explicit and separate from the validated Shell fact
   * projection. Neither path rewrites the raw journal. */
  private omitted(entry: JsonlEntry, header = entry.header): T {
    // Legacy native resumes are empty control records, even when the page budget is exhausted.
    const nativeRecovery = header.type === 'user.message' && header.payload?.displayKind === 'workflow_v3_continue' &&
      header.payload.displayText === '恢复原生执行' && !header.text
    return { ...header,
      text: nativeRecovery ? '' : header.text || '[Historical event body exceeds the display limit; original retained in transcript.]',
      payload: { ...header.payload, type: header.type,
        ...(header.type === 'tool.progress' ? { output: '[Cumulative progress body omitted; original retained in transcript.]\n' + header.text } : {}),
        historyBodyOmitted: true, originalBytes: entry.end - entry.offset },
    } as T
  }

  async readEntries(path: string, entries: readonly JsonlEntry[], display = true): Promise<T[]> {
    const file = await open(path, 'r')
    try { return await this.readOpenEntries(file, path, entries, display) }
    finally { await file.close() }
  }

  private async readOpenEntries(file: FileHandle, path: string, entries: readonly JsonlEntry[], display: boolean): Promise<T[]> {
    const rows: T[] = []
    let bytesRead = 0
      for (const entry of entries) {
        const length = entry.end - entry.offset
        if (length > CHAT_RECORD_BYTES || bytesRead + length > CHAT_PAGE_BYTES) {
          if (!display) {
            if (length <= CHAT_RECORD_BYTES) throw Error(`Chat record exceeds bounded read limit in ${basename(path)} at byte ${entry.offset}`)
            const projection = shellFactProjection(path, entry), buffer = Buffer.alloc(CHUNK_BYTES)
            for (let position = entry.offset; position < entry.end;) {
              const { bytesRead: read } = await file.read(buffer, 0, Math.min(buffer.length, entry.end - position), position)
              if (!read) throw Error('Chat transcript changed while reading')
              projection.push(buffer.subarray(0, read)); position += read
            }
            const row = projection.finish() as T
            bytesRead += projection.byteLength
            if (bytesRead > CHAT_PAGE_BYTES) throw Error(`Chat record exceeds bounded read limit in ${basename(path)} at byte ${entry.offset}`)
            rows.push(row); continue
          }
          const head = Buffer.alloc(Math.min(HEADER_BYTES, length))
          const { bytesRead: read } = await file.read(head, 0, head.length, entry.offset)
          rows.push(this.omitted(entry, { ...entry.header, text: headerOf(head.subarray(0, read), Buffer.alloc(0), true).text.slice(0, 4096) })); continue
        }
        const bytes = Buffer.alloc(length)
        let read = 0
        while (read < length) {
          const result = await file.read(bytes, read, length - read, entry.offset + read)
          if (!result.bytesRead) throw Error('Chat transcript changed while reading')
          read += result.bytesRead
        }
        bytesRead += length; rows.push(this.parse(path, entry, bytes))
      }
      return rows
  }

  async read(path: string, selection: JsonlSelection = {}) {
    const entries = await this.entries(path)
    const eligible = entries.filter(({ header: h }) =>
      (selection.afterId === undefined || Number(h.id) > selection.afterId) &&
      (selection.beforeId === undefined || Number(h.id) < selection.beforeId) &&
      (!selection.sessionId || h.sessionId === selection.sessionId) &&
      (!selection.turnId || h.turnId === selection.turnId) &&
      (!selection.types || selection.types.includes(String(h.type))))
    const limit = Math.min(CHAT_PAGE_ROWS, Math.max(1, selection.limit ?? CHAT_PAGE_ROWS))
    const selected = selection.newestFirst ? eligible.slice(-limit) : eligible.slice(0, limit)
    return { rows: await this.readEntries(path, selected), hasMore: eligible.length > selected.length,
      nextBeforeId: selected[0]?.header.id ?? null, nextAfterId: selected.at(-1)?.header.id ?? null }
  }

  async readFacts(path: string, project: (row: T) => T | undefined, types?: readonly string[], sessionId?: string): Promise<T[]> {
    const entries = await this.entries(path)
    if (!types && this.facts?.offset === this.offset && this.facts.project === project && this.facts.sessionId === sessionId) return this.facts.rows
    const rows: T[] = [], file = await open(path, 'r')
    try { for (const entry of entries) {
      if (sessionId && entry.header.sessionId !== sessionId || types && !types.includes(String(entry.header.type))) continue
      // Progress still supplies the latest cursor/turn/time after a crash. Its
      // raw output is not a host decision or usage receipt.
      const row = project(entry.header.type === 'tool.progress'
        ? entry.header as T : (await this.readOpenEntries(file, path, [entry], false))[0]!)
      if (row) rows.push(row)
    }
    } finally { await file.close() }
    if (!types) this.facts = { offset: this.offset, project, sessionId, rows }
    return rows
  }

  readFactsSync(path: string, project: (row: T) => T | undefined, sessionId?: string): T[] {
    const entries = this.entriesSync(path)
    if (this.facts?.offset === this.offset && this.facts.project === project && this.facts.sessionId === sessionId) return this.facts.rows
    const rows: T[] = [], file = openSync(path, 'r')
    try {
      for (const entry of entries) {
        if (sessionId && entry.header.sessionId !== sessionId) continue
        if (entry.header.type === 'tool.progress') {
          const row = project(entry.header as T)
          if (row) rows.push(row)
          continue
        }
        const length = entry.end - entry.offset
        if (length > CHAT_RECORD_BYTES) {
          const projection = shellFactProjection(path, entry), buffer = Buffer.alloc(CHUNK_BYTES)
          for (let position = entry.offset; position < entry.end;) {
            const read = readSync(file, buffer, 0, Math.min(buffer.length, entry.end - position), position)
            if (!read) throw Error('Chat transcript changed while reading')
            projection.push(buffer.subarray(0, read)); position += read
          }
          const row = project(projection.finish() as T)
          if (row) rows.push(row)
          continue
        }
        const bytes = Buffer.alloc(length)
        let read = 0
        while (read < length) {
          const size = readSync(file, bytes, read, length - read, entry.offset + read)
          if (!size) throw Error('Chat transcript changed while reading')
          read += size
        }
        const row = project(this.parse(path, entry, bytes))
        if (row) rows.push(row)
      }
      this.facts = { offset: this.offset, project, sessionId, rows }
      return rows
    } finally { closeSync(file) }
  }
}
