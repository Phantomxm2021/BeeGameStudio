import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS,
  ProviderStreamIdleError,
  resolveProviderStreamIdleTimeoutMs,
  withProviderStreamIdleDeadline,
} from '../providerStreamIdleDeadline.js'

describe('provider stream idle deadline', () => {
  test('uses a native default above observed healthy long-generation gaps', () => {
    expect(resolveProviderStreamIdleTimeoutMs(undefined)).toBe(
      DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS,
    )
    expect(DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS).toBe(180_000)
    expect(resolveProviderStreamIdleTimeoutMs('240000')).toBe(240_000)
    expect(resolveProviderStreamIdleTimeoutMs('invalid')).toBe(180_000)
  })

  test('rejects when the provider leaves iterator.next pending forever', async () => {
    let returnCalls = 0
    const hangingStream: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<string>>(() => undefined),
          return: async () => {
            returnCalls += 1
            return { done: true, value: undefined }
          },
        }
      },
    }

    const iterator = withProviderStreamIdleDeadline(hangingStream, {
      timeoutMs: 10,
    })[Symbol.asyncIterator]()

    await expect(iterator.next()).rejects.toBeInstanceOf(
      ProviderStreamIdleError,
    )
    expect(returnCalls).toBe(1)
  })

  test('resets the deadline after each event', async () => {
    async function* delayedStream() {
      yield 'first'
      await Bun.sleep(5)
      yield 'second'
    }

    const received: string[] = []
    for await (const value of withProviderStreamIdleDeadline(delayedStream(), {
      timeoutMs: 20,
    }))
      received.push(value)

    expect(received).toEqual(['first', 'second'])
  })

  test('emits one warning before the terminal deadline', async () => {
    let warnings = 0
    const hangingStream: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<string>>(() => undefined),
        }
      },
    }

    const iterator = withProviderStreamIdleDeadline(hangingStream, {
      warningMs: 5,
      timeoutMs: 15,
      onWarning: () => {
        warnings += 1
      },
    })[Symbol.asyncIterator]()

    await expect(iterator.next()).rejects.toBeInstanceOf(
      ProviderStreamIdleError,
    )
    expect(warnings).toBe(1)
  })
})
