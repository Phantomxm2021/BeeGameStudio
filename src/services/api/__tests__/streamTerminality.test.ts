import { describe, expect, test } from 'bun:test'
import {
  ProviderStreamIdleError,
  ProviderStreamIncompleteError,
  createProviderStreamTerminality,
  withProviderStreamIdleTimeout,
} from '../streamTerminality'

describe('provider stream terminality', () => {
  test('rejects even when the provider iterator ignores abort forever', async () => {
    let returnCalls = 0
    const hangingStream: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<string>>(() => {}),
          return: async () => {
            returnCalls += 1
            return { done: true, value: undefined }
          },
        }
      },
    }

    const iterator = withProviderStreamIdleTimeout(hangingStream, {
      timeoutMs: 10,
    })[Symbol.asyncIterator]()

    await expect(iterator.next()).rejects.toBeInstanceOf(
      ProviderStreamIdleError,
    )
    expect(returnCalls).toBe(1)
  })

  test('resets the idle deadline after every provider event', async () => {
    async function* delayedStream() {
      yield 'first'
      await Bun.sleep(5)
      yield 'second'
    }

    const received: string[] = []
    for await (const value of withProviderStreamIdleTimeout(delayedStream(), {
      timeoutMs: 20,
    })) received.push(value)

    expect(received).toEqual(['first', 'second'])
  })

  test('rejects a response body that stops inside tool JSON', () => {
    const terminality = createProviderStreamTerminality({
      requestId: 'request-mid-tool-json',
    })

    terminality.observe({ type: 'message_start' })
    terminality.observe({
      type: 'content_block_start',
      index: 0,
      contentType: 'tool_use',
    })
    terminality.observe({
      type: 'input_json_delta',
      index: 0,
      bytes: 187,
    })

    expect(() => terminality.completeBody()).toThrow(
      ProviderStreamIncompleteError,
    )
    expect(() => terminality.completeBody()).toThrow(
      'Provider response ended without a terminal message: request-mid-tool-json',
    )
  })

  test('rejects a response that has a stop reason but no message stop', () => {
    const terminality = createProviderStreamTerminality({
      requestId: 'request-missing-stop',
    })

    terminality.observe({ type: 'message_start' })
    terminality.observe({
      type: 'message_delta',
      stopReason: 'end_turn',
    })

    expect(() => terminality.completeBody()).toThrow(
      ProviderStreamIncompleteError,
    )
  })

  test('accepts only a closed response with a provider stop reason', () => {
    const terminality = createProviderStreamTerminality({
      requestId: 'request-complete',
    })

    terminality.observe({ type: 'message_start' })
    terminality.observe({
      type: 'content_block_start',
      index: 0,
      contentType: 'tool_use',
    })
    terminality.observe({
      type: 'input_json_delta',
      index: 0,
      bytes: 64,
    })
    terminality.observe({ type: 'content_block_stop', index: 0 })
    terminality.observe({ type: 'message_delta', stopReason: 'tool_use' })
    terminality.observe({ type: 'message_stop' })

    expect(terminality.completeBody()).toEqual({
      requestId: 'request-complete',
      sawMessageStart: true,
      sawMessageStop: true,
      stopReason: 'tool_use',
      openToolJsonBlockIndexes: [],
      eventCount: 6,
      inputJsonBytes: 64,
    })
  })
})
