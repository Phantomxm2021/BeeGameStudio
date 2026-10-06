import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { asSystemPrompt } from 'src/utils/systemPromptType.js'
import { subagentSystemPrompt } from '../subagentSystemPrompt'

test('fresh typed agents retain their role/environment and receive appended constraints', () => {
  const prompt = asSystemPrompt(['Independent designer', 'Environment'])
  expect(subagentSystemPrompt(prompt, 'Use actual source paths; do not preselect undecided answers'))
    .toEqual(['Independent designer', 'Environment', 'Use actual source paths; do not preselect undecided answers'])
  expect(prompt).toEqual(['Independent designer', 'Environment'])
  expect(subagentSystemPrompt(prompt, undefined)).toBe(prompt)
  const inherited = asSystemPrompt([...prompt, 'constraints'])
  expect(subagentSystemPrompt(inherited, 'constraints')).toBe(inherited)
})

test('exact-context forks and background summarizers keep their rendered prompt without another append', () => {
  const prompt = asSystemPrompt(['Already rendered parent prompt'])
  expect(subagentSystemPrompt(prompt, 'constraints', true)).toBe(prompt)
})

test('the native query and cache-safe callback use the same effective subagent prompt', () => {
  const source = readFileSync(new URL('../runAgent.ts', import.meta.url), 'utf8')
  expect(source).toContain('subagentSystemPrompt(baseAgentSystemPrompt,')
  expect(source.match(/systemPrompt: agentSystemPrompt/g)?.length).toBeGreaterThanOrEqual(2)
})
