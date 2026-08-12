import { describe, expect, test } from 'bun:test'
import {
  ProviderStreamIncompleteError,
  createProviderStreamTerminality,
} from '../streamTerminality'

describe('provider stream terminality', () => {
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
