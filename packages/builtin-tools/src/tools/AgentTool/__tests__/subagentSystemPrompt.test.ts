import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { asSystemPrompt } from 'src/utils/systemPromptType.js'
import { subagentSystemPrompt } from '../subagentSystemPrompt'
import { GENERAL_PURPOSE_AGENT } from '../built-in/generalPurposeAgent'
import { EXPLORE_AGENT } from '../built-in/exploreAgent'
import { PLAN_AGENT } from '../built-in/planAgent'

test('ordinary native role introductions use BGS without changing their task guidance', () => {
  const params = { toolUseContext: { options: {} } } as never
  const general = GENERAL_PURPOSE_AGENT.getSystemPrompt(params)
  const explore = EXPLORE_AGENT.getSystemPrompt(params)
  const plan = PLAN_AGENT.getSystemPrompt(params)
  expect(general).toStartWith('You are an agent for BGS.')
  expect(explore).toStartWith('You are a file search specialist for BGS.')
  expect(plan).toStartWith('You are a software architect and planning specialist for BGS.')
  for (const prompt of [general, explore, plan]) expect(prompt).not.toContain("Anthropic's official CLI")
  expect(general).toContain('Complete the task fully')
  expect(explore).toContain('READ-ONLY MODE - NO FILE MODIFICATIONS')
  expect(plan).toContain('READ-ONLY MODE - NO FILE MODIFICATIONS')
})

test('fresh typed agents retain their role/environment and receive appended constraints', () => {
  const prompt = asSystemPrompt(['Independent designer', 'Environment'])
  expect(subagentSystemPrompt(prompt, 'Use actual source paths; do not preselect undecided answers'))
    .toEqual(asSystemPrompt(['Independent designer', 'Environment', 'Use actual source paths; do not preselect undecided answers']))
  expect(prompt).toEqual(asSystemPrompt(['Independent designer', 'Environment']))
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
