import {
  GAME_IR_DOMAIN_IDS,
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  buildGameIrProjectionContract,
  type GameIrProjectionContract,
  type GameIrProjectionModuleId,
} from './projection-contract'
import {
  buildGameIrEvidenceFragmentCatalog,
  deriveProjectionSlicePlan,
} from './projection-slices'
import { sourceSectionsForGameIrProjectionSlice } from './projection-slice-authority'
import {
  GAME_IR_SEMANTIC_OBLIGATION_MANIFEST,
  type GameIrSemanticObligation,
  type GameIrSemanticObligationInventory,
} from './semantic-obligation-inventory'
import { canonicalGameIrModuleSourceDocuments } from './domain-source'
import { compareCodeUnits, digestGameIrValue } from './model'

export const GAME_IR_SEMANTIC_OBLIGATION_VALIDATOR_MANIFEST_SCHEMA_VERSION =
  'game-ir-semantic-obligation-validator-manifest.v1' as const

export const GAME_IR_SEMANTIC_OBLIGATION_VALIDATION_SCHEMA_VERSION =
  'game-ir-semantic-obligation-validation.v1' as const

export const GAME_IR_SEMANTIC_OBLIGATION_VALIDATION_RECEIPT_SCHEMA_VERSION =
  'game-ir-semantic-obligation-validation-receipt.v1' as const

const SHA256 = /^[a-f0-9]{64}$/u
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

type RecordValue = Record<string, unknown>

export type GameIrSemanticObligationValidatorManifest = Readonly<{
  schemaVersion: typeof GAME_IR_SEMANTIC_OBLIGATION_VALIDATOR_MANIFEST_SCHEMA_VERSION
  moduleId: GameIrProjectionModuleId
  sourceDocumentPaths: readonly string[]
  obligations: readonly Readonly<{
    targetKind: string
    obligationClass: string
    semanticRole: string
    ownerSliceId: string
  }>[]
  digest: string
}>

export type GameIrSemanticObligationValidationIdentities = Readonly<{
  compileRequestDigest: string
  sourceDigest: string
  inventoryDigest: string
  projectionContractDigest: string
  validatorManifestDigest: string
  ownerSliceMapDigest: string
}>

export type GameIrSemanticObligationValidationAuthority = Readonly<{
  schemaVersion: typeof GAME_IR_SEMANTIC_OBLIGATION_VALIDATION_SCHEMA_VERSION
  moduleId: GameIrProjectionModuleId
  source: GameIrDomainSourceEnvelope
  projectionContract: GameIrProjectionContract
  validatorManifest: GameIrSemanticObligationValidatorManifest
  inventory: GameIrSemanticObligationInventory
  sourceFragments: readonly Readonly<{
    fragmentId: string
    documentPath: string
    sectionId: string
    sectionDigest: string
    text: string
  }>[]
  identities: GameIrSemanticObligationValidationIdentities
}>

export type GameIrSemanticObligationValidationCoverage = Readonly<{
  fragmentId: string
  documentPath: string
  sectionId: string
  sectionDigest: string
}>

export type GameIrSemanticObligationValidationReceipt = Readonly<{
  schemaVersion: typeof GAME_IR_SEMANTIC_OBLIGATION_VALIDATION_RECEIPT_SCHEMA_VERSION
  moduleId: GameIrProjectionModuleId
  identities: GameIrSemanticObligationValidationIdentities
  coverage: readonly GameIrSemanticObligationValidationCoverage[]
  receiptDigest: string
}>

export type GameIrSemanticObligationValidationResult = Readonly<
  | {
      outcome: 'PASS'
      receipt: GameIrSemanticObligationValidationReceipt
    }
  | {
      outcome: 'FAIL'
      reasonCode: 'missing-obligation'
      targetId: string
      expectedKind: string
      semanticRole: string
      fragmentId: string
      obligationId: string
      ownerSliceId: string
      evidence: GameIrSemanticObligationValidationCoverage
    }
  | {
      outcome: 'AMBIGUOUS'
      reasonCode: 'ambiguous-obligation'
      detail: string
    }
>

