import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readCommittedGameIr } from './committed-reader'
import { parseWorkerTerminalResult } from '../worker-contracts'
import { readSecureWorkspaceFile } from '../secure-file'
import { implementationVerificationFixture } from './implementation-verification-test-helpers'
import { prepareImplementationVerificationSemanticValidationPacket } from './phase7-admission'
import type { ImplementationVerificationAssemblyAuthority } from './implementation-verification-assembler'
import type { ResourceRealizationAssemblyAuthority } from './resource-realization-assembler'
import { GameIrStageCheckpointLoader, GameIrStageCheckpointWriter, type GameIrCheckpointStep } from './stage-checkpoint'
import { commitGameIrPublication, validateCommittedGameIr } from './publication'
import { createRunStore } from '../run-store'
import { createFoundationAuditState, type FoundationAuditState } from '../foundation-audit-state'
import { FOUNDATION_AUDIT_PRODUCTION_MANIFEST } from '../foundation-audit-production-manifest'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST, FOUNDATION_SEMANTIC_CHECKS } from '../foundation-semantic-audit'
import { CANONICAL_FOUNDATION_DOCUMENTS, DELIVERY_RUN_SCHEMA_VERSION, type DeliveryRun } from '../types'
import { digestGameIrValue } from './model'
import { relativeFoundationAuditArtifactPaths } from '../foundation-audit-artifacts'
import { canonicalCompilerFailureReason, canonicalCompilerDomainResults } from '../controller'

function readerAuthority() {
  const fixture = implementationVerificationFixture()
  const phase6Authority = fixture.phase6Authority as ResourceRealizationAssemblyAuthority
  const preparation = { phase6Authority, implementationVerification: { source: fixture.authority.source, mechanical: fixture.authority.mechanical, semantic: fixture.semantic } } as const
  const packet = prepareImplementationVerificationSemanticValidationPacket(preparation)
  const phase7Authority: ImplementationVerificationAssemblyAuthority = { phase6Authority, implementationVerification: { ...preparation.implementationVerification, validation: { outcome: 'PASS', packetDigest: packet.packetDigest, checkIds: packet.checkIds, coveredTargets: packet.requiredTargets } } }
  const p4 = phase7Authority.phase6Authority.phase5Authority.phase4Authority
  const p5 = phase7Authority.phase6Authority.phase5Authority
  const p6 = phase7Authority.phase6Authority
  return { ...fixture, phase7Authority }
}

