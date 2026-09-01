import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { DeliveryRun, GameIrCheckpointRef } from '../types'
import { durableWrite } from '../run-store'
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
  'game-ir-stage-checkpoint.v46' as const

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

/** A stage is deliberately a closed union; there is no generic record kind. */
export type GameIrCheckpointStep =
  | Readonly<{ phase: 'phase4'; records: readonly GameIrCheckpointRecord[] }>
  | Readonly<{ phase: 'phase5'; records: readonly GameIrCheckpointRecord[] }>
  | Readonly<{ phase: 'phase6'; records: readonly GameIrCheckpointRecord[] }>
  | Readonly<{ phase: 'phase7'; records: readonly GameIrCheckpointRecord[] }>

/** Existing domain assembly authorities are the only admitted input. */
export type GameIrAdmittedAuthority =
  | GameplayBalanceAssemblyAuthority
  | WorldPresentationAssemblyAuthority
  | ResourceRealizationAssemblyAuthority
  | ImplementationVerificationAssemblyAuthority

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
type StoredRecord = Readonly<{
  schemaVersion: 'game-ir-stage-record.v46'
  kind: GameIrCheckpointRecordKind
  record: unknown
}>
type RecordRef = Readonly<{
  kind: GameIrCheckpointRecordKind
  path: string
  digest: string
  canonicalLength: number
}>
type ManifestBody = Readonly<{
  schemaVersion: typeof GAME_IR_CHECKPOINT_SCHEMA_VERSION
  phase: GameIrCheckpointPhase
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
}>
type Manifest = ManifestBody & Readonly<{ manifestDigest: string }>

