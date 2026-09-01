import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import {
  deliveryRunSchema,
  parseDeliveryRun,
  tasksPlannedEventSchema,
  workflowUnitAcceptedEventSchema,
} from './schema'
import {
  DELIVERY_RUN_SCHEMA_VERSION,
  type DeliveryRun,
} from './types'
import { createFoundationAuditState, parseFoundationAuditState } from './foundation-audit-state'
import { FOUNDATION_AUDIT_PRODUCTION_MANIFEST } from './foundation-audit-production-manifest'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST, FOUNDATION_SEMANTIC_CHECKS } from './foundation-semantic-audit'

const PERSISTED_SCHEMA_FINGERPRINTS: Readonly<Record<number, string>> = {
  13: '263640f06ada501afb0421806f29215b83e54b4fb239591b9dc1256e8e4b5067',
  14: 'e96f3be72863e49335cfa40a30339e3aba4bc8731a94c6e7dd71dc806772502f',
  15: 'b3ab7051195615c4fc10604119a5d5c182d8c5d5dd148e36eff7727f0d949c17',
  16: 'babed79caaa373722db640fe32cd31e1b96d40c8b21e6c994f4979e10652d16c',
  17: 'dc68dca067800b5b15de725cba916d95313ed311b61023a239a456f5033f6723',
  18: '2352e359db168510bb94df80f2d3c503c31cc103c5102e62027e70b74232d52f',
  19: 'fa7ed231a746a3fc859f8d427f4dcfdd098f64a18efdfb15f378cdbdfb90848b',
  20: '1877eb5bed542b4d0ec97f3ef3bfda55523f63eb2a20e3aa744c5f8c4000e29a',
  21: 'f7a9be464348e9b3b147eab4675439e24035ef776c502779c8672ae6069ac820',
  22: '3f5bbd9d8653e4043879c1eb34f2f2fa2662457cbd6ae4b9af51dfd9361cdb81',
  23: '5f5058823411b98aeebedd5e015b1f54f3f2db02ceb2bc41feed3ca19645929e',
  24: 'facee311b19a5f1ebc85ff6a762d7a8ef9909ec8502fa530765f52263d3073df',
  25: '8aee130912d5c1b6313946d8ed6579ba470443667fe3fb7b218ad782367975ef',
  26: '88dcdf3314759e405f38b211fa56dcc8642b4bf3e7547b12983aba9c03557245',
  27: 'f1437b7488bf6a0844e14eeda637189c9dd681e68bd5d202082acd6528df84b7',
  28: 'cb10b23c9676f0d66e8deba45505d5d1b0a974871fc8e2ba2e63a207694ab0b6',
  29: '3b018da54421c0afa25daae8d231fea138a464d8918e5b31dfc5eb3bf349924c',
  30: '9afb9fa1890aafbba84e5e8cf4d4bd6ffee886bbae4394cd0b50ee195a33d178',
  31: 'fe780a696a623c71c21ef8fe8502b474d439fd306e7d39a539f9e0505dfa8518',
  32: '8d54a99feb898e7dd8d633bf1cb84f418dde7fb8be0899ec8dee16100624cc04',
  33: '69e1a49e42e9f027382a1c2dedc38e1981e5248167df26f61f5d27baee84fa4d',
  34: 'e43f0bc0957db839f8bfcc9ee354e4bcf0371a5fe762280c9f31a8f2280456db',
  35: '94388d50563ce6b74978c7dd105181deb68435065480049d61f239444c110838',
  36: 'a69dc95be99a94289c268b0e8e5fb5ce0ecf6c46453744e4acdb0d5ec1160c71',
  37: 'c7c03f7569bcc322dc68ab3f99a08b89aa3e1393fdf13f2cdac81d4f96a5f1b1',
  38: 'f14815309fbba9069f845b0f8d2d3ff5ab9ec08c9e8ce93083f15d934eec1ff1',
  39: 'f30658fbf8a542dda66a198a302b4d97172d2a3fae1b1c8974a88b08746d6a3a',
  40: '8f381cff1c0e14782b716bd2852fe826af59223612b3e1dbad51c8de88c11e55',
  41: 'd7845acf8536669db88aca430b60dd14a7cc3bc70363ba152e204069de1acd52',
  42: 'e5d702943996943ddda6d7cedb37115ed5855e3d920dd9bcf3266f8f4a32cddd',
  43: '9ad82b75692fe292b11ed73a00cef9526e611e1b5f20f00b2f0d22c717991e39',
  44: '10c9b7d69cf294be7934368ca0fd0be02be62f570b5c456fb9c35192c1ea964c',
  45: 'e7965861cc072c45e510fca3ffb61201034c7639dcf9ec694cb19dcc51fd28b6',
  46: 'ac47715fa5d9b650ce56330a5720e3f28eaddce59da6f5d27215d8dd8cd5085f',
  47: '49437690f3e102e79736ef591533988e432df96d1104f3c29aab2dbcb91b6323',
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  )
}

