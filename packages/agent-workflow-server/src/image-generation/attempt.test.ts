import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { ImageAttemptStore } from './attempt'
import { imageConfigSchema } from './config'
import { ImageProviderError, type ImageResult } from './provider'

const input = {
  ownerId: 'user', projectId: 'project', requestId: 'icon-1',
  config: imageConfigSchema.parse({ apiKey: 'never-store-this-secret' }),
  request: { prompt: 'private prompt' },
}
async function result(): Promise<ImageResult> {
  return { bytes: await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff0000' } }).png().toBuffer(),
    model: input.config.model, mimeType: 'image/png', usage: { input_tokens: 5, output_tokens: 6 }, providerRequestId: 'upstream-1' }
}
function temporary() { return mkdtempSync(join(tmpdir(), 'image-attempt-')) }

test('concurrent and restarted attempts recover one paid result without another provider call', async () => {
  const root = temporary()
  let calls = 0
  const provider = { generate: async () => { calls++; return result() } }
  try {
    const store = new ImageAttemptStore(root, provider)
    const [first, second] = await Promise.all([store.generate(input), store.generate(input)])
    expect(first).toEqual(second)
    expect(await new ImageAttemptStore(root, provider).generate(input)).toEqual(first)
    expect(calls).toBe(1)
    const receipt = readFileSync(join(root, readdirSync(root)[0]!, 'receipt.json'), 'utf8')
    expect(receipt).not.toContain(input.config.apiKey)
    expect(receipt).not.toContain(input.request.prompt)
    expect(receipt).toContain('upstream-1')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('same identity cannot silently change prompt; different project is isolated', async () => {
  const root = temporary()
  let calls = 0
  try {
    const store = new ImageAttemptStore(root, { generate: async () => { calls++; return result() } })
    await store.generate(input)
    await expect(store.generate({ ...input, request: { prompt: 'changed' } })).rejects.toMatchObject({ reason: 'conflict' })
    await store.generate({ ...input, projectId: 'other-project' })
    expect(calls).toBe(2)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('unknown and rejected responses remain explicit across restart, without retries', async () => {
  for (const outcome of ['unknown', 'rejected'] as const) {
    const root = temporary()
    let calls = 0
    const status = outcome === 'unknown' ? 502 : 400
    const provider = { generate: async (): Promise<ImageResult> => { calls++; throw new ImageProviderError('private failure', outcome, status) } }
    try {
      await expect(new ImageAttemptStore(root, provider).generate(input)).rejects.toMatchObject({ reason: outcome, status })
      await expect(new ImageAttemptStore(root, provider).generate(input)).rejects.toMatchObject({ reason: outcome, status })
      expect(calls).toBe(1)
      const receipt = readFileSync(join(root, readdirSync(root)[0]!, 'receipt.json'), 'utf8')
      expect(JSON.parse(receipt).status).toBe(status)
      expect(receipt).not.toContain('private failure')
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})

test('truncated PNG is retained for diagnosis but cannot be published or regenerated on retry', async () => {
  const root = temporary()
  let calls = 0
  const provider = { generate: async (): Promise<ImageResult> => {
    calls++
    return { ...(await result()), bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) }
  } }
  try {
    await expect(new ImageAttemptStore(root, provider).generate(input)).rejects.toMatchObject({ reason: 'invalid-image' })
    await expect(new ImageAttemptStore(root, provider).generate(input)).rejects.toMatchObject({ reason: 'invalid-image' })
    expect(calls).toBe(1)
    expect(readFileSync(join(root, readdirSync(root)[0]!, 'receipt.json'), 'utf8')).toContain('received')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('another process sees pending receipt as unknown, not permission to submit again', async () => {
  const root = temporary()
  let finish!: (result: ImageResult) => void
  const pending = new Promise<ImageResult>(resolve => { finish = resolve })
  let calls = 0
  const provider = { generate: async () => { calls++; return pending } }
  try {
    const running = new ImageAttemptStore(root, provider).generate(input)
    await expect(new ImageAttemptStore(root, provider).generate(input)).rejects.toMatchObject({ reason: 'unknown' })
    finish(await result())
    await running
    expect(calls).toBe(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
