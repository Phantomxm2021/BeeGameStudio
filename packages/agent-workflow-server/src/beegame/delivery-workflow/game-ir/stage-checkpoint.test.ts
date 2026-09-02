import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { DeliveryRun } from '../types'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  DELIVERY_RUN_SCHEMA_VERSION,
} from '../types'
import { createRunStore } from '../run-store'
import {
  createFoundationAuditState,
  parseFoundationAuditState,
  type FoundationAuditState,
} from '../foundation-audit-state'
import { FOUNDATION_AUDIT_PRODUCTION_MANIFEST } from '../foundation-audit-production-manifest'
import {
  FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
  FOUNDATION_SEMANTIC_CHECKS,
} from '../foundation-semantic-audit'
import { implementationVerificationFixture } from './implementation-verification-test-helpers'
import { buildGameplayProjectionOperationPacket } from './gameplay-producer'
import {
  cleanupGameIrProjectionSliceJournalAfterCheckpoint,
  createGameIrProjectionSliceJournal,
  gameIrProjectionSliceJournalPath,
} from './projection-slice-journal'
import { deriveProjectionSlicePlan } from './projection-slices'
import { prepareImplementationVerificationSemanticValidationPacket } from './phase7-admission'
import type { ImplementationVerificationAssemblyAuthority } from './implementation-verification-assembler'
import type { ResourceRealizationAssemblyAuthority } from './resource-realization-assembler'
import { canonicalGameIrJson, digestGameIrValue } from './model'
import {
  GameIrStageCheckpointLoader,
  GameIrStageCheckpointWriter,
  GAME_IR_CHECKPOINT_SCHEMA_VERSION,
  type GameIrCheckpointStep,
} from './stage-checkpoint'

