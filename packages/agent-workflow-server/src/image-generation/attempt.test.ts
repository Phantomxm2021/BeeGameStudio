import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { ImageAttemptStore } from './attempt'
import { imageConfigSchema } from './config'
import { ImageProviderError, type ImageGenerationProvider, type ImageResult } from './provider'

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

test('an interrupted completed-result download is recovered once for concurrent callers', async () => {
  const root = temporary()
  const image = await result()
  const { bytes: _, ...metadata } = image
  const reference = { ...metadata, url: 'https://cdn.example.test/result.png?signed=private' }
  let submissions = 0, downloads = 0
  const provider: ImageGenerationProvider = {
    async generate(_config, _request, context) {
      submissions++
      context!.onResultReference!(reference)
      throw new ImageProviderError('download failed', 'unknown')
    },
    async recover(_config, saved) {
      downloads++
      expect(saved).toEqual(reference)
      return image
    },
  }
  try {
    await expect(new ImageAttemptStore(root, provider).generate(input)).rejects.toMatchObject({ reason: 'unknown' })
    const path = join(root, readdirSync(root)[0]!, 'receipt.json')
    const record = JSON.parse(readFileSync(path, 'utf8'))
    // Simulate termination after the completed reference was saved, before
    // the downloader could report success or failure.
    writeFileSync(path, JSON.stringify({ digest: record.digest, state: 'pending', reference }))
    const restarted = new ImageAttemptStore(root, provider)
    const results = await Promise.all([restarted.generate(input), restarted.generate(input)])
    expect(results).toEqual([image, image])
    expect(submissions).toBe(1)
    expect(downloads).toBe(1)
    expect(readFileSync(path, 'utf8')).not.toContain(reference.url)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a rejected download cannot turn a completed generation into a refundable rejection', async () => {
  const root = temporary()
  const { bytes: _, ...metadata } = await result()
  const reference = { ...metadata, url: 'https://cdn.example.test/result.png' }
  let submissions = 0
  const provider: ImageGenerationProvider = {
    async generate(_config, _request, context) {
      submissions++
      context!.onResultReference!(reference)
      throw new ImageProviderError('download rejected', 'rejected', 403)
    },
    async recover() { throw new ImageProviderError('download rejected', 'rejected', 403) },
  }
  try {
    for (let replay = 0; replay < 2; replay++) {
      await expect(new ImageAttemptStore(root, provider).generate(input))
        .rejects.toMatchObject({ reason: 'unknown', status: 403, replayed: replay > 0 })
    }
    const record = JSON.parse(readFileSync(join(root, readdirSync(root)[0]!, 'receipt.json'), 'utf8'))
    expect(record.state).toBe('pending')
    expect(record.reference).toEqual(reference)
    expect(submissions).toBe(1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a late failed download cannot overwrite a result recovered by another store', async () => {
  const root = temporary()
  const image = await result()
  const { bytes: _, ...metadata } = image
  let submissions = 0, downloads = 0
  let failLate!: () => void
  const waitForFailure = new Promise<void>(resolve => { failLate = resolve })
  const provider: ImageGenerationProvider = {
    async generate(_config, _request, context) {
      submissions++
      context!.onResultReference!({ ...metadata, url: 'https://cdn.example.test/result.png' })
      throw new ImageProviderError('download failed', 'unknown')
    },
    async recover() {
      if (++downloads === 1) return image
      await waitForFailure
      throw new ImageProviderError('late network failure', 'unknown')
    },
  }
  try {
    await expect(new ImageAttemptStore(root, provider).generate(input)).rejects.toMatchObject({ reason: 'unknown' })
    const successful = new ImageAttemptStore(root, provider).generate(input)
    const failed = new ImageAttemptStore(root, provider).generate(input)
    expect(await successful).toEqual(image)
    failLate()
    await expect(failed).rejects.toMatchObject({ reason: 'unknown' })
    expect(await new ImageAttemptStore(root, provider).generate(input)).toEqual(image)
    expect(submissions).toBe(1)
    expect(downloads).toBe(2)
  } finally { failLate(); rmSync(root, { recursive: true, force: true }) }
})
