import { describe, expect, test } from 'bun:test'
import {
  getOfficialOpenAIPromptCacheKey,
  isOfficialOpenAIBaseURL,
  updateOpenAIUsage,
} from '../openaiShared.js'

test('final zero cache counts replace earlier values while omitted fields remain intact', () => {
  const current = { input_tokens: 4, output_tokens: 3, cache_creation_input_tokens: 2, cache_read_input_tokens: 8 }
  expect(updateOpenAIUsage(current, { input_tokens: 12, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }))
    .toEqual({ input_tokens: 12, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })
  expect(updateOpenAIUsage(current, {})).toEqual(current)
})

describe('isOfficialOpenAIBaseURL', () => {
  test('treats the SDK default endpoint as official OpenAI', () => {
    expect(isOfficialOpenAIBaseURL(undefined)).toBe(true)
    expect(isOfficialOpenAIBaseURL('')).toBe(true)
  })

  test('accepts global and regional official OpenAI endpoints', () => {
    expect(isOfficialOpenAIBaseURL('https://api.openai.com/v1')).toBe(true)
    expect(isOfficialOpenAIBaseURL('https://eu.api.openai.com/v1')).toBe(true)
    expect(isOfficialOpenAIBaseURL('https://api.openai.com:443/v1')).toBe(true)
  })

  test('rejects OpenAI-compatible and spoofed endpoints', () => {
    expect(isOfficialOpenAIBaseURL('https://api.deepseek.com/v1')).toBe(false)
    expect(isOfficialOpenAIBaseURL('http://api.openai.com/v1')).toBe(false)
    expect(isOfficialOpenAIBaseURL('https://api.openai.com.evil.test/v1')).toBe(
      false,
    )
    expect(isOfficialOpenAIBaseURL('https://api.openai.com:8443/v1')).toBe(
      false,
    )
    expect(isOfficialOpenAIBaseURL('not-a-url')).toBe(false)
  })
})

describe('getOfficialOpenAIPromptCacheKey', () => {
  test('returns a session key for the SDK default and official endpoint', () => {
    expect(getOfficialOpenAIPromptCacheKey(undefined, 'session-1')).toBe(
      'bgs:session-1',
    )
    expect(
      getOfficialOpenAIPromptCacheKey('https://api.openai.com/v1', 'session-2'),
    ).toBe('bgs:session-2')
  })

  test('returns undefined for compatible endpoints', () => {
    expect(
      getOfficialOpenAIPromptCacheKey(
        'https://api.deepseek.com/v1',
        'session-1',
      ),
    ).toBeUndefined()
  })
})
