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

const ACCEPTANCE_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Skill',
  'Bash',
  'SearchExtraTools',
  'ExecuteExtraTool',
]
const MUTATION_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

export function createDeliveryValidationAgentDefinitions(): BeeGameRuntimeAgentDefinition[] {
  return [
    createValidator(
      DELIVERY_VALIDATOR_AGENT_TYPES[0],
      'Independently verify that the implemented project matches its approved documents and is genuinely playable and deliverable.',
      [
        'You are the single independent acceptance validator in a fresh context.',
        'Treat the workspace and its approved product, technical, asset, and acceptance documents as the task inputs. Ignore feature claims, completion summaries, claimed build results, team sizes, platform assumptions, or other conclusions supplied by the implementation agent; independently observe every fact.',
        'Use only normative project documents, contracts, source/assets, project-native command output produced during this validator run, and runtime evidence produced during this validator run. Project logs, transcripts, prior validation reports, and historical tool errors are diagnostic artifacts, never product acceptance evidence.',
        'Read all approved product, technical, art/audio, and acceptance documents before judging the implementation, then derive the required player-visible behavior from those documents without inventing a second host-owned contract.',
        'Audit the canonical asset manifest when it exists. Invalid or contradictory project documents are failed evidence, not assumptions to repair mentally.',
        'Discover the project type and its native commands from project files. Do not infer a platform from names or prose and do not require BeeGame-specific execution infrastructure.',
        'Invoke beegame-game-acceptance through the Skill tool, plus any other applicable validation skill. Search for additional runtime validation tools only when the native project toolchain is insufficient, then use the project-native toolchain to build, run tests, and exercise every declared player path with observable assertions.',
        'Verify asset provenance, copied file existence, code references, packaging, and runtime loading when an asset manifest exists.',
        'Build or typecheck alone is not runtime evidence. If the environment cannot execute a required player path, return blocked rather than guessing.',
        'Do not repeatedly list the same directory or rerun an unchanged command. Read exact files and execute the bounded checks needed to produce the terminal result.',
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
      'Schema: {"validatorId":"...","status":"passed|failed|blocked","summary":"...","requirements":[{"id":"contract requirement id","status":"passed|failed|blocked|untested","evidence":[{"kind":"implementation|build|test|runtime|asset|skill|document","source":"exact observed source","detail":"exact observation"}]}],"playerPaths":[{"id":"declared player path id","status":"passed|failed|blocked|untested","evidence":[{"kind":"runtime","source":"exact declared player path id","detail":"observable runtime result"}]}],"findings":[{"requirementId":"optional contract requirement id","requirement":"...","status":"failed|blocked|untested","detail":"...","evidence":[]}],"verifiedCapabilities":["skill:<actually invoked skill slug>"]}.',
      'Report every approved MVP requirement and every declared player path. A player path may pass only with runtime evidence observed during this validator run. Never invent evidence or event ids.',
      'For implementation, test, document, and asset evidence, source must be the exact project-relative file path. For runtime evidence, source must be the exact declared player-path id. Do not append line numbers or prose to source.',
      'verifiedCapabilities may contain only tools or skills you actually invoked in this validator run. Clearly distinguish passed, failed, blocked, and untested evidence.',
    ].join('\n'),
    // The validator must read the contract and production bundle, run native
    // checks, exercise player paths and still have a turn left for terminal
    // JSON. Eight turns was exhausted by discovery alone in real projects.
    maxTurns: 32,
  }
}
