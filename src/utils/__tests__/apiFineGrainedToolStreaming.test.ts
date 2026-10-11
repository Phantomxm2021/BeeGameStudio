import { afterEach, describe, expect, test } from 'bun:test'
import { FileWriteTool } from '@bee-game-studio/builtin-tools/tools/FileWriteTool/FileWriteTool.js'
import {
  shouldEnableFineGrainedToolStreaming,
  toolToAPISchema,
} from '../api.js'
import { clearToolSchemaCache } from '../toolSchemaCache.js'

const originalBaseUrl = process.env.ANTHROPIC_BASE_URL
const originalStreamingFlag =
  process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = originalBaseUrl
  if (originalStreamingFlag === undefined) {
    delete process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING
  } else {
    process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING =
      originalStreamingFlag
  }
  clearToolSchemaCache()
})

describe('fine-grained tool input streaming capability', () => {
  test('honors an explicit native opt-in on an Anthropic-compatible custom endpoint', () => {
    expect(
      shouldEnableFineGrainedToolStreaming({
        provider: 'firstParty',
        firstPartyBaseUrl: false,
        featureEnabled: false,
        explicitlyEnabled: true,
      }),
    ).toBe(true)
  })

  test('does not send the beta field to an unconfigured custom endpoint', () => {
    expect(
      shouldEnableFineGrainedToolStreaming({
        provider: 'firstParty',
        firstPartyBaseUrl: false,
        featureEnabled: true,
        explicitlyEnabled: false,
      }),
    ).toBe(false)
  })

  test('serializes eager input streaming on the production Write schema', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://custom.example.test'
    process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING = '1'
    clearToolSchemaCache()

    const schema = (await toolToAPISchema(FileWriteTool, {
      getToolPermissionContext: async () => ({}) as never,
      tools: [FileWriteTool],
      agents: [],
      model: 'ark-code-latest',
    })) as unknown as Record<string, unknown>

    expect(schema.eager_input_streaming).toBe(true)
  })
})
