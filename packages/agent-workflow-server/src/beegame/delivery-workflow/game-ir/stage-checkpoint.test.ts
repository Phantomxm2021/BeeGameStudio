import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { DeliveryRun } from '../types'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import { createRunStore } from '../run-store'
import { createFoundationAuditState, parseFoundationAuditState, type FoundationAuditState } from '../foundation-audit-state'
import { FOUNDATION_AUDIT_PRODUCTION_MANIFEST } from '../foundation-audit-production-manifest'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST, FOUNDATION_SEMANTIC_CHECKS } from '../foundation-semantic-audit'
import { implementationVerificationFixture } from './implementation-verification-test-helpers'
import { prepareImplementationVerificationSemanticValidationPacket } from './phase7-admission'
import type { ImplementationVerificationAssemblyAuthority } from './implementation-verification-assembler'
import type { ResourceRealizationAssemblyAuthority } from './resource-realization-assembler'
import {
  GameIrStageCheckpointLoader,
  GameIrStageCheckpointWriter,
  GAME_IR_CHECKPOINT_SCHEMA_VERSION,
  type GameIrCheckpointStep,
} from './stage-checkpoint'

const workspaces: string[] = []
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const FIXTURE_DIGEST = 'a'.repeat(64)
const FIXTURE_REVIEW = 'b'.repeat(64)
const FIXTURE_REVISION = 'foundation-revision-1'
const FIXTURE_TIME = '2026-08-24T00:00:00.000Z'
const FIXTURE_USAGE = { input_tokens: 1, cache_read_tokens: 1, cache_creation_tokens: 1, completion_tokens: 1, total_tokens: 4 }
function auditReadyFixture(): FoundationAuditState {
  const seed = createFoundationAuditState({ revision: FIXTURE_REVISION, documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest: FIXTURE_DIGEST })), manifest: { revision: FIXTURE_REVISION, status: 'index_staged', catalogVersion: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion, sectionIndexDigest: FIXTURE_DIGEST } })
  const semantic = parseFoundationAuditState({ ...seed, status: 'semantic_review', phaseStartedAt: FIXTURE_TIME, derived: { manifestPath: `.beegame/audit/${FIXTURE_REVISION}/derived/manifest.json`, manifestDigest: FIXTURE_DIGEST, markerPath: `.beegame/audit/${FIXTURE_REVISION}/derived/COMMITTED.json`, markerDigest: FIXTURE_DIGEST, factStorePath: `.beegame/audit/${FIXTURE_REVISION}/derived/fact-store.json`, factStoreDigest: FIXTURE_DIGEST, sectionIndexPath: `.beegame/audit/${FIXTURE_REVISION}/derived/section-index.json`, sectionIndexDigest: FIXTURE_DIGEST }, deterministic: { reviewDigest: FIXTURE_DIGEST, issueRegistryPath: `.beegame/audit/foundation/${FIXTURE_REVISION}/staging/review/issues.json`, issueRegistryDigest: FIXTURE_DIGEST, manifestPath: `.beegame/audit/foundation/${FIXTURE_REVISION}/staging/review/manifest.json`, manifestDigest: FIXTURE_DIGEST, markerPath: `.beegame/audit/foundation/${FIXTURE_REVISION}/staging/review/COMMITTED.json`, markerDigest: FIXTURE_DIGEST, catalogVersion: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion, contractGraphDigest: FIXTURE_DIGEST, sectionIndexDigest: FIXTURE_DIGEST, factStoreDigest: FIXTURE_DIGEST }, semantic: { aggregateUsage: FIXTURE_USAGE }, tasks: FOUNDATION_SEMANTIC_CHECKS.map(check => ({ taskId: `semantic-${check.checkId}`, kind: 'semantic' as const, revision: FIXTURE_REVISION, checkId: check.checkId, packetDigest: FIXTURE_DIGEST, modelTier: check.modelTier, status: 'completed' as const, attempt: 1, terminalDigest: FIXTURE_DIGEST, usage: FIXTURE_USAGE, durationMs: 1, dispatch: { dispatchId: `dispatch-${check.checkId}`, workerType: 'foundation-semantic-reviewer' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: `semantic-${check.checkId}`, revision: FIXTURE_REVISION, status: 'completed' as const, startedAt: FIXTURE_TIME, finishedAt: FIXTURE_TIME, terminalResult: {} }, admittedResult: { checkId: check.checkId, packetIdentity: FIXTURE_DIGEST, outcome: 'PASS' as const } })) })
  return parseFoundationAuditState({ ...semantic, status: 'audit_ready', review: { reviewDigest: FIXTURE_REVIEW, issueRegistryPath: `.beegame/audit/foundation/${FIXTURE_REVISION}/review/${FIXTURE_REVIEW}/issue-registry.json`, issueRegistryDigest: FIXTURE_DIGEST, manifestPath: `.beegame/audit/foundation/${FIXTURE_REVISION}/review/${FIXTURE_REVIEW}/manifest.json`, manifestDigest: FIXTURE_DIGEST, markerPath: `.beegame/audit/foundation/${FIXTURE_REVISION}/review/${FIXTURE_REVIEW}/COMMITTED.json`, markerDigest: FIXTURE_DIGEST, sectionIndexDigest: FIXTURE_DIGEST, factStoreDigest: FIXTURE_DIGEST, semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest, issueSummary: { total: 0, blocker: 0, high: 0, medium: 0, low: 0 } } })
}
function authorityFixture() {
  const fixture = implementationVerificationFixture()
  const phase6Authority = fixture.phase6Authority as ResourceRealizationAssemblyAuthority
  const preparation = {
    phase6Authority,
    implementationVerification: { source: fixture.authority.source, mechanical: fixture.authority.mechanical, semantic: fixture.semantic },
  } as const
  const packet = prepareImplementationVerificationSemanticValidationPacket(preparation)
  const phase7Authority: ImplementationVerificationAssemblyAuthority = {
    phase6Authority,
    implementationVerification: {
      ...preparation.implementationVerification,
      validation: { outcome: 'PASS', packetDigest: packet.packetDigest, checkIds: packet.checkIds, coveredTargets: packet.requiredTargets },
    },
  }
  return { ...fixture, phase7Authority }
}
function runFor(authority: ReturnType<typeof authorityFixture>): DeliveryRun {
  const request = authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority.gameplay.source.compileRequest
  return {
    schemaVersion: 46, runId: 'checkpoint-run', ownerId: 'checkpoint-owner', projectId: request.foundation.projectId,
    confirmedBriefDigest: request.foundation.confirmedBriefDigest, confirmedBriefContext: 'fixture', phase: 'GAME_IR_COMPILATION', status: 'running',
    revision: { document: request.foundation.foundationRevision, workspace: 'workspace-revision' }, tasks: [], evidence: {}, foundationDraftState: { completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS] }, foundationAuditState: auditReadyFixture(),
    gameIrState: { status: 'compiling', identity: { runId: 'checkpoint-run', taskId: request.taskId, publicationId: request.publicationId, confirmedBriefDigest: request.foundation.confirmedBriefDigest, foundationRevision: request.foundation.foundationRevision, foundationReadyReceiptDigest: request.foundation.receiptDigest } },
    resourceProductionState: { currentTask: 'RESOURCE_PLAN' }, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  } as DeliveryRun
}
function recordsFor(phase: 'phase4' | 'phase5' | 'phase6' | 'phase7', authority: ReturnType<typeof authorityFixture>['phase7Authority']): GameIrCheckpointStep['records'] {
  const p4 = authority.phase6Authority.phase5Authority.phase4Authority
  const p5 = authority.phase6Authority.phase5Authority
  const p6 = authority.phase6Authority
  const values: Record<string, unknown> = phase === 'phase4' ? {
    'phase4/gameplay/source': p4.gameplay.source, 'phase4/gameplay/mechanical': p4.gameplay.mechanical, 'phase4/gameplay/semantic': p4.gameplay.semantic,
    'phase4/balance/source': p4.balance.source, 'phase4/balance/mechanical': p4.balance.mechanical, 'phase4/balance/semantic': p4.balance.semantic,
  } : phase === 'phase5' ? {
    'phase5/world-scene/source': p5.worldScene.source, 'phase5/world-scene/mechanical': p5.worldScene.mechanical, 'phase5/world-scene/semantic': p5.worldScene.semantic, 'phase5/world-scene/validation': p5.worldScene.validation,
    'phase5/presentation/source': p5.presentation.source, 'phase5/presentation/mechanical': p5.presentation.mechanical, 'phase5/presentation/semantic': p5.presentation.semantic, 'phase5/presentation/validation': p5.presentation.validation,
  } : phase === 'phase6' ? {
    'phase6/resource-realization/source': p6.resourceRealization.source, 'phase6/resource-realization/mechanical': p6.resourceRealization.mechanical, 'phase6/resource-realization/semantic': p6.resourceRealization.semantic, 'phase6/resource-realization/validation': p6.resourceRealization.validation,
  } : {
    'phase7/implementation-verification/source': authority.implementationVerification.source, 'phase7/implementation-verification/mechanical': authority.implementationVerification.mechanical, 'phase7/implementation-verification/semantic': authority.implementationVerification.semantic, 'phase7/implementation-verification/validation': authority.implementationVerification.validation,
  }
  return Object.entries(values).map(([kind, record]) => ({ kind, record })) as GameIrCheckpointStep['records']
}
function step(phase: 'phase4' | 'phase5' | 'phase6' | 'phase7', authority: ReturnType<typeof authorityFixture>['phase7Authority']): GameIrCheckpointStep { return { phase, records: recordsFor(phase, authority) } }
async function persist(workspacePath: string, run: DeliveryRun): Promise<void> { await createRunStore(workspacePath, run.ownerId).save(run) }
beforeEach(async () => { workspaces.push(await mkdtemp(join(tmpdir(), 'game-ir-stage-checkpoint-'))) })
afterEach(async () => { await Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('v46 Game IR stage checkpoint boundary', () => {
  test('exports the strict v46 checkpoint protocol', () => {
    expect(GAME_IR_CHECKPOINT_SCHEMA_VERSION).toBe('game-ir-stage-checkpoint.v46')
    expect(new GameIrStageCheckpointWriter()).toBeDefined()
    expect(new GameIrStageCheckpointLoader()).toBeDefined()
  })

  test('rejects a checkpoint write without an admitted stage authority', async () => {
    const writer = new GameIrStageCheckpointWriter()
    await expect(
      writer.write({
        workspacePath: '/tmp/game-ir-stage-checkpoint-test',
        deliveryRun: {} as never,
        step: { kind: 'phase4.gameplay.source', record: {} } as never,
        authority: {} as never,
      }),
    ).rejects.toThrow()
  })

  test('writes Phase 4, reloads it, and deterministically reuses the exact final tree', async () => {
    const authority = authorityFixture()
    const writer = new GameIrStageCheckpointWriter()
    const loader = new GameIrStageCheckpointLoader()
    const run = runFor(authority)
    await persist(workspaces[0]!, run)
    const first = await writer.write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step('phase4', authority.phase7Authority), authority: authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority })
    const replay = await loader.load({ workspacePath: workspaces[0]!, deliveryRun: { ...run, gameIrState: { ...(run.gameIrState as Extract<DeliveryRun['gameIrState'], { status: 'compiling' }>), latestCheckpoint: first } } })
    const second = await writer.write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step('phase4', authority.phase7Authority), authority: authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority })
    expect(second).toEqual(first)
    expect(replay.phase4Authority).toBeDefined()
  })

  test('replays the complete Phase 4 through Phase 7 authority chain and preserves UTF-8 lengths', async () => {
    const authority = authorityFixture()
    const writer = new GameIrStageCheckpointWriter()
    const loader = new GameIrStageCheckpointLoader()
    let run = runFor(authority)
    await persist(workspaces[0]!, run)
    for (const phase of ['phase4', 'phase5', 'phase6', 'phase7'] as const) {
      const phaseAuthority = phase === 'phase4' ? authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority : phase === 'phase5' ? authority.phase7Authority.phase6Authority.phase5Authority : phase === 'phase6' ? authority.phase7Authority.phase6Authority : authority.phase7Authority
      const ref = await writer.write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step(phase, authority.phase7Authority), authority: phaseAuthority })
      run = { ...run, gameIrState: { ...(run.gameIrState as Extract<DeliveryRun['gameIrState'], { status: 'compiling' }>), latestCheckpoint: ref } }
      await persist(workspaces[0]!, run)
    }
    const replay = await loader.load({ workspacePath: workspaces[0]!, deliveryRun: run })
    expect(replay.phase7Authority).toBeDefined()
    const bytes = await readFile(join(workspaces[0]!, '.beegame/ir/runs/checkpoint-run/checkpoints/phase7/records/phase7__implementation-verification__source.json'))
    expect(bytes.byteLength).toBeGreaterThan(bytes.toString('utf8').length)
  })

  test('advances an existing Phase 4 pointer when Phase 5 is committed before snapshot advancement', async () => {
    const authority = authorityFixture()
    const writer = new GameIrStageCheckpointWriter()
    let run = runFor(authority)
    await persist(workspaces[0]!, run)
    const phase4 = await writer.write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step('phase4', authority.phase7Authority), authority: authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority })
    run = { ...run, gameIrState: { ...(run.gameIrState as Extract<DeliveryRun['gameIrState'], { status: 'compiling' }>), latestCheckpoint: phase4 } }
    await persist(workspaces[0]!, run)
    const phase5 = await writer.write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step('phase5', authority.phase7Authority), authority: authority.phase7Authority.phase6Authority.phase5Authority })
    const recovered = await new GameIrStageCheckpointLoader().recover({ workspacePath: workspaces[0]!, deliveryRun: run })
    expect(recovered.gameIrState?.status === 'compiling' ? recovered.gameIrState.latestCheckpoint : undefined).toEqual(phase5)
  })

  test('fails closed for missing, duplicate, out-of-scope, damaged, empty, and symlink finals', async () => {
    const authority = authorityFixture()
    const writer = new GameIrStageCheckpointWriter()
    const run = runFor(authority)
    await persist(workspaces[0]!, run)
    const valid = step('phase4', authority.phase7Authority)
    await expect(writer.write({ workspacePath: workspaces[0]!, deliveryRun: run, step: { ...valid, records: valid.records.slice(1) }, authority: authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority })).rejects.toThrow()
    await expect(writer.write({ workspacePath: workspaces[0]!, deliveryRun: run, step: { ...valid, records: [...valid.records, valid.records[0]!] }, authority: authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority })).rejects.toThrow()
    await expect(writer.write({ workspacePath: workspaces[0]!, deliveryRun: run, step: { ...valid, records: valid.records.map((item, index) => index === 0 ? { ...item, kind: 'phase5/world-scene/source' } : item) as GameIrCheckpointStep['records'] }, authority: authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority })).rejects.toThrow()
    const root = join(workspaces[0]!, '.beegame/ir/runs/checkpoint-run/checkpoints')
    await writeFile(join(workspaces[0]!, 'outside'), 'x')
    await import('node:fs/promises').then(fs => fs.mkdir(root, { recursive: true }))
    await symlink(join(workspaces[0]!, 'outside'), join(root, 'phase4'))
    await expect(writer.write({ workspacePath: workspaces[0]!, deliveryRun: run, step: valid, authority: authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority })).rejects.toThrow()
    await rm(join(root, 'phase4'), { force: true })
    const cleanRef = await writer.write({ workspacePath: workspaces[0]!, deliveryRun: run, step: valid, authority: authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority })
    const recordsPath = join(workspaces[0]!, '.beegame/ir/runs/checkpoint-run/checkpoints/phase4/records')
    const recordOutside = await mkdtemp(join(tmpdir(), 'game-ir-stage-record-outside-'))
    await rm(recordsPath, { recursive: true, force: true })
    await symlink(recordOutside, recordsPath)
    await expect(new GameIrStageCheckpointLoader().load({ workspacePath: workspaces[0]!, deliveryRun: { ...run, gameIrState: { ...(run.gameIrState as Extract<DeliveryRun['gameIrState'], { status: 'compiling' }>), latestCheckpoint: cleanRef } } })).rejects.toThrow()
  })

  test('does not adopt temp/orphan checkpoints and rejects a non-regular final', async () => {
    const authority = authorityFixture()
    const run = runFor(authority)
    await persist(workspaces[0]!, run)
    const root = join(workspaces[0]!, '.beegame/ir/runs/checkpoint-run/checkpoints')
    await import('node:fs/promises').then(fs => fs.mkdir(join(root, '.tmp-phase4-orphan', 'records'), { recursive: true }))
    await writeFile(join(workspaces[0]!, '.beegame/ir/runs/checkpoint-run/checkpoints/.tmp-phase4-orphan/manifest.json'), '{}')
    await expect(new GameIrStageCheckpointLoader().recover({ workspacePath: workspaces[0]!, deliveryRun: run })).resolves.toEqual(run)
    await import('node:fs/promises').then(fs => fs.mkdir(join(root, 'phase4'), { recursive: true }))
    await expect(new GameIrStageCheckpointLoader().recover({ workspacePath: workspaces[0]!, deliveryRun: run })).rejects.toThrow()
  })

  test('rejects run/task/revision/READY mismatches and predecessor mismatches', async () => {
    const authority = authorityFixture()
    const writer = new GameIrStageCheckpointWriter()
    const run = runFor(authority)
    await persist(workspaces[0]!, run)
    const phase4Authority = authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority
    await expect(writer.write({ workspacePath: workspaces[0]!, deliveryRun: { ...run, runId: 'other-run' }, step: step('phase4', authority.phase7Authority), authority: phase4Authority })).rejects.toThrow()
    await expect(writer.write({ workspacePath: workspaces[0]!, deliveryRun: { ...run, gameIrState: { ...run.gameIrState!, identity: { ...run.gameIrState!.identity, foundationRevision: 'other-revision' } } }, step: step('phase4', authority.phase7Authority), authority: phase4Authority })).rejects.toThrow()
    for (const identity of [
      { ...run.gameIrState!.identity, publicationId: 'other-publication' },
      { ...run.gameIrState!.identity, confirmedBriefDigest: 'b'.repeat(64) },
      { ...run.gameIrState!.identity, foundationReadyReceiptDigest: 'c'.repeat(64) },
    ]) await expect(writer.write({ workspacePath: workspaces[0]!, deliveryRun: { ...run, gameIrState: { ...(run.gameIrState as Extract<DeliveryRun['gameIrState'], { status: 'compiling' }>), identity } }, step: step('phase4', authority.phase7Authority), authority: phase4Authority })).rejects.toThrow()
    const phase5Authority = authority.phase7Authority.phase6Authority.phase5Authority
    await expect(writer.write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step('phase5', authority.phase7Authority), authority: phase5Authority })).rejects.toThrow()
  })

  test('rejects conflicting and damaged deterministic finals, including empty directories', async () => {
    const authority = authorityFixture()
    const writer = new GameIrStageCheckpointWriter()
    const run = runFor(authority)
    await persist(workspaces[0]!, run)
    const phase4Authority = authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority
    const ref = await writer.write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step('phase4', authority.phase7Authority), authority: phase4Authority })
    const manifestPath = join(workspaces[0]!, ref.checkpointPath)
    await writeFile(manifestPath, '{}')
    await expect(writer.write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step('phase4', authority.phase7Authority), authority: phase4Authority })).rejects.toThrow()
    await writeFile(manifestPath, await readFile(manifestPath).catch(() => '{}'))
    const root = join(workspaces[0]!, '.beegame/ir/runs/checkpoint-run/checkpoints')
    await rm(join(root, 'phase4'), { recursive: true, force: true })
    await import('node:fs/promises').then(fs => fs.mkdir(join(root, 'phase4'), { recursive: true }))
    await expect(writer.write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step('phase4', authority.phase7Authority), authority: phase4Authority })).rejects.toThrow()
  })

  test('rejects root and intermediate symlinks and adopts filesystem-before-snapshot checkpoints monotonically', async () => {
    const authority = authorityFixture()
    const run = runFor(authority)
    await persist(workspaces[0]!, run)
    const phase4Authority = authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority
    const ref = await new GameIrStageCheckpointWriter().write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step('phase4', authority.phase7Authority), authority: phase4Authority })
    const recovered = await new GameIrStageCheckpointLoader().recover({ workspacePath: workspaces[0]!, deliveryRun: run })
    expect(recovered.gameIrState?.status === 'compiling' ? recovered.gameIrState.latestCheckpoint : undefined).toEqual(ref)
    const withPointer = { ...run, gameIrState: { ...run.gameIrState!, latestCheckpoint: ref } }
    await expect(new GameIrStageCheckpointLoader().recover({ workspacePath: workspaces[0]!, deliveryRun: withPointer })).resolves.toEqual(withPointer)
    const secondWorkspace = await mkdtemp(join(tmpdir(), 'game-ir-stage-root-link-'))
    workspaces.push(secondWorkspace)
    const outside = await mkdtemp(join(tmpdir(), 'game-ir-stage-outside-'))
    await symlink(outside, join(secondWorkspace, '.beegame'))
    await expect(new GameIrStageCheckpointWriter().write({ workspacePath: secondWorkspace, deliveryRun: run, step: step('phase4', authority.phase7Authority), authority: phase4Authority })).rejects.toThrow()
    await rm(outside, { recursive: true, force: true })
  })

  test('uses the strict durable snapshot and fails fast when the mutation lease is already held', async () => {
    const authority = authorityFixture()
    const run = runFor(authority)
    const phase4Authority = authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority
    await persist(workspaces[0]!, run)
    const store = createRunStore(workspaces[0]!, run.ownerId)
    const lease = await store.mutationLock(run.runId)
    try {
      await expect(new GameIrStageCheckpointWriter().write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step('phase4', authority.phase7Authority), authority: phase4Authority })).rejects.toThrow('mutation lease')
    } finally {
      await store.unlock(lease)
    }
    const stale = { ...run, gameIrState: { ...(run.gameIrState as Extract<DeliveryRun['gameIrState'], { status: 'compiling' }>), identity: { ...(run.gameIrState as Extract<DeliveryRun['gameIrState'], { status: 'compiling' }>).identity, publicationId: 'stale-publication' } } }
    await expect(new GameIrStageCheckpointWriter().write({ workspacePath: workspaces[0]!, deliveryRun: stale, step: step('phase4', authority.phase7Authority), authority: phase4Authority })).rejects.toThrow()
  })

  test('asserts the exact manifest envelope and rejects unknown persisted fields', async () => {
    const authority = authorityFixture()
    const run = runFor(authority)
    const phase4Authority = authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority
    await persist(workspaces[0]!, run)
    const ref = await new GameIrStageCheckpointWriter().write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step('phase4', authority.phase7Authority), authority: phase4Authority })
    const manifestPath = join(workspaces[0]!, ref.checkpointPath)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    expect(Object.keys(manifest).sort()).toEqual(['authoritySectionIndex', 'compileRequestDigest', 'foundationReadyBinding', 'identity', 'manifestDigest', 'phase', 'records', 'schemaVersion'])
    await writeFile(manifestPath, JSON.stringify({ ...manifest, unknown: true }))
    await expect(new GameIrStageCheckpointLoader().load({ workspacePath: workspaces[0]!, deliveryRun: { ...run, gameIrState: { ...(run.gameIrState as Extract<DeliveryRun['gameIrState'], { status: 'compiling' }>), latestCheckpoint: ref } } })).rejects.toThrow()
  })

  test('reclaims a crashed mutation lease before committing the checkpoint', async () => {
    const authority = authorityFixture()
    const run = runFor(authority)
    const phase4Authority = authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority
    await persist(workspaces[0]!, run)
    const store = createRunStore(workspaces[0]!, run.ownerId)
    await import('node:fs/promises').then(fs => fs.writeFile(store.paths.lock, JSON.stringify({ ownerId: run.ownerId, runId: run.runId, leaseId: 'dead-lease', processId: 999999, purpose: 'mutation', acquiredAt: new Date(0).toISOString(), heartbeatAt: new Date(0).toISOString() })))
    await expect(new GameIrStageCheckpointWriter().write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step('phase4', authority.phase7Authority), authority: phase4Authority })).resolves.toBeDefined()
  })

  test('serializes same-owner concurrent writers with one durable winner and one fast lock failure', async () => {
    const authority = authorityFixture()
    const run = runFor(authority)
    const phase4Authority = authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority
    await persist(workspaces[0]!, run)
    const results = await Promise.allSettled([
      new GameIrStageCheckpointWriter().write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step('phase4', authority.phase7Authority), authority: phase4Authority }),
      new GameIrStageCheckpointWriter().write({ workspacePath: workspaces[0]!, deliveryRun: run, step: step('phase4', authority.phase7Authority), authority: phase4Authority }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  })
})
