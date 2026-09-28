import { expect, test } from 'bun:test'
import { getMacroDefines } from './defines'
import type { Tools } from '../src/Tool'

Object.assign(globalThis, { MACRO: Object.fromEntries(Object.entries(getMacroDefines())
  .map(([key, value]) => [key.replace('MACRO.', ''), JSON.parse(value)])) })

test('native prompt exposes delegation without imposing a verifier completion gate', async () => {
  const previous = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'offline-test-no-provider-call'
  try {
  const { getSystemPrompt } = await import('../src/constants/prompts')
  const { AGENT_TOOL_NAME } = await import('../packages/builtin-tools/src/tools/AgentTool/constants')
  const prompt = (await getSystemPrompt([{ name: AGENT_TOOL_NAME }] as Tools, 'test-model')).join('\n')
  expect(prompt).toContain(AGENT_TOOL_NAME)
  expect(prompt).not.toContain('only the verifier assigns a verdict')
  expect(prompt).not.toContain('repeat until PASS')
  expect(prompt).not.toContain('3+ file edits')
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = previous
  }
})