export type GameIrSemanticObligationValidationRawResult = Readonly<
  | {
      outcome: 'PASS'
      moduleId: GameIrProjectionModuleId
      identities: GameIrSemanticObligationValidationIdentities
      coverage: readonly string[]
    }
  | {
      outcome: 'FAIL'
      moduleId: GameIrProjectionModuleId
      reasonCode: 'missing-obligation'
      targetId: string
      expectedKind: string
      semanticRole: string
      fragmentId: string
    }
  | {
      outcome: 'AMBIGUOUS'
      moduleId: GameIrProjectionModuleId
      reasonCode: 'ambiguous-obligation'
      detail: string
    }
>

type RawValidationResult = GameIrSemanticObligationValidationRawResult

export type GameIrSemanticObligationValidationStreamResult = Readonly<{
  done: boolean
  result?: RawValidationResult
  diagnostic?: string
}>

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function isPlainRecord(value: unknown): value is RecordValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}

function exactKeys(value: RecordValue, expected: readonly string[], label: string): void {
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
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index]))
    throw new Error(`${label} has unknown or missing fields`)
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${label} must be non-empty text`)
  return value
}

function safeId(value: unknown, label: string): string {
  const result = text(value, label)
  if (!SAFE_ID.test(result)) throw new Error(`${label} is not a safe identifier`)
  return result
}

function digest(value: unknown, label: string): string {
  const result = text(value, label)
  if (!SHA256.test(result)) throw new Error(`${label} is not a SHA-256 digest`)
  return result
}

function moduleId(value: unknown, label: string): GameIrProjectionModuleId {
  const result = text(value, label)
  if (!(GAME_IR_DOMAIN_IDS as readonly string[]).includes(result))
    throw new Error(`${label} is not a canonical Game IR module`)
  return result as GameIrProjectionModuleId
}

function catalogFor(source: GameIrDomainSourceEnvelope) {
  return buildGameIrEvidenceFragmentCatalog({
    sectionIndex: source.sectionIndex,
    sectionBytes: source.sectionBytes,
  })
}

function ownerSlice(module: GameIrProjectionModuleId, targetKind: string): string {
  const slices = deriveProjectionSlicePlan(module).slices.filter(slice =>
    slice.nodeKinds.includes(targetKind),
  )
  if (slices.length !== 1)
    throw new Error(`obligation target kind does not have a unique owner slice: ${targetKind}`)
  return slices[0]!.sliceId
}

function selectedFragments(
  source: GameIrDomainSourceEnvelope,
  sliceId: string,
  catalog: ReturnType<typeof catalogFor>,
): ReadonlySet<string> {
  const selected = new Set(
    sourceSectionsForGameIrProjectionSlice(sliceId).map(
      selector => `${selector.documentPath}#${selector.sectionId}`,
    ),
  )
  return new Set(
    catalog.fragments
      .filter(fragment => selected.has(`${fragment.documentPath}#${fragment.sectionId}`))
      .map(fragment => fragment.fragmentId),
  )
}

function manifestFor(module: GameIrProjectionModuleId): GameIrSemanticObligationValidatorManifest {
  const contract = buildGameIrProjectionContract(module)
  const obligations = contract.nodes.map(node => {
    const descriptor = GAME_IR_SEMANTIC_OBLIGATION_MANIFEST[module][node.kind]
    if (!descriptor) throw new Error(`missing obligation descriptor: ${module}.${node.kind}`)
    return {
      targetKind: node.kind,
      obligationClass: descriptor.obligationClass,
      semanticRole: descriptor.semanticRole,
      ownerSliceId: ownerSlice(module, node.kind),
    }
  })
  const body = {
    schemaVersion: GAME_IR_SEMANTIC_OBLIGATION_VALIDATOR_MANIFEST_SCHEMA_VERSION,
    moduleId: module,
    sourceDocumentPaths: [...canonicalGameIrModuleSourceDocuments(module)],
    obligations,
  }
  return deepFreeze({ ...body, digest: digestGameIrValue(body) })
}

/** Fixed service-owned validator manifests; callers cannot redefine this map. */
export const GAME_IR_SEMANTIC_OBLIGATION_VALIDATOR_MANIFEST: Readonly<
  Record<GameIrProjectionModuleId, GameIrSemanticObligationValidatorManifest>
