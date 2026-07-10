import { describe, expect, test } from 'bun:test'
import { uploadPolicyResponse } from '../app'
import { validateBeeGameAttachments, BeeGameUploadPolicyError } from '../security/upload-policy'

const encoded = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const attachment = (data: string, filename = 'image.png', mediaType = 'image/png') => ({ type: 'image', data, filename, mediaType })

describe('BeeGame upload policy', () => {
  test('rejects malformed Base64 padding without including the payload', () => {
    expect(() => validateBeeGameAttachments([attachment('iVBORw0KGgo=bad')])).toThrow(BeeGameUploadPolicyError)
    try { validateBeeGameAttachments([attachment('iVBORw0KGgo=bad')]) } catch (error) { expect(String(error)).not.toContain('iVBORw0KGgo=bad') }
  })
  test('enforces attachment count and aggregate byte limits', () => {
    const one = attachment(encoded(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    expect(() => validateBeeGameAttachments(Array.from({ length: 9 }, () => one))).toThrow(BeeGameUploadPolicyError)
    const large = encoded(new Uint8Array(4 * 1024 * 1024).fill(0x20))
    expect(() => validateBeeGameAttachments([attachment(large), attachment(large), attachment(large, 'a.png'), attachment(large, 'b.png')])).toThrow(BeeGameUploadPolicyError)
  })
  test('rejects a claimed PNG whose magic bytes do not match', () => {
    expect(() => validateBeeGameAttachments([attachment(encoded(new TextEncoder().encode('not png')))])).toThrow(BeeGameUploadPolicyError)
  })
  test('returns normalized metadata for valid UTF-8 JSON', () => {
    const result = validateBeeGameAttachments([{ type: 'file', filename: '../state.json', mediaType: 'application/json', data: encoded(new TextEncoder().encode('{"ok":true}')) }])
    expect(result[0]).toMatchObject({ filename: 'state.json', byteLength: 11, mediaType: 'application/json' })
  })

  test('logs a traced, payload-free policy rejection response', async () => {
    const originalWarn = console.warn
    const warnings: unknown[] = []
    console.warn = (...args) => warnings.push(args)
    try {
      const payload = 'secret-attachment-data'
      const response = uploadPolicyResponse(new BeeGameUploadPolicyError('invalid payload'), 'trace-123')
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Attachment validation failed', traceId: 'trace-123' })
      expect(JSON.stringify(warnings)).toContain('trace-123')
      expect(JSON.stringify(warnings)).not.toContain(payload)
      expect(JSON.stringify(warnings)).not.toContain('invalid payload')
    } finally {
      console.warn = originalWarn
    }
  })
})