function currentPersistedSchemaFingerprint(): string {
  const topology = canonicalize({
    acceptedUnitJournalEvent: z.toJSONSchema(workflowUnitAcceptedEventSchema),
    deliveryRun: z.toJSONSchema(deliveryRunSchema),
    tasksPlannedJournalEvent: z.toJSONSchema(tasksPlannedEventSchema),
  })
  return createHash('sha256').update(JSON.stringify(topology)).digest('hex')
}

describe('persisted workflow schema evolution', () => {
  test('requires a version increment for structural schema changes', () => {
    const expected = PERSISTED_SCHEMA_FINGERPRINTS[DELIVERY_RUN_SCHEMA_VERSION]
    expect(
      expected,
      `DELIVERY_RUN_SCHEMA_VERSION ${DELIVERY_RUN_SCHEMA_VERSION} has no registered persisted schema fingerprint`,
    ).toBeDefined()
    expect(
      currentPersistedSchemaFingerprint(),
      `persisted workflow schema changed at DELIVERY_RUN_SCHEMA_VERSION ${DELIVERY_RUN_SCHEMA_VERSION}; increment DELIVERY_RUN_SCHEMA_VERSION`,
    ).toBe(expected)
  })
})

const V46_DIGEST = 'a'.repeat(64)
const V46_MODULES = [
  'balance',
  'gameplay',
  'implementation-verification',
  'presentation',
  'resource-realization',
  'world-scene',
] as const

function v46Digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function v46Identity() {
  return {
    runId: 'run-v46',
    taskId: 'compile-v46',
    publicationId: 'publication-v46',
    confirmedBriefDigest: V46_DIGEST,
    foundationRevision: 'foundation-rev-1',
    foundationReadyReceiptDigest: V46_DIGEST,
  }
}

function v46ReadyReceipt() {
  return {
    schemaVersion: 'game-ir-ready-receipt.v1',
    taskId: 'compile-v46',
    publicationId: 'publication-v46',
    gameIrSchemaVersion: 'game-ir.v1',
    foundationRevision: 'foundation-rev-1',
    foundationReceiptDigest: V46_DIGEST,
    manifestDigest: V46_DIGEST,
    moduleDigests: Object.fromEntries(V46_MODULES.map(module => [module, V46_DIGEST])) as Record<(typeof V46_MODULES)[number], string>,
    sourceMapDigests: Object.fromEntries(V46_MODULES.map(module => [module, V46_DIGEST])) as Record<(typeof V46_MODULES)[number], string>,
    dependencyGraphDigest: V46_DIGEST,
    committedPath: '.beegame/ir/game-ir.v1/revisions/foundation-rev-1/COMMITTED.json',
  }
}

