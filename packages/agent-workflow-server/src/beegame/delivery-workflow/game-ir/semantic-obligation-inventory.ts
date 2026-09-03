import {
  GAME_IR_DOMAIN_IDS,
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  buildGameIrProjectionContract,
  type GameIrProjectionModuleId,
} from './projection-contract'
import {
  buildGameIrEvidenceFragmentCatalog,
  deriveProjectionSlicePlan,
} from './projection-slices'
import { sourceSectionsForGameIrProjectionSlice } from './projection-slice-authority'
import { compareCodeUnits, digestGameIrValue } from './model'

export const GAME_IR_SEMANTIC_OBLIGATION_INVENTORY_SCHEMA_VERSION =
  'game-ir-semantic-obligation-inventory.v1' as const

type RecordValue = Record<string, unknown>

export type GameIrSemanticObligationRecord = Readonly<{
  record: 'obligation'
  moduleId: GameIrProjectionModuleId
  targetId: string
  targetKind: string
  fragmentId: string
}>

export type GameIrSemanticObligation = Readonly<{
  moduleId: GameIrProjectionModuleId
  targetId: string
  targetKind: string
  /** Derived from the service-owned projection node kind; never model supplied. */
  obligationClass: string
  /** Derived semantic role for the contract node; never model supplied. */
  semanticRole: string
  fragmentId: string
  ownerSliceId: string
  obligationId: string
}>

type SemanticObligationDescriptor = Readonly<{
  obligationClass: string
  semanticRole: string
}>

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested)
    if (!Object.isFrozen(value)) Object.freeze(value)
  }
  return value
}

/** The sole service-owned semantic role/class authority for obligation records. */
export const GAME_IR_SEMANTIC_OBLIGATION_MANIFEST: Readonly<
  Record<GameIrProjectionModuleId, Readonly<Record<string, SemanticObligationDescriptor>>>
