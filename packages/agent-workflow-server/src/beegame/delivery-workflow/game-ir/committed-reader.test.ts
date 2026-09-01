import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readCommittedGameIr } from './committed-reader'
import { parseWorkerTerminalResult } from '../worker-contracts'
import { readSecureWorkspaceFile } from '../secure-file'
import { implementationVerificationFixture } from './implementation-verification-test-helpers'
import { prepareImplementationVerificationSemanticValidationPacket } from './phase7-admission'
import type { ImplementationVerificationAssemblyAuthority } from './implementation-verification-assembler'
import type { ResourceRealizationAssemblyAuthority } from './resource-realization-assembler'
import {
  GameIrStageCheckpointLoader,
  GameIrStageCheckpointWriter,
  type GameIrCheckpointStep,
} from './stage-checkpoint'
import { commitGameIrPublication, validateCommittedGameIr } from './publication'
import { createRunStore } from '../run-store'
import {
  createFoundationAuditState,
  type FoundationAuditState,
} from '../foundation-audit-state'
import { FOUNDATION_AUDIT_PRODUCTION_MANIFEST } from '../foundation-audit-production-manifest'
import {
  FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
  FOUNDATION_SEMANTIC_CHECKS,
} from '../foundation-semantic-audit'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  DELIVERY_RUN_SCHEMA_VERSION,
  type DeliveryRun,
} from '../types'
import { canonicalGameIrJson, digestGameIrValue } from './model'
import { relativeFoundationAuditArtifactPaths } from '../foundation-audit-artifacts'
import {
  canonicalCompilerFailureReason,
  canonicalCompilerDomainResults,
} from '../controller'
import {
  GAME_IR_CANONICAL_MODULE_IDS,
  GAME_IR_PUBLICATION_ROOT,
} from './contracts'

function readerAuthority() {
  const fixture = implementationVerificationFixture()
  const phase6Authority =
    fixture.phase6Authority as ResourceRealizationAssemblyAuthority
  const preparation = {
    phase6Authority,
    implementationVerification: {
      source: fixture.authority.source,
      mechanical: fixture.authority.mechanical,
      semantic: fixture.semantic,
    },
  } as const
  const packet =
    prepareImplementationVerificationSemanticValidationPacket(preparation)
  const phase7Authority: ImplementationVerificationAssemblyAuthority = {
    phase6Authority,
    implementationVerification: {
      ...preparation.implementationVerification,
      validation: {
        outcome: 'PASS',
        packetDigest: packet.packetDigest,
        checkIds: packet.checkIds,
        coveredTargets: packet.requiredTargets,
      },
    },
  }
  const p4 = phase7Authority.phase6Authority.phase5Authority.phase4Authority
  const p5 = phase7Authority.phase6Authority.phase5Authority
  const p6 = phase7Authority.phase6Authority
  return { ...fixture, phase7Authority }
}

