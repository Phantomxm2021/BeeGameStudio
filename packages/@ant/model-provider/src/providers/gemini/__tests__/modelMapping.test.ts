import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resolveGeminiModel } from '../modelMapping.js'

describe('resolveGeminiModel', () => {
  const originalEnv = {
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    GEMINI_DEFAULT_HAIKU_MODEL: process.env.GEMINI_DEFAULT_HAIKU_MODEL,
    GEMINI_DEFAULT_SONNET_MODEL: process.env.GEMINI_DEFAULT_SONNET_MODEL,
    GEMINI_DEFAULT_OPUS_MODEL: process.env.GEMINI_DEFAULT_OPUS_MODEL,
    BGS_DEFAULT_FAST_MODEL: process.env.BGS_DEFAULT_FAST_MODEL,
    BGS_DEFAULT_BALANCED_MODEL: process.env.BGS_DEFAULT_BALANCED_MODEL,
    BGS_DEFAULT_STRONG_MODEL: process.env.BGS_DEFAULT_STRONG_MODEL,
  }

  beforeEach(() => {
    delete process.env.GEMINI_MODEL
    delete process.env.GEMINI_DEFAULT_HAIKU_MODEL
    delete process.env.GEMINI_DEFAULT_SONNET_MODEL
    delete process.env.GEMINI_DEFAULT_OPUS_MODEL
    delete process.env.BGS_DEFAULT_FAST_MODEL
    delete process.env.BGS_DEFAULT_BALANCED_MODEL
    delete process.env.BGS_DEFAULT_STRONG_MODEL
  })

  afterEach(() => {
    Object.assign(process.env, originalEnv)
  })

  test('GEMINI_MODEL env var overrides family mappings', () => {
    process.env.GEMINI_MODEL = 'gemini-2.5-pro'
    process.env.BGS_DEFAULT_BALANCED_MODEL = 'gemini-2.5-flash'

    expect(resolveGeminiModel('claude-sonnet-4-6')).toBe('gemini-2.5-pro')
  })

  test('GEMINI_DEFAULT_*_MODEL takes precedence over ANTHROPIC_DEFAULT_*', () => {
    process.env.GEMINI_DEFAULT_SONNET_MODEL = 'gemini-2.5-flash-priority'
    process.env.BGS_DEFAULT_BALANCED_MODEL = 'gemini-2.5-flash-fallback'

    expect(resolveGeminiModel('claude-sonnet-4-6')).toBe(
      'gemini-2.5-flash-priority',
    )
  })

  test('resolves sonnet model from GEMINI_DEFAULT_SONNET_MODEL', () => {
    process.env.GEMINI_DEFAULT_SONNET_MODEL = 'gemini-2.5-flash'
    expect(resolveGeminiModel('claude-sonnet-4-6')).toBe('gemini-2.5-flash')
  })

  test('resolves haiku model from GEMINI_DEFAULT_HAIKU_MODEL', () => {
    process.env.GEMINI_DEFAULT_HAIKU_MODEL = 'gemini-2.5-flash-lite'
    expect(resolveGeminiModel('claude-haiku-4-5-20251001')).toBe(
      'gemini-2.5-flash-lite',
    )
  })

  test('resolves opus model from GEMINI_DEFAULT_OPUS_MODEL', () => {
    process.env.GEMINI_DEFAULT_OPUS_MODEL = 'gemini-2.5-pro'
    expect(resolveGeminiModel('claude-opus-4-6')).toBe('gemini-2.5-pro')
  })

  test('falls back to ANTHROPIC_DEFAULT_* when GEMINI_DEFAULT_* not set', () => {
    process.env.BGS_DEFAULT_BALANCED_MODEL = 'gemini-2.5-flash'
    expect(resolveGeminiModel('claude-sonnet-4-6')).toBe('gemini-2.5-flash')
  })

  test('resolves haiku from BGS_DEFAULT_FAST_MODEL as fallback', () => {
    process.env.BGS_DEFAULT_FAST_MODEL = 'gemini-2.5-flash-lite'
    expect(resolveGeminiModel('claude-haiku-4-5-20251001')).toBe(
      'gemini-2.5-flash-lite',
    )
  })

  test('resolves opus from BGS_DEFAULT_STRONG_MODEL as fallback', () => {
    process.env.BGS_DEFAULT_STRONG_MODEL = 'gemini-2.5-pro'
    expect(resolveGeminiModel('claude-opus-4-6')).toBe('gemini-2.5-pro')
  })

  test('uses backward compatible family override', () => {
    process.env.BGS_DEFAULT_BALANCED_MODEL = 'legacy-gemini-sonnet'
    expect(resolveGeminiModel('claude-sonnet-4-6')).toBe('legacy-gemini-sonnet')
  })

  test('strips [1m] suffix before resolving', () => {
    process.env.GEMINI_DEFAULT_SONNET_MODEL = 'gemini-2.5-flash'
    expect(resolveGeminiModel('claude-sonnet-4-6[1m]')).toBe('gemini-2.5-flash')
  })

  test('passes through explicit Gemini model names', () => {
    expect(resolveGeminiModel('gemini-3.1-flash-lite-preview')).toBe(
      'gemini-3.1-flash-lite-preview',
    )
  })

  test('throws when no Gemini model configuration is available', () => {
    expect(() => resolveGeminiModel('claude-sonnet-4-6')).toThrow(
      'Gemini provider requires GEMINI_MODEL or GEMINI_DEFAULT_SONNET_MODEL (or BGS_DEFAULT_BALANCED_MODEL for backward compatibility) to be configured.',
    )
  })
})