> = deepFreeze({
  gameplay: Object.freeze({
    'gameplay.action': { obligationClass: 'gameplay-action', semanticRole: 'action-rule' },
    'gameplay.capability': { obligationClass: 'gameplay-capability', semanticRole: 'capability' },
    'gameplay.condition': { obligationClass: 'gameplay-condition', semanticRole: 'condition' },
    'gameplay.effect': { obligationClass: 'gameplay-effect', semanticRole: 'effect' },
    'gameplay.entity': { obligationClass: 'gameplay-entity', semanticRole: 'entity' },
    'gameplay.event': { obligationClass: 'gameplay-event', semanticRole: 'event' },
    'gameplay.objective': { obligationClass: 'gameplay-objective', semanticRole: 'objective' },
    'gameplay.outcome': { obligationClass: 'gameplay-outcome', semanticRole: 'outcome' },
    'gameplay.rule': { obligationClass: 'gameplay-rule', semanticRole: 'rule' },
    'gameplay.state': { obligationClass: 'gameplay-state', semanticRole: 'state' },
    'gameplay.transition': { obligationClass: 'gameplay-transition', semanticRole: 'transition' },
  }),
  balance: Object.freeze({
    'balance.cost': { obligationClass: 'balance-cost', semanticRole: 'cost' },
    'balance.economy-sink': { obligationClass: 'balance-economy-sink', semanticRole: 'economy-sink' },
    'balance.economy-source': { obligationClass: 'balance-economy-source', semanticRole: 'economy-source' },
    'balance.formula': { obligationClass: 'balance-formula', semanticRole: 'formula-dependency' },
    'balance.parameter': { obligationClass: 'balance-parameter', semanticRole: 'parameter' },
    'balance.progression-curve': { obligationClass: 'balance-progression-curve', semanticRole: 'progression-curve' },
    'balance.reward': { obligationClass: 'balance-reward', semanticRole: 'reward' },
    'balance.reward-cost-binding': { obligationClass: 'balance-reward-cost-binding', semanticRole: 'reward-cost-binding' },
    'balance.unit': { obligationClass: 'balance-unit', semanticRole: 'unit' },
    'balance.variable': { obligationClass: 'balance-variable', semanticRole: 'variable' },
  }),
  'world-scene': Object.freeze({
    'world-scene.camera-region': { obligationClass: 'world-scene-camera-region', semanticRole: 'camera-region' },
    'world-scene.checkpoint': { obligationClass: 'world-scene-checkpoint', semanticRole: 'checkpoint' },
    'world-scene.encounter': { obligationClass: 'world-scene-encounter', semanticRole: 'encounter' },
    'world-scene.entity-instance': { obligationClass: 'world-scene-entity-instance', semanticRole: 'entity-instance' },
    'world-scene.node': { obligationClass: 'world-scene-node', semanticRole: 'scene-node' },
    'world-scene.objective-placement': { obligationClass: 'world-scene-objective-placement', semanticRole: 'objective-placement' },
    'world-scene.route': { obligationClass: 'world-scene-route', semanticRole: 'route' },
    'world-scene.scene': { obligationClass: 'world-scene-scene', semanticRole: 'scene' },
    'world-scene.spawn': { obligationClass: 'world-scene-spawn', semanticRole: 'spawn' },
    'world-scene.zone': { obligationClass: 'world-scene-zone', semanticRole: 'zone' },
  }),
  presentation: Object.freeze({
    'presentation.animation-clip': { obligationClass: 'presentation-animation-clip', semanticRole: 'animation-clip' },
    'presentation.animation-state': { obligationClass: 'presentation-animation-state', semanticRole: 'animation-state' },
    'presentation.audio-cue': { obligationClass: 'presentation-audio-cue', semanticRole: 'audio-cue' },
    'presentation.audio-event': { obligationClass: 'presentation-audio-event', semanticRole: 'audio-event' },
    'presentation.camera-behavior': { obligationClass: 'presentation-camera-behavior', semanticRole: 'camera-behavior' },
    'presentation.feedback': { obligationClass: 'presentation-feedback', semanticRole: 'feedback' },
    'presentation.music-state': { obligationClass: 'presentation-music-state', semanticRole: 'music-state' },
    'presentation.transition': { obligationClass: 'presentation-transition', semanticRole: 'transition' },
    'presentation.ui-action': { obligationClass: 'presentation-ui-action', semanticRole: 'ui-action' },
    'presentation.ui-screen': { obligationClass: 'presentation-ui-screen', semanticRole: 'ui-screen' },
    'presentation.ui-state': { obligationClass: 'presentation-ui-state', semanticRole: 'ui-state' },
    'presentation.vfx-cue': { obligationClass: 'presentation-vfx-cue', semanticRole: 'vfx-cue' },
  }),
  'resource-realization': Object.freeze({
    'resource-realization.acquisition-profile': { obligationClass: 'resource-acquisition-profile', semanticRole: 'acquisition-profile' },
    'resource-realization.delivery-artifact': { obligationClass: 'resource-delivery-artifact', semanticRole: 'delivery-artifact' },
    'resource-realization.delivery-target': { obligationClass: 'resource-delivery-target', semanticRole: 'delivery-target' },
    'resource-realization.logical-resource': { obligationClass: 'resource-logical-resource', semanticRole: 'logical-resource' },
    'resource-realization.variant': { obligationClass: 'resource-variant', semanticRole: 'variant' },
  }),
  'implementation-verification': Object.freeze({
    'implementation-verification.acceptance-scenario': { obligationClass: 'implementation-acceptance-scenario', semanticRole: 'acceptance-scenario' },
    'implementation-verification.evidence-requirement': { obligationClass: 'implementation-evidence-requirement', semanticRole: 'evidence-requirement' },
    'implementation-verification.invariant': { obligationClass: 'implementation-invariant', semanticRole: 'invariant' },
    'implementation-verification.target': { obligationClass: 'implementation-target', semanticRole: 'target' },
    'implementation-verification.unit': { obligationClass: 'implementation-unit', semanticRole: 'unit' },
  }),
})

