import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { createNativeCliProcessRunner } from './native-cli-process-runner'

const fixturePath = fileURLToPath(
  new URL('./fixtures/native-runtime-fixture.ts', import.meta.url),
)

function startRuntime() {
  return createNativeCliProcessRunner({
    command: [process.execPath, fixturePath],
  }).start({
    sessionId: 'session-1',
    cwd: process.cwd(),
    env: {},
  })
}

describe('native CLI process runner', () => {
  test('forwards native messages and resolves only on result', async () => {
    const runtime = await startRuntime()
    const messages: Record<string, unknown>[] = []

    await runtime.submit({
      prompt: 'write',
      signal: new AbortController().signal,
      onMessage: message => messages.push(message),
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    expect(messages.map(message => message.type)).toEqual([
      'assistant',
      'result',
    ])
    runtime.dispose?.()
  })

  test('rejects an explicit native API error with its detail', async () => {
    const runtime = await startRuntime()
    await expect(
      runtime.submit({
        prompt: 'error',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow('provider exploded')
    runtime.dispose?.()
  })

  test('rejects EOF without a terminal result', async () => {
    const runtime = await startRuntime()
    await expect(
      runtime.submit({
        prompt: 'eof',
        signal: new AbortController().signal,
        onMessage: () => undefined,
        requestPermission: async () => ({ behavior: 'deny' }),
      }),
    ).rejects.toThrow('exited without a terminal result')
  })

  test('routes native permission requests through the BGS authority callback', async () => {
    const runtime = await startRuntime()
    const requests: unknown[] = []
    const messages: Record<string, unknown>[] = []

    await runtime.submit({
      prompt: 'permission',
      signal: new AbortController().signal,
      onMessage: message => messages.push(message),
      requestPermission: async request => {
        requests.push(request)
        return { behavior: 'allow', scope: 'once' }
      },
    })

    expect(requests).toEqual([
      {
        toolUseID: 'tool-1',
        toolName: 'Write',
        message: 'Write requires permission.',
        input: { file_path: 'docs/GDD.md', content: 'test' },
      },
    ])
    expect(messages.at(-1)).toMatchObject({
      type: 'result',
      subtype: 'success',
    })
    runtime.dispose?.()
  })
})