function readerFoundationState(request: ReturnType<typeof readerAuthority>['phase7Authority']['phase6Authority']['phase5Authority']['phase4Authority']['gameplay']['source']['compileRequest']): FoundationAuditState {
  const seed = createFoundationAuditState({ revision: request.foundation.foundationRevision, documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest: request.foundation.documentDigests[path] })), manifest: { revision: request.foundation.foundationRevision, status: 'index_staged', catalogVersion: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion, sectionIndexDigest: request.foundation.sectionIndexDigest } })
  const paths = relativeFoundationAuditArtifactPaths(request.foundation.foundationRevision)
  const derivedRoot = paths.sectionIndex.replace('/staging/', '/derived/').replace(/\/section-index\.json$/, '')
  const reviewDigest = request.foundation.authority.kind === 'review' ? request.foundation.authority.reviewDigest : 'c'.repeat(64)
  const issueRegistryDigest = request.foundation.authority.kind === 'review' ? request.foundation.authority.issueRegistryDigest : 'a'.repeat(64)
  const usage = { input_tokens: 1, cache_read_tokens: 1, cache_creation_tokens: 1, completion_tokens: 1, total_tokens: 4 }
  const tasks = FOUNDATION_SEMANTIC_CHECKS.map(check => ({ taskId: `semantic-${check.checkId}`, kind: 'semantic' as const, revision: request.foundation.foundationRevision, checkId: check.checkId, packetDigest: 'a'.repeat(64), modelTier: check.modelTier, status: 'completed' as const, attempt: 1, terminalDigest: 'a'.repeat(64), usage, durationMs: 1, dispatch: { dispatchId: `dispatch-${check.checkId}`, workerType: 'foundation-semantic-reviewer' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: `semantic-${check.checkId}`, revision: request.foundation.foundationRevision, status: 'completed' as const, startedAt: new Date(0).toISOString(), finishedAt: new Date(0).toISOString(), terminalResult: {} }, admittedResult: { checkId: check.checkId, packetIdentity: 'a'.repeat(64), outcome: 'PASS' as const } }))
  return { ...seed, status: 'audit_ready', phaseStartedAt: new Date(0).toISOString(), tasks, semantic: { aggregateUsage: usage }, deterministic: { reviewDigest, issueRegistryPath: `.beegame/audit/foundation/${request.foundation.foundationRevision}/staging/review/issues.json`, issueRegistryDigest, manifestPath: `.beegame/audit/foundation/${request.foundation.foundationRevision}/staging/review/manifest.json`, manifestDigest: 'b'.repeat(64), markerPath: `.beegame/audit/foundation/${request.foundation.foundationRevision}/staging/review/COMMITTED.json`, markerDigest: 'c'.repeat(64), catalogVersion: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion, contractGraphDigest: 'd'.repeat(64), sectionIndexDigest: request.foundation.sectionIndexDigest, factStoreDigest: 'e'.repeat(64) }, derived: { sectionIndexPath: paths.sectionIndex.replace('/staging/', '/derived/'), sectionIndexDigest: request.foundation.sectionIndexDigest, manifestPath: `${derivedRoot}/manifest.json`, manifestDigest: 'd'.repeat(64), factStorePath: `${derivedRoot}/fact-store.json`, factStoreDigest: 'e'.repeat(64), markerPath: `${derivedRoot}/COMMITTED.json`, markerDigest: 'f'.repeat(64) }, review: { reviewDigest, issueRegistryPath: `.beegame/audit/foundation/${request.foundation.foundationRevision}/review/${reviewDigest}/issue-registry.json`, issueRegistryDigest, manifestPath: `.beegame/audit/foundation/${request.foundation.foundationRevision}/review/${reviewDigest}/manifest.json`, manifestDigest: 'b'.repeat(64), markerPath: `.beegame/audit/foundation/${request.foundation.foundationRevision}/review/${reviewDigest}/COMMITTED.json`, markerDigest: 'c'.repeat(64), sectionIndexDigest: request.foundation.sectionIndexDigest, factStoreDigest: 'e'.repeat(64), semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest, issueSummary: { total: 0, blocker: 0, high: 0, medium: 0, low: 0 } } }
}

function readerRun(authority: ReturnType<typeof readerAuthority>): DeliveryRun {
  const request = authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority.gameplay.source.compileRequest
  const foundationAuditState = readerFoundationState(request)
  return { schemaVersion: DELIVERY_RUN_SCHEMA_VERSION, runId: 'reader-run', ownerId: 'reader-owner', projectId: request.foundation.projectId, confirmedBriefDigest: request.foundation.confirmedBriefDigest, confirmedBriefContext: 'fixture', phase: 'GAME_IR_COMPILATION', status: 'running', revision: { document: request.foundation.foundationRevision, workspace: 'reader-workspace' }, tasks: [], evidence: {}, foundationDraftState: { completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS] }, foundationAuditState, gameIrState: { status: 'compiling', identity: { runId: 'reader-run', taskId: request.taskId, publicationId: request.publicationId, confirmedBriefDigest: request.foundation.confirmedBriefDigest, foundationRevision: request.foundation.foundationRevision, foundationReadyReceiptDigest: request.foundation.receiptDigest } }, resourceProductionState: { currentTask: 'RESOURCE_PLAN' }, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() } as DeliveryRun
}

function readerStep(phase: 'phase4' | 'phase5' | 'phase6' | 'phase7', authority: ReturnType<typeof readerAuthority>['phase7Authority']): GameIrCheckpointStep {
  const p4 = authority.phase6Authority.phase5Authority.phase4Authority
  const p5 = authority.phase6Authority.phase5Authority
  const p6 = authority.phase6Authority
  const values: Record<string, unknown> = phase === 'phase4' ? { 'phase4/gameplay/source': p4.gameplay.source, 'phase4/gameplay/mechanical': p4.gameplay.mechanical, 'phase4/gameplay/semantic': p4.gameplay.semantic, 'phase4/balance/source': p4.balance.source, 'phase4/balance/mechanical': p4.balance.mechanical, 'phase4/balance/semantic': p4.balance.semantic } : phase === 'phase5' ? { 'phase5/world-scene/source': p5.worldScene.source, 'phase5/world-scene/mechanical': p5.worldScene.mechanical, 'phase5/world-scene/semantic': p5.worldScene.semantic, 'phase5/world-scene/validation': p5.worldScene.validation, 'phase5/presentation/source': p5.presentation.source, 'phase5/presentation/mechanical': p5.presentation.mechanical, 'phase5/presentation/semantic': p5.presentation.semantic, 'phase5/presentation/validation': p5.presentation.validation } : phase === 'phase6' ? { 'phase6/resource-realization/source': p6.resourceRealization.source, 'phase6/resource-realization/mechanical': p6.resourceRealization.mechanical, 'phase6/resource-realization/semantic': p6.resourceRealization.semantic, 'phase6/resource-realization/validation': p6.resourceRealization.validation } : { 'phase7/implementation-verification/source': authority.implementationVerification.source, 'phase7/implementation-verification/mechanical': authority.implementationVerification.mechanical, 'phase7/implementation-verification/semantic': authority.implementationVerification.semantic, 'phase7/implementation-verification/validation': authority.implementationVerification.validation }
  return { phase, records: Object.entries(values).map(([kind, record]) => ({ kind, record })) as GameIrCheckpointStep['records'] }
}

