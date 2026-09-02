import { compareCodeUnits, digestGameIrValue } from './model'
import {
  buildGameIrProjectionContract,
  type GameIrProjectionContract,
} from './projection-contract'
import {
  admitGameIrMechanicalProjectionReceipt,
  normalizeGameIrDomainSemanticPacket,
  type GameIrMechanicalProjectionReceipt,
  type GameIrDomainSemanticPacket,
} from './domain-projection'
import {
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainId,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import { createSemanticFidelityPrimitives } from './semantic-fidelity'

export type OperationTarget = Readonly<{ id: string; kind: string }>
export type DomainProjectionEnvelope<
  TDependencies,
  TSemantic = GameIrDomainSemanticPacket,
  TVersion extends string = string,
> = Readonly<{
  schemaVersion: TVersion
  source: GameIrDomainSourceEnvelope
  semanticPacket: TSemantic
  projectionContract: GameIrProjectionContract
  dependencies: TDependencies
  packetDigest: string
}>
type RecordValue = Record<string, unknown>
const fidelity = createSemanticFidelityPrimitives(
  'invalid Game IR operation packet',
)

export function operationIsRecord(value: unknown): value is RecordValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}
export const operationExactKeys = fidelity.exactKeys

/**
 * Every current isolated projection starts with an empty mechanical receipt.
 * Keeping its canonical construction here lets packet normalizers rebuild the
 * semantic packet instead of trusting a caller-re-signed semantic payload.
 */
export function emptyOperationMechanicalReceipt(
  source: GameIrDomainSourceEnvelope,
): GameIrMechanicalProjectionReceipt {
  const body = {
    schemaVersion: 'game-ir-mechanical-projection-receipt.v1' as const,
    taskId: source.taskId,
    moduleId: source.moduleId,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    sourceDigest: source.sourceDigest,
    nodes: [],
    verifiedClaims: [],
    ownedTargets: [],
  }
  return admitGameIrMechanicalProjectionReceipt({
    source,
    receipt: { ...body, receiptDigest: digestGameIrValue(body) },
  })
}

export function operationTargets(
  value: unknown,
  label: string,
): readonly OperationTarget[] {
  const output = fidelity.strictArray(value, label).map((target, index) => {
    if (!operationIsRecord(target))
      throw new Error(`${label}[${index}] must be a plain object`)
    fidelity.exactKeys(target, ['id', 'kind'], `${label}[${index}]`)
    return Object.freeze({
      id: fidelity.safeId(target.id, `${label}[${index}].id`),
      kind: fidelity.text(target.kind, `${label}[${index}].kind`),
    })
  })
  const ids = new Set<string>()
  for (let index = 1; index < output.length; index += 1)
    if (
      compareCodeUnits(
        `${output[index - 1]!.id}\0${output[index - 1]!.kind}`,
        `${output[index]!.id}\0${output[index]!.kind}`,
      ) >= 0
    )
      throw new Error(`${label} must be unique and sorted`)
  for (const target of output) {
    if (ids.has(target.id))
      throw new Error(`${label} contains a conflicting or duplicate id`)
    ids.add(target.id)
  }
  return Object.freeze(output)
}

export function deriveOperationTargets(
  targets: readonly OperationTarget[],
  label: string,
): readonly OperationTarget[] {
  const byId = new Map<string, string>()
  for (const target of targets) {
    const prior = byId.get(target.id)
    if (prior !== undefined && prior !== target.kind)
      throw new Error(`${label} contains a conflicting target kind`)
    byId.set(target.id, target.kind)
  }
  return operationTargets(
    [...byId]
      .map(([id, kind]) => ({ id, kind }))
      .sort((a, b) =>
        compareCodeUnits(`${a.id}\0${a.kind}`, `${b.id}\0${b.kind}`),
      ),
    label,
  )
}

function normalizedSourceSemantic(
  sourceValue: unknown,
  semanticValue: unknown,
  moduleId: GameIrDomainId,
  label: string,
) {
  const source = validateGameIrDomainSourceEnvelope(sourceValue)
  if (source.moduleId !== moduleId)
    throw new Error(`${label} source moduleId is relabeled`)
  if (!operationIsRecord(semanticValue))
    throw new Error(`${label} semanticPacket must be a plain object`)
  const semanticPacket = normalizeGameIrDomainSemanticPacket(semanticValue, {
    errorPrefix: `invalid ${label}`,
    allowedModuleIds: [moduleId],
  })
  if (
    semanticPacket.taskId !== source.taskId ||
    semanticPacket.foundationRevision !==
      source.compileRequest.foundation.foundationRevision ||
    semanticPacket.sourceDigest !== source.sourceDigest
  )
    throw new Error(`${label} semanticPacket is detached or relabeled`)
  return { source, semanticPacket }
}

export function buildDomainProjectionEnvelope<
  TDependencies,
  TVersion extends string,
>(
  input: Readonly<{
    schemaVersion: TVersion
    moduleId: GameIrDomainId
    source: GameIrDomainSourceEnvelope
    semanticPacket: GameIrDomainSemanticPacket
    dependencies: TDependencies
  }>,
): DomainProjectionEnvelope<TDependencies, GameIrDomainSemanticPacket, TVersion>
export function buildDomainProjectionEnvelope<
  TDependencies,
  TSemantic,
  TVersion extends string,
