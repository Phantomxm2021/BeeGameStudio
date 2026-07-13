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

export type DeliveryValidatorAgentType = typeof DELIVERY_VALIDATOR_AGENT_TYPES[number]

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
        'First audit document coverage: every normative MVP statement in the source documents must map to a contract requirement through sourceRefs, and every contract sourceRef must resolve to the declared document location.',
        'Then audit implementation conformance: every MVP requirement must have concrete implementation evidence and roadmap work must not be presented as delivered.',
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
        'For every runtime evidence item, source must be the exact player path id from docs/delivery-contract.json. Source files, build commands, and static tests are not runtime evidence.',
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

export function deliveryValidationDispatchPrompt(): string {
  return [
    'Dispatch independent delivery validation jobs for the current game engineering project.',
    'In one parallel tool-call batch, invoke exactly these Task subagents:',
    ...DELIVERY_VALIDATOR_AGENT_TYPES.map(agentType => `- ${agentType}`),
    'Give each validator the project workspace and instruct it to return findings with real observed evidence using its required JSON schema.',
    'Run all three Task calls synchronously. Do not use background or detached subagents.',
    'You are only a dispatcher. Do not inspect, validate, summarize, merge, or reinterpret the project or validator reports yourself. Do not modify files.',
    'After all three Task results return, respond only with: VALIDATION_SUBAGENTS_COMPLETED',
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
      `Return one JSON object only. validatorId must equal ${JSON.stringify(agentType)}.`,
      'Schema: {"validatorId":"...","status":"passed|failed|blocked","summary":"...","requirements":[{"id":"contract requirement id","status":"passed|failed|blocked|untested","evidence":[{"kind":"implementation|build|test|runtime|asset|skill|document","source":"exact observed source","detail":"exact observation"}]}],"findings":[{"requirementId":"optional contract requirement id","requirement":"...","status":"failed|blocked|untested","detail":"...","evidence":[]}],"verifiedCapabilities":["skill:<actually invoked skill slug>"]}.',
      'Report every contract MVP requirement relevant to your validator. Never invent event ids; the host will attach provenance to your report.',
      'For implementation, test, document, and asset evidence, source must be the exact project-relative file path. For runtime evidence, source must be the exact declared player-path id. Do not append line numbers or prose to source.',
      'verifiedCapabilities may contain only tools or skills you actually invoked in this validator run. Clearly distinguish passed, failed, blocked, and untested evidence.',
    ].join('\n'),
    maxTurns: 8,
  }
}
