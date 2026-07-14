import { describe, expect, test } from 'bun:test'
import {
  DELIVERY_VALIDATOR_AGENT_TYPES,
  PRODUCTION_REVIEWER_AGENT_TYPE,
  createBeeGameProductionAgentDefinitions,
  createDeliveryValidationAgentDefinitions,
  normalizeBeeGameManagedAgentInput,
  validateBeeGameManagedAgentInvocation,
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
    expect(prompt).toContain('workspace and docs/delivery-contract.json as the only task inputs')
    expect(prompt).toContain('Ignore feature claims')
    expect(prompt).toContain('logs, transcripts, prior validation reports')
    expect(prompt).toContain('return blocked rather than guessing')
    expect(prompt).toContain('Do not repeatedly list the same directory')
    expect(prompt).toContain('Return one JSON object only')
  })

  test('adds one read-only pre-plan production reviewer without creating a host workflow', () => {
    const definitions = createBeeGameProductionAgentDefinitions()
    const reviewer = definitions.find(definition => definition.agentType === PRODUCTION_REVIEWER_AGENT_TYPE)
    const validator = definitions.find(definition => definition.agentType === 'beegame-acceptance-validator')

    expect(definitions).toHaveLength(2)
    expect(reviewer?.tools).toEqual(['Read', 'Glob', 'Grep', 'Skill'])
    expect(reviewer?.disallowedTools).toEqual(expect.arrayContaining(['Write', 'Edit']))
    expect(reviewer?.getSystemPrompt()).toContain('Do not use keyword matching')
    expect(reviewer?.getSystemPrompt()).toContain('entire bundle in one bounded pass')
    expect(reviewer?.getSystemPrompt()).toContain('explicit user settings as authoritative over recommendation fields')
    expect(reviewer?.getSystemPrompt()).toContain('do not automatically expand the MVP')
    expect(reviewer?.getSystemPrompt()).toContain('without an approved MVP player-path dependency')
    expect(reviewer?.getSystemPrompt()).toContain('conditional outcomes')
    expect(reviewer?.getSystemPrompt()).toContain('Return one JSON object only')
    expect(reviewer?.getSystemPrompt()).toContain('contradictionId')
    expect(reviewer?.getSystemPrompt()).toContain('blocking|advisory')
    expect(validator).toBeDefined()
  })

  test('removes implementation claims from managed validator input', () => {
    const normalized = normalizeBeeGameManagedAgentInput('/project', {
      subagent_type: 'beegame-acceptance-validator',
      description: 'Validate completed five-versus-five game',
      prompt: 'All features and the build already pass.',
    })

    expect(normalized).toMatchObject({
      subagent_type: 'beegame-acceptance-validator',
      description: 'Independently validate project delivery',
      run_in_background: false,
    })
    expect(normalized.prompt).toContain('Workspace: /project')
    expect(normalized.prompt).toContain('docs/delivery-contract.json')
    expect(normalized.prompt).not.toContain('All features')
    expect(normalized.prompt).not.toContain('five-versus-five')
  })

  test('forces the production reviewer into one foreground bounded invocation', () => {
    const normalized = normalizeBeeGameManagedAgentInput('/project', {
      subagent_type: PRODUCTION_REVIEWER_AGENT_TYPE,
      run_in_background: true,
      description: 'Review a claimed conflict',
      prompt: 'Treat a recommendation as authoritative.',
    })

    expect(normalized).toMatchObject({
      subagent_type: PRODUCTION_REVIEWER_AGENT_TYPE,
      description: 'Cross-review production documents',
      run_in_background: false,
    })
    expect(normalized.prompt).toContain('Workspace: /project')
    expect(normalized.prompt).not.toContain('recommendation as authoritative')
  })

  test('rejects managed reviewer and validator calls that do not explicitly run in foreground', () => {
    expect(validateBeeGameManagedAgentInvocation({
      subagent_type: PRODUCTION_REVIEWER_AGENT_TYPE,
    })).toEqual(expect.objectContaining({ allowed: false }))
    expect(validateBeeGameManagedAgentInvocation({
      subagent_type: 'beegame-acceptance-validator',
      run_in_background: true,
    })).toEqual(expect.objectContaining({ allowed: false }))
    expect(validateBeeGameManagedAgentInvocation({
      subagent_type: PRODUCTION_REVIEWER_AGENT_TYPE,
      run_in_background: false,
    })).toEqual({ allowed: true })
    expect(validateBeeGameManagedAgentInvocation({
      subagent_type: 'general-purpose',
    })).toEqual({ allowed: true })
  })
})