describe('committed Game IR reader', () => {
  test('canonicalizes compiler failure reasons and preserves material diagnostics', () => {
    expect(canonicalCompilerFailureReason('source digest mismatch at 2026-09-01T00:00:00Z id 123')).toBe(
      canonicalCompilerFailureReason('digest mismatch source at 2026-09-02T00:00:00Z id 456'),
    )
    expect(canonicalCompilerFailureReason('source digest mismatch')).not.toBe(
      canonicalCompilerFailureReason('publication digest mismatch'),
    )
    expect(canonicalCompilerFailureReason('missing 1 required section')).not.toBe(
      canonicalCompilerFailureReason('missing 2 required sections'),
    )
    expect(canonicalCompilerFailureReason('expected 4 modules, received 3')).not.toBe(
      canonicalCompilerFailureReason('expected 6 modules, received 2'),
    )
    const failed = canonicalCompilerDomainResults([{
      moduleId: 'gameplay',
      semantic: {
        outcome: 'FAIL',
        reasonCode: 'missing-source',
        actual: 'observed source',
        missingSubject: 'loop',
        expectedProjection: 'one loop',
        evidencePointers: ['docs/GDD.md#loop'],
      },
    }])!
    expect(failed[0]!.semantic).toMatchObject({ actual: 'observed source', expectedProjection: 'one loop' })
  })

  test('exposes the single workspace/run-bound reader entry point', async () => {
    await expect(
      readCommittedGameIr({ workspacePath: '/tmp/missing-game-ir', deliveryRun: {} as never }),
    ).rejects.toThrow()
  })

  test('rejects caller-supplied alternate reader authority', async () => {
    await expect(
      readCommittedGameIr({
        workspacePath: '/tmp/missing-game-ir',
        deliveryRun: {} as never,
        candidate: {} as never,
      } as never),
    ).rejects.toThrow('reader accepts only workspacePath and deliveryRun')
  })

  test('rejects self-authorizing compiler checkpoint and READY fields', () => {
    const terminal = {
      workerType: 'game-ir-compiler',
      status: 'completed',
      runId: 'run',
      dispatchId: 'dispatch',
      taskId: 'task',
      revision: 'revision',
      compileRequestDigest: 'a'.repeat(64),
      foundationReadyReceiptDigest: 'b'.repeat(64),
      domainResults: [],
      checkpoint: { checkpointPath: 'forged', checkpointDigest: 'c'.repeat(64) },
      readyReceipt: {},
    }
    expect(() => parseWorkerTerminalResult(terminal)).toThrow()
  })

  test('accepts only strict semantic and validation DTOs from the compiler', () => {
    const terminal = {
      workerType: 'game-ir-compiler',
      status: 'completed',
      runId: 'run',
      dispatchId: 'dispatch',
      taskId: 'task',
      revision: 'revision',
      compileRequestDigest: 'a'.repeat(64),
      foundationReadyReceiptDigest: 'b'.repeat(64),
      domainResults: [{
        moduleId: 'gameplay',
        semantic: {
          outcome: 'PROJECTED',
          nodes: [],
          sourceClaims: [],
        },
        mechanical: [],
      }],
    }
    expect(() => parseWorkerTerminalResult(terminal)).toThrow()
  })

  test('requires changed compiler progress to remain in the same identity loop', () => {
    const terminal = {
      workerType: 'game-ir-compiler',
      status: 'failed',
      runId: 'run',
      dispatchId: 'dispatch',
      taskId: 'task',
      revision: 'revision',
      compileRequestDigest: 'a'.repeat(64),
      foundationReadyReceiptDigest: 'b'.repeat(64),
      reason: 'domain result needs repair',
    }
    expect(parseWorkerTerminalResult(terminal)).toMatchObject({ status: 'failed' })
  })

  test('reads a real Phase 4-7 checkpoint and publication fixture, then fails closed on marker tamper', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'game-ir-reader-fixture-'))
    try {
      const authority = readerAuthority()
      let run = readerRun(authority)
      await createRunStore(workspace, run.ownerId).save(run)
      const writer = new GameIrStageCheckpointWriter()
      for (const phase of ['phase4', 'phase5', 'phase6', 'phase7'] as const) {
        const ref = await writer.write({ workspacePath: workspace, deliveryRun: run, step: readerStep(phase, authority.phase7Authority), authority: phase === 'phase4' ? authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority : phase === 'phase5' ? authority.phase7Authority.phase6Authority.phase5Authority : phase === 'phase6' ? authority.phase7Authority.phase6Authority : authority.phase7Authority })
        run = { ...run, gameIrState: { ...(run.gameIrState as Extract<DeliveryRun['gameIrState'], { status: 'compiling' }>), latestCheckpoint: ref } }
        await createRunStore(workspace, run.ownerId).save(run)
      }
      const readyReceipt = await commitGameIrPublication({ workspacePath: workspace, publicationId: authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority.gameplay.source.compileRequest.publicationId, phase7Authority: authority.phase7Authority })
      const committed = await validateCommittedGameIr({ workspacePath: workspace, publicationId: readyReceipt.publicationId, phase7Authority: authority.phase7Authority })
      expect(committed).toEqual(readyReceipt)
      const compilingState = run.gameIrState as Extract<DeliveryRun['gameIrState'], { status: 'compiling' }>
      const readyRun = {
        ...run,
        phase: 'DOCUMENT_REVIEW' as const,
        documentStep: 'CHECKLIST_DRAFTING' as const,
        gameIrState: {
          status: 'ready' as const,
          identity: compilingState.identity,
          checkpoint: compilingState.latestCheckpoint!,
          readyReceipt,
          readyReceiptDigest: digestGameIrValue(readyReceipt),
        },
      } as DeliveryRun
      const projection = await readCommittedGameIr({ workspacePath: workspace, deliveryRun: readyRun })
      expect(projection.readyReceipt).toEqual(readyReceipt)
      expect(projection.executionProjection.units.every(node => node.payload.kind === 'implementation-verification.unit')).toBe(true)
      expect(projection.resourceProjection.deliveryArtifacts.every(node => node.payload.kind === 'resource-realization.delivery-artifact')).toBe(true)
      const tamperCases = [
        { path: join(workspace, readyReceipt.committedPath, '..', 'COMMITTED.json') },
        { path: join(workspace, readyReceipt.committedPath, '..', 'manifest.json') },
        { path: join(workspace, (run.gameIrState as Extract<DeliveryRun['gameIrState'], { status: 'compiling' }>).latestCheckpoint!.checkpointPath.replace(/manifest\.json$/, 'records/phase7__implementation-verification__source.json')) },
      ]
      for (const tamper of tamperCases) {
        const original = await readFile(tamper.path)
        await writeFile(tamper.path, Buffer.concat([original, Buffer.from('tampered')]))
        await expect(readCommittedGameIr({ workspacePath: workspace, deliveryRun: readyRun })).rejects.toThrow()
        await writeFile(tamper.path, original)
      }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 20_000)

  test('reads only regular workspace files and rejects symlinked components', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'game-ir-reader-'))
    try {
      await mkdir(join(workspace, 'canonical'))
      await writeFile(join(workspace, 'canonical', 'READY.json'), '{"status":"ready"}\n')
      expect(await readSecureWorkspaceFile(workspace, 'canonical/READY.json')).toContain('ready')
      await symlink(join(workspace, 'canonical'), join(workspace, 'alias'))
      await expect(readSecureWorkspaceFile(workspace, 'alias/READY.json')).rejects.toThrow(/symlink|component/i)
      await symlink(join(workspace, 'canonical', 'READY.json'), join(workspace, 'canonical', 'alias.json'))
      await expect(readSecureWorkspaceFile(workspace, 'canonical/alias.json')).rejects.toThrow()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
