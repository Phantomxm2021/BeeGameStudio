import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { bgsHomeDirectory } from './home'
import { createChatGPTResponsesStream } from './auth'

test('subscription responses use the shared SSE parser and release the stream at completion', async () => {
  const root = await mkdtemp('/private/tmp/bgs-auth-stream-')
  const home = bgsHomeDirectory(root)
  await mkdir(home, { recursive: true })
  // Synthetic, unverified token; no network request or login client is used.
  const token = 'fixture.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.fixture'
  await writeFile(join(home, 'auth.json'), JSON.stringify({ tokens: { access_token: token, refresh_token: 'synthetic' } }))
  let cancelled = false
  const response = { id: 'offline', status: 'completed', output: [] }
  try {
    const events = await createChatGPTResponsesStream({ configDirectory: root, request: { stream: true },
      signal: AbortSignal.timeout(2000), fetchOverride: (async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('data: ' +
          JSON.stringify({ type: 'response.completed', response }) + '\r\r')) },
        cancel() { cancelled = true },
      }))) as unknown as typeof fetch })
    for await (const event of events) {
      expect(event).toEqual({ type: 'response.completed', response })
      break
    }
    expect(cancelled).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
