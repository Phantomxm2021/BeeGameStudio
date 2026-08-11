import { describe, expect, test } from 'bun:test'
import {
  DOCUMENT_NATIVE_WRITE_MAX_BYTES,
  createWorkflowToolInputBudgetState,
  observeWorkflowToolInput,
} from './workflow-tool-input-budget'

function start(index: number, name: string) {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id: `tool-${index}`, name },
    },
  }
}

function inputDelta(index: number, partialJson: string) {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: partialJson },
    },
  }
}

describe('workflow document tool input budget', () => {
  test('allows the serialized overhead of a bounded document edit', () => {
    const state = createWorkflowToolInputBudgetState()
    observeWorkflowToolInput(state, start(0, 'Edit'))

    expect(
      observeWorkflowToolInput(state, inputDelta(0, 'x'.repeat(16_393))),
    ).toBeUndefined()
  })

  test('reports the exact write tool stream byte overflow', () => {
    const state = createWorkflowToolInputBudgetState()
    expect(observeWorkflowToolInput(state, start(3, 'Write'))).toBeUndefined()
    expect(
      observeWorkflowToolInput(
        state,
        inputDelta(3, 'x'.repeat(DOCUMENT_NATIVE_WRITE_MAX_BYTES)),
      ),
    ).toBeUndefined()

    expect(observeWorkflowToolInput(state, inputDelta(3, 'y'))).toEqual({
      code: 'document_native_write_input_too_large',
      toolName: 'Write',
      maxBytes: DOCUMENT_NATIVE_WRITE_MAX_BYTES,
      observedBytes: DOCUMENT_NATIVE_WRITE_MAX_BYTES + 1,
    })
  })

  test('ignores non-write tools and clears completed stream blocks', () => {
    const state = createWorkflowToolInputBudgetState()
    observeWorkflowToolInput(state, start(1, 'Read'))
    expect(
      observeWorkflowToolInput(
        state,
        inputDelta(1, 'x'.repeat(DOCUMENT_NATIVE_WRITE_MAX_BYTES + 1)),
      ),
    ).toBeUndefined()

    observeWorkflowToolInput(state, start(2, 'Edit'))
    observeWorkflowToolInput(state, {
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 2 },
    })
    expect(
      observeWorkflowToolInput(
        state,
        inputDelta(2, 'x'.repeat(DOCUMENT_NATIVE_WRITE_MAX_BYTES + 1)),
      ),
    ).toBeUndefined()
  })

  test('counts UTF-8 bytes instead of JavaScript characters', () => {
    const state = createWorkflowToolInputBudgetState()
    observeWorkflowToolInput(state, start(0, 'MultiEdit'))
    const multibyte = '界'.repeat(Math.floor(DOCUMENT_NATIVE_WRITE_MAX_BYTES / 3))

    expect(
      observeWorkflowToolInput(state, inputDelta(0, multibyte)),
    ).toBeUndefined()
    expect(observeWorkflowToolInput(state, inputDelta(0, '界'))).toMatchObject({
      code: 'document_native_write_input_too_large',
      toolName: 'MultiEdit',
    })
  })
})
