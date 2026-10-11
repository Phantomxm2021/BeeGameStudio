import { expect, mock, test } from 'bun:test'
import { forwardSessionUpdates } from '../bridge.js'
import { normalizeMessage } from '../../../utils/queryHelpers.js'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
} from '../../../utils/messages.js'
import type { SDKMessage } from '../../../entrypoints/sdk/coreTypes.js'

test('synthetic API errors survive normalization and streaming deduplication', async () => {
  const failure = createAssistantAPIErrorMessage({
    content: 'Provider connection failed',
    apiError: 'api_error',
  })
  const normalized = [...normalizeMessage(failure)]
  expect(normalized[0]).toMatchObject({ isApiErrorMessage: true })
  const child = [
    ...normalizeMessage({
      type: 'progress',
      parentToolUseID: 'parent',
      data: {
        type: 'agent_progress',
        message: failure,
        taskId: 'child',
        elapsedTimeSeconds: 1,
      },
    } as any),
  ]
  expect(child[0]).toMatchObject({
    isApiErrorMessage: true,
    parent_tool_use_id: 'parent',
  })

  async function* stream(): AsyncGenerator<SDKMessage> {
    yield {
      type: 'stream_event',
      parent_tool_use_id: null,
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Partial answer' },
      },
    } as SDKMessage
    yield* normalizeMessage(
      createAssistantMessage({ content: 'Partial answer' }),
    )
    yield* normalized
  }
  const sessionUpdate = mock(async () => {})
  await forwardSessionUpdates(
    's1',
    stream(),
    { sessionUpdate } as any,
    new AbortController().signal,
    {},
  )
  const output = JSON.stringify(sessionUpdate.mock.calls)
  expect(output.match(/Provider connection failed/g)).toHaveLength(1)
  expect(output.match(/Partial answer/g)).toHaveLength(1)
})