export type GameIrSemanticObligationRecordStreamResult = Readonly<{
  records: readonly GameIrSemanticObligationRecord[]
  done: boolean
  diagnostic?: string
}>

export type GameIrSemanticObligationPromptProviderMode = 'anthropic' | 'openai'

export const GAME_IR_SEMANTIC_OBLIGATION_PROMPT_PROVIDER_MODES = Object.freeze([
  'anthropic',
  'openai',
] as const)

export type GameIrSemanticObligationInventoryPromptAuthority = Readonly<{
  schemaVersion: 'game-ir-semantic-obligation-inventory-prompt.v1'
  moduleId: GameIrProjectionModuleId
  sourceFragments: readonly Readonly<{
    fragmentId: string
    text: string
  }>[]
  targetKinds: readonly Readonly<{
    targetKind: string
    obligationClass: string
    semanticRole: string
  }>[]
}>

export type GameIrSemanticObligationInventory = Readonly<{
  schemaVersion: typeof GAME_IR_SEMANTIC_OBLIGATION_INVENTORY_SCHEMA_VERSION
  moduleId: GameIrProjectionModuleId
  sourceDigest: string
  obligations: readonly GameIrSemanticObligation[]
  index: Readonly<Record<string, GameIrSemanticObligation>>
  digest: string
}>

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

export function validateGameIrSemanticObligationManifest(): void {
  for (const moduleId of GAME_IR_DOMAIN_IDS) {
    const manifest = GAME_IR_SEMANTIC_OBLIGATION_MANIFEST[moduleId]
    const contractKinds = buildGameIrProjectionContract(moduleId).nodes.map(
      node => node.kind,
    )
    const manifestKinds = Object.keys(manifest).sort(compareCodeUnits)
    const expectedKinds = [...contractKinds].sort(compareCodeUnits)
    if (
      manifestKinds.length !== expectedKinds.length ||
      manifestKinds.some((kind, index) => kind !== expectedKinds[index])
    )
      throw new Error(
        `semantic obligation manifest does not exactly cover ${moduleId} contract`,
      )
    for (const kind of expectedKinds) {
      const descriptor = manifest[kind]
      if (
        !descriptor ||
        typeof descriptor.obligationClass !== 'string' ||
        descriptor.obligationClass.length === 0 ||
        typeof descriptor.semanticRole !== 'string' ||
        descriptor.semanticRole.length === 0
      )
        throw new Error(`semantic obligation manifest has an invalid ${moduleId}.${kind}`)
    }
  }
}

validateGameIrSemanticObligationManifest()

function isPlainRecord(value: unknown): value is RecordValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}

function exactKeys(
  value: RecordValue,
  expected: readonly string[],
  label: string,
): void {
  const actual = Reflect.ownKeys(value)
  if (actual.some(key => typeof key !== 'string'))
    throw new Error(`${label} has a symbol property`)
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw new Error(`${label} has a hidden or accessor property`)
  }
  const keys = (actual as string[]).sort(compareCodeUnits)
  const wanted = [...expected].sort(compareCodeUnits)
  if (
    keys.length !== wanted.length ||
    keys.some((key, index) => key !== wanted[index])
  )
    throw new Error(`${label} has unknown or missing fields`)
}

function nonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${label} must be non-empty text`)
  return value
}

function safeId(value: unknown, label: string): string {
  const result = nonEmptyText(value, label)
  if (!SAFE_ID.test(result)) throw new Error(`${label} is not a safe identifier`)
  return result
}

function expectedModule(value: unknown, label: string): GameIrProjectionModuleId {
  const moduleId = nonEmptyText(value, label)
  if (!(GAME_IR_DOMAIN_IDS as readonly string[]).includes(moduleId))
    throw new Error(`${label} is not a canonical Game IR module`)
  return moduleId as GameIrProjectionModuleId
}

function streamLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map(line => (line.endsWith('\r') ? line.slice(0, -1) : line))
}

function diagnostic(
  records: readonly GameIrSemanticObligationRecord[],
  reason: string,
): GameIrSemanticObligationRecordStreamResult {
  return { records: [...records], done: false, diagnostic: reason }
}

/** Parses only the canonical raw obligation JSONL protocol. */
export function parseGameIrSemanticObligationRecordStream(input: {
  expectedModuleId: GameIrProjectionModuleId
  text: string
}): GameIrSemanticObligationRecordStreamResult {
  const moduleId = expectedModule(input.expectedModuleId, 'expectedModuleId')
  if (typeof input.text !== 'string')
    throw new Error('obligation stream text must be text')
  const records: GameIrSemanticObligationRecord[] = []
  let previousTargetId: string | undefined
  let doneSeen = false

  for (const [lineIndex, line] of streamLines(input.text).entries()) {
    const label = `line ${lineIndex + 1}`
    if (line.trim().length === 0)
      return diagnostic(records, `${label} is an empty line`)
    if (doneSeen) return diagnostic(records, `${label} appears after done`)

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return diagnostic(records, `${label} is not valid JSON`)
    }
    if (!isPlainRecord(parsed))
      return diagnostic(records, `${label} must be a JSON object record`)

    try {
      if (parsed.record === 'obligation') {
        exactKeys(
          parsed,
          ['record', 'moduleId', 'targetId', 'targetKind', 'fragmentId'],
          `obligation record at ${label}`,
        )
        if (parsed.moduleId !== moduleId)
          throw new Error(`obligation record at ${label} has the wrong module`)
        const targetId = safeId(parsed.targetId, `${label}.targetId`)
        if (
          previousTargetId !== undefined &&
          compareCodeUnits(previousTargetId, targetId) >= 0
        )
          throw new Error(
            `obligation target IDs must be unique and code-unit sorted at ${label}`,
          )
        previousTargetId = targetId
        records.push({
          record: 'obligation',
          moduleId,
          targetId,
          targetKind: safeId(parsed.targetKind, `${label}.targetKind`),
          fragmentId: nonEmptyText(parsed.fragmentId, `${label}.fragmentId`),
        })
        continue
      }

      if (parsed.record === 'done') {
        exactKeys(parsed, ['record', 'moduleId'], `done record at ${label}`)
        if (parsed.moduleId !== moduleId)
          throw new Error(`done record at ${label} has the wrong module`)
        doneSeen = true
        continue
      }

      throw new Error(`${label} has an unknown record type`)
    } catch (error) {
      return diagnostic(
        records,
        error instanceof Error ? error.message : `${label} is invalid`,
      )
    }
  }

  if (!doneSeen)
    return diagnostic(records, 'obligation stream is missing its final done record')
  return { records: Object.freeze([...records]), done: true }
}

function obligationId(
  moduleId: GameIrProjectionModuleId,
  targetKind: string,
  targetId: string,
): string {
  return `${moduleId}:${targetKind}:${targetId}`
}

function selectedFragmentIds(
  source: GameIrDomainSourceEnvelope,
  sliceId: string,
  catalog: ReturnType<typeof buildGameIrEvidenceFragmentCatalog>,
): ReadonlySet<string> {
  const selectors = new Set(
    sourceSectionsForGameIrProjectionSlice(sliceId).map(
      selector => `${selector.documentPath}#${selector.sectionId}`,
    ),
  )
  return new Set(
    catalog.fragments
      .filter(fragment =>
        selectors.has(`${fragment.documentPath}#${fragment.sectionId}`),
      )
      .map(fragment => fragment.fragmentId),
  )
}