>(
  input: Readonly<{
    schemaVersion: TVersion
    moduleId: GameIrDomainId
    source: GameIrDomainSourceEnvelope
    semanticPacket: TSemantic
    dependencies: TDependencies
    normalizeSemanticPacket: (
      value: unknown,
      source: GameIrDomainSourceEnvelope,
    ) => TSemantic
  }>,
): DomainProjectionEnvelope<TDependencies, TSemantic, TVersion>
export function buildDomainProjectionEnvelope<
  TDependencies,
  TSemantic = GameIrDomainSemanticPacket,
  TVersion extends string = string,
>(
  input: Readonly<{
    schemaVersion: TVersion
    moduleId: GameIrDomainId
    source: GameIrDomainSourceEnvelope
    semanticPacket: TSemantic
    dependencies: TDependencies
    normalizeSemanticPacket?: (
      value: unknown,
      source: GameIrDomainSourceEnvelope,
    ) => TSemantic
  }>,
): DomainProjectionEnvelope<
  TDependencies,
  GameIrDomainSemanticPacket | TSemantic,
  TVersion
> {
  const source = validateGameIrDomainSourceEnvelope(input.source)
  if (source.moduleId !== input.moduleId)
    throw new Error('operation packet source moduleId is relabeled')
  if (input.normalizeSemanticPacket) {
    const semanticPacket = input.normalizeSemanticPacket(
      input.semanticPacket,
      source,
    )
    const body = {
      schemaVersion: input.schemaVersion,
      source,
      semanticPacket,
      projectionContract: buildGameIrProjectionContract(input.moduleId),
      dependencies: input.dependencies,
    }
    return fidelity.deepFreeze({
      ...body,
      packetDigest: digestGameIrValue(body),
    })
  }
  const semanticPacket = normalizedSourceSemantic(
    source,
    input.semanticPacket,
    input.moduleId,
    'operation packet',
  ).semanticPacket
  const body = {
    schemaVersion: input.schemaVersion,
    source,
    semanticPacket,
    projectionContract: buildGameIrProjectionContract(input.moduleId),
    dependencies: input.dependencies,
  }
  return fidelity.deepFreeze({ ...body, packetDigest: digestGameIrValue(body) })
}

export function normalizeDomainProjectionEnvelope<
  TDependencies,
  TVersion extends string,
>(
  value: unknown,
  spec: Readonly<{
    schemaVersion: TVersion
    moduleId: GameIrDomainId
    label: string
    parseDependencies: (value: unknown) => TDependencies
  }>,
): DomainProjectionEnvelope<TDependencies, GameIrDomainSemanticPacket, TVersion>
export function normalizeDomainProjectionEnvelope<
  TDependencies,
  TSemantic,
  TVersion extends string,
>(
  value: unknown,
  spec: Readonly<{
    schemaVersion: TVersion
    moduleId: GameIrDomainId
    label: string
    parseDependencies: (value: unknown) => TDependencies
    normalizeSemanticPacket: (
      value: unknown,
      source: GameIrDomainSourceEnvelope,
    ) => TSemantic
  }>,
): DomainProjectionEnvelope<TDependencies, TSemantic, TVersion>
export function normalizeDomainProjectionEnvelope<
  TDependencies,
  TSemantic = GameIrDomainSemanticPacket,
  TVersion extends string = string,
>(
  value: unknown,
  spec: Readonly<{
    schemaVersion: TVersion
    moduleId: GameIrDomainId
    label: string
    parseDependencies: (value: unknown) => TDependencies
    normalizeSemanticPacket?: (
      value: unknown,
      source: GameIrDomainSourceEnvelope,
    ) => TSemantic
  }>,
): DomainProjectionEnvelope<
  TDependencies,
  GameIrDomainSemanticPacket | TSemantic,
  TVersion
> {
  if (!operationIsRecord(value)) throw new Error(`invalid ${spec.label}`)
  fidelity.exactKeys(
    value,
    [
      'schemaVersion',
      'source',
      'semanticPacket',
      'projectionContract',
      'dependencies',
      'packetDigest',
    ],
    spec.label,
  )
  if (value.schemaVersion !== spec.schemaVersion)
    throw new Error(`${spec.label} schemaVersion is invalid`)
  const source = validateGameIrDomainSourceEnvelope(value.source)
  const expectedProjectionContract = buildGameIrProjectionContract(
    spec.moduleId,
  )
  if (
    digestGameIrValue(value.projectionContract) !==
    digestGameIrValue(expectedProjectionContract)
  )
    throw new Error(
      `${spec.label} projectionContract is not the schema-owned module contract`,
    )
  const semanticPacket = spec.normalizeSemanticPacket
    ? spec.normalizeSemanticPacket(value.semanticPacket, source)
    : normalizedSourceSemantic(
        source,
        value.semanticPacket,
        spec.moduleId,
        spec.label,
      ).semanticPacket
  if (source.moduleId !== spec.moduleId)
    throw new Error(`${spec.label} source moduleId is relabeled`)
  const dependencies = spec.parseDependencies(value.dependencies)
  const body = {
    schemaVersion: spec.schemaVersion,
    source,
    semanticPacket,
    projectionContract: expectedProjectionContract,
    dependencies,
  }
  const packetDigest = fidelity.sha256(
    value.packetDigest,
    `${spec.label} packetDigest`,
  )
  if (packetDigest !== digestGameIrValue(body))
    throw new Error(`${spec.label} packetDigest is stale or invalid`)
  return fidelity.deepFreeze({ ...body, packetDigest })
}