function readerFoundationState(
  request: ReturnType<
    typeof readerAuthority
  >['phase7Authority']['phase6Authority']['phase5Authority']['phase4Authority']['gameplay']['source']['compileRequest'],
): FoundationAuditState {
  const seed = createFoundationAuditState({
    revision: request.foundation.foundationRevision,
    documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
      path,
      digest: request.foundation.documentDigests[path],
    })),
    manifest: {
      revision: request.foundation.foundationRevision,
      status: 'index_staged',
      catalogVersion: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion,
      sectionIndexDigest: request.foundation.sectionIndexDigest,
    },
  })
  const paths = relativeFoundationAuditArtifactPaths(
    request.foundation.foundationRevision,
  )
  const derivedRoot = paths.sectionIndex
    .replace('/staging/', '/derived/')
    .replace(/\/section-index\.json$/, '')
  const reviewDigest =
    request.foundation.authority.kind === 'review'
      ? request.foundation.authority.reviewDigest
      : 'c'.repeat(64)
  const issueRegistryDigest =
    request.foundation.authority.kind === 'review'
      ? request.foundation.authority.issueRegistryDigest
      : 'a'.repeat(64)
  const usage = {
    input_tokens: 1,
    cache_read_tokens: 1,
    cache_creation_tokens: 1,
    completion_tokens: 1,
    total_tokens: 4,
  }
  const tasks = FOUNDATION_SEMANTIC_CHECKS.map(check => ({
    taskId: `semantic-${check.checkId}`,
    kind: 'semantic' as const,
    revision: request.foundation.foundationRevision,
    checkId: check.checkId,
    packetDigest: 'a'.repeat(64),
    modelTier: check.modelTier,
    status: 'completed' as const,
    attempt: 1,
    terminalDigest: 'a'.repeat(64),
    usage,
    durationMs: 1,
    dispatch: {
      dispatchId: `dispatch-${check.checkId}`,
      workerType: 'foundation-semantic-reviewer' as const,
      phase: 'DOCUMENT_REVIEW' as const,
      taskId: `semantic-${check.checkId}`,
      revision: request.foundation.foundationRevision,
      status: 'completed' as const,
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(0).toISOString(),
      terminalResult: {},
    },
    admittedResult: {
      checkId: check.checkId,
      packetIdentity: 'a'.repeat(64),
      outcome: 'PASS' as const,
    },
  }))
  return {
    ...seed,
    status: 'audit_ready',
    phaseStartedAt: new Date(0).toISOString(),
    tasks,
    semantic: { aggregateUsage: usage },
    deterministic: {
      reviewDigest,
      issueRegistryPath: `.beegame/audit/foundation/${request.foundation.foundationRevision}/staging/review/issues.json`,
      issueRegistryDigest,
      manifestPath: `.beegame/audit/foundation/${request.foundation.foundationRevision}/staging/review/manifest.json`,
      manifestDigest: 'b'.repeat(64),
      markerPath: `.beegame/audit/foundation/${request.foundation.foundationRevision}/staging/review/COMMITTED.json`,
      markerDigest: 'c'.repeat(64),
      catalogVersion: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion,
      contractGraphDigest: 'd'.repeat(64),
      sectionIndexDigest: request.foundation.sectionIndexDigest,
      factStoreDigest: 'e'.repeat(64),
    },
    derived: {
      sectionIndexPath: paths.sectionIndex.replace('/staging/', '/derived/'),
      sectionIndexDigest: request.foundation.sectionIndexDigest,
      manifestPath: `${derivedRoot}/manifest.json`,
      manifestDigest: 'd'.repeat(64),
      factStorePath: `${derivedRoot}/fact-store.json`,
      factStoreDigest: 'e'.repeat(64),
      markerPath: `${derivedRoot}/COMMITTED.json`,
      markerDigest: 'f'.repeat(64),
    },
    review: {
      reviewDigest,
      issueRegistryPath: `.beegame/audit/foundation/${request.foundation.foundationRevision}/review/${reviewDigest}/issue-registry.json`,
      issueRegistryDigest,
      manifestPath: `.beegame/audit/foundation/${request.foundation.foundationRevision}/review/${reviewDigest}/manifest.json`,
      manifestDigest: 'b'.repeat(64),
      markerPath: `.beegame/audit/foundation/${request.foundation.foundationRevision}/review/${reviewDigest}/COMMITTED.json`,
      markerDigest: 'c'.repeat(64),
      sectionIndexDigest: request.foundation.sectionIndexDigest,
      factStoreDigest: 'e'.repeat(64),
      semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest,
      issueSummary: { total: 0, blocker: 0, high: 0, medium: 0, low: 0 },
    },
  }
}