function validateRecord(
  source: GameIrDomainSourceEnvelope,
  moduleId: GameIrProjectionModuleId,
  record: GameIrSemanticObligationRecord,
  catalog: ReturnType<typeof buildGameIrEvidenceFragmentCatalog>,
  selectedFragmentsBySlice: ReadonlyMap<string, ReadonlySet<string>>,
): GameIrSemanticObligation {
  if (!isPlainRecord(record)) throw new Error('obligation record must be a plain object')
  exactKeys(
    record,
    ['record', 'moduleId', 'targetId', 'targetKind', 'fragmentId'],
    'obligation record',
  )
  if (record.record !== 'obligation' || record.moduleId !== moduleId)
    throw new Error('obligation record identity is detached')
  const targetId = safeId(record.targetId, 'obligation targetId')
  const targetKind = safeId(record.targetKind, 'obligation targetKind')
  const fragmentId = nonEmptyText(record.fragmentId, 'obligation fragmentId')

  const contract = buildGameIrProjectionContract(moduleId)
  const targetContract = contract.nodes.find(node => node.kind === targetKind)
  if (!targetContract)
    throw new Error(`obligation target kind is outside ${moduleId} projection contract`)
  const slices = deriveProjectionSlicePlan(moduleId).slices.filter(slice =>
    slice.nodeKinds.includes(targetKind),
  )
  if (slices.length !== 1)
    throw new Error(`obligation target kind does not have a unique owner slice: ${targetKind}`)
  const ownerSliceId = slices[0]!.sliceId

  const fragment = catalog.fragments.find(candidate => candidate.fragmentId === fragmentId)
  if (!fragment) throw new Error(`obligation fragment is outside source catalog: ${fragmentId}`)
  if (!selectedFragmentsBySlice.get(ownerSliceId)!.has(fragmentId))
    throw new Error(`obligation fragment is outside selected source authority: ${fragmentId}`)

  return Object.freeze({
    moduleId,
    targetId,
    targetKind,
    obligationClass: GAME_IR_SEMANTIC_OBLIGATION_MANIFEST[moduleId][targetKind]!.obligationClass,
    semanticRole: GAME_IR_SEMANTIC_OBLIGATION_MANIFEST[moduleId][targetKind]!.semanticRole,
    fragmentId,
    ownerSliceId,
    obligationId: obligationId(moduleId, targetKind, targetId),
  })
}

/** Validates source bindings and derives the sole immutable inventory identity. */
export function buildGameIrSemanticObligationInventory(input: {
  moduleId: GameIrProjectionModuleId
  source: GameIrDomainSourceEnvelope
  records: readonly GameIrSemanticObligationRecord[]
}): GameIrSemanticObligationInventory {
  const moduleId = expectedModule(input.moduleId, 'moduleId')
  const source = validateGameIrDomainSourceEnvelope(input.source)
  if (source.moduleId !== moduleId)
    throw new Error('obligation source module is detached')
  if (!Array.isArray(input.records))
    throw new Error('obligation records must be an array')

  const catalog = buildGameIrEvidenceFragmentCatalog({
    sectionIndex: source.sectionIndex,
    sectionBytes: source.sectionBytes,
  })
  const selectedFragmentsBySlice = new Map(
    deriveProjectionSlicePlan(moduleId).slices.map(slice => [
      slice.sliceId,
      selectedFragmentIds(source, slice.sliceId, catalog),
    ] as const),
  )
  const obligations = input.records.map(record =>
    validateRecord(source, moduleId, record, catalog, selectedFragmentsBySlice),
  )
  const seen = new Set<string>()
  for (let index = 0; index < obligations.length; index += 1) {
    const current = obligations[index]!
    if (seen.has(current.obligationId))
      throw new Error(`obligation records contain a duplicate target: ${current.targetId}`)
    seen.add(current.obligationId)
    if (
      index > 0 &&
      compareCodeUnits(obligations[index - 1]!.targetId, current.targetId) >= 0
    )
      throw new Error('obligation records must be unique and code-unit sorted')
  }

  const frozenObligations = Object.freeze([...obligations])
  const index: Record<string, GameIrSemanticObligation> = {}
  for (const obligation of frozenObligations) index[obligation.obligationId] = obligation
  Object.freeze(index)
  const body = {
    schemaVersion: GAME_IR_SEMANTIC_OBLIGATION_INVENTORY_SCHEMA_VERSION,
    moduleId,
    sourceDigest: source.sourceDigest,
    obligations: frozenObligations,
    index,
  }
  return Object.freeze({
    ...body,
    digest: digestGameIrValue(body),
  })
}