const workspaces: string[] = []
const sha = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex')
const FIXTURE_DIGEST = 'a'.repeat(64)
const FIXTURE_REVIEW = 'b'.repeat(64)
const FIXTURE_REVISION = 'foundation-revision-1'
const FIXTURE_TIME = '2026-08-24T00:00:00.000Z'
const FIXTURE_USAGE = {
  input_tokens: 1,
  cache_read_tokens: 1,
  cache_creation_tokens: 1,
  completion_tokens: 1,
  total_tokens: 4,
}
function auditReadyFixture(): FoundationAuditState {
  const seed = createFoundationAuditState({
    revision: FIXTURE_REVISION,
    documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
      path,
      digest: FIXTURE_DIGEST,
    })),
    manifest: {
      revision: FIXTURE_REVISION,
      status: 'index_staged',
      catalogVersion: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion,
      sectionIndexDigest: FIXTURE_DIGEST,
    },
  })
  const semantic = parseFoundationAuditState({
    ...seed,
    status: 'semantic_review',
    phaseStartedAt: FIXTURE_TIME,
    derived: {
      manifestPath: `.beegame/audit/${FIXTURE_REVISION}/derived/manifest.json`,
      manifestDigest: FIXTURE_DIGEST,
      markerPath: `.beegame/audit/${FIXTURE_REVISION}/derived/COMMITTED.json`,
      markerDigest: FIXTURE_DIGEST,
      factStorePath: `.beegame/audit/${FIXTURE_REVISION}/derived/fact-store.json`,
      factStoreDigest: FIXTURE_DIGEST,
      sectionIndexPath: `.beegame/audit/${FIXTURE_REVISION}/derived/section-index.json`,
      sectionIndexDigest: FIXTURE_DIGEST,
    },
    deterministic: {
      reviewDigest: FIXTURE_DIGEST,
      issueRegistryPath: `.beegame/audit/foundation/${FIXTURE_REVISION}/staging/review/issues.json`,
      issueRegistryDigest: FIXTURE_DIGEST,
      manifestPath: `.beegame/audit/foundation/${FIXTURE_REVISION}/staging/review/manifest.json`,
      manifestDigest: FIXTURE_DIGEST,
      markerPath: `.beegame/audit/foundation/${FIXTURE_REVISION}/staging/review/COMMITTED.json`,
      markerDigest: FIXTURE_DIGEST,
      catalogVersion: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion,
      contractGraphDigest: FIXTURE_DIGEST,
      sectionIndexDigest: FIXTURE_DIGEST,
      factStoreDigest: FIXTURE_DIGEST,
    },
    semantic: { aggregateUsage: FIXTURE_USAGE },
    tasks: FOUNDATION_SEMANTIC_CHECKS.map(check => ({
      taskId: `semantic-${check.checkId}`,
      kind: 'semantic' as const,
      revision: FIXTURE_REVISION,
      checkId: check.checkId,
      packetDigest: FIXTURE_DIGEST,
      modelTier: check.modelTier,
      status: 'completed' as const,
      attempt: 1,
      terminalDigest: FIXTURE_DIGEST,
      usage: FIXTURE_USAGE,
      durationMs: 1,
      dispatch: {
        dispatchId: `dispatch-${check.checkId}`,
        workerType: 'foundation-semantic-reviewer' as const,
        phase: 'DOCUMENT_REVIEW' as const,
        taskId: `semantic-${check.checkId}`,
        revision: FIXTURE_REVISION,
        status: 'completed' as const,
        startedAt: FIXTURE_TIME,
        finishedAt: FIXTURE_TIME,
        terminalResult: {},
      },
      admittedResult: {
        checkId: check.checkId,
        packetIdentity: FIXTURE_DIGEST,
        outcome: 'PASS' as const,
      },
    })),
  })
  return parseFoundationAuditState({
    ...semantic,
    status: 'audit_ready',
    review: {
      reviewDigest: FIXTURE_REVIEW,
      issueRegistryPath: `.beegame/audit/foundation/${FIXTURE_REVISION}/review/${FIXTURE_REVIEW}/issue-registry.json`,
      issueRegistryDigest: FIXTURE_DIGEST,
      manifestPath: `.beegame/audit/foundation/${FIXTURE_REVISION}/review/${FIXTURE_REVIEW}/manifest.json`,
      manifestDigest: FIXTURE_DIGEST,
      markerPath: `.beegame/audit/foundation/${FIXTURE_REVISION}/review/${FIXTURE_REVIEW}/COMMITTED.json`,
      markerDigest: FIXTURE_DIGEST,
      sectionIndexDigest: FIXTURE_DIGEST,
      factStoreDigest: FIXTURE_DIGEST,
      semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest,
      issueSummary: { total: 0, blocker: 0, high: 0, medium: 0, low: 0 },
    },
  })
}
function authorityFixture() {
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
  return { ...fixture, phase7Authority }
}
function runFor(authority: ReturnType<typeof authorityFixture>): DeliveryRun {
  const request =
    authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority
      .gameplay.source.compileRequest
  return {
    schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
    runId: 'checkpoint-run',
    ownerId: 'checkpoint-owner',
    projectId: request.foundation.projectId,
    confirmedBriefDigest: request.foundation.confirmedBriefDigest,
    confirmedBriefContext: 'fixture',
    phase: 'GAME_IR_COMPILATION',
    status: 'running',
    revision: {
      document: request.foundation.foundationRevision,
      workspace: 'workspace-revision',
    },
    tasks: [],
    evidence: {},
    foundationDraftState: {
      completedPaths: [...CANONICAL_FOUNDATION_DOCUMENTS],
    },
    foundationAuditState: auditReadyFixture(),
    gameIrState: {
      status: 'compiling',
      identity: {
        runId: 'checkpoint-run',
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
function recordsFor(
  phase: 'phase4' | 'phase5' | 'phase6' | 'phase7',
  authority: ReturnType<typeof authorityFixture>['phase7Authority'],
): GameIrCheckpointStep['records'] {
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
  return Object.entries(values).map(([kind, record]) => ({
    kind,
    record,
  })) as GameIrCheckpointStep['records']
}
function protocolStep(
  id: string,
  authority: ReturnType<typeof authorityFixture>['phase7Authority'],
): GameIrCheckpointStep {
  const [phase, domain, operation] = id.split('/') as [
    'phase4' | 'phase5' | 'phase6' | 'phase7',
    string,
    'projection' | 'validation',
  ]
  const records = recordsFor(phase, authority).filter(
    record =>
      record.kind.includes(`/${domain}/`) &&
      (operation === 'projection'
        ? !record.kind.endsWith('/validation')
        : record.kind.endsWith('/validation')),
  )
  return {
    phase,
    domain: domain as GameIrCheckpointStep['domain'],
    operation,
    records,
  }
}
const canonicalBytes = (value: unknown) => `${canonicalGameIrJson(value)}\n`
async function resealManifest(
  manifestPath: string,
  mutate: (manifest: Record<string, unknown>) => Record<string, unknown>,
): Promise<string> {
  const current = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
    string,
    unknown
  >
  const body = mutate({ ...current })
  delete body.manifestDigest
  const bytes = canonicalBytes({
    ...body,
    manifestDigest: digestGameIrValue(body),
  })
  await writeFile(manifestPath, bytes)
  return sha(bytes)
}
async function persist(workspacePath: string, run: DeliveryRun): Promise<void> {
  await createRunStore(workspacePath, run.ownerId).save(run)
}
beforeEach(async () => {
  workspaces.push(await mkdtemp(join(tmpdir(), 'game-ir-stage-checkpoint-')))
})
afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true })),
  )
})

