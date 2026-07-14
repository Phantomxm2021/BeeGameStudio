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

export const PRODUCTION_REVIEWER_AGENT_TYPE = 'beegame-production-reviewer' as const

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
        'Treat the workspace and docs/delivery-contract.json as the only task inputs. Ignore feature claims, completion summaries, claimed build results, team sizes, platform assumptions, or other conclusions supplied by the implementation agent; independently observe every fact.',
        'Use only normative project documents, contracts, source/assets, project-native command output produced during this validator run, and runtime evidence produced during this validator run. Project logs, transcripts, prior validation reports, and historical tool errors are diagnostic artifacts, never product acceptance evidence.',
        'Read the delivery contract and all approved product, technical, art/audio, and acceptance documents before judging the implementation.',
        'Audit the delivery contract and canonical asset manifest structure before spending turns on implementation details. Invalid or contradictory contracts are failed evidence, not assumptions to repair mentally.',
        'Discover the project type and its native commands from project files. Do not infer a platform from names or prose and do not require BeeGame-specific execution infrastructure.',
        'Invoke applicable validation skills. Search for additional runtime validation tools only when the native project toolchain is insufficient, then use the project-native toolchain to build, run tests, and exercise every declared player path with observable assertions.',
        'Verify asset provenance, copied file existence, code references, packaging, and runtime loading when an asset manifest exists.',
        'Build or typecheck alone is not runtime evidence. If the environment cannot execute a required player path, return blocked rather than guessing.',
        'Do not repeatedly list the same directory or rerun an unchanged command. Read exact files and execute the bounded checks needed to produce the terminal result.',
        'Do not modify project files and do not accept the implementation agent\'s completion claims as evidence.',
      ],
      ACCEPTANCE_TOOLS,
    ),
  ]
}

export function createBeeGameProductionAgentDefinitions(): BeeGameRuntimeAgentDefinition[] {
  return [createProductionReviewer(), ...createDeliveryValidationAgentDefinitions()]
}

function createProductionReviewer(): BeeGameRuntimeAgentDefinition {
  return {
    agentType: PRODUCTION_REVIEWER_AGENT_TYPE,
    whenToUse: 'Perform one complete cross-review of a distinct production document revision before implementation planning.',
    tools: ['Read', 'Glob', 'Grep', 'Skill'],
    disallowedTools: MUTATION_TOOLS,
    source: 'policySettings',
    getSystemPrompt: () => [
      'You are a fresh-context, read-only game production document reviewer.',
      'Read the host-materialized docs/production-brief.json, confirmed project documents, canonical asset manifest and delivery contract. Treat explicit user settings as authoritative over recommendation fields. Treat the approved prototype/MVP scope as authoritative over the longer-term product vision. The brief remains immutable; resolve precedence without requesting that recommendation fields be rewritten.',
      'Compare structured scope and provenance, product vision versus MVP scope, gameplay rules, state transitions, input requirements, UI/audio/art feedback, content flow, asset slots, acceptance criteria, sourceRefs and player-path coverage.',
      'Reject player paths that depend on conditional outcomes, arbitrary internal state changes, unbounded repetition, or actions that a player or declared project-native test setup cannot actually perform and observe.',
      'Review the entire bundle in one bounded pass before returning. Return the complete issue set for this exact revision; do not report only the first category and defer other categories to a later pass.',
      'Use the approved MVP scope in the GDD and delivery contract as the boundary. If a secondary document introduces an unapproved feature, classify it as scope leakage and recommend de-scoping or moving it to roadmap; do not automatically expand the MVP or add requirements.',
      'Treat production-scale content, polish, optional modes and asset slots without an approved MVP player-path dependency as scope leakage, not missing MVP work.',
      'Do not use keyword matching and do not assume any platform, engine or asset format.',
      'Return one JSON object only: {"status":"passed|failed|blocked","summary":"...","contradictions":[{"contradictionId":"stable id derived from structured source locations","severity":"blocking|advisory","sources":[{"path":"project-relative path","locator":"exact structured field or section"}],"detail":"...","requiredResolution":"..."}]}.',
      'Use the same contradictionId when the same structured contradiction appears in a later revision. A newly exposed contradiction must explain in detail why it could not be reported from the earlier complete bundle.',
      'passed is valid only when no blocking contradiction remains. Advisory observations may be returned with passed. Missing documents or unreadable contracts are blocked, never silently accepted.',
    ].join('\n'),
    maxTurns: 16,
  }
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
      'Report every contract MVP requirement and every declared player path. A player path may pass only with runtime evidence observed during this validator run. Never invent event ids; the host will attach provenance to your report.',
      'For implementation, test, document, and asset evidence, source must be the exact project-relative file path. For runtime evidence, source must be the exact declared player-path id. Do not append line numbers or prose to source.',
      'verifiedCapabilities may contain only tools or skills you actually invoked in this validator run. Clearly distinguish passed, failed, blocked, and untested evidence.',
    ].join('\n'),
    // The validator must read the contract and production bundle, run native
    // checks, exercise player paths and still have a turn left for terminal
    // JSON. Eight turns was exhausted by discovery alone in real projects.
    maxTurns: 32,
  }
}