/** Builds the compact, complete source authority shown to the inventory model. */
export function buildGameIrSemanticObligationInventoryPromptAuthority(input: {
  source: GameIrDomainSourceEnvelope
}): GameIrSemanticObligationInventoryPromptAuthority {
  const source = validateGameIrDomainSourceEnvelope(input.source)
  const contract = buildGameIrProjectionContract(source.moduleId)
  const catalog = buildGameIrEvidenceFragmentCatalog({
    sectionIndex: source.sectionIndex,
    sectionBytes: source.sectionBytes,
  })
  const sourceFragments = catalog.fragments.map(fragment => ({
    fragmentId: fragment.fragmentId,
    text: fragment.excerpt,
  }))
  const targetKinds = contract.nodes.map(node => {
    const descriptor = GAME_IR_SEMANTIC_OBLIGATION_MANIFEST[source.moduleId][node.kind]
    if (!descriptor) throw new Error(`missing obligation descriptor: ${source.moduleId}.${node.kind}`)
    return {
      targetKind: node.kind,
      obligationClass: descriptor.obligationClass,
      semanticRole: descriptor.semanticRole,
    }
  })
  return deepFreeze({
    schemaVersion: 'game-ir-semantic-obligation-inventory-prompt.v1',
    moduleId: source.moduleId,
    sourceFragments,
    targetKinds,
  })
}

function providerLabel(mode: GameIrSemanticObligationPromptProviderMode): string {
  if (mode === 'anthropic') return 'Anthropic-compatible'
  if (mode === 'openai') return 'OpenAI-compatible'
  throw new Error(`unsupported semantic obligation provider mode: ${mode}`)
}

/** Renders only the inventory authority and its strict raw NDJSON contract. */
export function renderGameIrSemanticObligationInventoryPrompt(
  authority: GameIrSemanticObligationInventoryPromptAuthority,
  providerMode: GameIrSemanticObligationPromptProviderMode = 'anthropic',
): string {
  const mode = providerLabel(providerMode)
  const targetRows = authority.targetKinds.map(kind =>
    `${kind.targetKind} | ${kind.obligationClass} | ${kind.semanticRole}`,
  )
  const fragmentRows = authority.sourceFragments.map(fragment =>
    `- ${fragment.fragmentId}: ${JSON.stringify(fragment.text)}`,
  )
  return [
    'Semantic obligation inventory authority',
    `Provider mode: ${mode}`,
    `Module: ${authority.moduleId}`,
    '',
    '## Allowed target kinds (service-owned class and role)',
    'targetKind | class | role',
    ...targetRows,
    '',
    '## Source fragments (complete canonical module scope)',
    ...fragmentRows,
    '',
    '## Output contract',
    'Return strict NDJSON only: one JSON object per line, no Markdown, prose, array/object wrapper, tool call, or extra fields.',
    'Identify every obligation instance supported by the source fragments. Use only an allowed targetKind and one exact fragmentId. targetId values must be safe, unique, and code-unit sorted.',
    'The service owns all authority not represented in this record shape; emit no extra properties.',
    '{"record":"obligation","moduleId":"' + authority.moduleId + '","targetId":"<targetId>","targetKind":"<targetKind>","fragmentId":"<fragmentId>"}',
    'After the final obligation, emit exactly: {"record":"done","moduleId":"' + authority.moduleId + '"}',
    'The done record is last. An empty inventory is valid when no obligation is present.',
  ].join('\n')
}
