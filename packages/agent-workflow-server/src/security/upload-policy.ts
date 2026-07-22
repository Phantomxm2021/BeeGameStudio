import type {
  BeeGameAttachment,
  BeeGameFileAttachment,
  BeeGameImageAttachment,
} from '../beegame/session-manager'

export const MAX_BEEGAME_ATTACHMENTS = 8
export const MAX_BEEGAME_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_BEEGAME_ATTACHMENTS_BYTES = 32 * 1024 * 1024
export const MAX_BEEGAME_REQUEST_BYTES = 48 * 1024 * 1024
export const MAX_BEEGAME_PROJECT_ASSET_BYTES = 256 * 1024 * 1024
export const MAX_BEEGAME_PROJECT_ASSET_REQUEST_BYTES = MAX_BEEGAME_PROJECT_ASSET_BYTES + 2 * 1024 * 1024

const MIME_EXTENSIONS: Record<string, readonly string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
  'application/zip': ['.zip'],
  'application/msword': ['.doc'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/plain': ['.txt', '.md'],
  'text/markdown': ['.md'],
  'text/csv': ['.csv'],
  'application/csv': ['.csv'],
  'application/json': ['.json'],
  'text/json': ['.json'],
  'application/jsonl': ['.jsonl'],
  'application/x-ndjson': ['.jsonl'],
  'text/jsonl': ['.jsonl'],
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const JSON_TYPES = new Set(['application/json', 'text/json', 'application/jsonl', 'application/x-ndjson', 'text/jsonl'])

export type ValidatedBeeGameAttachment = (BeeGameImageAttachment | BeeGameFileAttachment) & {
  filename: string
  byteLength: number
}

export class BeeGameUploadPolicyError extends Error {
  constructor(reason = 'attachment rejected') {
    super(reason)
    this.name = 'BeeGameUploadPolicyError'
    Object.setPrototypeOf(this, BeeGameUploadPolicyError.prototype)
  }
}

/** Documented upload pairs: images, PDF/Office/ZIP archives, and UTF-8 text/JSON documents. */
export function validateBeeGameAttachments(value: unknown): ValidatedBeeGameAttachment[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BEEGAME_ATTACHMENTS) {
    throw new BeeGameUploadPolicyError()
  }
  let total = 0
  const validated = value.map((candidate) => {
    const attachment = readCandidate(candidate)
    const filename = safeBasename(attachment.filename, attachment.mediaType)
    const extension = extensionOf(filename)
    const allowedExtensions = MIME_EXTENSIONS[attachment.mediaType]
    if (!allowedExtensions?.includes(extension)) throw new BeeGameUploadPolicyError()
    const bytes = decodeBase64(attachment.data)
    if (bytes.length === 0 || bytes.length > MAX_BEEGAME_ATTACHMENT_BYTES) {
      throw new BeeGameUploadPolicyError()
    }
    total += bytes.length
    if (total > MAX_BEEGAME_ATTACHMENTS_BYTES) throw new BeeGameUploadPolicyError()
    verifyContent(attachment.mediaType, extension, bytes)
    return {
      ...attachment,
      data: attachment.data,
      filename,
      byteLength: bytes.length,
    } as ValidatedBeeGameAttachment
  })
  return validated
}

function readCandidate(value: unknown): { type: 'image' | 'file'; mediaType: string; data: string; filename?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BeeGameUploadPolicyError()
  const record = value as Record<string, unknown>
  const type = record.type === 'image' || record.type === 'file' ? record.type : undefined
  const mediaType = typeof record.mediaType === 'string' ? record.mediaType : ''
  const data = typeof record.data === 'string' ? record.data.trim() : ''
  const filename = typeof record.filename === 'string' ? record.filename : undefined
  if (!type || !MIME_EXTENSIONS[mediaType] || !data || (type === 'file' && !filename)) {
    throw new BeeGameUploadPolicyError()
  }
  if (type === 'image' && !IMAGE_TYPES.has(mediaType)) throw new BeeGameUploadPolicyError()
  return { type, mediaType, data, filename }
}

function decodeBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0 || value.length > Math.ceil(MAX_BEEGAME_ATTACHMENT_BYTES / 3) * 4 + 4) {
    throw new BeeGameUploadPolicyError()
  }
  let padding = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!
    if (char === '=') {
      padding += 1
      if (index < value.length - padding || padding > 2) throw new BeeGameUploadPolicyError()
    } else if (padding > 0 || !isBase64Char(char)) {
      throw new BeeGameUploadPolicyError()
    }
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== value) throw new BeeGameUploadPolicyError()
  return bytes
}

function isBase64Char(value: string): boolean {
  const code = value.charCodeAt(0)
  return code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || value === '+' || value === '/'
}

function verifyContent(mediaType: string, extension: string, bytes: Uint8Array): void {
  if (mediaType === 'image/png' && !startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) throw new BeeGameUploadPolicyError()
  if (mediaType === 'image/jpeg' && !startsWith(bytes, [0xff, 0xd8, 0xff])) throw new BeeGameUploadPolicyError()
  if (mediaType === 'image/webp' && (!startsWithAscii(bytes, 'RIFF') || !startsWithAscii(bytes.slice(8), 'WEBP'))) throw new BeeGameUploadPolicyError()
  if (mediaType === 'application/pdf' && !startsWithAscii(bytes, '%PDF-')) throw new BeeGameUploadPolicyError()
  if (extension === '.docx' || extension === '.xlsx' || extension === '.zip') {
    if (!isZip(bytes)) throw new BeeGameUploadPolicyError()
  }
  if (extension === '.doc' || extension === '.xls') {
    if (!startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) throw new BeeGameUploadPolicyError()
  }
  if (isTextType(mediaType)) {
    let text = ''
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new BeeGameUploadPolicyError() }
    if (JSON_TYPES.has(mediaType) || extension === '.json') {
      if (extension === '.jsonl' || mediaType === 'application/jsonl' || mediaType === 'application/x-ndjson' || mediaType === 'text/jsonl') {
        for (const line of text.split('\n')) if (line.trim()) { try { JSON.parse(line) } catch { throw new BeeGameUploadPolicyError() } }
      } else { try { JSON.parse(text) } catch { throw new BeeGameUploadPolicyError() } }
    }
  }
}

function isTextType(mediaType: string): boolean { return mediaType.startsWith('text/') || JSON_TYPES.has(mediaType) }
function isZip(bytes: Uint8Array): boolean { return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]) }
function startsWith(bytes: Uint8Array, prefix: number[]): boolean { return prefix.every((value, index) => bytes[index] === value) }
function startsWithAscii(bytes: Uint8Array, value: string): boolean { return startsWith(bytes, Array.from(value, char => char.charCodeAt(0))) }

function extensionOf(filename: string): string { const dot = filename.lastIndexOf('.'); return dot >= 0 ? filename.slice(dot).toLowerCase() : '' }

function safeBasename(value: string | undefined, mediaType: string): string {
  const raw = value?.trim() ?? ''
  let separator = -1
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === '/' || raw[index] === '\\') separator = index
  }
  const source = raw.slice(separator + 1)
  let output = ''
  for (const char of source) {
    const code = char.charCodeAt(0)
    const safe = code >= 65 && code <= 90 || code >= 97 && code <= 122 || code >= 48 && code <= 57 || char === '.' || char === '-' || char === '_'
    output += safe ? char : '_'
  }
  if (!output || output === '.' || output === '..') output = 'attachment'
  if (!extensionOf(output)) output += defaultExtension(mediaType)
  return output
}

function defaultExtension(mediaType: string): string { return MIME_EXTENSIONS[mediaType]?.[0] ?? '.bin' }
