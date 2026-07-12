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
  'beegame-contract-validator',
  'beegame-runtime-validator',
  'beegame-asset-validator',
] as const

const INSPECTION_TOOLS = ['Read', 'Glob', 'Grep', 'Skill']
const RUNTIME_VALIDATION_TOOLS = [...INSPECTION_TOOLS, 'Bash']
const MUTATION_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

export function createDeliveryValidationAgentDefinitions(): BeeGameRuntimeAgentDefinition[] {
  return [
    createValidator(
      DELIVERY_VALIDATOR_AGENT_TYPES[0],
      'Validate the versioned delivery contract against project documents and implementation without changing files.',
      [
        'You are the independent contract and implementation validator.',
        'Use a fresh context. Read the versioned delivery contract, GDD, technical/UI/audio/art documents, acceptance checklist, and relevant implementation entrypoints.',
        'Check that every MVP requirement has implementation evidence and that roadmap work is not presented as delivered.',
        'Use available validation skills when applicable. Do not modify files and do not accept model claims as evidence.',
      ],
      INSPECTION_TOOLS,
    ),
    createValidator(
      DELIVERY_VALIDATOR_AGENT_TYPES[1],
      'Run project-native, target-adapter validation of declared player paths and observable game behavior.',
      [
        'You are the independent runtime and player-path validator.',
        'Your agent type is not a runtime adapter or a skill. Read the explicit project validation adapter and structured player paths from the project contract. Never infer a platform or engine from names or prose.',
        'Use the project-native toolchain and matching validation skill/adapter to launch the project and execute player paths with assertions.',
        'Build/typecheck alone is never runtime evidence. If the project-declared adapter is unavailable, immediately return a blocked JSON report. Do not create a plan file, install dependencies, or modify project files.',
      ],
      RUNTIME_VALIDATION_TOOLS,
    ),
    createValidator(
      DELIVERY_VALIDATOR_AGENT_TYPES[2],
      'Validate asset declaration, provenance, copied files, code references, packaging, and runtime loading.',
      [
        'You are the independent asset delivery validator.',
        'Read the explicit asset manifest and target capability contract.',
        'Validate each acceptance-relevant slot through declaration, binding provenance, copied file existence, project reference, packaged output, and runtime load evidence.',
        'Respect each slot acceptance policy: a placeholder is blocking only when the contract marks it required and disallows placeholders.',
        'Do not infer compatibility from filenames, project names, or natural-language keywords. Do not modify files.',
      ],
      INSPECTION_TOOLS,
    ),
  ]
}

export function deliveryValidationCoordinatorPrompt(): string {
  return [
    'Coordinate an independent delivery validation of the current game engineering project.',
    'In one parallel tool-call batch, invoke exactly these Task subagents:',
    ...DELIVERY_VALIDATOR_AGENT_TYPES.map(agentType => `- ${agentType}`),
    'Give each validator the project workspace and instruct it to return findings with real observed evidence.',
    'Run all three Task calls synchronously. Do not use background or detached subagents.',
    'Do not inspect or validate the project yourself. Do not modify files. Your role is only to launch the independent validators and merge their results.',
    'After all three Task results return, produce one JSON object only using the delivery contract response schema supplied below.',
  ].join('\n')
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
      'Return one JSON object to the parent coordinator with status, summary, findings, evidence, and verifiedCapabilities.',
      'verifiedCapabilities may contain only tools or skills you actually invoked in this validator run. Clearly distinguish passed, failed, blocked, and untested evidence.',
    ].join('\n'),
    maxTurns: 8,
  }
}
