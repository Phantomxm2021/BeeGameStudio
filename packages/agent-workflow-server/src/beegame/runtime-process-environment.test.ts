import { afterEach, describe, expect, test } from 'bun:test'
import { getSafeRuntimeProcessEnvironment } from './runtime-process-environment'

const originalFineGrainedStreaming =
  process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING

afterEach(() => {
  if (originalFineGrainedStreaming === undefined) {
    delete process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING
  } else {
    process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING =
      originalFineGrainedStreaming
  }
})

describe('native runtime process environment', () => {
  test('forwards an explicitly configured native fine-grained streaming capability', () => {
    process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING = '1'

    expect(getSafeRuntimeProcessEnvironment()).toMatchObject({
      CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING: '1',
    })
  })
})