> = deepFreeze(
  Object.fromEntries(
    GAME_IR_DOMAIN_IDS.map(module => [module, manifestFor(module)]),
  ) as Record<GameIrProjectionModuleId, GameIrSemanticObligationValidatorManifest>,
)

function sectionDigest(
  source: GameIrDomainSourceEnvelope,
  documentPath: string,
  sectionId: string,
): string {
  const section = source.sectionIndex.find(
    candidate => candidate.documentPath === documentPath && candidate.sectionId === sectionId,
  )
  if (!section) throw new Error(`validation source section is outside scope: ${documentPath}#${sectionId}`)
  return section.digest
}

function validateInventory(
  source: GameIrDomainSourceEnvelope,
  contract: GameIrProjectionContract,
  inventory: GameIrSemanticObligationInventory,
): void {
  if (!isPlainRecord(inventory)) throw new Error('validation inventory must be a plain object')
  exactKeys(inventory, ['schemaVersion', 'moduleId', 'sourceDigest', 'obligations', 'index', 'digest'], 'validation inventory')
  if (inventory.schemaVersion !== 'game-ir-semantic-obligation-inventory.v1')
    throw new Error('validation inventory schemaVersion is invalid')
  if (inventory.moduleId !== source.moduleId || inventory.sourceDigest !== source.sourceDigest)
    throw new Error('validation inventory source identity is stale or relabeled')
  if (!Array.isArray(inventory.obligations) || !isPlainRecord(inventory.index))
    throw new Error('validation inventory collections are invalid')
  const catalog = catalogFor(source)
  const knownKinds = new Set(contract.nodes.map(node => node.kind))
  const seen = new Set<string>()
  for (let index = 0; index < inventory.obligations.length; index += 1) {
    const obligation: GameIrSemanticObligation = inventory.obligations[index]!
    if (!isPlainRecord(obligation)) throw new Error(`validation inventory obligation ${index} is invalid`)
    exactKeys(obligation, ['moduleId', 'targetId', 'targetKind', 'obligationClass', 'semanticRole', 'fragmentId', 'ownerSliceId', 'obligationId'], `validation inventory obligation ${index}`)
    const targetId = safeId(obligation.targetId, 'validation inventory targetId')
    const targetKind = safeId(obligation.targetKind, 'validation inventory targetKind')
    if (obligation.moduleId !== source.moduleId || !knownKinds.has(targetKind))
      throw new Error('validation inventory target kind is outside the projection contract')
    const descriptor = GAME_IR_SEMANTIC_OBLIGATION_MANIFEST[source.moduleId][targetKind]
    const sliceId = ownerSlice(source.moduleId, targetKind)
    if (
      obligation.obligationClass !== descriptor!.obligationClass ||
      obligation.semanticRole !== descriptor!.semanticRole ||
      obligation.ownerSliceId !== sliceId
    ) throw new Error('validation inventory obligation descriptor is forged')
    const fragmentId = text(obligation.fragmentId, 'validation inventory fragmentId')
    const fragment = catalog.fragments.find(candidate => candidate.fragmentId === fragmentId)
    if (!fragment || !selectedFragments(source, sliceId, catalog).has(fragmentId))
      throw new Error('validation inventory fragment is outside source authority')
    const expectedId = `${source.moduleId}:${targetKind}:${targetId}`
    if (obligation.obligationId !== expectedId || seen.has(expectedId))
      throw new Error('validation inventory obligation identity is invalid')
    seen.add(expectedId)
    if (index > 0 && compareCodeUnits(inventory.obligations[index - 1]!.targetId, targetId) >= 0)
      throw new Error('validation inventory obligations are not sorted')
    if (
      !isPlainRecord(inventory.index[expectedId]) ||
      digestGameIrValue(inventory.index[expectedId]) !== digestGameIrValue(obligation)
    )
      throw new Error('validation inventory index is detached')
  }
  const indexKeys = Object.keys(inventory.index).sort(compareCodeUnits)
  const expectedKeys = [...seen].sort(compareCodeUnits)
  if (indexKeys.length !== expectedKeys.length || indexKeys.some((key, index) => key !== expectedKeys[index]))
    throw new Error('validation inventory index coverage is incomplete')
  const { digest: suppliedDigest, ...body } = inventory
  if (digest(suppliedDigest, 'validation inventory digest') !== digestGameIrValue(body))
    throw new Error('validation inventory digest is stale or invalid')
}

