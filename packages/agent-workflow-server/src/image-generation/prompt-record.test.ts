import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createImagePromptRecord } from './prompt-record'
import { imageConfigSchema } from './config'

test('records are readable, preserve existing notes and group replay observations across restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'image-record-'))
  const config = imageConfigSchema.parse({ apiKey: 'private-api-key', upstreamApiKey: 'upstream-key' })
  try {
    mkdirSync(join(root, 'assets'))
    const file = join(root, 'assets/ai-generation-prompts.md')
    writeFileSync(file, '# Existing human notes\n')
    const request = { requestId: 'fox', prompt: 'A fox\nsoft light', background: 'transparent' }
    expect(createImagePromptRecord(root, '/capability/generate')(request, config, { event: 'request-received' })).toBe(true)
    expect(createImagePromptRecord(root, '/capability/generate')(request, config, { event: 'delivery-failed', replayed: true })).toBe(true)
    const doc = readFileSync(file, 'utf8')
    expect(doc).toStartWith('# Existing human notes')
    expect(doc).toContain('A fox\\nsoft light')
    expect(doc.match(/<!-- image-request:/g)).toHaveLength(1)
    expect(doc).toContain('"background": "transparent"')
    expect(doc).not.toContain('private-api-key')
    expect(doc).not.toContain('upstream-key')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('records redact echoed credentials, capability URLs and signed URLs', () => {
  const root = mkdtempSync(join(tmpdir(), 'image-record-redact-'))
  try {
    const config = imageConfigSchema.parse({ apiKey: 'private-api-key' })
    const record = createImagePromptRecord(root, '/capability/generate')
    record({ requestId: 'x', prompt: 'private-api-key http://127.0.0.1:1234/capability/generate https://cdn.test/image?signature=secret' }, config, { event: 'request-received' })
    const doc = readFileSync(join(root, 'assets/ai-generation-prompts.md'), 'utf8')
    expect(doc).not.toContain('private-api-key')
    expect(doc).not.toContain('/capability/generate')
    expect(doc).not.toContain('signature=secret')
    expect(doc).toContain('[redacted')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('recording refuses project symlinks without writing outside the project', () => {
  const root = mkdtempSync(join(tmpdir(), 'image-record-links-'))
  try {
    mkdirSync(join(root, 'project'))
    mkdirSync(join(root, 'outside'))
    symlinkSync(join(root, 'outside'), join(root, 'project/assets'))
    expect(createImagePromptRecord(join(root, 'project'), '/cap')(
      { requestId: 'x', prompt: 'fox' }, undefined, { event: 'request-received' })).toBe(false)
    expect(existsSync(join(root, 'outside/ai-generation-prompts.md'))).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