function readerRun(authority: ReturnType<typeof readerAuthority>): DeliveryRun {
  const request =
    authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority
      .gameplay.source.compileRequest
  const foundationAuditState = readerFoundationState(request)
  return {
    schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
    runId: 'reader-run',
    ownerId: 'reader-owner',
    projectId: request.foundation.projectId,
    confirmedBriefDigest: request.foundation.confirmedBriefDigest,
    confirmedBriefContext: 'fixture',
    phase: 'GAME_IR_COMPILATION',
    status: 'running',
    revision: {
      document: request.foundation.foundationRevision,
      workspace: 'reader-workspace',
    },
    tasks: [],
    evidence: {},
    foundationDraftState: {
      completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
    },
    foundationAuditState,
    gameIrState: {
      status: 'compiling',
      identity: {
        runId: 'reader-run',
        taskId: request.taskId,
        publicationId: request.publicationId,
        confirmedBriefDigest: request.foundation.confirmedBriefDigest,
        foundationRevision: request.foundation.foundationRevision,
        foundationReadyReceiptDigest: request.foundation.receiptDigest,
      },
    },
    resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  } as DeliveryRun
}

function readerStep(
  phase: 'phase4' | 'phase5' | 'phase6' | 'phase7',
  authority: ReturnType<typeof readerAuthority>['phase7Authority'],
): GameIrCheckpointStep {
  const p4 = authority.phase6Authority.phase5Authority.phase4Authority
  const p5 = authority.phase6Authority.phase5Authority
  const p6 = authority.phase6Authority
  const values: Record<string, unknown> =
    phase === 'phase4'
      ? {
          'phase4/gameplay/source': p4.gameplay.source,
          'phase4/gameplay/mechanical': p4.gameplay.mechanical,
          'phase4/gameplay/semantic': p4.gameplay.semantic,
          'phase4/balance/source': p4.balance.source,
          'phase4/balance/mechanical': p4.balance.mechanical,
          'phase4/balance/semantic': p4.balance.semantic,
        }
      : phase === 'phase5'
        ? {
            'phase5/world-scene/source': p5.worldScene.source,
            'phase5/world-scene/mechanical': p5.worldScene.mechanical,
            'phase5/world-scene/semantic': p5.worldScene.semantic,
            'phase5/world-scene/validation': p5.worldScene.validation,
            'phase5/presentation/source': p5.presentation.source,
            'phase5/presentation/mechanical': p5.presentation.mechanical,
            'phase5/presentation/semantic': p5.presentation.semantic,
            'phase5/presentation/validation': p5.presentation.validation,
          }
        : phase === 'phase6'
          ? {
              'phase6/resource-realization/source':
                p6.resourceRealization.source,
              'phase6/resource-realization/mechanical':
                p6.resourceRealization.mechanical,
              'phase6/resource-realization/semantic':
                p6.resourceRealization.semantic,
              'phase6/resource-realization/validation':
                p6.resourceRealization.validation,
            }
          : {
              'phase7/implementation-verification/source':
                authority.implementationVerification.source,
              'phase7/implementation-verification/mechanical':
                authority.implementationVerification.mechanical,
              'phase7/implementation-verification/semantic':
                authority.implementationVerification.semantic,
              'phase7/implementation-verification/validation':
                authority.implementationVerification.validation,
            }
  return {
    phase,
    records: Object.entries(values).map(([kind, record]) => ({
      kind,
      record,
    })) as GameIrCheckpointStep['records'],
  }
}

async function materializeReaderFixture(workspace: string) {
  const authority = readerAuthority()
  let run = readerRun(authority)
  await createRunStore(workspace, run.ownerId).save(run)
  const writer = new GameIrStageCheckpointWriter()
  for (const phase of ['phase4', 'phase5', 'phase6', 'phase7'] as const) {
    const ref = await writer.write({
      workspacePath: workspace,
      deliveryRun: run,
      step: readerStep(phase, authority.phase7Authority),
      authority:
        phase === 'phase4'
          ? authority.phase7Authority.phase6Authority.phase5Authority
              .phase4Authority
          : phase === 'phase5'
            ? authority.phase7Authority.phase6Authority.phase5Authority
            : phase === 'phase6'
              ? authority.phase7Authority.phase6Authority
              : authority.phase7Authority,
    })
    run = {
      ...run,
      gameIrState: {
        ...(run.gameIrState as Extract<
          DeliveryRun['gameIrState'],
          { status: 'compiling' }
        >),
        latestCheckpoint: ref,
      },
    }
    await createRunStore(workspace, run.ownerId).save(run)
  }
  const readyReceipt = await commitGameIrPublication({
    workspacePath: workspace,
    publicationId:
      authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority
        .gameplay.source.compileRequest.publicationId,
    phase7Authority: authority.phase7Authority,
  })
  const compilingState = run.gameIrState as Extract<
    DeliveryRun['gameIrState'],
    { status: 'compiling' }
  >
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
  return {
    authority,
    run,
    readyRun,
    readyReceipt,
    publicationRoot: join(workspace, readyReceipt.committedPath, '..'),
  }
}