export function buildGameIrSemanticObligationValidationAuthority(input: {
  source: GameIrDomainSourceEnvelope
  inventory: GameIrSemanticObligationInventory
}): GameIrSemanticObligationValidationAuthority {
  if (!isPlainRecord(input)) throw new Error('validation authority input must be a plain object')
  exactKeys(input, ['source', 'inventory'], 'validation authority input')
  const source = validateGameIrDomainSourceEnvelope(input.source)
  const module = source.moduleId
  const contract = buildGameIrProjectionContract(module)
  validateInventory(source, contract, input.inventory)
  const validatorManifest = GAME_IR_SEMANTIC_OBLIGATION_VALIDATOR_MANIFEST[module]
  const catalog = catalogFor(source)
  const sourceFragments = catalog.fragments.map(fragment => ({
    fragmentId: fragment.fragmentId,
    documentPath: fragment.documentPath,
    sectionId: fragment.sectionId,
    sectionDigest: sectionDigest(source, fragment.documentPath, fragment.sectionId),
    text: fragment.excerpt,
  }))
  const ownerSliceMap = input.inventory.obligations.map(obligation => ({
    obligationId: obligation.obligationId,
    ownerSliceId: obligation.ownerSliceId,
  }))
  const identities = {
    compileRequestDigest: digestGameIrValue(source.compileRequest),
    sourceDigest: source.sourceDigest,
    inventoryDigest: input.inventory.digest,
    projectionContractDigest: digestGameIrValue(contract),
    validatorManifestDigest: validatorManifest.digest,
    ownerSliceMapDigest: digestGameIrValue(ownerSliceMap),
  }
  return deepFreeze({
    schemaVersion: GAME_IR_SEMANTIC_OBLIGATION_VALIDATION_SCHEMA_VERSION,
    moduleId: module,
    source,
    projectionContract: contract,
    validatorManifest,
    inventory: input.inventory,
    sourceFragments,
    identities,
  })
}

function lines(textValue: string): string[] {
  const result = textValue.split('\n')
  if (result.at(-1) === '') result.pop()
  return result.map(lineValue => (lineValue.endsWith('\r') ? lineValue.slice(0, -1) : lineValue))
}

function parseIdentity(value: RecordValue, label: string): GameIrSemanticObligationValidationIdentities {
  exactKeys(value, [
    'record',
    'moduleId',
    'compileRequestDigest',
    'sourceDigest',
    'inventoryDigest',
    'projectionContractDigest',
    'validatorManifestDigest',
    'ownerSliceMapDigest',
  ], label)
  return {
    compileRequestDigest: digest(value.compileRequestDigest, `${label}.compileRequestDigest`),
    sourceDigest: digest(value.sourceDigest, `${label}.sourceDigest`),
    inventoryDigest: digest(value.inventoryDigest, `${label}.inventoryDigest`),
    projectionContractDigest: digest(value.projectionContractDigest, `${label}.projectionContractDigest`),
    validatorManifestDigest: digest(value.validatorManifestDigest, `${label}.validatorManifestDigest`),
    ownerSliceMapDigest: digest(value.ownerSliceMapDigest, `${label}.ownerSliceMapDigest`),
  }
}

