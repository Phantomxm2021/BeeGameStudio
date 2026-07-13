export type BeeGameRuntimeAgentDefinition = {
  agentType: string
  whenToUse: string
  tools: string[]
  disallowedTools: string[]
  source: 'policySettings'
  getSystemPrompt: () => string
  maxTurns: number
}

export const DELIVERY_VALIDATOR_AGENT_TYPES = [
  'beegame-acceptance-validator',
] as const

export type DeliveryValidatorAgentType = typeof DELIVERY_VALIDATOR_AGENT_TYPES[number]

const ACCEPTANCE_TOOLS = ['Read', 'Glob', 'Grep', 'Skill', 'Bash']
const MUTATION_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

export function createDeliveryValidationAgentDefinitions(): BeeGameRuntimeAgentDefinition[] {
  return [
    createValidator(
      DELIVERY_VALIDATOR_AGENT_TYPES[0],
      'Independently verify that the implemented project matches its approved documents and is genuinely playable and deliverable.',
      [
        'You are the single independent acceptance validator in a fresh context.',
        'Read the delivery contract and all approved product, technical, art/audio, and acceptance documents before judging the implementation.',
        'Discover the project type and its native commands from project files. Do not infer a platform from names or prose and do not require BeeGame-specific execution infrastructure.',
        'Invoke applicable validation skills, then use the project-native toolchain to build, run tests, and exercise every declared player path with observable assertions.',
        'Verify asset provenance, copied file existence, code references, packaging, and runtime loading when an asset manifest exists.',
        'Build or typecheck alone is not runtime evidence. If the environment cannot execute a required player path, return blocked rather than guessing.',
        'Do not modify project files and do not accept the implementation agent\'s completion claims as evidence.',
      ],
      ACCEPTANCE_TOOLS,
    ),
  ]
}

function createValidator(
  agentType: string,
  whenToUse: string,
  promptLines: string[],
  tools: string[],
): BeeGameRuntimeAgentDefinition {
  return {
    agentType,
    whenToUse,
    tools,
    disallowedTools: MUTATION_TOOLS,
    source: 'policySettings',
    getSystemPrompt: () => [
      ...promptLines,
      'Perform the bounded validation now. Do not enter planning mode and do not create a plan file.',
      `Return one JSON object only. validatorId must equal ${JSON.stringify(agentType)}.`,
      'Schema: {"validatorId":"...","status":"passed|failed|blocked","summary":"...","requirements":[{"id":"contract requirement id","status":"passed|failed|blocked|untested","evidence":[{"kind":"implementation|build|test|runtime|asset|skill|document","source":"exact observed source","detail":"exact observation"}]}],"findings":[{"requirementId":"optional contract requirement id","requirement":"...","status":"failed|blocked|untested","detail":"...","evidence":[]}],"verifiedCapabilities":["skill:<actually invoked skill slug>"]}.',
      'Report every contract MVP requirement relevant to your validator. Never invent event ids; the host will attach provenance to your report.',
      'For implementation, test, document, and asset evidence, source must be the exact project-relative file path. For runtime evidence, source must be the exact declared player-path id. Do not append line numbers or prose to source.',
      'verifiedCapabilities may contain only tools or skills you actually invoked in this validator run. Clearly distinguish passed, failed, blocked, and untested evidence.',
    ].join('\n'),
    maxTurns: 8,
  }
}