function v46FoundationReadyState() {
  const digest = V46_DIGEST
  const revision = 'foundation-rev-1'
  const reviewDigest = 'b'.repeat(64)
  const reviewRoot = `.beegame/audit/foundation/${revision}/review/${reviewDigest}`
  const seed = createFoundationAuditState({
    revision,
    documentDigests: [
      'docs/GDD.md', 'docs/TECHNICAL_DESIGN.md', 'docs/LEVEL_SCENE_DESIGN.md', 'docs/BALANCE_DESIGN.md',
      'docs/UI_UX_SPEC.md', 'docs/ART_DIRECTION.md', 'docs/AUDIO_DESIGN.md', 'docs/ASSET_PLAN.md',
    ].map(path => ({ path, digest })) as any,
    manifest: { revision, status: 'index_staged', catalogVersion: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion, sectionIndexDigest: digest },
  })
  const usage = { input_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  const tasks = FOUNDATION_SEMANTIC_CHECKS.map(check => {
    const taskId = `v46-semantic-${check.checkId}`
    return {
      taskId, kind: 'semantic' as const, revision, checkId: check.checkId, packetDigest: digest,
      modelTier: check.modelTier, status: 'completed' as const, attempt: 1, terminalDigest: digest,
      usage, durationMs: 0,
      dispatch: { dispatchId: `v46-dispatch-${check.checkId}`, workerType: 'foundation-semantic-reviewer' as const, phase: 'DOCUMENT_REVIEW' as const, taskId, revision, status: 'completed' as const, startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:00.000Z', terminalResult: {} },
      admittedResult: { checkId: check.checkId, packetIdentity: digest, outcome: 'PASS' as const },
    }
  })
  return parseFoundationAuditState({
    ...seed, status: 'audit_ready', phaseStartedAt: '2026-01-01T00:00:00.000Z',
    derived: {
      manifestPath: `.beegame/audit/foundation/${revision}/derived/manifest.json`, manifestDigest: digest,
      markerPath: `.beegame/audit/foundation/${revision}/derived/COMMITTED.json`, markerDigest: digest,
      factStorePath: `.beegame/audit/foundation/${revision}/derived/fact-store.json`, factStoreDigest: digest,
      sectionIndexPath: `.beegame/audit/foundation/${revision}/derived/section-index.json`, sectionIndexDigest: digest,
    },
    deterministic: { reviewDigest: digest, issueRegistryPath: `.beegame/audit/foundation/${revision}/staging/review/issue-registry.json`, issueRegistryDigest: digest, manifestPath: `.beegame/audit/foundation/${revision}/staging/review/manifest.json`, manifestDigest: digest, markerPath: `.beegame/audit/foundation/${revision}/staging/review/COMMITTED.json`, markerDigest: digest, catalogVersion: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion, contractGraphDigest: digest, sectionIndexDigest: digest, factStoreDigest: digest },
    semantic: { aggregateUsage: usage }, tasks,
    review: { reviewDigest, issueRegistryPath: `${reviewRoot}/issue-registry.json`, issueRegistryDigest: reviewDigest, manifestPath: `${reviewRoot}/manifest.json`, manifestDigest: reviewDigest, markerPath: `${reviewRoot}/COMMITTED.json`, markerDigest: reviewDigest, sectionIndexDigest: digest, factStoreDigest: digest, semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest, issueSummary: { total: 0, blocker: 0, high: 0, medium: 0, low: 0 } },
  })
}

function v46Run(overrides: Record<string, unknown> = {}): DeliveryRun {
  const readyReceipt = v46ReadyReceipt()
  return {
    schemaVersion: DELIVERY_RUN_SCHEMA_VERSION,
    runId: 'run-v46',
    projectId: 'project-v46',
    ownerId: 'owner-v46',
    confirmedBriefDigest: V46_DIGEST,
    confirmedBriefContext: 'v46 confirmed brief',
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'CHECKLIST_DRAFTING',
    status: 'running',
    revision: { document: 'uncomputed', workspace: 'uncomputed' },
    tasks: [],
    evidence: {},
    foundationDraftState: {
      completedPaths: [
        'docs/GDD.md',
        'docs/LEVEL_SCENE_DESIGN.md',
        'docs/BALANCE_DESIGN.md',
        'docs/TECHNICAL_DESIGN.md',
        'docs/ART_DIRECTION.md',
        'docs/UI_UX_SPEC.md',
        'docs/AUDIO_DESIGN.md',
        'docs/ASSET_PLAN.md',
      ],
    },
    foundationAuditState: v46FoundationReadyState(),
    resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    gameIrState: {
      status: 'ready',
      identity: v46Identity(),
      checkpoint: {
        checkpointPath: '.beegame/ir/runs/run-v46/checkpoints/phase7.json',
        checkpointDigest: V46_DIGEST,
      },
      readyReceipt,
      readyReceiptDigest: v46Digest(readyReceipt),
    },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as unknown as DeliveryRun
}

function v46ReadyReceiptDigest(): string {
  const state = v46Run().gameIrState
  if (!state || state.status !== 'ready') throw new Error('v46 fixture must be ready')
  return state.readyReceiptDigest
}

describe('v46 Game IR and Checklist bridge schema', () => {
  test('accepts a strict ready v46 run and rejects the v45 shape', () => {
    expect(parseDeliveryRun(v46Run()).schemaVersion).toBe(DELIVERY_RUN_SCHEMA_VERSION)
    expect(() => parseDeliveryRun({ ...v46Run(), schemaVersion: DELIVERY_RUN_SCHEMA_VERSION - 1 })).toThrow()
  })

  test('requires persisted Game IR state to retain Foundation READY authority and matching revision', () => {
    expect(() => parseDeliveryRun({ ...v46Run(), foundationAuditState: undefined })).toThrow(/Foundation|audit_ready|revision_ready/i)
    expect(() => parseDeliveryRun({
      ...v46Run(),
      foundationAuditState: { ...v46Run().foundationAuditState!, status: 'index_staged' },
    })).toThrow(/Foundation|audit_ready|revision_ready/i)
    expect(() => parseDeliveryRun({
      ...v46Run(),
      gameIrState: { ...v46Run().gameIrState!, identity: { ...v46Run().gameIrState!.identity, foundationRevision: 'other-revision' } },
    })).toThrow(/revision|Foundation/i)
  })

  test('rejects unknown or nullable legacy Game IR state', () => {
    expect(() => parseDeliveryRun({ ...v46Run(), gameIrState: { status: 'unknown' } })).toThrow()
    expect(() => parseDeliveryRun({ ...v46Run(), gameIrState: null })).toThrow()
    expect(() => parseDeliveryRun({
      ...v46Run(),
      gameIrState: { ...v46Run().gameIrState, unexpected: true },
    })).toThrow()
  })

  test('rejects missing Foundation READY identity and missing checkpoint/publication', () => {
    expect(() => parseDeliveryRun({
      ...v46Run(),
      gameIrState: {
        status: 'compiling',
        identity: { ...v46Identity(), foundationReadyReceiptDigest: '' },
      },
    })).toThrow()
    expect(() => parseDeliveryRun({
      ...v46Run(),
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_DRAFTING',
      gameIrState: {
        status: 'compiling',
        identity: v46Identity(),
      },
    })).toThrow()
  })

  test('rejects direct resource entry and duplicate state pointers', () => {
    expect(() => parseDeliveryRun({
      ...v46Run(),
      phase: 'RESOURCE_PREPARATION',
      gameIrState: undefined,
    })).toThrow()
    expect(() => parseDeliveryRun({
      ...v46Run(),
      gameIrState: {
        ...v46Run().gameIrState,
        latestCheckpoint: {
          checkpointPath: '.beegame/ir/runs/run-v46/checkpoints/phase7.json',
          checkpointDigest: V46_DIGEST,
        },
      },
    })).toThrow()
  })

  test('requires an admitted bridge before resource preparation', () => {
    expect(() => parseDeliveryRun({
      ...v46Run(),
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_BRIDGE',
      checklistBridgeState: {
        status: 'bridging',
        identity: {
          runId: 'run-v46',
          taskId: 'bridge-v46',
          checklistPublicationDigest: V46_DIGEST,
          gameIrReadyReceiptDigest: V46_DIGEST,
        },
      },
    })).toThrow()
  })

  test('requires ready Game IR and bridge state for every downstream phase', () => {
    for (const phase of [
      'RESOURCE_PREPARATION',
      'ATOMIC_TASK_PLANNING',
      'IMPLEMENTATION',
      'IMPLEMENTATION_AUDIT',
      'ACCEPTANCE',
      'DELIVERY',
    ] as const) {
      expect(() => parseDeliveryRun({
        ...v46Run(),
        phase,
        documentStep: undefined,
        gameIrState: undefined,
      })).toThrow()
      expect(() => parseDeliveryRun({
        ...v46Run(),
        phase,
        documentStep: undefined,
        checklistBridgeState: undefined,
      })).toThrow()
    }
  })

  test('closes state placement to its owning phase and step', () => {
    expect(() => parseDeliveryRun({
      ...v46Run(),
      phase: 'BRIEF_CONFIRMED',
      documentStep: undefined,
      gameIrState: { status: 'compiling', identity: v46Identity() },
      checklistBridgeState: undefined,
    })).toThrow()
    expect(() => parseDeliveryRun({
      ...v46Run(),
      phase: 'GAME_IR_COMPILATION',
      documentStep: undefined,
    })).toThrow()
    expect(() => parseDeliveryRun({
      ...v46Run(),
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_BRIDGE',
      checklistBridgeState: {
        status: 'bridging',
        identity: {
          runId: 'run-v46',
          taskId: 'bridge-v46',
          checklistPublicationDigest: V46_DIGEST,
          gameIrReadyReceiptDigest: v46ReadyReceiptDigest(),
        },
      },
    })).not.toThrow()
    expect(() => parseDeliveryRun({
      ...v46Run(),
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_BRIDGE',
      checklistBridgeState: {
        status: 'ready',
        identity: {
          runId: 'run-v46',
          taskId: 'bridge-v46',
          checklistPublicationDigest: V46_DIGEST,
          gameIrReadyReceiptDigest: v46ReadyReceiptDigest(),
        },
        receiptPath: '.beegame/bridge.json',
        receiptDigest: V46_DIGEST,
      },
    })).toThrow()
  })

  test('rejects a bridge state that is not backed by ready Game IR', () => {
    expect(() => parseDeliveryRun({
      ...v46Run(),
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_BRIDGE',
      gameIrState: {
        status: 'compiling',
        identity: v46Identity(),
      },
      checklistBridgeState: {
        status: 'bridging',
        identity: {
          runId: 'run-v46',
          taskId: 'bridge-v46',
          checklistPublicationDigest: V46_DIGEST,
          gameIrReadyReceiptDigest: V46_DIGEST,
        },
      },
    })).toThrow()
  })
})
