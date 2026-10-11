import { expect, test } from 'bun:test'
import { normalizeRuntimeEnvironment } from '../../../../../../src/utils/runtimeEnvironment'
import { resolveOpenAIModel } from '../../providers/openai/modelMapping'
import { resolveGeminiModel } from '../../providers/gemini/modelMapping'
import { resolveGrokModel } from '../../providers/grok/modelMapping'

test.each([resolveOpenAIModel, resolveGeminiModel, resolveGrokModel])('model overrides work before and after CLI normalization (%p)', resolveModel => {
  const keys = ['OPENAI_MODEL', 'GEMINI_MODEL', 'GROK_MODEL', 'GROK_MODEL_MAP',
    'OPENAI_DEFAULT_SONNET_MODEL', 'GEMINI_DEFAULT_SONNET_MODEL', 'GROK_DEFAULT_SONNET_MODEL',
    'BGS_DEFAULT_BALANCED_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL']
  const before = new Map(keys.map(key => [key, process.env[key]]))
  try {
    for (const key of keys) delete process.env[key]
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'legacy-choice'
    expect(resolveModel('claude-sonnet-4-6')).toBe('legacy-choice')
    const normalized = normalizeRuntimeEnvironment(process.env)
    delete process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
    Object.assign(process.env, normalized)
    expect(resolveModel('claude-sonnet-4-6')).toBe('legacy-choice')
    process.env.BGS_DEFAULT_BALANCED_MODEL = 'product-choice'
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'stale-choice'
    expect(resolveModel('claude-sonnet-4-6')).toBe('product-choice')
    process.env.BGS_DEFAULT_BALANCED_MODEL = ''
    if (resolveModel === resolveGeminiModel) expect(() => resolveModel('claude-sonnet-4-6')).toThrow()
    else expect(resolveModel('claude-sonnet-4-6')).not.toBe('stale-choice')
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
