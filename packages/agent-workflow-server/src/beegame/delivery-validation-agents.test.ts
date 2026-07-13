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
    expect(definitions[0]?.disallowedTools).toEqual(expect.arrayContaining(['Write', 'Edit']))
  })
})
