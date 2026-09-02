import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  readdir,
} from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { DeliveryRun, GameIrCheckpointRef } from '../types'
import { createRunStore, durableWrite } from '../run-store'
import {
  assembleGameplayBalanceModules,
  type GameplayBalanceAssemblyAuthority,
} from './gameplay-balance-assembler'
import {
  assembleWorldPresentationClosure,
  type WorldPresentationAssemblyAuthority,
} from './world-presentation-assembler'
import {
  assembleResourceRealizationClosure,
  type ResourceRealizationAssemblyAuthority,
} from './resource-realization-assembler'
import {
  assembleImplementationVerificationClosure,
  type ImplementationVerificationAssemblyAuthority,
} from './implementation-verification-assembler'
import {
  canonicalGameIrJson,
  digestGameIrValue,
  type GameIrSourceSection,
} from './model'
import {
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'

export const GAME_IR_CHECKPOINT_SCHEMA_VERSION =
  'game-ir-stage-checkpoint.v48' as const
export const GAME_IR_RECORD_SCHEMA_VERSION = 'game-ir-stage-record.v48' as const
export const GAME_IR_CHECKPOINT_PHASES = Object.freeze([
  'phase4',
  'phase5',
  'phase6',
  'phase7',
] as const)
export type GameIrCheckpointPhase = (typeof GAME_IR_CHECKPOINT_PHASES)[number]
export const GAME_IR_CHECKPOINT_RECORD_KINDS = Object.freeze([
  'phase4/gameplay/source',
  'phase4/gameplay/mechanical',
  'phase4/gameplay/semantic',
  'phase4/balance/source',
  'phase4/balance/mechanical',
  'phase4/balance/semantic',
  'phase5/world-scene/source',
  'phase5/world-scene/mechanical',
  'phase5/world-scene/semantic',
  'phase5/world-scene/validation',
  'phase5/presentation/source',
  'phase5/presentation/mechanical',
  'phase5/presentation/semantic',
  'phase5/presentation/validation',
  'phase6/resource-realization/source',
  'phase6/resource-realization/mechanical',
  'phase6/resource-realization/semantic',
  'phase6/resource-realization/validation',
  'phase7/implementation-verification/source',
  'phase7/implementation-verification/mechanical',
  'phase7/implementation-verification/semantic',
  'phase7/implementation-verification/validation',
] as const)
export type GameIrCheckpointRecordKind =
  (typeof GAME_IR_CHECKPOINT_RECORD_KINDS)[number]
export type GameIrCheckpointRecord = Readonly<{
  kind: GameIrCheckpointRecordKind
  record: unknown
}>
export const GAME_IR_PROTOCOL_STEPS = Object.freeze([
  'phase4/gameplay/projection',
  'phase4/balance/projection',
  'phase5/world-scene/projection',
  'phase5/world-scene/validation',
  'phase5/presentation/projection',
  'phase5/presentation/validation',
  'phase6/resource-realization/projection',
  'phase6/resource-realization/validation',
  'phase7/implementation-verification/projection',
  'phase7/implementation-verification/validation',
] as const)
export type GameIrProtocolStep = (typeof GAME_IR_PROTOCOL_STEPS)[number]
export type GameIrCheckpointDomain =
  | 'gameplay'
  | 'balance'
  | 'world-scene'
  | 'presentation'
  | 'resource-realization'
  | 'implementation-verification'
export type GameIrCheckpointOperation = 'projection' | 'validation'
export type GameIrCheckpointStep = Readonly<{
  phase: GameIrCheckpointPhase
  domain: GameIrCheckpointDomain
  operation: GameIrCheckpointOperation
  records: readonly GameIrCheckpointRecord[]
}>
export type GameIrReplayAuthority = Readonly<{
  phase4Authority: GameplayBalanceAssemblyAuthority
  phase5Authority?: WorldPresentationAssemblyAuthority
  phase6Authority?: ResourceRealizationAssemblyAuthority
  phase7Authority?: ImplementationVerificationAssemblyAuthority
  checkpoint: GameIrCheckpointRef
}>

type Identity = Readonly<{
  runId: string
  taskId: string
  publicationId: string
  confirmedBriefDigest: string
  foundationRevision: string
  foundationReadyReceiptDigest: string
}>
type RecordEnvelope = Readonly<{
  schemaVersion: typeof GAME_IR_RECORD_SCHEMA_VERSION
  kind: GameIrCheckpointRecordKind
  phase: GameIrCheckpointPhase
  moduleId: string
  taskId: string
  foundationRevision: string
  foundationReadyReceiptDigest: string
  compileRequestDigest: string
  authoritySectionIndexDigest: string
  authorityDigest: string
  priorClosureDigest?: string
  record: unknown
}>
type RecordRef = Readonly<{
  kind: GameIrCheckpointRecordKind
  path: string
  digest: string
  canonicalLength: number
}>
type ClosureIdentity = Readonly<{
  runId: string
  taskId: string
  publicationId: string
  phase: GameIrCheckpointPhase
  compileRequestDigest: string
  foundationRevision: string
  foundationReadyReceiptDigest: string
  authoritySectionIndexDigest: string
}>
type ClosureSeal = Readonly<{
  phase: GameIrCheckpointPhase
  step: GameIrProtocolStep
  identity: ClosureIdentity
  recordRefs: readonly RecordRef[]
  closureDigest: string
}>
type Manifest = Readonly<{
  schemaVersion: typeof GAME_IR_CHECKPOINT_SCHEMA_VERSION
  step: GameIrProtocolStep
  phase: GameIrCheckpointPhase
  domain: GameIrCheckpointDomain
  operation: GameIrCheckpointOperation
  identity: Identity
  compileRequestDigest: string
  foundationReadyBinding: Readonly<{
    foundationRevision: string
    receiptDigest: string
  }>
  authoritySectionIndex: readonly GameIrSourceSection[]
  records: readonly RecordRef[]
  previousManifestPath?: string
  previousManifestDigest?: string
  closure?: ClosureSeal
  manifestDigest: string
}>
type ClosedCheckpointLoad = Readonly<{
  status: 'closed'
  checkpoint: GameIrCheckpointRef
  step: GameIrProtocolStep
  nextStep?: GameIrProtocolStep
  phase: GameIrCheckpointPhase
  records: ReadonlyMap<GameIrCheckpointRecordKind, unknown>
  authority: GameIrReplayAuthority
  closureDigest: string
}>

const SHA256 = /^[a-f0-9]{64}$/u
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const RECORD_SET = new Set<string>(GAME_IR_CHECKPOINT_RECORD_KINDS)
const DESCRIPTORS: Readonly<
  Record<
    GameIrProtocolStep,
    Readonly<{
      phase: GameIrCheckpointPhase
      domain: GameIrCheckpointDomain
      operation: GameIrCheckpointOperation
      kinds: readonly GameIrCheckpointRecordKind[]
      closes?: GameIrCheckpointPhase
    }>
  >
> = {
  'phase4/gameplay/projection': {
    phase: 'phase4',
    domain: 'gameplay',
    operation: 'projection',
    kinds: GAME_IR_CHECKPOINT_RECORD_KINDS.slice(0, 3),
  },
  'phase4/balance/projection': {
    phase: 'phase4',
    domain: 'balance',
    operation: 'projection',
    kinds: GAME_IR_CHECKPOINT_RECORD_KINDS.slice(3, 6),
    closes: 'phase4',
  },
  'phase5/world-scene/projection': {
    phase: 'phase5',
    domain: 'world-scene',
    operation: 'projection',
    kinds: GAME_IR_CHECKPOINT_RECORD_KINDS.slice(6, 9),
  },
  'phase5/world-scene/validation': {
    phase: 'phase5',
    domain: 'world-scene',
    operation: 'validation',
    kinds: [GAME_IR_CHECKPOINT_RECORD_KINDS[9]],
  },
  'phase5/presentation/projection': {
    phase: 'phase5',
    domain: 'presentation',
    operation: 'projection',
    kinds: GAME_IR_CHECKPOINT_RECORD_KINDS.slice(10, 13),
  },
  'phase5/presentation/validation': {
    phase: 'phase5',
    domain: 'presentation',
    operation: 'validation',
    kinds: [GAME_IR_CHECKPOINT_RECORD_KINDS[13]],
    closes: 'phase5',
  },
  'phase6/resource-realization/projection': {
    phase: 'phase6',
    domain: 'resource-realization',
    operation: 'projection',
    kinds: GAME_IR_CHECKPOINT_RECORD_KINDS.slice(14, 17),
  },
  'phase6/resource-realization/validation': {
    phase: 'phase6',
    domain: 'resource-realization',
    operation: 'validation',
    kinds: [GAME_IR_CHECKPOINT_RECORD_KINDS[17]],
    closes: 'phase6',
  },
  'phase7/implementation-verification/projection': {
    phase: 'phase7',
    domain: 'implementation-verification',
    operation: 'projection',
    kinds: GAME_IR_CHECKPOINT_RECORD_KINDS.slice(18, 21),
  },
  'phase7/implementation-verification/validation': {
    phase: 'phase7',
    domain: 'implementation-verification',
    operation: 'validation',
    kinds: [GAME_IR_CHECKPOINT_RECORD_KINDS[21]],
    closes: 'phase7',
  },
}

export type GameIrCheckpointLoad =
  | Readonly<{
      status: 'partial'
      checkpoint: GameIrCheckpointRef
      step: GameIrProtocolStep
      nextStep: GameIrProtocolStep
      records: ReadonlyMap<GameIrCheckpointRecordKind, unknown>
    }>
  | ClosedCheckpointLoad

function fail(message: string): never {
  throw new Error(`invalid Game IR stage checkpoint: ${message}`)
}
function sha(bytes: string): string {
  return createHash('sha256').update(bytes, 'utf8').digest('hex')
}
function json(value: unknown): string {
  return `${canonicalGameIrJson(value)}\n`
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (
    keys.length !== wanted.length ||
    keys.some((key, index) => key !== wanted[index])
  )
    fail(`${label} has unknown or missing fields`)
}
function safeRelative(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.split('/').some(part => !part || part === '.' || part === '..')
  )
    fail(`${label} is not a safe relative path`)
}
function digest(value: unknown): string {
  return digestGameIrValue(value)
}
function phaseForKind(kind: GameIrCheckpointRecordKind): GameIrCheckpointPhase {
  return kind.slice(0, 6) as GameIrCheckpointPhase
}
function sourceOf(value: unknown): GameIrDomainSourceEnvelope | undefined {
  if (!isRecord(value) || value.schemaVersion !== 'game-ir-domain-source.v1')
    return undefined
  return validateGameIrDomainSourceEnvelope(value)
}
function moduleForKind(kind: GameIrCheckpointRecordKind): string {
  return kind.split('/')[1]!
}
function descriptorFor(step: GameIrCheckpointStep): {
  id: GameIrProtocolStep
  descriptor: (typeof DESCRIPTORS)[GameIrProtocolStep]
} {
  if (
    !isRecord(step) ||
    typeof step.phase !== 'string' ||
    typeof step.domain !== 'string' ||
    typeof step.operation !== 'string' ||
    !Array.isArray(step.records)
  )
    fail('checkpoint step is invalid')
  const id =
    `${step.phase}/${step.domain}/${step.operation}` as GameIrProtocolStep
  const descriptor = DESCRIPTORS[id]
  if (
    !descriptor ||
    descriptor.phase !== step.phase ||
    descriptor.domain !== step.domain ||
    descriptor.operation !== step.operation
  )
    fail('checkpoint operation is not in the fixed protocol')
  return { id, descriptor }
}
function normalizeClosure(
  value: unknown,
  descriptor: (typeof DESCRIPTORS)[GameIrProtocolStep],
): ClosureSeal {
  if (!descriptor.closes || !isRecord(value)) fail('closure seal is missing')
  exactKeys(
    value,
    ['phase', 'step', 'identity', 'recordRefs', 'closureDigest'],
    'closure seal',
  )
  const expectedStep = `${descriptor.phase}/${descriptor.domain}/${descriptor.operation}`
  if (
    value.phase !== descriptor.closes ||
    value.step !== expectedStep ||
    !Array.isArray(value.recordRefs) ||
    typeof value.closureDigest !== 'string' ||
    !SHA256.test(value.closureDigest)
  )
    fail('closure seal discriminant or digest is invalid')
  if (!isRecord(value.identity)) fail('closure identity is invalid')
  exactKeys(
    value.identity,
    [
      'runId',
      'taskId',
      'publicationId',
      'phase',
      'compileRequestDigest',
      'foundationRevision',
      'foundationReadyReceiptDigest',
      'authoritySectionIndexDigest',
    ],
    'closure identity',
  )
  const refs = value.recordRefs
  for (const ref of refs) {
    if (!isRecord(ref)) fail('closure record reference is invalid')
    exactKeys(
      ref,
      ['kind', 'path', 'digest', 'canonicalLength'],
      'closure record reference',
    )
    if (
      typeof ref.kind !== 'string' ||
      !RECORD_SET.has(ref.kind) ||
      typeof ref.digest !== 'string' ||
      !SHA256.test(ref.digest) ||
      typeof ref.canonicalLength !== 'number' ||
      !Number.isInteger(ref.canonicalLength) ||
      ref.canonicalLength < 0
    )
      fail('closure record reference is invalid')
    safeRelative(ref.path, 'closure record path')
  }
  return value as ClosureSeal
}
function normalizeManifest(value: unknown): Manifest {
  if (!isRecord(value)) fail('manifest is not an object')
  const step = value.step as GameIrProtocolStep
  const descriptor = DESCRIPTORS[step]
  if (!descriptor) {
    if (
      value.schemaVersion === 'game-ir-stage-checkpoint.v46' ||
      value.schemaVersion === 'game-ir-stage-record.v46'
    )
      fail('obsolete v46 checkpoint protocol')
    fail('unknown protocol step')
  }
  const hasPrevious = GAME_IR_PROTOCOL_STEPS.indexOf(step) > 0
  const expected = [
    'schemaVersion',
    'step',
    'phase',
    'domain',
    'operation',
    'identity',
    'compileRequestDigest',
    'foundationReadyBinding',
    'authoritySectionIndex',
    'records',
    ...(hasPrevious ? ['previousManifestPath', 'previousManifestDigest'] : []),
    ...(descriptor.closes ? ['closure'] : []),
    'manifestDigest',
  ]
  exactKeys(value, expected, 'manifest')
  if (
    value.schemaVersion !== GAME_IR_CHECKPOINT_SCHEMA_VERSION ||
    value.phase !== descriptor.phase ||
    value.domain !== descriptor.domain ||
    value.operation !== descriptor.operation
  )
    fail('manifest schema or operation is invalid')
  if (
    !isRecord(value.identity) ||
    !isRecord(value.foundationReadyBinding) ||
    !Array.isArray(value.authoritySectionIndex) ||
    !Array.isArray(value.records)
  )
    fail('manifest shape is invalid')
  const identityKeys = [
    'runId',
    'taskId',
    'publicationId',
    'confirmedBriefDigest',
    'foundationRevision',
    'foundationReadyReceiptDigest',
  ] as const
  exactKeys(value.identity, identityKeys, 'manifest identity')
  for (const key of identityKeys)
    if (
      typeof value.identity[key] !== 'string' ||
      (key.endsWith('Digest') && !SHA256.test(value.identity[key] as string))
    )
      fail('manifest identity is invalid')
  exactKeys(
    value.foundationReadyBinding,
    ['foundationRevision', 'receiptDigest'],
    'manifest Foundation binding',
  )
  if (
    value.foundationReadyBinding.foundationRevision !==
      value.identity.foundationRevision ||
    value.foundationReadyBinding.receiptDigest !==
      value.identity.foundationReadyReceiptDigest
  )
    fail('manifest Foundation binding mismatch')
  if (
    typeof value.compileRequestDigest !== 'string' ||
    !SHA256.test(value.compileRequestDigest) ||
    typeof value.manifestDigest !== 'string' ||
    !SHA256.test(value.manifestDigest)
  )
    fail('manifest digest is invalid')
  if (hasPrevious) {
    safeRelative(value.previousManifestPath, 'previousManifestPath')
    if (
      typeof value.previousManifestDigest !== 'string' ||
      !SHA256.test(value.previousManifestDigest)
    )
      fail('previous manifest reference is invalid')
  } else if (
    'previousManifestPath' in value ||
    'previousManifestDigest' in value
  )
    fail('first protocol step cannot contain a predecessor')
  const refs: RecordRef[] = []
  const seen = new Set<string>()
  for (const raw of value.records) {
    if (!isRecord(raw)) fail('record reference is invalid')
    exactKeys(
      raw,
      ['kind', 'path', 'digest', 'canonicalLength'],
      'record reference',
    )
    if (
      typeof raw.kind !== 'string' ||
      !RECORD_SET.has(raw.kind) ||
      seen.has(raw.kind) ||
      !descriptor.kinds.includes(raw.kind as GameIrCheckpointRecordKind)
    )
      fail('record kind is unknown, out of scope, or duplicated')
    safeRelative(raw.path, 'record path')
    if (
      typeof raw.digest !== 'string' ||
      !SHA256.test(raw.digest) ||
      typeof raw.canonicalLength !== 'number' ||
      !Number.isInteger(raw.canonicalLength) ||
      raw.canonicalLength < 0
    )
      fail('record reference digest or length is invalid')
    seen.add(raw.kind)
    refs.push(raw as RecordRef)
  }
  if (
    refs.length !== descriptor.kinds.length ||
    refs.some((ref, index) => ref.kind !== descriptor.kinds[index])
  )
    fail('manifest records are not the exact operation record set')
  if (descriptor.closes) normalizeClosure(value.closure, descriptor)
  const body = { ...value }
  delete body.manifestDigest
  if (digest(body) !== value.manifestDigest) fail('manifest digest mismatch')
  return value as Manifest
}
function stageRoot(workspacePath: string, runId: string): string {
  if (!SAFE_ID.test(runId)) fail('runId is not a safe path segment')
  return join(
    resolve(workspacePath),
    '.beegame',
    'ir',
    'runs',
    runId,
    'checkpoints',
  )
}
function inside(root: string, path: string): boolean {
  const value = relative(root, path)
  return value !== '..' && !value.startsWith(`..${sep}`) && value !== ''
}
async function componentsSafe(root: string, target: string): Promise<void> {
  const rootBase = resolve(root)
  const absolute = resolve(target)
  const rel = relative(rootBase, absolute)
  if (rel.startsWith('..') || rel.includes(`..${sep}`))
    fail('checkpoint path escapes root')
  let current = rootBase
  for (const part of rel.split(sep).filter(Boolean)) {
    current = join(current, part)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink() || !info.isDirectory())
        fail('checkpoint path contains symlink or non-directory component')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      break
    }
  }
}
async function regularPath(
  root: string,
  path: string,
  label: string,
): Promise<void> {
  let rootReal: string
  let targetReal: string
  try {
    rootReal = await realpath(root)
    const rootInfo = await lstat(root)
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
      fail(`${label} root is not a directory`)
    await componentsSafe(root, dirname(path))
    targetReal = await realpath(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error
    if (
      error instanceof Error &&
      error.message.startsWith('invalid Game IR stage checkpoint:')
    )
      throw error
    fail(`${label} cannot be resolved`)
  }
  if (!targetReal.startsWith(`${rootReal}${sep}`))
    fail(`${label} escapes checkpoint root`)
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile())
    fail(`${label} is not a regular file`)
}
async function safeReadFile(path: string): Promise<string> {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  )
  try {
    const info = await handle.stat()
    if (!info.isFile()) fail('checkpoint path is not a regular file')
    return await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
}
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
async function assertWorkspace(path: string): Promise<void> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory())
    fail('workspace is not a real directory')
}