function canonicalBytes(value: unknown): string {
  return `${canonicalGameIrJson(value)}\n`
}

function byteDigest(bytes: string): string {
  return createHash('sha256').update(bytes, 'utf8').digest('hex')
}

async function jsonRecord(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
}

async function writeCanonical(path: string, value: unknown): Promise<string> {
  const bytes = canonicalBytes(value)
  await writeFile(path, bytes)
  return byteDigest(bytes)
}

async function resealPublication(input: {
  authority: ReturnType<typeof readerAuthority>
  workspace: string
  publicationRoot: string
  readyRun: DeliveryRun
  mutate: (
    publicationRoot: string,
    manifest: Record<string, unknown>,
  ) => Promise<void> | void
}): Promise<DeliveryRun> {
  const manifestPath = join(input.publicationRoot, 'manifest.json')
  const markerPath = join(input.publicationRoot, 'COMMITTED.json')
  const manifest = await jsonRecord(manifestPath)
  await input.mutate(input.publicationRoot, manifest)
  const manifestDigest = await writeCanonical(manifestPath, manifest)
  const modules = manifest.modules as Array<Record<string, unknown>>
  const state = input.readyRun.gameIrState as Extract<
    DeliveryRun['gameIrState'],
    { status: 'ready' }
  >
  const moduleDigests = { ...state.readyReceipt.moduleDigests }
  const sourceMapDigests = { ...state.readyReceipt.sourceMapDigests }
  for (const moduleId of GAME_IR_CANONICAL_MODULE_IDS) {
    const entry = modules.find(candidate => candidate.moduleId === moduleId)
    if (entry) {
      moduleDigests[moduleId] = String(entry.digest)
      sourceMapDigests[moduleId] = String(entry.sourceMapDigest)
    }
  }
  const artifactPaths = [
    ...GAME_IR_CANONICAL_MODULE_IDS.map(moduleId => `modules/${moduleId}.json`),
    ...GAME_IR_CANONICAL_MODULE_IDS.map(
      moduleId => `source-maps/${moduleId}.json`,
    ),
    'dependency-graph.json',
    'manifest.json',
  ]
  const artifacts = await Promise.all(
    artifactPaths.map(async path => ({
      path,
      digest: byteDigest(
        await readFile(join(input.publicationRoot, path), 'utf8'),
      ),
    })),
  )
  const source =
    input.authority.phase7Authority.phase6Authority.phase5Authority
      .phase4Authority.gameplay.source
  const authorityDigest = byteDigest(
    canonicalGameIrJson({
      publicationId: manifest.publicationId,
      compileRequest: manifest.compileRequest,
      candidateDigest: manifest.candidateDigest,
      sectionIndex: source.authoritySectionIndex,
      semanticEvidence: manifest.semanticEvidence,
      artifacts,
    }),
  )
  const marker = await jsonRecord(markerPath)
  Object.assign(marker, {
    authorityDigest,
    manifestDigest,
    candidateDigest: manifest.candidateDigest,
    compileRequestDigest: manifest.compileRequestDigest,
    foundationReceiptDigest: manifest.foundationReceiptDigest,
    moduleDigests,
    sourceMapDigests,
    dependencyGraphDigest: manifest.dependencyGraphDigest,
  })
  const markerDigest = await writeCanonical(markerPath, marker)
  const journalPath = join(
    input.workspace,
    GAME_IR_PUBLICATION_ROOT,
    '.journal',
    `${String(manifest.publicationId)}.json`,
  )
  const journal = await jsonRecord(journalPath)
  Object.assign(journal, {
    authorityDigest,
    candidateDigest: manifest.candidateDigest,
    compileRequestDigest: manifest.compileRequestDigest,
    foundationReceiptDigest: manifest.foundationReceiptDigest,
    entries: [...artifacts, { path: 'COMMITTED.json', digest: markerDigest }],
  })
  await writeCanonical(journalPath, journal)
  const readyReceipt = {
    ...state.readyReceipt,
    manifestDigest,
    moduleDigests,
    sourceMapDigests,
    dependencyGraphDigest: String(manifest.dependencyGraphDigest),
  }
  return {
    ...input.readyRun,
    gameIrState: {
      ...state,
      readyReceipt,
      readyReceiptDigest: digestGameIrValue(readyReceipt),
    },
  }
}

