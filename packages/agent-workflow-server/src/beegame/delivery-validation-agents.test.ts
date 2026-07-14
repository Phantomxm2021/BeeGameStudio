import { describe, expect, test } from 'bun:test'
import {
  DELIVERY_VALIDATOR_AGENT_TYPES,
  createDeliveryValidationAgentDefinitions,
} from './delivery-validation-agents'

describe('delivery validation agents', () => {
  test('uses one independent acceptance subagent without a parallel validation track', () => {
    const definitions = createDeliveryValidationAgentDefinitions()

    expect(DELIVERY_VALIDATOR_AGENT_TYPES).toEqual(['beegame-acceptance-validator'])
    expect(definitions).toHaveLength(1)
    expect(definitions[0]).toEqual(expect.objectContaining({
      agentType: 'beegame-acceptance-validator',
      source: 'policySettings',
    }))
    expect(definitions[0]?.tools).toEqual(expect.arrayContaining(['Read', 'Skill', 'Bash']))
    expect(definitions[0]?.tools).toEqual(expect.arrayContaining(['SearchExtraTools', 'ExecuteExtraTool']))
    expect(definitions[0]?.disallowedTools).toEqual(expect.arrayContaining(['Write', 'Edit']))
    expect(definitions[0]?.maxTurns).toBeGreaterThanOrEqual(24)

    const prompt = definitions[0]?.getSystemPrompt() ?? ''
    expect(prompt).toContain('approved product, technical, asset, and acceptance documents')
    expect(prompt).toContain('without inventing a second host-owned contract')
    expect(prompt).toContain('Ignore feature claims')
    expect(prompt).toContain('logs, transcripts, prior validation reports')
    expect(prompt).toContain('return blocked rather than guessing')
    expect(prompt).toContain('Invoke beegame-game-acceptance through the Skill tool')
    expect(prompt).toContain('a missing manifest is a failure')
    expect(prompt).toContain('genuinely asset-free project')
    expect(prompt).toContain('Do not repeatedly list the same directory')
    expect(prompt).toContain('Return one JSON object only')
  })

  test('leaves native Agent lifecycle decisions to Claude Code', () => {
    const definitions = createDeliveryValidationAgentDefinitions()

    for (const definition of definitions) {
      expect(definition).not.toHaveProperty('background')
      expect(definition.getSystemPrompt()).not.toContain('run_in_background')
      expect(definition.getSystemPrompt()).not.toContain('TaskOutput')
    }
  })
})