type CheckpointChain = Readonly<{
  manifests: readonly Manifest[]
  records: ReadonlyMap<GameIrCheckpointRecordKind, RecordEnvelope>
  ref: GameIrCheckpointRef
  identity: Identity
  compileRequestDigest: string
  sections: readonly GameIrSourceSection[]
}>
function checkpointDescriptor(
  step: GameIrProtocolStep,
): (typeof DESCRIPTORS)[GameIrProtocolStep] {
  const descriptor = DESCRIPTORS[step]
  if (!descriptor) fail('unknown protocol step')
  return descriptor
}
function checkpointExpectedPath(root: string, step: GameIrProtocolStep): string {
  const descriptor = checkpointDescriptor(step)
  return join(
    root,
    descriptor.phase,
    descriptor.domain,
    descriptor.operation,
    'manifest.json',
  )
}
async function checkpointFuturePath(
  root: string,
  after: number,
): Promise<string | undefined> {
  for (const step of GAME_IR_PROTOCOL_STEPS.slice(after + 1)) {
    const path = checkpointExpectedPath(root, step)
    try {
      await componentsSafe(root, dirname(path))
      await lstat(path)
      return path
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return undefined
}
function checkpointSource(
  records: ReadonlyMap<GameIrCheckpointRecordKind, RecordEnvelope>,
): GameIrDomainSourceEnvelope | undefined {
  for (const value of records.values()) {
    const source = sourceOf(value.record)
    if (source) return source
  }
  return undefined
}
function phase4AuthorityFromRecords(
  records: ReadonlyMap<GameIrCheckpointRecordKind, RecordEnvelope>,
): GameplayBalanceAssemblyAuthority {
  const get = (kind: GameIrCheckpointRecordKind) => {
    const value = records.get(kind)
    if (!value) fail(`missing ${kind}`)
    return value.record
  }
  return {
    gameplay: {
      source: get('phase4/gameplay/source') as GameIrDomainSourceEnvelope,
      mechanical: get(
        'phase4/gameplay/mechanical',
      ) as GameplayBalanceAssemblyAuthority['gameplay']['mechanical'],
      semantic: get(
        'phase4/gameplay/semantic',
      ) as GameplayBalanceAssemblyAuthority['gameplay']['semantic'],
    },
    balance: {
      source: get('phase4/balance/source') as GameIrDomainSourceEnvelope,
      mechanical: get(
        'phase4/balance/mechanical',
      ) as GameplayBalanceAssemblyAuthority['balance']['mechanical'],
      semantic: get(
        'phase4/balance/semantic',
      ) as GameplayBalanceAssemblyAuthority['balance']['semantic'],
    },
  }
}
function phase5AuthorityFromRecords(
  records: ReadonlyMap<GameIrCheckpointRecordKind, RecordEnvelope>,
  phase4Authority: GameplayBalanceAssemblyAuthority,
): WorldPresentationAssemblyAuthority {
  const get = (kind: GameIrCheckpointRecordKind) => {
    const value = records.get(kind)
    if (!value) fail(`missing ${kind}`)
    return value.record
  }
  return {
    phase4Authority,
    worldScene: {
      source: get('phase5/world-scene/source') as GameIrDomainSourceEnvelope,
      mechanical: get(
        'phase5/world-scene/mechanical',
      ) as WorldPresentationAssemblyAuthority['worldScene']['mechanical'],
      semantic: get(
        'phase5/world-scene/semantic',
      ) as WorldPresentationAssemblyAuthority['worldScene']['semantic'],
      validation: get(
        'phase5/world-scene/validation',
      ) as WorldPresentationAssemblyAuthority['worldScene']['validation'],
    },
    presentation: {
      source: get('phase5/presentation/source') as GameIrDomainSourceEnvelope,
      mechanical: get(
        'phase5/presentation/mechanical',
      ) as WorldPresentationAssemblyAuthority['presentation']['mechanical'],
      semantic: get(
        'phase5/presentation/semantic',
      ) as WorldPresentationAssemblyAuthority['presentation']['semantic'],
      validation: get(
        'phase5/presentation/validation',
      ) as WorldPresentationAssemblyAuthority['presentation']['validation'],
    },
  }
}
function phase6AuthorityFromRecords(
  records: ReadonlyMap<GameIrCheckpointRecordKind, RecordEnvelope>,
  phase5Authority: WorldPresentationAssemblyAuthority,
): ResourceRealizationAssemblyAuthority {
  const get = (kind: GameIrCheckpointRecordKind) => {
    const value = records.get(kind)
    if (!value) fail(`missing ${kind}`)
    return value.record
  }
  return {
    phase5Authority,
    resourceRealization: {
      source: get(
        'phase6/resource-realization/source',
      ) as GameIrDomainSourceEnvelope,
      mechanical: get(
        'phase6/resource-realization/mechanical',
      ) as ResourceRealizationAssemblyAuthority['resourceRealization']['mechanical'],
      semantic: get(
        'phase6/resource-realization/semantic',
      ) as ResourceRealizationAssemblyAuthority['resourceRealization']['semantic'],
      validation: get(
        'phase6/resource-realization/validation',
      ) as ResourceRealizationAssemblyAuthority['resourceRealization']['validation'],
    },
  }
}
function phase7AuthorityFromRecords(
  records: ReadonlyMap<GameIrCheckpointRecordKind, RecordEnvelope>,
  phase6Authority: ResourceRealizationAssemblyAuthority,
): ImplementationVerificationAssemblyAuthority {
  const get = (kind: GameIrCheckpointRecordKind) => {
    const value = records.get(kind)
    if (!value) fail(`missing ${kind}`)
    return value.record
  }
  return {
    phase6Authority,
    implementationVerification: {
      source: get(
        'phase7/implementation-verification/source',
      ) as GameIrDomainSourceEnvelope,
      mechanical: get(
        'phase7/implementation-verification/mechanical',
      ) as ImplementationVerificationAssemblyAuthority['implementationVerification']['mechanical'],
      semantic: get(
        'phase7/implementation-verification/semantic',
      ) as ImplementationVerificationAssemblyAuthority['implementationVerification']['semantic'],
      validation: get(
        'phase7/implementation-verification/validation',
      ) as ImplementationVerificationAssemblyAuthority['implementationVerification']['validation'],
    },
  }
}
function checkpointClosure(
  chain: CheckpointChain,
  descriptor: (typeof DESCRIPTORS)[GameIrProtocolStep],
): { authority: GameIrReplayAuthority; closureDigest: string } {
  if (!descriptor.closes) fail('operation has no closure')
  const phase4Authority = phase4AuthorityFromRecords(chain.records)
  const base: GameIrReplayAuthority = { phase4Authority, checkpoint: chain.ref }
  if (descriptor.closes === 'phase4')
    return {
      authority: base,
      closureDigest: digest(assembleGameplayBalanceModules(phase4Authority)),
    }
  const phase5Authority = phase5AuthorityFromRecords(chain.records, phase4Authority)
  const with5 = { ...base, phase5Authority }
  if (descriptor.closes === 'phase5')
    return {
      authority: with5,
      closureDigest: digest(assembleWorldPresentationClosure(phase5Authority)),
    }
  const phase6Authority = phase6AuthorityFromRecords(chain.records, phase5Authority)
  const with6 = { ...with5, phase6Authority }
  if (descriptor.closes === 'phase6')
    return {
      authority: with6,
      closureDigest: digest(
        assembleResourceRealizationClosure(phase6Authority),
      ),
    }
  const phase7Authority = phase7AuthorityFromRecords(chain.records, phase6Authority)
  return {
    authority: { ...with6, phase7Authority },
    closureDigest: digest(
      assembleImplementationVerificationClosure(phase7Authority),
    ),
  }
}
async function readCheckpointManifest(
  path: string,
  root: string,
): Promise<{ manifest: Manifest; bytes: string }> {
  await regularPath(root, path, 'manifest')
  const bytes = await safeReadFile(path)
  return { manifest: normalizeManifest(JSON.parse(bytes)), bytes }
}
async function assertCheckpointTree(
  path: string,
  descriptor: (typeof DESCRIPTORS)[GameIrProtocolStep],
): Promise<void> {
  const entries = (await readdir(path)).sort()
  if (entries.join('\0') !== 'manifest.json\0records')
    fail('deterministic final checkpoint tree contains unexpected entries')
  const actual = (await readdir(join(path, 'records'))).sort()
  const expected = descriptor.kinds
    .map(kind => `${kind.replaceAll('/', '__')}.json`)
    .sort()
  if (actual.join('\0') !== expected.join('\0'))
    fail('deterministic final checkpoint records contain unexpected entries')
}
async function readCheckpointChain(input: {
  workspacePath: string
  deliveryRun: DeliveryRun
  ref: GameIrCheckpointRef
}): Promise<CheckpointChain> {
  const state = input.deliveryRun.gameIrState
  if (!state) fail('DeliveryRun has no Game IR state')
  safeRelative(input.ref.checkpointPath, 'checkpointPath')
  const root = stageRoot(input.workspacePath, input.deliveryRun.runId)
  await componentsSafe(resolve(input.workspacePath), root)
  let path = resolve(input.workspacePath, input.ref.checkpointPath)
  if (!inside(root, path) || !path.endsWith(`${sep}manifest.json`))
    fail('checkpoint pointer is outside run-scoped checkpoint root')
  const manifests: Manifest[] = []
  const records = new Map<GameIrCheckpointRecordKind, RecordEnvelope>()
  let expectedDigest = input.ref.checkpointDigest
  while (true) {
    const current = await readCheckpointManifest(path, root)
    if (sha(current.bytes) !== expectedDigest)
      fail('checkpoint manifest digest mismatch')
    const descriptor = checkpointDescriptor(current.manifest.step!)
    const expectedPath = checkpointExpectedPath(root, current.manifest.step!)
    if (path !== expectedPath)
      fail('manifest is not at deterministic protocol path')
    await assertCheckpointTree(dirname(path), descriptor)
    for (const recordRef of current.manifest.records) {
      const recordPath = resolve(input.workspacePath, recordRef.path)
      const expectedRecordPath = join(
        root,
        descriptor.phase,
        descriptor.domain,
        descriptor.operation,
        'records',
        `${recordRef.kind.replaceAll('/', '__')}.json`,
      )
      if (recordPath !== expectedRecordPath || !inside(root, recordPath))
        fail('record is outside deterministic path')
      await regularPath(root, recordPath, 'record')
      const recordBytes = await safeReadFile(recordPath)
      if (
        sha(recordBytes) !== recordRef.digest ||
        Buffer.byteLength(recordBytes, 'utf8') !== recordRef.canonicalLength
      )
        fail('record digest or canonical length mismatch')
      const value = JSON.parse(recordBytes)
      if (!isRecord(value)) fail('record is not an object')
      const expectedKeys = [
        'schemaVersion',
        'kind',
        'phase',
        'moduleId',
        'taskId',
        'foundationRevision',
        'foundationReadyReceiptDigest',
        'compileRequestDigest',
        'authoritySectionIndexDigest',
        'authorityDigest',
        'record',
      ]
      if ('priorClosureDigest' in value) expectedKeys.push('priorClosureDigest')
      exactKeys(value, expectedKeys, 'record')
      if (
        value.schemaVersion !== GAME_IR_RECORD_SCHEMA_VERSION ||
        value.kind !== recordRef.kind ||
        value.phase !== descriptor.phase ||
        records.has(recordRef.kind as GameIrCheckpointRecordKind)
      )
        fail('record schema, kind, phase, or uniqueness is invalid')
      records.set(
        recordRef.kind as GameIrCheckpointRecordKind,
        value as RecordEnvelope,
      )
    }
    manifests.unshift(current.manifest)
    if (current.manifest.step === GAME_IR_PROTOCOL_STEPS[0]) break
    const index = GAME_IR_PROTOCOL_STEPS.indexOf(current.manifest.step!)
    const previousStep = GAME_IR_PROTOCOL_STEPS[index - 1]!
    const previousPath = resolve(
      input.workspacePath,
      current.manifest.previousManifestPath!,
    )
    if (
      previousPath !== checkpointExpectedPath(root, previousStep) ||
      !inside(root, previousPath)
    )
      fail('previous manifest path is not the immediate predecessor')
    path = previousPath
    expectedDigest = current.manifest.previousManifestDigest!
  }
  const identity = manifests[0]!.identity
  const compileRequestDigest = manifests[0]!.compileRequestDigest
  const sections = manifests[0]!.authoritySectionIndex
  const stateIdentity = state.identity
  if (
    identity.runId !== input.deliveryRun.runId ||
    identity.taskId !== stateIdentity.taskId ||
    identity.publicationId !== stateIdentity.publicationId ||
    identity.confirmedBriefDigest !== stateIdentity.confirmedBriefDigest ||
    identity.foundationRevision !== stateIdentity.foundationRevision ||
    identity.foundationReadyReceiptDigest !==
      stateIdentity.foundationReadyReceiptDigest
  )
    fail('checkpoint identity does not match DeliveryRun')
  for (let index = 0; index < manifests.length; index += 1) {
    const manifest = manifests[index]!
    if (manifest.step !== GAME_IR_PROTOCOL_STEPS[index])
      fail('checkpoint chain is not the canonical prefix')
    if (
      digest(manifest.identity) !== digest(identity) ||
      manifest.compileRequestDigest !== compileRequestDigest ||
      digest(manifest.authoritySectionIndex) !== digest(sections)
    )
      fail('checkpoint identity or Section Index mismatch')
  }
  for (const [kind, record] of records) {
    if (
      record.taskId !== identity.taskId ||
      record.phase !== phaseForKind(kind) ||
      record.moduleId !== moduleForKind(kind) ||
      record.foundationRevision !== identity.foundationRevision ||
      record.foundationReadyReceiptDigest !==
        identity.foundationReadyReceiptDigest ||
      record.compileRequestDigest !== compileRequestDigest ||
      record.authoritySectionIndexDigest !== digest(sections) ||
      record.authorityDigest !== digest(record.record)
    )
      fail('record authority binding mismatch')
    if (kind.endsWith('/source')) {
      const source = sourceOf(record.record)
      if (!source) fail('source record is not a valid source envelope')
      if (
        digest(source.compileRequest) !== compileRequestDigest ||
        digest(source.authoritySectionIndex) !== digest(sections)
      )
        fail('source binding mismatch')
    }
  }
  for (const manifest of manifests) {
    const index = GAME_IR_PROTOCOL_STEPS.indexOf(manifest.step!)
    const priorClosure =
      index > 0
        ? manifests
            .slice(0, index)
            .reverse()
            .find(item => item.closure)?.closure?.closureDigest
        : undefined
    for (const kind of checkpointDescriptor(manifest.step!).kinds) {
      const record = records.get(kind)!
      if (
        manifest.phase === 'phase4'
          ? 'priorClosureDigest' in record
          : record.priorClosureDigest !== priorClosure
      )
        fail('prior closure digest mismatch')
    }
    if (manifest.closure) {
      const prefixRecords = new Map<
        GameIrCheckpointRecordKind,
        RecordEnvelope
      >()
      for (const prefixManifest of manifests.slice(0, index + 1))
        for (const recordRef of prefixManifest.records)
          prefixRecords.set(recordRef.kind, records.get(recordRef.kind)!)
      const prefix: CheckpointChain = {
        manifests: manifests.slice(0, index + 1),
        records: prefixRecords,
        ref: input.ref,
        identity,
        compileRequestDigest,
        sections,
      }
      const closed = checkpointClosure(prefix, checkpointDescriptor(manifest.step!))
      if (
        manifest.closure.closureDigest !== closed.closureDigest ||
        digest(manifest.closure.identity) !==
          digest(checkpointClosureIdentity(prefix, manifest.closure.phase)) ||
        digest(manifest.closure.recordRefs) !==
          digest(prefix.manifests.flatMap(item => item.records))
      )
        fail('closure seal does not match its canonical prefix')
    }
  }
  for (const [kind, record] of records) {
    if (!kind.endsWith('/source')) continue
    const source = sourceOf(record.record)
    if (
      !source ||
      source.taskId !== identity.taskId ||
      source.compileRequest.taskId !== identity.taskId ||
      source.compileRequest.publicationId !== identity.publicationId ||
      source.compileRequest.foundation.confirmedBriefDigest !==
        identity.confirmedBriefDigest ||
      source.compileRequest.foundation.foundationRevision !==
        identity.foundationRevision ||
      source.compileRequest.foundation.receiptDigest !==
        identity.foundationReadyReceiptDigest
    )
      fail('source identity is detached from DeliveryRun')
  }
  return {
    manifests,
    records,
    ref: input.ref,
    identity,
    compileRequestDigest,
    sections,
  }
}
function checkpointIdentity(
  run: DeliveryRun,
  source: GameIrDomainSourceEnvelope,
  compileRequestDigest: string,
): { identity: Identity; sections: readonly GameIrSourceSection[] } {
  const state = run.gameIrState
  if (
    !state ||
    state.status !== 'compiling' ||
    run.phase !== 'GAME_IR_COMPILATION'
  )
    fail('checkpoint writes require the compiling Game IR phase')
  const identity: Identity = {
    runId: run.runId,
    taskId: state.identity.taskId,
    publicationId: state.identity.publicationId,
    confirmedBriefDigest: state.identity.confirmedBriefDigest,
    foundationRevision: state.identity.foundationRevision,
    foundationReadyReceiptDigest: state.identity.foundationReadyReceiptDigest,
  }
  if (
    source.taskId !== identity.taskId ||
    source.compileRequest.taskId !== identity.taskId ||
    source.compileRequest.publicationId !== identity.publicationId ||
    source.compileRequest.foundation.foundationRevision !==
      identity.foundationRevision ||
    source.compileRequest.foundation.receiptDigest !==
      identity.foundationReadyReceiptDigest ||
    source.compileRequest.foundation.confirmedBriefDigest !==
      identity.confirmedBriefDigest ||
    digest(source.compileRequest) !== compileRequestDigest
  )
    fail('step source identity does not match DeliveryRun')
  return { identity, sections: source.authoritySectionIndex }
}
function checkpointClosureIdentity(
  chain: CheckpointChain,
  phase: GameIrCheckpointPhase,
): Record<string, unknown> {
  return {
    runId: chain.identity.runId,
    taskId: chain.identity.taskId,
    publicationId: chain.identity.publicationId,
    phase,
    compileRequestDigest: chain.compileRequestDigest,
    foundationRevision: chain.identity.foundationRevision,
    foundationReadyReceiptDigest: chain.identity.foundationReadyReceiptDigest,
    authoritySectionIndexDigest: digest(chain.sections),
  }
}

export class GameIrStageCheckpointWriter {
  async write(input: {
    workspacePath: string
    deliveryRun: DeliveryRun
    step: GameIrCheckpointStep
  }): Promise<GameIrCheckpointRef> {
    const { id, descriptor } = descriptorFor(input.step)
    if (
      input.step.records.length !== descriptor.kinds.length ||
      input.step.records.some(
        (record, index) =>
          record.kind !== descriptor.kinds[index] ||
          record.record === undefined,
      )
    )
      fail(
        'checkpoint step does not contain the exact newly committed record set',
      )
    await assertWorkspace(input.workspacePath)
    const root = stageRoot(input.workspacePath, input.deliveryRun.runId)
    await componentsSafe(resolve(input.workspacePath), root)
    const state = input.deliveryRun.gameIrState
    if (!state || state.status !== 'compiling')
      fail('checkpoint writes require compiling Game IR state')
    const current = state.latestCheckpoint
      ? await readCheckpointChain({
          workspacePath: input.workspacePath,
          deliveryRun: input.deliveryRun,
          ref: state.latestCheckpoint,
        })
      : undefined
    const index = current
      ? GAME_IR_PROTOCOL_STEPS.indexOf(current.manifests.at(-1)!.step!) + 1
      : 0
    if (GAME_IR_PROTOCOL_STEPS[index] !== id)
      fail('checkpoint operation is not the immediate next protocol step')
    const store = createRunStore(input.workspacePath, input.deliveryRun.ownerId)
    const lease = await store.mutationLock(input.deliveryRun.runId, true)
    try {
      const durable = await store.load(lease)
      if (
        !durable ||
        durable.phase !== 'GAME_IR_COMPILATION' ||
        durable.gameIrState?.status !== 'compiling' ||
        digest(durable.gameIrState.latestCheckpoint ?? null) !==
          digest(state.latestCheckpoint ?? null)
      )
        fail('caller DeliveryRun is stale or durable snapshot is missing')
      const source =
        input.step.records
          .map(record => sourceOf(record.record))
          .find(
            (value): value is GameIrDomainSourceEnvelope => value !== undefined,
          ) ??
        checkpointSource(
          current?.records ??
            new Map<GameIrCheckpointRecordKind, RecordEnvelope>(),
        )
      if (!source) fail('step has no source binding')
      const identity = checkpointIdentity(
        input.deliveryRun,
        source,
        current?.compileRequestDigest ?? digest(source.compileRequest),
      )
      if (
        current &&
        (digest(identity.sections) !== digest(current.sections) ||
          identity.identity.taskId !== current.identity.taskId)
      )
        fail('step source is detached from committed prefix')
      const allRecords = new Map<GameIrCheckpointRecordKind, RecordEnvelope>(
        current?.records ?? [],
      )
      const priorClosureDigest = current?.manifests
        .slice()
        .reverse()
        .find(manifest => manifest.closure)?.closure?.closureDigest
      for (const record of input.step.records) {
        if (allRecords.has(record.kind))
          fail('checkpoint record is already committed')
        const envelope: RecordEnvelope = {
          schemaVersion: GAME_IR_RECORD_SCHEMA_VERSION,
          kind: record.kind,
          phase: descriptor.phase,
          moduleId: descriptor.domain,
          taskId: identity.identity.taskId,
          foundationRevision: identity.identity.foundationRevision,
          foundationReadyReceiptDigest:
            identity.identity.foundationReadyReceiptDigest,
          compileRequestDigest:
            current?.compileRequestDigest ?? digest(source.compileRequest),
          authoritySectionIndexDigest: digest(identity.sections),
          authorityDigest: digest(record.record),
          ...(priorClosureDigest ? { priorClosureDigest } : {}),
          record: record.record,
        }
        allRecords.set(record.kind, envelope)
      }
      const operationPath = join(
        root,
        descriptor.phase,
        descriptor.domain,
        descriptor.operation,
      )
      await componentsSafe(root, dirname(operationPath))
      const manifestPath = join(operationPath, 'manifest.json')
      const temp = join(
        root,
        `.tmp-${descriptor.phase}-${descriptor.domain}-${descriptor.operation}-${process.pid}-${randomUUID()}`,
      )
      const refs: RecordRef[] = []
      try {
        await mkdir(join(temp, 'records'), { recursive: true })
        for (const record of input.step.records) {
          const envelope = allRecords.get(record.kind)!
          const bytes = json(envelope)
          await durableWrite(
            join(temp, 'records', `${record.kind.replaceAll('/', '__')}.json`),
            bytes,
          )
          refs.push({
            kind: record.kind,
            path: relative(
              resolve(input.workspacePath),
              join(
                operationPath,
                'records',
                `${record.kind.replaceAll('/', '__')}.json`,
              ),
            ).replaceAll('\\', '/'),
            digest: sha(bytes),
            canonicalLength: Buffer.byteLength(bytes, 'utf8'),
          })
        }
        const body: Record<string, unknown> = {
          schemaVersion: GAME_IR_CHECKPOINT_SCHEMA_VERSION,
          step: id,
          phase: descriptor.phase,
          domain: descriptor.domain,
          operation: descriptor.operation,
          identity: identity.identity,
          compileRequestDigest:
            current?.compileRequestDigest ?? digest(source.compileRequest),
          foundationReadyBinding: {
            foundationRevision: identity.identity.foundationRevision,
            receiptDigest: identity.identity.foundationReadyReceiptDigest,
          },
          authoritySectionIndex: identity.sections,
          records: refs,
          ...(state.latestCheckpoint
            ? {
                previousManifestPath: state.latestCheckpoint.checkpointPath,
                previousManifestDigest: state.latestCheckpoint.checkpointDigest,
              }
            : {}),
        }
        if (descriptor.closes) {
          const closureChain: CheckpointChain = {
            manifests: current?.manifests ?? [],
            records: allRecords,
            ref: {
              checkpointPath: relative(
                resolve(input.workspacePath),
                manifestPath,
              ).replaceAll('\\', '/'),
              checkpointDigest: '',
            },
            identity: identity.identity,
            compileRequestDigest:
              current?.compileRequestDigest ?? digest(source.compileRequest),
            sections: identity.sections,
          }
          const closed = checkpointClosure(closureChain, descriptor)
          Object.assign(body, {
            closure: {
              phase: descriptor.closes,
              step: id,
              identity: checkpointClosureIdentity(closureChain, descriptor.closes),
              recordRefs: [
                ...(current?.manifests.flatMap(manifest => manifest.records) ??
                  []),
                ...refs,
              ],
              closureDigest: closed.closureDigest,
            },
          })
        }
        const manifest: Manifest = {
          ...body,
          manifestDigest: digest(body),
        } as Manifest
        await durableWrite(join(temp, 'manifest.json'), json(manifest))
        await syncDirectory(join(temp, 'records'))
        await syncDirectory(temp)
        await mkdir(dirname(operationPath), { recursive: true })
        try {
          await rename(temp, operationPath)
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error
          const existing = await readCheckpointManifest(manifestPath, root)
          if (existing.bytes !== json(manifest))
            fail(
              'deterministic final checkpoint path contains conflicting bytes',
            )
        }
        await syncDirectory(root)
        await syncDirectory(dirname(operationPath))
        await syncDirectory(dirname(root))
        const checkpointPath = relative(
          resolve(input.workspacePath),
          manifestPath,
        ).replaceAll('\\', '/')
        const ref = {
          checkpointPath,
          checkpointDigest: sha(await safeReadFile(manifestPath)),
        }
        await readCheckpointChain({
          workspacePath: input.workspacePath,
          deliveryRun: {
            ...input.deliveryRun,
            gameIrState: { ...state, latestCheckpoint: ref },
          },
          ref,
        })
        return ref
      } finally {
        await rm(temp, { recursive: true, force: true })
      }
    } finally {
      await store.unlock(lease)
    }
  }
}
export class GameIrStageCheckpointLoader {
  async load(input: {
    workspacePath: string
    deliveryRun: DeliveryRun
  }): Promise<GameIrCheckpointLoad> {
    const state = input.deliveryRun.gameIrState
    if (!state) fail('DeliveryRun has no Game IR state')
    const ref =
      state.status === 'compiling' ? state.latestCheckpoint : state.checkpoint
    if (!ref) fail('DeliveryRun does not point to a checkpoint')
    const chain = await readCheckpointChain({
      workspacePath: input.workspacePath,
      deliveryRun: input.deliveryRun,
      ref,
    })
    const head = chain.manifests.at(-1)!
    const descriptor = checkpointDescriptor(head.step!)
    if (descriptor.closes) {
      const closed = checkpointClosure(chain, descriptor)
      if (!head.closure || head.closure.closureDigest !== closed.closureDigest)
        fail('closure seal digest mismatch')
      const cumulative = chain.manifests.flatMap(manifest => manifest.records)
      if (digest(head.closure.recordRefs) !== digest(cumulative))
        fail('closure seal record refs mismatch')
      const nextStep =
        GAME_IR_PROTOCOL_STEPS[GAME_IR_PROTOCOL_STEPS.indexOf(head.step!) + 1]
      return {
        status: 'closed',
        checkpoint: ref,
        step: head.step!,
        ...(nextStep ? { nextStep } : {}),
        phase: descriptor.closes,
        records: new Map(
          [...chain.records].map(([kind, value]) => [kind, value.record]),
        ),
        authority: closed.authority,
        closureDigest: closed.closureDigest,
      }
    }
    const nextStep =
      GAME_IR_PROTOCOL_STEPS[GAME_IR_PROTOCOL_STEPS.indexOf(head.step!) + 1]
    if (!nextStep) fail('partial checkpoint has no next protocol step')
    return {
      status: 'partial',
      checkpoint: ref,
      step: head.step!,
      nextStep,
      records: new Map(
        [...chain.records].map(([kind, value]) => [kind, value.record]),
      ),
    }
  }
  async recover(input: {
    workspacePath: string
    deliveryRun: DeliveryRun
  }): Promise<DeliveryRun> {
    const state = input.deliveryRun.gameIrState
    if (
      !state ||
      state.status !== 'compiling' ||
      input.deliveryRun.phase !== 'GAME_IR_COMPILATION'
    )
      return input.deliveryRun
    const current = state.latestCheckpoint
      ? await readCheckpointChain({
          workspacePath: input.workspacePath,
          deliveryRun: input.deliveryRun,
          ref: state.latestCheckpoint,
        })
      : undefined
    const next =
      GAME_IR_PROTOCOL_STEPS[
        current
          ? GAME_IR_PROTOCOL_STEPS.indexOf(current.manifests.at(-1)!.step!) + 1
          : 0
      ]
    if (!next) return input.deliveryRun
    const path = checkpointExpectedPath(
      stageRoot(input.workspacePath, input.deliveryRun.runId),
      next,
    )
    try {
      await regularPath(
        stageRoot(input.workspacePath, input.deliveryRun.runId),
        path,
        'manifest',
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const index = GAME_IR_PROTOCOL_STEPS.indexOf(next)
        if (
          await checkpointFuturePath(
            stageRoot(input.workspacePath, input.deliveryRun.runId),
            index,
          )
        )
          fail('future checkpoint exists beyond missing immediate predecessor')
        return input.deliveryRun
      }
      throw error
    }
    const bytes = await safeReadFile(path)
    const ref: GameIrCheckpointRef = {
      checkpointPath: relative(resolve(input.workspacePath), path).replaceAll(
        '\\',
        '/',
      ),
      checkpointDigest: sha(bytes),
    }
    await readCheckpointChain({
      workspacePath: input.workspacePath,
      deliveryRun: {
        ...input.deliveryRun,
        gameIrState: { ...state, latestCheckpoint: ref },
      },
      ref,
    })
    return {
      ...input.deliveryRun,
      gameIrState: { ...state, latestCheckpoint: ref },
    }
  }
}
export const gameIrStageCheckpointWriter = new GameIrStageCheckpointWriter()
export const gameIrStageCheckpointLoader = new GameIrStageCheckpointLoader()
export function writeGameIrStageCheckpoint(input: {
  workspacePath: string
  deliveryRun: DeliveryRun
  step: GameIrCheckpointStep
}): Promise<GameIrCheckpointRef> {
  return gameIrStageCheckpointWriter.write(input)
}
export function loadGameIrStageCheckpoint(input: {
  workspacePath: string
  deliveryRun: DeliveryRun
}): Promise<GameIrCheckpointLoad> {
  return gameIrStageCheckpointLoader.load(input)
}