const resealedPublicationMutations: ReadonlyArray<{
  name: string
  mutate: (
    publicationRoot: string,
    manifest: Record<string, unknown>,
  ) => Promise<void> | void
}> = [
  {
    name: 'duplicate canonical module',
    mutate: (_root, manifest) => {
      const modules = manifest.modules as Array<Record<string, unknown>>
      modules[modules.length - 1] = { ...modules[0]! }
    },
  },
  {
    name: 'placeholder core module',
    mutate: (_root, manifest) => {
      const modules = manifest.modules as Array<Record<string, unknown>>
      modules[0] = { ...modules[0]!, moduleId: 'core' }
    },
  },
  {
    name: 'detached semantic evidence',
    mutate: (_root, manifest) => {
      const evidence = manifest.semanticEvidence as Array<
        Record<string, unknown>
      >
      evidence[0] = { ...evidence[0]!, projectionDigest: 'f'.repeat(64) }
    },
  },
  {
    name: 'module identity remap',
    mutate: async (root, manifest) => {
      const modules = manifest.modules as Array<Record<string, unknown>>
      const entry = modules[0]!
      const path = join(root, String(entry.path))
      const module = await jsonRecord(path)
      module.moduleId = 'gameplay'
      entry.digest = await writeCanonical(path, module)
    },
  },
  {
    name: 'source map detachment',
    mutate: async (root, manifest) => {
      const modules = manifest.modules as Array<Record<string, unknown>>
      const entry = modules[0]!
      const path = join(root, String(entry.sourceMapPath))
      const sourceMap = await jsonRecord(path)
      sourceMap.moduleId = 'gameplay'
      entry.sourceMapDigest = await writeCanonical(path, sourceMap)
    },
  },
  {
    name: 'dependency graph detachment',
    mutate: async (root, manifest) => {
      const path = join(root, String(manifest.dependencyGraphPath))
      const graph = await jsonRecord(path)
      graph.edges = [
        ...(graph.edges as unknown[]),
        {
          kind: 'reference',
          type: 'reference',
          from: 'balance/forged',
          to: 'gameplay/forged',
          targetType: 'node',
        },
      ]
      manifest.dependencyGraphDigest = await writeCanonical(path, graph)
    },
  },
]