const SHA256 = /^[a-f0-9]{64}$/u
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const RECORD_SET = new Set<string>(GAME_IR_CHECKPOINT_RECORD_KINDS)
const PHASE_KINDS: Record<GameIrCheckpointPhase, readonly GameIrCheckpointRecordKind[]> = {
  phase4: GAME_IR_CHECKPOINT_RECORD_KINDS.slice(0, 6),
  phase5: GAME_IR_CHECKPOINT_RECORD_KINDS.slice(6, 14),
  phase6: GAME_IR_CHECKPOINT_RECORD_KINDS.slice(14, 18),
  phase7: GAME_IR_CHECKPOINT_RECORD_KINDS.slice(18, 22),
}

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
function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index]))
    fail(`${label} has unknown or missing fields`)
}
function safeRelative(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.includes('\0'))
    fail(`${label} is not a safe relative path`)
  if (value.split('/').some(part => !part || part === '.' || part === '..'))
    fail(`${label} is not a safe relative path`)
}
function digest(value: unknown): string {
  return digestGameIrValue(value)
}
function phaseForKind(kind: GameIrCheckpointRecordKind): GameIrCheckpointPhase {
  return kind.slice(0, 6) as GameIrCheckpointPhase
}
function sourceOf(value: unknown): GameIrDomainSourceEnvelope | undefined {
  if (!isRecord(value) || value.schemaVersion !== 'game-ir-domain-source.v1') return undefined
  return validateGameIrDomainSourceEnvelope(value)
}
function sourceList(authority: GameIrAdmittedAuthority): GameIrDomainSourceEnvelope[] {
  const candidate = authority as Record<string, any>
  const values: unknown[] = []
  if (isRecord(candidate) && isRecord(candidate.gameplay)) values.push(candidate.gameplay.source)
  if (isRecord(candidate) && isRecord(candidate.balance)) values.push(candidate.balance.source)
  if (isRecord(candidate) && isRecord(candidate.worldScene)) values.push(candidate.worldScene.source)
  if (isRecord(candidate) && isRecord(candidate.presentation)) values.push(candidate.presentation.source)
  if (isRecord(candidate) && isRecord(candidate.resourceRealization)) values.push(candidate.resourceRealization.source)
  if (isRecord(candidate) && isRecord(candidate.implementationVerification)) values.push(candidate.implementationVerification.source)
  return values.map(sourceOf).filter((source): source is GameIrDomainSourceEnvelope => source !== undefined)
}
function identityFor(run: DeliveryRun, authority: GameIrAdmittedAuthority): { identity: Identity; compileRequestDigest: string; sections: readonly GameIrSourceSection[] } {
  const state = run.gameIrState
  if (!state) fail('DeliveryRun has no Game IR compilation identity')
  if (state.status !== 'compiling' || run.phase !== 'GAME_IR_COMPILATION') fail('checkpoint writes require the compiling Game IR phase')
  const identity = state.identity
  if (identity.runId !== run.runId || identity.taskId.length === 0 || identity.publicationId.length === 0 || !SHA256.test(identity.confirmedBriefDigest) || !SAFE_ID.test(identity.foundationRevision) || !SHA256.test(identity.foundationReadyReceiptDigest)) fail('DeliveryRun Game IR identity is invalid')
  const sources = sourceList(authority)
  if (!sources.length) fail('authority has no admitted source records')
  const source = sources[0]!
  const request = source.compileRequest
  const expected: Identity = {
    runId: run.runId,
    taskId: identity.taskId,
    publicationId: identity.publicationId,
    confirmedBriefDigest: identity.confirmedBriefDigest,
    foundationRevision: identity.foundationRevision,
    foundationReadyReceiptDigest: identity.foundationReadyReceiptDigest,
  }
  if (request.taskId !== expected.taskId || request.publicationId !== expected.publicationId || request.foundation.foundationRevision !== expected.foundationRevision || request.foundation.receiptDigest !== expected.foundationReadyReceiptDigest || request.foundation.confirmedBriefDigest !== expected.confirmedBriefDigest)
    fail('admitted authority identity does not match DeliveryRun')
  if (sources.some(item => item.taskId !== expected.taskId || item.compileRequest.foundation.foundationRevision !== expected.foundationRevision || item.compileRequest.foundation.receiptDigest !== expected.foundationReadyReceiptDigest))
    fail('authority source identity is inconsistent')
  const sections = source.authoritySectionIndex
  if (sources.some(item => digest(item.authoritySectionIndex) !== digest(sections))) fail('authority Section Index is inconsistent')
  return { identity: expected, compileRequestDigest: digest(request), sections }
}
function authorityRecords(phase: GameIrCheckpointPhase, authority: GameIrAdmittedAuthority): Map<GameIrCheckpointRecordKind, unknown> {
  const candidate = authority as Record<string, any>
  const out = new Map<GameIrCheckpointRecordKind, unknown>()
  const put = (prefix: string, value: unknown) => out.set(`${phase}/${prefix}` as GameIrCheckpointRecordKind, value)
  if (phase === 'phase4') {
    if (!isRecord(candidate) || !isRecord(candidate.gameplay) || !isRecord(candidate.balance)) fail('Phase 4 authority shape is invalid')
    put('gameplay.source', candidate.gameplay.source); put('gameplay.mechanical', candidate.gameplay.mechanical); put('gameplay.semantic', candidate.gameplay.semantic)
    put('balance.source', candidate.balance.source); put('balance.mechanical', candidate.balance.mechanical); put('balance.semantic', candidate.balance.semantic)
    assembleGameplayBalanceModules(authority as GameplayBalanceAssemblyAuthority)
  } else if (phase === 'phase5') {
    if (!isRecord(candidate) || !isRecord(candidate.phase4Authority) || !isRecord(candidate.worldScene) || !isRecord(candidate.presentation)) fail('Phase 5 authority shape is invalid')
    put('world-scene.source', candidate.worldScene.source); put('world-scene.mechanical', candidate.worldScene.mechanical); put('world-scene.semantic', candidate.worldScene.semantic); put('world-scene.validation', candidate.worldScene.validation)
    put('presentation.source', candidate.presentation.source); put('presentation.mechanical', candidate.presentation.mechanical); put('presentation.semantic', candidate.presentation.semantic); put('presentation.validation', candidate.presentation.validation)
    assembleWorldPresentationClosure(authority as WorldPresentationAssemblyAuthority)
  } else if (phase === 'phase6') {
    if (!isRecord(candidate) || !isRecord(candidate.phase5Authority) || !isRecord(candidate.resourceRealization)) fail('Phase 6 authority shape is invalid')
    put('resource-realization.source', candidate.resourceRealization.source); put('resource-realization.mechanical', candidate.resourceRealization.mechanical); put('resource-realization.semantic', candidate.resourceRealization.semantic); put('resource-realization.validation', candidate.resourceRealization.validation)
    assembleResourceRealizationClosure(authority as ResourceRealizationAssemblyAuthority)
  } else {
    if (!isRecord(candidate) || !isRecord(candidate.phase6Authority) || !isRecord(candidate.implementationVerification)) fail('Phase 7 authority shape is invalid')
    put('implementation-verification.source', candidate.implementationVerification.source); put('implementation-verification.mechanical', candidate.implementationVerification.mechanical); put('implementation-verification.semantic', candidate.implementationVerification.semantic); put('implementation-verification.validation', candidate.implementationVerification.validation)
    assembleImplementationVerificationClosure(authority as ImplementationVerificationAssemblyAuthority)
  }
  return out
}
function normalizeStep(step: GameIrCheckpointStep): { phase: GameIrCheckpointPhase; records: readonly GameIrCheckpointRecord[] } {
  if (!isRecord(step) || typeof step.phase !== 'string' || !GAME_IR_CHECKPOINT_PHASES.includes(step.phase as GameIrCheckpointPhase) || !Array.isArray(step.records)) fail('checkpoint step is invalid')
  return { phase: step.phase as GameIrCheckpointPhase, records: step.records as GameIrCheckpointRecord[] }
}
function normalizeManifest(value: unknown): Manifest {
  if (!isRecord(value)) fail('manifest is not an object')
  exactKeys(value, ['schemaVersion', 'phase', 'identity', 'compileRequestDigest', 'foundationReadyBinding', 'authoritySectionIndex', 'records', 'previousManifestPath', 'previousManifestDigest', 'manifestDigest'], 'manifest')
  if (value.schemaVersion !== GAME_IR_CHECKPOINT_SCHEMA_VERSION || !GAME_IR_CHECKPOINT_PHASES.includes(value.phase as GameIrCheckpointPhase)) fail('manifest schema or phase is invalid')
  if (!isRecord(value.identity) || !isRecord(value.foundationReadyBinding) || !Array.isArray(value.authoritySectionIndex) || !Array.isArray(value.records)) fail('manifest shape is invalid')
  const identityKeys = ['runId','taskId','publicationId','confirmedBriefDigest','foundationRevision','foundationReadyReceiptDigest'] as const
  exactKeys(value.identity, identityKeys, 'manifest identity')
  for (const key of identityKeys) if (typeof value.identity[key] !== 'string' || (key.endsWith('Digest') && !SHA256.test(value.identity[key] as string))) fail('manifest identity is invalid')
  exactKeys(value.foundationReadyBinding, ['foundationRevision','receiptDigest'], 'manifest Foundation binding')
  if (value.foundationReadyBinding.foundationRevision !== value.identity.foundationRevision || value.foundationReadyBinding.receiptDigest !== value.identity.foundationReadyReceiptDigest) fail('manifest Foundation binding mismatch')
  if (typeof value.compileRequestDigest !== 'string' || !SHA256.test(value.compileRequestDigest) || typeof value.manifestDigest !== 'string' || !SHA256.test(value.manifestDigest)) fail('manifest digest is invalid')
  if (value.previousManifestPath !== undefined) safeRelative(value.previousManifestPath, 'previousManifestPath')
  if (value.previousManifestDigest !== undefined && (typeof value.previousManifestDigest !== 'string' || !SHA256.test(value.previousManifestDigest))) fail('previousManifestDigest is invalid')
  if ((value.previousManifestPath === undefined) !== (value.previousManifestDigest === undefined)) fail('previous manifest reference is incomplete')
  const records: RecordRef[] = []
  const seen = new Set<string>()
  for (const raw of value.records) {
    if (!isRecord(raw)) fail('record reference is invalid')
    exactKeys(raw, ['kind','path','digest','canonicalLength'], 'record reference')
    if (typeof raw.kind !== 'string' || !RECORD_SET.has(raw.kind) || seen.has(raw.kind)) fail('record kind is unknown or duplicated')
    safeRelative(raw.path, 'record path')
    if (typeof raw.digest !== 'string' || !SHA256.test(raw.digest) || typeof raw.canonicalLength !== 'number' || !Number.isInteger(raw.canonicalLength) || raw.canonicalLength < 0) fail('record reference digest or length is invalid')
    seen.add(raw.kind); records.push(raw as RecordRef)
  }
  const expectedOrder = PHASE_KINDS[value.phase as GameIrCheckpointPhase]
  if (records.length !== expectedOrder.length || records.some((item, index) => item.kind !== expectedOrder[index])) fail('manifest records are not in canonical phase order')
  const body = { ...value }; delete (body as Record<string, unknown>).manifestDigest
  if (digest(body) !== value.manifestDigest) fail('manifest digest mismatch')
  return value as Manifest
}
function stageRoot(workspacePath: string, runId: string): string {
  if (!SAFE_ID.test(runId)) fail('runId is not a safe path segment')
  return join(resolve(workspacePath), '.beegame', 'ir', 'runs', runId, 'checkpoints')
}
function inside(root: string, path: string): boolean {
  const relativePath = relative(root, path)
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && relativePath !== ''
}
async function readManifest(path: string): Promise<{ manifest: Manifest; bytes: string }> {
  const bytes = await readFile(path, 'utf8')
  return { manifest: normalizeManifest(JSON.parse(bytes) as unknown), bytes }
}
async function writeImmutable(path: string, bytes: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  try {
    const handle = await open(path, 'wx')
    try {
      await handle.writeFile(bytes, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if ((await readFile(path, 'utf8')) !== bytes) fail('immutable checkpoint file contains conflicting bytes')
  }
}

export class GameIrStageCheckpointWriter {
  async write(input: { workspacePath: string; deliveryRun: DeliveryRun; step: GameIrCheckpointStep; authority: GameIrAdmittedAuthority }): Promise<GameIrCheckpointRef> {
    const { phase, records } = normalizeStep(input.step)
    const { identity, compileRequestDigest, sections } = identityFor(input.deliveryRun, input.authority)
    const expected = authorityRecords(phase, input.authority)
    const expectedKinds = PHASE_KINDS[phase]
    if (records.length !== expectedKinds.length) fail('checkpoint step does not contain the complete stage record set')
    const seen = new Set<string>()
    for (const item of records) {
      if (!isRecord(item) || typeof item.kind !== 'string' || !RECORD_SET.has(item.kind) || phaseForKind(item.kind as GameIrCheckpointRecordKind) !== phase || seen.has(item.kind)) fail('checkpoint step contains unknown, out-of-scope, or duplicate records')
      if (!expected.has(item.kind as GameIrCheckpointRecordKind) || digest(item.record) !== digest(expected.get(item.kind as GameIrCheckpointRecordKind))) fail(`admitted record ${item.kind} does not match authority`)
      seen.add(item.kind)
    }
    if (seen.size !== expectedKinds.length) fail('checkpoint step is missing an admitted record')
    const root = stageRoot(input.workspacePath, input.deliveryRun.runId)
    const finalPath = join(root, `${phase}.json`)
    const previous = input.deliveryRun.gameIrState?.status === 'compiling' ? input.deliveryRun.gameIrState.latestCheckpoint : undefined
    const expectedPreviousPhase = phase === 'phase4' ? undefined : `phase${Number(phase.slice(-1)) - 1}`
    if (expectedPreviousPhase === undefined && previous) fail('Phase 4 cannot link a previous manifest')
    if (expectedPreviousPhase !== undefined && (!previous || !previous.checkpointPath.endsWith(`/${expectedPreviousPhase}.json`))) fail('checkpoint predecessor does not match phase order')
    const temp = join(root, `.tmp-${phase}-${process.pid}-${randomUUID()}`)
    const recordRefs: RecordRef[] = []
    try {
      if (previous) {
        safeRelative(previous.checkpointPath, 'previous checkpoint path')
        const previousPath = resolve(input.workspacePath, previous.checkpointPath)
        if (!inside(root, previousPath) || previousPath !== join(root, `${expectedPreviousPhase}.json`)) fail('checkpoint predecessor is outside its deterministic path')
        const previousManifest = await readManifest(previousPath)
        if (sha(previousManifest.bytes) !== previous.checkpointDigest || previousManifest.manifest.identity.runId !== identity.runId || previousManifest.manifest.identity.taskId !== identity.taskId || previousManifest.manifest.identity.foundationRevision !== identity.foundationRevision) fail('checkpoint predecessor identity or digest mismatch')
      }
      await mkdir(join(temp, 'records'), { recursive: true })
      const pending: { path: string; bytes: string }[] = []
      for (const kind of expectedKinds) {
        const value = expected.get(kind)!
        const stored: StoredRecord = { schemaVersion: 'game-ir-stage-record.v46', kind, record: value }
        const bytes = json(stored)
        const recordPath = join('records', `${kind.replaceAll('/', '__')}.json`)
        await durableWrite(join(temp, recordPath), bytes)
        const finalRecordPath = join(root, recordPath)
        pending.push({ path: finalRecordPath, bytes })
        recordRefs.push({ kind, path: relative(resolve(input.workspacePath), finalRecordPath).replaceAll('\\', '/'), digest: sha(bytes), canonicalLength: bytes.length })
      }
      for (const record of pending) await writeImmutable(record.path, record.bytes)
      const previousManifestPath = previous?.checkpointPath
      const previousManifestDigest = previous?.checkpointDigest
      const body: ManifestBody = {
        schemaVersion: GAME_IR_CHECKPOINT_SCHEMA_VERSION,
        phase,
        identity,
        compileRequestDigest,
        foundationReadyBinding: { foundationRevision: identity.foundationRevision, receiptDigest: identity.foundationReadyReceiptDigest },
        authoritySectionIndex: sections,
        records: recordRefs,
        ...(previousManifestPath ? { previousManifestPath } : {}),
        ...(previousManifestDigest ? { previousManifestDigest } : {}),
      }
      const manifest: Manifest = { ...body, manifestDigest: digest(body) }
      const manifestBytes = json(manifest)
      await durableWrite(join(temp, 'manifest.json'), manifestBytes)
      await mkdir(dirname(finalPath), { recursive: true })
      await writeImmutable(finalPath, manifestBytes)
      const committed = await readManifest(finalPath)
      return { checkpointPath: relative(resolve(input.workspacePath), finalPath).replaceAll('\\', '/'), checkpointDigest: sha(committed.bytes) }
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  }
}

export class GameIrStageCheckpointLoader {
  async recover(input: { workspacePath: string; deliveryRun: DeliveryRun }): Promise<DeliveryRun> {
    const state = input.deliveryRun.gameIrState
    if (!state || state.status !== 'compiling' || input.deliveryRun.phase !== 'GAME_IR_COMPILATION') return input.deliveryRun
    let recovered = input.deliveryRun
    for (const phase of GAME_IR_CHECKPOINT_PHASES) {
      const path = join(stageRoot(input.workspacePath, input.deliveryRun.runId), `${phase}.json`)
      let bytes: string
      try { bytes = await readFile(path, 'utf8') } catch { break }
      const ref: GameIrCheckpointRef = { checkpointPath: relative(resolve(input.workspacePath), path).replaceAll('\\', '/'), checkpointDigest: sha(bytes) }
      const candidate: DeliveryRun = { ...input.deliveryRun, gameIrState: { ...state, latestCheckpoint: ref } }
      try { await this.load({ workspacePath: input.workspacePath, deliveryRun: candidate }); recovered = candidate } catch { break }
    }
    return recovered
  }
  async load(input: { workspacePath: string; deliveryRun: DeliveryRun }): Promise<GameIrReplayAuthority> {
    const state = input.deliveryRun.gameIrState
    if (!state) fail('DeliveryRun has no Game IR state')
    const ref = state.status === 'compiling' ? state.latestCheckpoint : state.checkpoint
    if (!ref) fail('DeliveryRun does not point to a checkpoint')
    safeRelative(ref.checkpointPath, 'checkpointPath')
    const root = stageRoot(input.workspacePath, input.deliveryRun.runId)
    const firstPath = resolve(input.workspacePath, ref.checkpointPath)
    if (!inside(root, firstPath) || !firstPath.endsWith('.json') || firstPath.includes(`${sep}records${sep}`)) fail('checkpoint pointer is outside the run-scoped checkpoint root')
    const manifests: Manifest[] = []
    const records = new Map<GameIrCheckpointRecordKind, unknown>()
    let path = firstPath
    let expectedDigest: string | undefined = ref.checkpointDigest
    while (true) {
      const { manifest, bytes } = await readManifest(path)
      if (path !== join(root, `${manifest.phase}.json`)) fail('manifest is not at its deterministic phase path')
      if (sha(bytes) !== expectedDigest) fail('checkpoint manifest digest mismatch')
      const identity = state.identity
      if (manifest.identity.runId !== input.deliveryRun.runId || manifest.identity.taskId !== identity.taskId || manifest.identity.publicationId !== identity.publicationId || manifest.identity.confirmedBriefDigest !== identity.confirmedBriefDigest || manifest.identity.foundationRevision !== identity.foundationRevision || manifest.identity.foundationReadyReceiptDigest !== identity.foundationReadyReceiptDigest) fail('checkpoint identity does not match DeliveryRun')
      if (manifest.records.length !== PHASE_KINDS[manifest.phase].length) fail('checkpoint manifest has missing records')
      for (const refRecord of manifest.records) {
        const recordPath = resolve(input.workspacePath, refRecord.path)
        if (!inside(root, recordPath)) fail('record path escapes run-scoped checkpoint root')
        const expectedRecordPath = join(root, 'records', `${refRecord.kind.replaceAll('/', '__')}.json`)
        if (recordPath !== expectedRecordPath) fail('record is outside its deterministic path')
        const recordBytes = await readFile(recordPath, 'utf8')
        if (sha(recordBytes) !== refRecord.digest || recordBytes.length !== refRecord.canonicalLength) fail('record digest or canonical length mismatch')
        const value = JSON.parse(recordBytes) as unknown
        if (!isRecord(value)) fail('record is not an object')
        exactKeys(value, ['schemaVersion','kind','record'], 'record')
        if (value.schemaVersion !== 'game-ir-stage-record.v46' || value.kind !== refRecord.kind || records.has(refRecord.kind)) fail('record schema, kind, or uniqueness is invalid')
        records.set(refRecord.kind, value.record)
      }
      manifests.unshift(manifest)
      if (!manifest.previousManifestPath) break
      if (!manifest.previousManifestDigest) fail('previous manifest digest is missing')
      const previousPath = resolve(input.workspacePath, manifest.previousManifestPath)
      if (!inside(root, previousPath) || !previousPath.endsWith('.json') || previousPath.includes(`${sep}records${sep}`)) fail('previous manifest path escapes run-scoped checkpoint root')
      path = previousPath; expectedDigest = manifest.previousManifestDigest
    }
    if (manifests.length < 1 || manifests[0]!.phase !== 'phase4') fail('checkpoint chain must begin at Phase 4')
    for (let index = 0; index < manifests.length; index += 1) if (manifests[index]!.phase !== `phase${index + 4}`) fail('checkpoint phases are not ordered')
    const source = [...records.values()].map(sourceOf).filter((value): value is GameIrDomainSourceEnvelope => value !== undefined)
    if (!source.length) fail('checkpoint has no source records')
    const first = source[0]!
    if (manifests.some(manifest => manifest.compileRequestDigest !== digest(first.compileRequest))) fail('compile request digest mismatch')
    if (digest(first.authoritySectionIndex) !== digest(manifests.at(-1)!.authoritySectionIndex)) fail('checkpoint Section Index mismatch')
    const authority4 = this.phase4(records)
    let replay: GameIrReplayAuthority = { phase4Authority: authority4, checkpoint: ref }
    const phase5Manifest = manifests.find(item => item.phase === 'phase5')
    const phase6Manifest = manifests.find(item => item.phase === 'phase6')
    const phase7Manifest = manifests.find(item => item.phase === 'phase7')
    if (phase5Manifest) replay = { ...replay, phase5Authority: this.phase5(records, authority4) }
    if (phase6Manifest) replay = { ...replay, phase6Authority: this.phase6(records, replay.phase5Authority!) }
    if (phase7Manifest) replay = { ...replay, phase7Authority: this.phase7(records, replay.phase6Authority!) }
    return Object.freeze(replay)
  }

  private phase4(records: Map<GameIrCheckpointRecordKind, unknown>): GameplayBalanceAssemblyAuthority {
    const get = (kind: GameIrCheckpointRecordKind) => { const value = records.get(kind); if (value === undefined) fail(`missing ${kind}`); return value }
    return { gameplay: { source: get('phase4/gameplay/source'), mechanical: get('phase4/gameplay/mechanical'), semantic: get('phase4/gameplay/semantic') }, balance: { source: get('phase4/balance/source'), mechanical: get('phase4/balance/mechanical'), semantic: get('phase4/balance/semantic') } } as GameplayBalanceAssemblyAuthority
  }
  private phase5(records: Map<GameIrCheckpointRecordKind, unknown>, phase4Authority: GameplayBalanceAssemblyAuthority): WorldPresentationAssemblyAuthority {
    const get = (kind: GameIrCheckpointRecordKind) => { const value = records.get(kind); if (value === undefined) fail(`missing ${kind}`); return value }
    return { phase4Authority, worldScene: { source: get('phase5/world-scene/source'), mechanical: get('phase5/world-scene/mechanical'), semantic: get('phase5/world-scene/semantic'), validation: get('phase5/world-scene/validation') }, presentation: { source: get('phase5/presentation/source'), mechanical: get('phase5/presentation/mechanical'), semantic: get('phase5/presentation/semantic'), validation: get('phase5/presentation/validation') } } as WorldPresentationAssemblyAuthority
  }
  private phase6(records: Map<GameIrCheckpointRecordKind, unknown>, phase5Authority: WorldPresentationAssemblyAuthority): ResourceRealizationAssemblyAuthority {
    const get = (kind: GameIrCheckpointRecordKind) => { const value = records.get(kind); if (value === undefined) fail(`missing ${kind}`); return value }
    return { phase5Authority, resourceRealization: { source: get('phase6/resource-realization/source'), mechanical: get('phase6/resource-realization/mechanical'), semantic: get('phase6/resource-realization/semantic'), validation: get('phase6/resource-realization/validation') } } as ResourceRealizationAssemblyAuthority
  }
  private phase7(records: Map<GameIrCheckpointRecordKind, unknown>, phase6Authority: ResourceRealizationAssemblyAuthority): ImplementationVerificationAssemblyAuthority {
    const get = (kind: GameIrCheckpointRecordKind) => { const value = records.get(kind); if (value === undefined) fail(`missing ${kind}`); return value }
    return { phase6Authority, implementationVerification: { source: get('phase7/implementation-verification/source'), mechanical: get('phase7/implementation-verification/mechanical'), semantic: get('phase7/implementation-verification/semantic'), validation: get('phase7/implementation-verification/validation') } } as ImplementationVerificationAssemblyAuthority
  }
}

export const gameIrStageCheckpointWriter = new GameIrStageCheckpointWriter()
export const gameIrStageCheckpointLoader = new GameIrStageCheckpointLoader()

export function writeGameIrStageCheckpoint(input: {
  workspacePath: string
  deliveryRun: DeliveryRun
  step: GameIrCheckpointStep
  authority: GameIrAdmittedAuthority
}): Promise<GameIrCheckpointRef> {
  return gameIrStageCheckpointWriter.write(input)
}

export function loadGameIrStageCheckpoint(input: {
  workspacePath: string
  deliveryRun: DeliveryRun
}): Promise<GameIrReplayAuthority> {
  return gameIrStageCheckpointLoader.load(input)
}