/** Parses the compact, strict validator NDJSON protocol. */
export function parseGameIrSemanticObligationValidationResultStream(input: {
  authority: GameIrSemanticObligationValidationAuthority
  text: string
}): GameIrSemanticObligationValidationStreamResult {
  if (typeof input.text !== 'string') throw new Error('validation stream text must be text')
  const module = input.authority.moduleId
  let result: RawValidationResult | undefined
  let doneSeen = false
  const coverage: string[] = []
  for (const [index, lineValue] of lines(input.text).entries()) {
    const label = `line ${index + 1}`
    if (lineValue.trim().length === 0) return { done: false, diagnostic: `${label} is empty` }
    if (doneSeen) return { done: false, diagnostic: `${label} appears after done` }
    let parsed: unknown
    try {
      parsed = JSON.parse(lineValue)
    } catch {
      return { done: false, diagnostic: `${label} is not valid JSON` }
    }
    if (!isPlainRecord(parsed)) return { done: false, diagnostic: `${label} must be an object` }
    try {
      if (parsed.record === 'pass') {
        if (result) throw new Error(`${label} contains multiple terminal results`)
        const identities = parseIdentity(parsed, `pass record at ${label}`)
        if (parsed.moduleId !== module) throw new Error(`${label} has the wrong module`)
        result = { outcome: 'PASS', moduleId: module, identities, coverage: [] }
      } else if (parsed.record === 'coverage') {
        exactKeys(parsed, ['record', 'moduleId', 'fragmentId'], `coverage record at ${label}`)
        if (!result || result.outcome !== 'PASS') throw new Error(`${label} coverage is not attached to PASS`)
        if (parsed.moduleId !== module) throw new Error(`${label} has the wrong module`)
        const fragmentId = text(parsed.fragmentId, `${label}.fragmentId`)
        if (coverage.includes(fragmentId)) throw new Error(`${label} contains duplicate coverage`)
        coverage.push(fragmentId)
        result = { ...result, coverage: [...coverage] }
      } else if (parsed.record === 'fail') {
        if (result) throw new Error(`${label} contains multiple terminal results`)
        exactKeys(parsed, ['record', 'moduleId', 'reasonCode', 'targetId', 'expectedKind', 'semanticRole', 'fragmentId'], `fail record at ${label}`)
        if (parsed.moduleId !== module) throw new Error(`${label} has the wrong module`)
        if (parsed.reasonCode !== 'missing-obligation') throw new Error(`${label} has an unknown failure reason`)
        result = {
          outcome: 'FAIL',
          moduleId: module,
          reasonCode: 'missing-obligation',
          targetId: safeId(parsed.targetId, `${label}.targetId`),
          expectedKind: safeId(parsed.expectedKind, `${label}.expectedKind`),
          semanticRole: text(parsed.semanticRole, `${label}.semanticRole`),
          fragmentId: text(parsed.fragmentId, `${label}.fragmentId`),
        }
      } else if (parsed.record === 'ambiguous') {
        if (result) throw new Error(`${label} contains multiple terminal results`)
        exactKeys(parsed, ['record', 'moduleId', 'reasonCode', 'detail'], `ambiguous record at ${label}`)
        if (parsed.moduleId !== module) throw new Error(`${label} has the wrong module`)
        if (parsed.reasonCode !== 'ambiguous-obligation') throw new Error(`${label} has an unknown ambiguity reason`)
        result = { outcome: 'AMBIGUOUS', moduleId: module, reasonCode: 'ambiguous-obligation', detail: text(parsed.detail, `${label}.detail`) }
      } else if (parsed.record === 'done') {
        exactKeys(parsed, ['record', 'moduleId'], `done record at ${label}`)
        if (!result) throw new Error(`${label} appears before a result`)
        if (parsed.moduleId !== module) throw new Error(`${label} has the wrong module`)
        doneSeen = true
      } else {
        throw new Error(`${label} has an unknown record type`)
      }
    } catch (error) {
      return { done: false, diagnostic: error instanceof Error ? error.message : `${label} is invalid` }
    }
  }
  if (!result) return { done: false, diagnostic: 'validation stream is missing its result' }
  if (!doneSeen) return { done: false, diagnostic: 'validation stream is missing its final done record' }
  return deepFreeze({ done: true, result })
}

function coverageFor(
  authority: GameIrSemanticObligationValidationAuthority,
  ids: readonly string[],
): readonly GameIrSemanticObligationValidationCoverage[] {
  if (ids.length !== authority.sourceFragments.length)
    throw new Error('PASS coverage must cover the full source exactly once')
  return authority.sourceFragments.map((fragment, index) => {
    if (ids[index] !== fragment.fragmentId)
      throw new Error('PASS coverage must be ordered by full source authority')
    return {
      fragmentId: fragment.fragmentId,
      documentPath: fragment.documentPath,
      sectionId: fragment.sectionId,
      sectionDigest: fragment.sectionDigest,
    }
  })
}