describe('committed Game IR reader', () => {
  test('canonicalizes compiler failure reasons and preserves material diagnostics', () => {
    expect(
      canonicalCompilerFailureReason(
        'source digest mismatch at 2026-09-01T00:00:00Z id 123',
      ),
    ).toBe(
      canonicalCompilerFailureReason(
        'digest mismatch source at 2026-09-02T00:00:00Z id 456',
      ),
    )
    expect(canonicalCompilerFailureReason('source digest mismatch')).not.toBe(
      canonicalCompilerFailureReason('publication digest mismatch'),
    )
    expect(
      canonicalCompilerFailureReason('missing 1 required section'),
    ).not.toBe(canonicalCompilerFailureReason('missing 2 required sections'))
    expect(
      canonicalCompilerFailureReason('expected 4 modules, received 3'),
    ).not.toBe(canonicalCompilerFailureReason('expected 6 modules, received 2'))
    const failed = canonicalCompilerDomainResults([
      {
        moduleId: 'gameplay',
        semantic: {
          outcome: 'FAIL',
          reasonCode: 'missing-source',
          actual: 'observed source',
          missingSubject: 'loop',
          expectedProjection: 'one loop',
          evidencePointers: ['docs/GDD.md#loop'],
        },
      },
    ])!
    expect(failed[0]!.semantic).toMatchObject({
      actual: 'observed source',
      expectedProjection: 'one loop',
    })
  })

  test('exposes the single workspace/run-bound reader entry point', async () => {
    await expect(
      readCommittedGameIr({
        workspacePath: '/tmp/missing-game-ir',
        deliveryRun: {} as never,
      }),
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
      checkpoint: {
        checkpointPath: 'forged',
        checkpointDigest: 'c'.repeat(64),
      },
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
      domainResults: [
        {
          moduleId: 'gameplay',
          semantic: {
            outcome: 'PROJECTED',
            nodes: [],
            sourceClaims: [],
          },
          mechanical: [],
        },
      ],
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
    expect(parseWorkerTerminalResult(terminal)).toMatchObject({
      status: 'failed',
    })
  })

  test('reads a real Phase 4-7 checkpoint and publication fixture, then fails closed on marker tamper', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'game-ir-reader-fixture-'))
    try {
      const { authority, run, readyRun, readyReceipt } =
        await materializeReaderFixture(workspace)
      const committed = await validateCommittedGameIr({
        workspacePath: workspace,
        publicationId: readyReceipt.publicationId,
        phase7Authority: authority.phase7Authority,
      })
      expect(committed).toEqual(readyReceipt)
      const projection = await readCommittedGameIr({
        workspacePath: workspace,
        deliveryRun: readyRun,
      })
      expect(projection.readyReceipt).toEqual(readyReceipt)
      expect(
        projection.executionProjection.units.every(
          node => node.payload.kind === 'implementation-verification.unit',
        ),
      ).toBe(true)
      expect(
        projection.resourceProjection.deliveryArtifacts.every(
          node =>
            node.payload.kind === 'resource-realization.delivery-artifact',
        ),
      ).toBe(true)
      const tamperCases = [
        {
          path: join(
            workspace,
            readyReceipt.committedPath,
            '..',
            'COMMITTED.json',
          ),
        },
        {
          path: join(
            workspace,
            readyReceipt.committedPath,
            '..',
            'manifest.json',
          ),
        },
        {
          path: join(
            workspace,
            (
              run.gameIrState as Extract<
                DeliveryRun['gameIrState'],
                { status: 'compiling' }
              >
            ).latestCheckpoint!.checkpointPath.replace(
              /manifest\.json$/,
              'records/phase7__implementation-verification__source.json',
            ),
          ),
        },
      ]
      for (const tamper of tamperCases) {
        const original = await readFile(tamper.path)
        await writeFile(
          tamper.path,
          Buffer.concat([original, Buffer.from('tampered')]),
        )
        await expect(
          readCommittedGameIr({
            workspacePath: workspace,
            deliveryRun: readyRun,
          }),
        ).rejects.toThrow()
        await writeFile(tamper.path, original)
      }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 20_000)

  for (const mutation of resealedPublicationMutations) {
    test(`rejects a digest-resealed ${mutation.name} through the public reader`, async () => {
      const workspace = await mkdtemp(
        join(tmpdir(), 'game-ir-reader-resealed-'),
      )
      try {
        const fixture = await materializeReaderFixture(workspace)
        const resealedRun = await resealPublication({
          authority: fixture.authority,
          workspace,
          publicationRoot: fixture.publicationRoot,
          readyRun: fixture.readyRun,
          mutate: mutation.mutate,
        })
        await expect(
          readCommittedGameIr({
            workspacePath: workspace,
            deliveryRun: resealedRun,
          }),
        ).rejects.toThrow()
      } finally {
        await rm(workspace, { recursive: true, force: true })
      }
    }, 20_000)
  }

  test('rejects every public READY, checkpoint, and run identity digest mismatch', async () => {
    const workspace = await mkdtemp(
      join(tmpdir(), 'game-ir-reader-identities-'),
    )
    try {
      const { readyRun } = await materializeReaderFixture(workspace)
      const state = readyRun.gameIrState as Extract<
        DeliveryRun['gameIrState'],
        { status: 'ready' }
      >
      const mutations: DeliveryRun[] = [
        { ...readyRun, runId: 'forged-run' },
        { ...readyRun, confirmedBriefDigest: 'f'.repeat(64) },
        {
          ...readyRun,
          gameIrState: {
            ...state,
            checkpoint: {
              ...state.checkpoint,
              checkpointDigest: 'f'.repeat(64),
            },
          },
        },
        {
          ...readyRun,
          gameIrState: {
            ...state,
            identity: { ...state.identity, taskId: 'forged-task' },
          },
        },
        {
          ...readyRun,
          gameIrState: {
            ...state,
            identity: {
              ...state.identity,
              publicationId: 'forged-publication',
            },
          },
        },
        {
          ...readyRun,
          gameIrState: {
            ...state,
            identity: {
              ...state.identity,
              foundationReadyReceiptDigest: 'f'.repeat(64),
            },
          },
        },
        {
          ...readyRun,
          gameIrState: { ...state, readyReceiptDigest: 'f'.repeat(64) },
        },
      ]
      for (const deliveryRun of mutations)
        await expect(
          readCommittedGameIr({ workspacePath: workspace, deliveryRun }),
        ).rejects.toThrow()
      for (const field of [
        'manifestDigest',
        'dependencyGraphDigest',
      ] as const) {
        const readyReceipt = { ...state.readyReceipt, [field]: 'f'.repeat(64) }
        const deliveryRun = {
          ...readyRun,
          gameIrState: {
            ...state,
            readyReceipt,
            readyReceiptDigest: digestGameIrValue(readyReceipt),
          },
        }
        await expect(
          readCommittedGameIr({ workspacePath: workspace, deliveryRun }),
        ).rejects.toThrow()
      }
      for (const moduleId of GAME_IR_CANONICAL_MODULE_IDS) {
        for (const field of ['moduleDigests', 'sourceMapDigests'] as const) {
          const readyReceipt = {
            ...state.readyReceipt,
            [field]: {
              ...state.readyReceipt[field],
              [moduleId]: 'f'.repeat(64),
            },
          }
          const deliveryRun = {
            ...readyRun,
            gameIrState: {
              ...state,
              readyReceipt,
              readyReceiptDigest: digestGameIrValue(readyReceipt),
            },
          }
          await expect(
            readCommittedGameIr({ workspacePath: workspace, deliveryRun }),
          ).rejects.toThrow()
        }
      }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 30_000)

  test('does not fall back to staging, old, or previous publication directories', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'game-ir-reader-fallback-'))
    try {
      const { readyRun, publicationRoot } =
        await materializeReaderFixture(workspace)
      for (const suffix of [
        'staging-copy',
        'old-publication',
        'previous-publication',
      ]) {
        const alternate = `${publicationRoot}-${suffix}`
        await rename(publicationRoot, alternate)
        try {
          await expect(
            readCommittedGameIr({
              workspacePath: workspace,
              deliveryRun: readyRun,
            }),
          ).rejects.toThrow()
        } finally {
          await rename(alternate, publicationRoot)
        }
      }
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 30_000)

  test('reads only regular workspace files and rejects symlinked components', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'game-ir-reader-'))
    try {
      await mkdir(join(workspace, 'canonical'))
      await writeFile(
        join(workspace, 'canonical', 'READY.json'),
        '{"status":"ready"}\n',
      )
      expect(
        await readSecureWorkspaceFile(workspace, 'canonical/READY.json'),
      ).toContain('ready')
      await symlink(join(workspace, 'canonical'), join(workspace, 'alias'))
      await expect(
        readSecureWorkspaceFile(workspace, 'alias/READY.json'),
      ).rejects.toThrow(/symlink|component/i)
      await symlink(
        join(workspace, 'canonical', 'READY.json'),
        join(workspace, 'canonical', 'alias.json'),
      )
      await expect(
        readSecureWorkspaceFile(workspace, 'canonical/alias.json'),
      ).rejects.toThrow()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