describe('v48 Game IR stage checkpoint boundary', () => {
  test('exports the strict v48 protocol and rejects v47', () => {
    expect(GAME_IR_CHECKPOINT_SCHEMA_VERSION).toBe(
      'game-ir-stage-checkpoint.v48',
    )
    expect(new GameIrStageCheckpointWriter()).toBeDefined()
    expect(new GameIrStageCheckpointLoader()).toBeDefined()
  })

  test('commits each exact operation set across the canonical ten-step prefix', async () => {
    const authority = authorityFixture()
    let run = runFor(authority)
    await persist(workspaces[0]!, run)
    const ids = [
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
    ] as const
    const expectedCounts = [3, 3, 3, 1, 3, 1, 3, 1, 3, 1]
    for (const [index, id] of ids.entries()) {
      const ref = await new GameIrStageCheckpointWriter().write({
        workspacePath: workspaces[0]!,
        deliveryRun: run,
        step: protocolStep(id, authority.phase7Authority),
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
      await persist(workspaces[0]!, run)
      const loaded = await new GameIrStageCheckpointLoader().load({
        workspacePath: workspaces[0]!,
        deliveryRun: run,
      })
      expect(loaded.status).toBeDefined()
      const operationManifest = JSON.parse(
        await readFile(join(workspaces[0]!, ref.checkpointPath), 'utf8'),
      ) as { step: string; records: unknown[]; closure?: unknown }
      expect(operationManifest.step).toBe(id)
      expect(operationManifest.records).toHaveLength(expectedCounts[index]!)
      expect('closure' in operationManifest).toBe(
        [false, true, false, false, false, true, false, true, false, true][
          index
        ],
      )
      if (index < ids.length - 1)
        expect(loaded).toHaveProperty('nextStep', ids[index + 1])
    }
  })

  test('recovers only an orphan immediate-next operation after filesystem commit', async () => {
    const authority = authorityFixture()
    let run = runFor(authority)
    await persist(workspaces[0]!, run)
    const first = await new GameIrStageCheckpointWriter().write({
      workspacePath: workspaces[0]!,
      deliveryRun: run,
      step: protocolStep(
        'phase4/gameplay/projection',
        authority.phase7Authority,
      ),
    })
    run = {
      ...run,
      gameIrState: {
        ...(run.gameIrState as Extract<
          DeliveryRun['gameIrState'],
          { status: 'compiling' }
        >),
        latestCheckpoint: first,
      },
    }
    await persist(workspaces[0]!, run)
    const second = await new GameIrStageCheckpointWriter().write({
      workspacePath: workspaces[0]!,
      deliveryRun: run,
      step: protocolStep(
        'phase4/balance/projection',
        authority.phase7Authority,
      ),
    })
    const recovered = await new GameIrStageCheckpointLoader().recover({
      workspacePath: workspaces[0]!,
      deliveryRun: run,
    })
    expect(
      recovered.gameIrState?.status === 'compiling'
        ? recovered.gameIrState.latestCheckpoint
        : undefined,
    ).toEqual(second)
  })

  test('cleans a completed projection journal only after the persisted checkpoint loads', async () => {
    const authority = authorityFixture()
    const run = runFor(authority)
    const identity =
      run.gameIrState?.status === 'compiling'
        ? run.gameIrState.identity
        : (() => {
            throw new Error('missing compiling state')
          })()
    await persist(workspaces[0]!, run)
    const gameplay =
      authority.phase7Authority.phase6Authority.phase5Authority.phase4Authority
        .gameplay
    const packet = buildGameplayProjectionOperationPacket({
      source: gameplay.source,
      mechanical: gameplay.mechanical,
    })
    const journalPath = gameIrProjectionSliceJournalPath({
      workspacePath: workspaces[0]!,
      identity,
      operationStep: 'phase4/gameplay/projection',
    })
    const journal = await createGameIrProjectionSliceJournal({
      journalPath,
      identity,
      operationStep: 'phase4/gameplay/projection',
      packet,
      slicePlan: deriveProjectionSlicePlan('gameplay'),
    })
    for (const slice of journal.slicePlan.slices)
      await journal.append({
        status: 'completed',
        sliceId: slice.sliceId,
        semantic: { nodes: [], sourceEvidenceGroups: [] },
      })
    const checkpoint = await new GameIrStageCheckpointWriter().write({
      workspacePath: workspaces[0]!,
      deliveryRun: run,
      step: protocolStep(
        'phase4/gameplay/projection',
        authority.phase7Authority,
      ),
    })
    await expect(
      cleanupGameIrProjectionSliceJournalAfterCheckpoint({
        workspacePath: workspaces[0]!,
        identity,
        operationStep: 'phase4/gameplay/projection',
        deliveryRun: run,
      }),
    ).rejects.toThrow(/checkpoint|missing|point/i)
    expect(await readFile(journalPath, 'utf8')).toBeTruthy()
    const checkpointed = {
      ...run,
      gameIrState: {
        ...(run.gameIrState as Extract<
          DeliveryRun['gameIrState'],
          { status: 'compiling' }
        >),
        latestCheckpoint: checkpoint,
      },
    }
    await persist(workspaces[0]!, checkpointed)
    await cleanupGameIrProjectionSliceJournalAfterCheckpoint({
      workspacePath: workspaces[0]!,
      identity: checkpointed.gameIrState.identity,
      operationStep: 'phase4/gameplay/projection',
      deliveryRun: checkpointed,
    })
    await expect(readFile(journalPath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test('rejects skipped or duplicate protocol operations', async () => {
    const authority = authorityFixture()
    const run = runFor(authority)
    await persist(workspaces[0]!, run)
    const writer = new GameIrStageCheckpointWriter()
    await expect(
      writer.write({
        workspacePath: workspaces[0]!,
        deliveryRun: run,
        step: protocolStep(
          'phase5/world-scene/projection',
          authority.phase7Authority,
        ),
      }),
    ).rejects.toThrow(/immediate next|protocol/i)
    const first = await writer.write({
      workspacePath: workspaces[0]!,
      deliveryRun: run,
      step: protocolStep(
        'phase4/gameplay/projection',
        authority.phase7Authority,
      ),
    })
    const withFirst = {
      ...run,
      gameIrState: {
        ...(run.gameIrState as Extract<
          DeliveryRun['gameIrState'],
          { status: 'compiling' }
        >),
        latestCheckpoint: first,
      },
    }
    await persist(workspaces[0]!, withFirst)
    await expect(
      writer.write({
        workspacePath: workspaces[0]!,
        deliveryRun: withFirst,
        step: protocolStep(
          'phase4/gameplay/projection',
          authority.phase7Authority,
        ),
      }),
    ).rejects.toThrow(/immediate next|already/i)
  })

  test('rejects nested checkpoint symlinks, unexpected files, and conflicting bytes', async () => {
    const authority = authorityFixture()
    const run = runFor(authority)
    await persist(workspaces[0]!, run)
    const root = join(
      workspaces[0]!,
      '.beegame/ir/runs/checkpoint-run/checkpoints',
    )
    await mkdir(root, { recursive: true })
    const outside = await mkdtemp(join(tmpdir(), 'game-ir-stage-outside-'))
    await symlink(outside, join(root, 'phase4'))
    await expect(
      new GameIrStageCheckpointWriter().write({
        workspacePath: workspaces[0]!,
        deliveryRun: run,
        step: protocolStep(
          'phase4/gameplay/projection',
          authority.phase7Authority,
        ),
      }),
    ).rejects.toThrow(/symlink|checkpoint/i)
    await rm(join(root, 'phase4'), { force: true })
    const ref = await new GameIrStageCheckpointWriter().write({
      workspacePath: workspaces[0]!,
      deliveryRun: run,
      step: protocolStep(
        'phase4/gameplay/projection',
        authority.phase7Authority,
      ),
    })
    const operationPath = join(
      workspaces[0]!,
      ref.checkpointPath.replace('/manifest.json', ''),
    )
    await writeFile(join(operationPath, 'unexpected'), 'x')
    await expect(
      new GameIrStageCheckpointLoader().load({
        workspacePath: workspaces[0]!,
        deliveryRun: {
          ...run,
          gameIrState: {
            ...(run.gameIrState as Extract<
              DeliveryRun['gameIrState'],
              { status: 'compiling' }
            >),
            latestCheckpoint: ref,
          },
        },
      }),
    ).rejects.toThrow(/unexpected|tree/i)
    await rm(join(operationPath, 'unexpected'))
    await writeFile(join(operationPath, 'manifest.json'), '{}')
    await expect(
      new GameIrStageCheckpointWriter().write({
        workspacePath: workspaces[0]!,
        deliveryRun: run,
        step: protocolStep(
          'phase4/gameplay/projection',
          authority.phase7Authority,
        ),
      }),
    ).rejects.toThrow(/manifest|conflict|invalid/i)
  })

  test('rejects a resealed predecessor skip and a future orphan during recovery', async () => {
    const authority = authorityFixture()
    let run = runFor(authority)
    await persist(workspaces[0]!, run)
    const writer = new GameIrStageCheckpointWriter()
    const first = await writer.write({
      workspacePath: workspaces[0]!,
      deliveryRun: run,
      step: protocolStep(
        'phase4/gameplay/projection',
        authority.phase7Authority,
      ),
    })
    run = {
      ...run,
      gameIrState: {
        ...(run.gameIrState as Extract<
          DeliveryRun['gameIrState'],
          { status: 'compiling' }
        >),
        latestCheckpoint: first,
      },
    }
    await persist(workspaces[0]!, run)
    const second = await writer.write({
      workspacePath: workspaces[0]!,
      deliveryRun: run,
      step: protocolStep(
        'phase4/balance/projection',
        authority.phase7Authority,
      ),
    })
    const secondPath = join(workspaces[0]!, second.checkpointPath)
    const originalSecondManifest = await readFile(secondPath, 'utf8')
    const skippedDigest = await resealManifest(secondPath, current => ({
      ...current,
      previousManifestPath:
        '.beegame/ir/runs/checkpoint-run/checkpoints/phase5/world-scene/projection/manifest.json',
    }))
    await expect(
      new GameIrStageCheckpointLoader().load({
        workspacePath: workspaces[0]!,
        deliveryRun: {
          ...run,
          gameIrState: {
            ...(run.gameIrState as Extract<
              DeliveryRun['gameIrState'],
              { status: 'compiling' }
            >),
            latestCheckpoint: { ...second, checkpointDigest: skippedDigest },
          },
        },
      }),
    ).rejects.toThrow(/predecessor|immediate/i)
    await writeFile(secondPath, originalSecondManifest)
    const thirdRun = {
      ...run,
      gameIrState: {
        ...(run.gameIrState as Extract<
          DeliveryRun['gameIrState'],
          { status: 'compiling' }
        >),
        latestCheckpoint: second,
      },
    }
    await persist(workspaces[0]!, thirdRun)
    const third = await writer.write({
      workspacePath: workspaces[0]!,
      deliveryRun: thirdRun,
      step: protocolStep(
        'phase5/world-scene/projection',
        authority.phase7Authority,
      ),
    })
    await rm(
      join(workspaces[0]!, second.checkpointPath.replace('/manifest.json', '')),
      { recursive: true, force: true },
    )
    await expect(
      new GameIrStageCheckpointLoader().recover({
        workspacePath: workspaces[0]!,
        deliveryRun: run,
      }),
    ).rejects.toThrow(/future|immediate|missing/i)
    expect(third).toBeDefined()
  })

  test('fails closed on a v47 manifest and detached DeliveryRun identity', async () => {
    const authority = authorityFixture()
    const run = runFor(authority)
    await persist(workspaces[0]!, run)
    const ref = await new GameIrStageCheckpointWriter().write({
      workspacePath: workspaces[0]!,
      deliveryRun: run,
      step: protocolStep(
        'phase4/gameplay/projection',
        authority.phase7Authority,
      ),
    })
    const manifestPath = join(workspaces[0]!, ref.checkpointPath)
    await expect(
      new GameIrStageCheckpointLoader().load({
        workspacePath: workspaces[0]!,
        deliveryRun: {
          ...run,
          gameIrState: {
            ...(run.gameIrState as Extract<
              DeliveryRun['gameIrState'],
              { status: 'compiling' }
            >),
            identity: {
              ...(
                run.gameIrState as Extract<
                  DeliveryRun['gameIrState'],
                  { status: 'compiling' }
                >
              ).identity,
              taskId: 'detached-task',
            },
            latestCheckpoint: ref,
          },
        },
      }),
    ).rejects.toThrow(/identity/i)
    await writeFile(
      manifestPath,
      JSON.stringify({ schemaVersion: 'game-ir-stage-checkpoint.v47' }),
    )
    await expect(
      new GameIrStageCheckpointLoader().load({
        workspacePath: workspaces[0]!,
        deliveryRun: {
          ...run,
          gameIrState: {
            ...(run.gameIrState as Extract<
              DeliveryRun['gameIrState'],
              { status: 'compiling' }
            >),
            latestCheckpoint: ref,
          },
        },
      }),
    ).rejects.toThrow(/invalid|obsolete|schema/i)
  })

  test('rejects record authority tamper after record-ref and manifest resealing', async () => {
    const authority = authorityFixture()
    const run = runFor(authority)
    await persist(workspaces[0]!, run)
    const ref = await new GameIrStageCheckpointWriter().write({
      workspacePath: workspaces[0]!,
      deliveryRun: run,
      step: protocolStep(
        'phase4/gameplay/projection',
        authority.phase7Authority,
      ),
    })
    const manifestPath = join(workspaces[0]!, ref.checkpointPath)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
    const refs = manifest.records as Array<Record<string, unknown>>
    const sourceRef = refs[0]!
    const recordPath = join(workspaces[0]!, sourceRef.path as string)
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<
      string,
      unknown
    >
    const recordBytes = canonicalBytes({
      ...record,
      record: { tampered: true },
    })
    await writeFile(recordPath, recordBytes)
    const checkpointDigest = await resealManifest(manifestPath, current => ({
      ...current,
      records: refs.map(item =>
        item === sourceRef
          ? {
              ...item,
              digest: sha(recordBytes),
              canonicalLength: Buffer.byteLength(recordBytes, 'utf8'),
            }
          : item,
      ),
    }))
    await expect(
      new GameIrStageCheckpointLoader().load({
        workspacePath: workspaces[0]!,
        deliveryRun: {
          ...run,
          gameIrState: {
            ...(run.gameIrState as Extract<
              DeliveryRun['gameIrState'],
              { status: 'compiling' }
            >),
            latestCheckpoint: { ...ref, checkpointDigest },
          },
        },
      }),
    ).rejects.toThrow(/authority|binding/i)
  })

  test('rejects a detached source envelope after its record and manifest are resealed', async () => {
    const authority = authorityFixture()
    const run = runFor(authority)
    await persist(workspaces[0]!, run)
    const ref = await new GameIrStageCheckpointWriter().write({
      workspacePath: workspaces[0]!,
      deliveryRun: run,
      step: protocolStep(
        'phase4/gameplay/projection',
        authority.phase7Authority,
      ),
    })
    const manifestPath = join(workspaces[0]!, ref.checkpointPath)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
    const refs = manifest.records as Array<Record<string, unknown>>
    const sourceRef = refs[0]!
    const recordPath = join(workspaces[0]!, sourceRef.path as string)
    const envelope = JSON.parse(await readFile(recordPath, 'utf8')) as Record<
      string,
      unknown
    >
    const source = envelope.record as Record<string, unknown>
    const detachedSource = { ...source, taskId: 'detached-source' }
    const detachedEnvelope = {
      ...envelope,
      authorityDigest: digestGameIrValue(detachedSource),
      record: detachedSource,
    }
    const bytes = canonicalBytes(detachedEnvelope)
    await writeFile(recordPath, bytes)
    const checkpointDigest = await resealManifest(manifestPath, current => ({
      ...current,
      records: refs.map(item =>
        item === sourceRef
          ? {
              ...item,
              digest: sha(bytes),
              canonicalLength: Buffer.byteLength(bytes, 'utf8'),
            }
          : item,
      ),
    }))
    await expect(
      new GameIrStageCheckpointLoader().load({
        workspacePath: workspaces[0]!,
        deliveryRun: {
          ...run,
          gameIrState: {
            ...(run.gameIrState as Extract<
              DeliveryRun['gameIrState'],
              { status: 'compiling' }
            >),
            latestCheckpoint: { ...ref, checkpointDigest },
          },
        },
      }),
    ).rejects.toThrow(/source|identity|task/i)
  })

  test('rejects closure digest, recordRefs, and closure identity tamper after resealing', async () => {
    const authority = authorityFixture()
    let run = runFor(authority)
    await persist(workspaces[0]!, run)
    const writer = new GameIrStageCheckpointWriter()
    const first = await writer.write({
      workspacePath: workspaces[0]!,
      deliveryRun: run,
      step: protocolStep(
        'phase4/gameplay/projection',
        authority.phase7Authority,
      ),
    })
    run = {
      ...run,
      gameIrState: {
        ...(run.gameIrState as Extract<
          DeliveryRun['gameIrState'],
          { status: 'compiling' }
        >),
        latestCheckpoint: first,
      },
    }
    await persist(workspaces[0]!, run)
    const closed = await writer.write({
      workspacePath: workspaces[0]!,
      deliveryRun: run,
      step: protocolStep(
        'phase4/balance/projection',
        authority.phase7Authority,
      ),
    })
    const manifestPath = join(workspaces[0]!, closed.checkpointPath)
    const originalManifest = await readFile(manifestPath, 'utf8')
    for (const mutation of [
      (closure: Record<string, unknown>) => ({
        ...closure,
        closureDigest: 'f'.repeat(64),
      }),
      (closure: Record<string, unknown>) => ({ ...closure, recordRefs: [] }),
      (closure: Record<string, unknown>) => ({
        ...closure,
        identity: {
          ...(closure.identity as Record<string, unknown>),
          runId: 'other-run',
        },
      }),
    ]) {
      const checkpointDigest = await resealManifest(manifestPath, current => ({
        ...current,
        closure: mutation(current.closure as Record<string, unknown>),
      }))
      await expect(
        new GameIrStageCheckpointLoader().load({
          workspacePath: workspaces[0]!,
          deliveryRun: {
            ...run,
            gameIrState: {
              ...(run.gameIrState as Extract<
                DeliveryRun['gameIrState'],
                { status: 'compiling' }
              >),
              latestCheckpoint: { ...closed, checkpointDigest },
            },
          },
        }),
      ).rejects.toThrow(/closure|prefix|identity/i)
      await writeFile(manifestPath, originalManifest)
    }
  })
})