function buildReceipt(
  authority: GameIrSemanticObligationValidationAuthority,
  coverage: readonly GameIrSemanticObligationValidationCoverage[],
): GameIrSemanticObligationValidationReceipt {
  const body = {
    schemaVersion: GAME_IR_SEMANTIC_OBLIGATION_VALIDATION_RECEIPT_SCHEMA_VERSION,
    moduleId: authority.moduleId,
    identities: authority.identities,
    coverage,
  }
  return deepFreeze({ ...body, receiptDigest: digestGameIrValue(body) })
}

function strictArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length'))
    throw new Error(`${label} must be a dense array without custom properties`)
  for (const key of ownKeys) {
    if (key === 'length') continue
    if (typeof key !== 'string' || !/^\d+$/u.test(key))
      throw new Error(`${label} has a symbol or custom property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw new Error(`${label} has a hidden or accessor property`)
  }
  for (let index = 0; index < value.length; index += 1)
    if (!Object.hasOwn(value, String(index))) throw new Error(`${label} must be dense`)
  return value
}

/** Rebuilds a persisted PASS receipt against the current service authority. */
export function normalizeGameIrSemanticObligationValidationReceipt(
  authority: GameIrSemanticObligationValidationAuthority,
  value: unknown,
): GameIrSemanticObligationValidationReceipt {
  if (!isPlainRecord(value)) throw new Error('validation receipt must be a plain object')
  exactKeys(value, ['schemaVersion', 'moduleId', 'identities', 'coverage', 'receiptDigest'], 'validation receipt')
  if (value.schemaVersion !== GAME_IR_SEMANTIC_OBLIGATION_VALIDATION_RECEIPT_SCHEMA_VERSION)
    throw new Error('validation receipt schemaVersion is obsolete or invalid')
  if (value.moduleId !== authority.moduleId)
    throw new Error('validation receipt module identity is stale or relabeled')
  if (!isPlainRecord(value.identities)) throw new Error('validation receipt identities are invalid')
  exactKeys(value.identities, Object.keys(authority.identities), 'validation receipt identities')
  for (const key of Object.keys(authority.identities) as (keyof GameIrSemanticObligationValidationIdentities)[]) {
    if (digest(value.identities[key], `validation receipt identities.${key}`) !== authority.identities[key])
      throw new Error('validation receipt identity is stale or relabeled')
  }
  const rawCoverage = strictArray(value.coverage, 'validation receipt coverage')
  const fragmentIds = rawCoverage.map((raw, index) => {
    if (!isPlainRecord(raw)) throw new Error(`validation receipt coverage[${index}] is invalid`)
    exactKeys(raw, ['fragmentId', 'documentPath', 'sectionId', 'sectionDigest'], `validation receipt coverage[${index}]`)
    return text(raw.fragmentId, `validation receipt coverage[${index}].fragmentId`)
  })
  const expectedCoverage = coverageFor(authority, fragmentIds)
  rawCoverage.forEach((raw, index) => {
    const rawRecord = raw as RecordValue
    const expected = expectedCoverage[index]!
    if (
      rawRecord.documentPath !== expected.documentPath ||
      rawRecord.sectionId !== expected.sectionId ||
      rawRecord.sectionDigest !== expected.sectionDigest
    ) throw new Error('validation receipt coverage evidence is stale or forged')
  })
  const receiptDigest = digest(value.receiptDigest, 'validation receipt digest')
  const body = {
    schemaVersion: GAME_IR_SEMANTIC_OBLIGATION_VALIDATION_RECEIPT_SCHEMA_VERSION,
    moduleId: authority.moduleId,
    identities: authority.identities,
    coverage: expectedCoverage,
  }
  if (receiptDigest !== digestGameIrValue(body))
    throw new Error('validation receipt digest is stale or invalid')
  return deepFreeze({ ...body, receiptDigest })
}

function validateResultKeys(value: RecordValue, outcome: RawValidationResult['outcome']): void {
  if (outcome === 'PASS') exactKeys(value, ['outcome', 'moduleId', 'identities', 'coverage'], 'validation PASS result')
  else if (outcome === 'FAIL') exactKeys(value, ['outcome', 'moduleId', 'reasonCode', 'targetId', 'expectedKind', 'semanticRole', 'fragmentId'], 'validation FAIL result')
  else exactKeys(value, ['outcome', 'moduleId', 'reasonCode', 'detail'], 'validation AMBIGUOUS result')
}

/** Mechanically validates and derives service-owned identities for a parsed result. */
export function admitGameIrSemanticObligationValidationResult(input: {
  authority: GameIrSemanticObligationValidationAuthority
  result: RawValidationResult
}): GameIrSemanticObligationValidationResult {
  if (!isPlainRecord(input.result)) throw new Error('validation result must be a plain object')
  const result = input.result
  if (result.outcome !== 'PASS' && result.outcome !== 'FAIL' && result.outcome !== 'AMBIGUOUS')
    throw new Error('validation result has an unknown outcome')
  validateResultKeys(result, result.outcome)
  if (result.moduleId !== input.authority.moduleId) throw new Error('validation result module is detached')
  if (result.outcome === 'PASS') {
    if (!isPlainRecord(result.identities) || !Array.isArray(result.coverage))
      throw new Error('validation PASS result is invalid')
    const expected = input.authority.identities
    const identities = result.identities as GameIrSemanticObligationValidationIdentities
    exactKeys(identities as unknown as RecordValue, Object.keys(expected), 'validation PASS identities')
    for (const key of Object.keys(expected) as (keyof typeof expected)[])
      if (identities[key] !== expected[key]) throw new Error('validation PASS identity is stale or relabeled')
    const receipt = buildReceipt(
      input.authority,
      coverageFor(input.authority, result.coverage),
    )
    return deepFreeze({ outcome: 'PASS' as const, receipt })
  }
  if (result.outcome === 'AMBIGUOUS')
    return deepFreeze({ outcome: 'AMBIGUOUS' as const, reasonCode: 'ambiguous-obligation' as const, detail: text(result.detail, 'validation ambiguity detail') })

  const targetId = safeId(result.targetId, 'validation missing targetId')
  const expectedKind = safeId(result.expectedKind, 'validation missing expectedKind')
  const contractNode = input.authority.projectionContract.nodes.find(node => node.kind === expectedKind)
  if (!contractNode) throw new Error('validation missing expectedKind is outside projection contract')
  const descriptor = GAME_IR_SEMANTIC_OBLIGATION_MANIFEST[input.authority.moduleId][expectedKind]
  if (!descriptor || result.semanticRole !== descriptor.semanticRole)
    throw new Error('validation missing semantic role is not service-owned')
  const sliceId = ownerSlice(input.authority.moduleId, expectedKind)
  const catalog = catalogFor(input.authority.source)
  const fragment = catalog.fragments.find(candidate => candidate.fragmentId === result.fragmentId)
  if (!fragment) throw new Error('validation missing fragment is outside source catalog')
  if (!selectedFragments(input.authority.source, sliceId, catalog).has(result.fragmentId))
    throw new Error('validation missing fragment is outside owner source authority')
  const obligationId = `${input.authority.moduleId}:${expectedKind}:${targetId}`
  if (input.authority.inventory.obligations.some(obligation => obligation.obligationId === obligationId))
    throw new Error('validation missing obligation is already present in inventory')
  const evidence = {
    fragmentId: fragment.fragmentId,
    documentPath: fragment.documentPath,
    sectionId: fragment.sectionId,
    sectionDigest: sectionDigest(input.authority.source, fragment.documentPath, fragment.sectionId),
  }
  return deepFreeze({
    outcome: 'FAIL',
    reasonCode: 'missing-obligation',
    targetId,
    expectedKind,
    semanticRole: descriptor.semanticRole,
    fragmentId: fragment.fragmentId,
    obligationId,
    ownerSliceId: sliceId,
    evidence,
  })
}

export const buildGameIrSemanticObligationValidationPacket =
  buildGameIrSemanticObligationValidationAuthority

export const validateGameIrSemanticObligationValidationResult =
  admitGameIrSemanticObligationValidationResult
