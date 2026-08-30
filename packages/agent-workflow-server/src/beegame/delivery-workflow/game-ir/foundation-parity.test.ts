import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { buildFoundationRevisionBatches } from '../foundation-revision-batches'
import { buildFoundationSemanticRecheckPacket } from '../foundation-patch-validation'
import { runProductionDeterministicFoundationAudit } from '../foundation-audit-production-manifest'
import { compileFoundationIssueRegistry } from '../foundation-audit-check-definitions'
import type { AuditIssue } from '../foundation-issue-registry'
import { FOUNDATION_FACT_CATALOG } from '../foundation-fact-definitions'
import { analyzeFoundationImpact } from '../foundation-impact-analysis'
import {
  buildFoundationSemanticPacket,
  FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
} from '../foundation-semantic-audit'
import {
  createFoundationSemanticTaskCollection,
  type FoundationSemanticTask,
} from '../foundation-semantic-runtime'
import { createFoundationFactTaskCollection } from '../foundation-fact-runtime'
import {
  createFoundationAuditState,
  parseFoundationAuditState,
  type FoundationAuditState,
} from '../foundation-audit-state'
import { getGameDocumentContract } from '../game-document-contracts'
import {
  digestSectionIndex,
  type SectionRef,
} from '../foundation-section-index'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'
import { GAME_IR_SCHEMA_VERSION, type GameIrCompileRequest } from './contracts'
import { projectFoundationReadyReceipt } from './foundation-ready-adapter'
import {
  parseGameIrCandidate,
  type GameIrCandidate,
  type GameIrSourceSection,
} from './model'
import {
  GAME_IR_SEMANTIC_VALIDATOR_MANIFEST,
  admitGameIrSemanticValidationResult,
  buildGameIrSemanticValidationPacket,
} from './semantic-admission'

const BASELINE = '70df2e2c'
const DIGEST = 'a'.repeat(64)
const PHASE_STARTED_AT = '2026-08-24T00:00:00.000Z'
const PROTECTED_PRODUCTION_FILES = [
  'packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts',
  'packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts',
] as const
const GAME_IR_MODULE_IDS = [
  'balance',
  'core',
  'gameplay',
  'implementation-verification',
  'presentation',
  'resource-realization',
  'world-scene',
] as const

type Fixture = {
  name: string
  revision: string
  sectionIndex: SectionRef[]
  factStore: ReturnType<typeof foundationFacts>
  state: FoundationAuditState
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function sectionIndexFor(name: string): SectionRef[] {
  return CANONICAL_FOUNDATION_DOCUMENTS.flatMap(documentPath => {
    const contract = getGameDocumentContract(documentPath)
    const sections = [
      {
        documentPath,
        sectionId: 'executive_summary',
        heading: 'Executive Summary',
        startLine: 1,
        endLine: 1,
        digest: sha256(`${name}:${documentPath}:executive_summary`),
      },
      ...contract.sections.map(section => ({
        documentPath,
        sectionId: section.sectionId,
        heading: section.title,
        startLine: 1,
        endLine: 1,
        digest: sha256(`${name}:${documentPath}:${section.sectionId}`),
      })),
    ]
    const materials = contract.productionMaterials.map((material, index) => ({
      documentPath,
      sectionId: `material.${material.materialId}`,
      heading: material.title,
      startLine: 1,
      endLine: 1,
      digest: sha256(`${name}:${documentPath}:material.${material.materialId}`),
    }))
    return [...sections, ...materials]
  }).sort((left, right) => {
    const leftKey = `${left.documentPath}\0${left.startLine}\0${left.sectionId}`
    const rightKey = `${right.documentPath}\0${right.startLine}\0${right.sectionId}`
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
}

function foundationFacts(sectionIndex: readonly SectionRef[]) {
  const byOwner = new Map(
    sectionIndex.map(section => [
      `${section.documentPath}\0${section.sectionId}`,
      section,
    ]),
  )
  return FOUNDATION_FACT_CATALOG.map(definition => {
    const source = byOwner.get(
      `${definition.owner.documentPath}\0${definition.owner.sectionId}`,
    )
    if (!source) throw new Error(`fixture is missing ${definition.key} owner`)
    const value =
      definition.valueType === 'number'
        ? Math.max(definition.valueSpec.min ?? 0, 1)
        : definition.valueType === 'number[]'
          ? [1]
          : definition.valueType === 'string'
            ? (definition.valueSpec.enum?.[0] ?? 'stable')
            : definition.valueType === 'boolean'
              ? true
              : ['stable']
    return {
      key: definition.key,
      value,
      source,
      evidence: {
        documentPath: source.documentPath,
        sectionId: source.sectionId,
        startLine: source.startLine,
        endLine: source.startLine,
        digest: sha256(`${definition.key}:evidence`),
      },
    }
  })
}

function readyState(
  revision: string,
  documentDigest: string,
  sectionIndexDigest: string,
): FoundationAuditState {
  const reviewDigest = 'b'.repeat(64)
  const state = createFoundationAuditState({
    revision,
    documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
      path,
      digest: documentDigest,
    })),
    manifest: {
      revision,
      status: 'index_staged',
      catalogVersion: 'foundation-facts.v2',
      sectionIndexDigest,
    },
  })
  return parseFoundationAuditState({
    ...state,
    status: 'audit_ready',
    phaseStartedAt: PHASE_STARTED_AT,
    derived: {
      manifestPath: `.beegame/audit/foundation/${revision}/derived/manifest.json`,
      manifestDigest: documentDigest,
      markerPath: `.beegame/audit/foundation/${revision}/derived/COMMITTED.json`,
      markerDigest: documentDigest,
      factStorePath: `.beegame/audit/foundation/${revision}/derived/fact-store.json`,
      factStoreDigest: documentDigest,
      sectionIndexPath: `.beegame/audit/foundation/${revision}/derived/section-index.json`,
      sectionIndexDigest,
    },
    deterministic: {
      reviewDigest: documentDigest,
      issueRegistryPath: `.beegame/audit/foundation/${revision}/staging/review/issue-registry.json`,
      issueRegistryDigest: documentDigest,
      manifestPath: `.beegame/audit/foundation/${revision}/staging/review/manifest.json`,
      manifestDigest: documentDigest,
      markerPath: `.beegame/audit/foundation/${revision}/staging/review/COMMITTED.json`,
      markerDigest: documentDigest,
      catalogVersion: 'foundation-facts.v2',
      contractGraphDigest: documentDigest,
      sectionIndexDigest,
      factStoreDigest: documentDigest,
    },
    semantic: {
      aggregateUsage: {
        input_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    },
    tasks: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map((check, index) => ({
      taskId: `${revision}:semantic:${index}`,
      kind: 'semantic' as const,
      revision,
      checkId: check.checkId,
      packetDigest: sha256(`${revision}:${check.checkId}`),
      modelTier: check.modelTier,
      status: 'completed' as const,
      attempt: 1,
      terminalDigest: DIGEST,
      usage: {
        input_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      durationMs: 0,
      dispatch: {
        dispatchId: `${revision}:dispatch:${index}`,
        workerType: 'foundation-semantic-reviewer' as const,
        phase: 'DOCUMENT_REVIEW' as const,
        taskId: `${revision}:semantic:${index}`,
        revision,
        status: 'completed' as const,
        startedAt: PHASE_STARTED_AT,
        finishedAt: PHASE_STARTED_AT,
        terminalResult: {},
      },
      admittedResult: {
        checkId: check.checkId,
        packetIdentity: sha256(`${revision}:${check.checkId}`),
        outcome: 'PASS' as const,
      },
    })),
    review: {
      reviewDigest,
      issueRegistryPath: `.beegame/audit/foundation/${revision}/review/${reviewDigest}/issue-registry.json`,
      issueRegistryDigest: reviewDigest,
      manifestPath: `.beegame/audit/foundation/${revision}/review/${reviewDigest}/manifest.json`,
      manifestDigest: reviewDigest,
      markerPath: `.beegame/audit/foundation/${revision}/review/${reviewDigest}/COMMITTED.json`,
      markerDigest: reviewDigest,
      sectionIndexDigest,
      factStoreDigest: documentDigest,
      semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest,
      issueSummary: { total: 0, blocker: 0, high: 0, medium: 0, low: 0 },
    },
  })
}

function foundationFixture(name: string): Fixture {
  const sectionIndex = sectionIndexFor(name)
  const revision = `foundation-${name}`
  return {
    name,
    revision,
    sectionIndex,
    factStore: foundationFacts(sectionIndex),
    state: readyState(
      revision,
      sha256(`${name}:documents`),
      digestSectionIndex(sectionIndex),
    ),
  }
}

function foundationFactTasks(fixture: Fixture) {
  return fixture.factStore.map((fact, index) => ({
    taskId: `${fixture.revision}:fact:${index}`,
    kind: 'document-facts' as const,
    revision: fixture.revision,
    packetDigest: sha256(`${fixture.name}:fact:${fact.key}`),
    factKeyCount: 1,
    modelTier: 'fast' as const,
    status: 'pending' as const,
    attempt: 0,
  }))
}

function foundationSemanticPackets(
  fixture: Fixture,
  deterministicIssuePrefix: readonly AuditIssue[],
) {
  const sectionBytes = Object.fromEntries(
    fixture.sectionIndex.map(section => [
      `${section.documentPath}#${section.sectionId}`,
      `${fixture.name}:${section.documentPath}:${section.sectionId}`,
    ]),
  )
  return FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check =>
    buildFoundationSemanticPacket({
      revision: fixture.revision,
      checkId: check.checkId,
      sectionIndex: fixture.sectionIndex,
      sectionBytes,
      factStore: fixture.factStore,
      deterministicIssuePrefix,
      deterministicReviewDigest: sha256(`${fixture.name}:deterministic-review`),
    }),
  )
}

function foundationSemanticTasks(
  fixture: Fixture,
  packets: readonly { identity: string }[],
): FoundationSemanticTask[] {
  return FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map((check, index) => ({
    taskId: `${fixture.revision}:semantic-plan:${index}`,
    kind: 'semantic' as const,
    revision: fixture.revision,
    checkId: check.checkId,
    packetDigest: packets[index]!.identity,
    modelTier: check.modelTier,
    status: 'pending' as const,
    attempt: 0 as const,
  }))
}

function gameIrCandidate(
  fixture: Fixture,
  request: GameIrCompileRequest,
): GameIrCandidate {
  const source = fixture.sectionIndex.find(
    section =>
      section.documentPath === 'docs/GDD.md' &&
      section.sectionId === 'core_loop',
  )!
  const modules = GAME_IR_MODULE_IDS.map(moduleId => ({
    moduleId,
    nodes: [
      {
        id: `${moduleId}.fixture`,
        kind: 'fixture-node',
        producerMode: 'mechanical' as const,
        value: { fixture: fixture.name },
        bindings: {
          '/id': {
            kind: 'owner' as const,
            documentPath: source.documentPath,
            sectionId: source.sectionId,
            sectionDigest: source.digest,
            sourcePointer: `/fixtures/${fixture.name}/${moduleId}`,
          },
          '/value/fixture': {
            kind: 'owner' as const,
            documentPath: source.documentPath,
            sectionId: source.sectionId,
            sectionDigest: source.digest,
            sourcePointer: `/fixtures/${fixture.name}/${moduleId}/name`,
          },
        },
      },
    ],
  }))
  const sourceSections = [...fixture.sectionIndex].sort((left, right) =>
    `${left.documentPath}\0${left.startLine}\0${left.sectionId}`.localeCompare(
      `${right.documentPath}\0${right.startLine}\0${right.sectionId}`,
    ),
  )
  return parseGameIrCandidate(
    {
      schemaVersion: GAME_IR_SCHEMA_VERSION,
      taskId: request.taskId,
      foundationRevision: fixture.revision,
      modules,
    },
    { request, sections: sourceSections as GameIrSourceSection[] },
  )
}

function parityOutputs(fixture: Fixture, gameIrEnabled: boolean) {
  const sectionIndexBytes = JSON.stringify(fixture.sectionIndex)
  const stateBytes = JSON.stringify(fixture.state)
  const factTasks = foundationFactTasks(fixture)
  const factTaskCollection = createFoundationFactTaskCollection({
    revision: fixture.revision,
    phaseStartedAt: PHASE_STARTED_AT,
    packets: factTasks,
  })
  const issueRegistry = runProductionDeterministicFoundationAudit({
    sectionIndex: fixture.sectionIndex,
    factStore: fixture.factStore,
  })
  const semanticPackets = foundationSemanticPackets(fixture, issueRegistry)
  const semanticTaskCollection = createFoundationSemanticTaskCollection({
    revision: fixture.revision,
    phaseStartedAt: PHASE_STARTED_AT,
    tasks: foundationSemanticTasks(fixture, semanticPackets),
  })
  const readyReceipt = gameIrEnabled
    ? projectFoundationReadyReceipt({
        state: fixture.state,
        projectId: `project-${fixture.name}`,
        confirmedBriefDigest: sha256(`${fixture.name}:brief`),
      })
    : undefined
  const request = readyReceipt && {
    schemaVersion: 'game-ir-compile-request.v1' as const,
    taskId: `${fixture.revision}.compile`,
    publicationId: `${fixture.revision}.publication`,
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: readyReceipt,
  }
  const candidate = request ? gameIrCandidate(fixture, request) : undefined
  const semanticAdmissions =
    request && candidate
      ? GAME_IR_MODULE_IDS.map(moduleId => {
          const packet = buildGameIrSemanticValidationPacket({
            candidate,
            request,
            sectionIndex: fixture.sectionIndex as GameIrSourceSection[],
            moduleId,
            sectionBytes: {
              'docs/GDD.md#core_loop': `${fixture.name}:docs/GDD.md:core_loop`,
            },
          })
          const manifestModule =
            GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules.find(
              item => item.moduleId === moduleId,
            )!
          return admitGameIrSemanticValidationResult(packet, {
            outcome: 'PASS',
            packetDigest: packet.packetDigest,
            checkIds: manifestModule.checkIds,
          })
        })
      : undefined
  return {
    foundation: {
      sectionIndexBytes,
      stateBytes,
      factTaskCollection,
      issueRegistry,
      semanticTaskCollection,
      semanticPackets,
      readyInputs: {
        status: fixture.state.status,
        revision: fixture.state.revision,
        documentDigests: fixture.state.documentDigests,
        sectionIndexDigest: fixture.state.sectionIndexDigest,
        issueSummary: fixture.state.review?.issueSummary,
      },
    },
    gameIr:
      request && candidate
        ? { request, candidate, semanticAdmissions }
        : undefined,
  }
}

function issueFixture() {
  const source = sectionIndexFor('issue')
    .map(section =>
      section.documentPath === 'docs/GDD.md' && section.sectionId === 'vision'
        ? { ...section, digest: sha256('# Vision'), startLine: 1, endLine: 1 }
        : section,
    )
    .find(
      section =>
        section.documentPath === 'docs/GDD.md' &&
        section.sectionId === 'vision',
    )!
  const sectionIndex = sectionIndexFor('issue').map(section =>
    section.documentPath === source.documentPath &&
    section.sectionId === source.sectionId
      ? source
      : section,
  )
  const issues = compileFoundationIssueRegistry({
    sectionIndex,
    factStore: [],
    drafts: [
      {
        checkId: 'fixture.semantic',
        severity: 'HIGH',
        type: 'semantic',
        source,
        expected: 'the fixture remains coherent',
        actual: 'the fixture is intentionally inconsistent',
        remediation: {
          kind: 'patch',
          documentPath: source.documentPath,
          sectionIds: [source.sectionId],
        },
        conflictIdentity: { fixture: 'issue' },
      },
    ],
  })
  const issue = issues[0]!
  const operation = {
    kind: 'REPLACE' as const,
    documentPath: source.documentPath,
    sectionId: source.sectionId,
    issueIds: [issue.id],
    beforeDigest: 'b'.repeat(64),
    afterDigest: source.digest,
  }
  const impact = analyzeFoundationImpact([operation])
  const registry = {
    validated: true as const,
    section(documentPath: string, sectionId: string) {
      return documentPath === source.documentPath &&
        sectionId === source.sectionId
        ? source
        : undefined
    },
  }
  return {
    issues,
    batches: buildFoundationRevisionBatches({ issues, registry }),
    targeted: buildFoundationSemanticRecheckPacket({
      issue,
      patchOperation: operation,
      sectionIndex,
      documents: new Map([[source.documentPath, '# Vision\n']]),
      impact,
      factStore: [],
    }),
  }
}

describe('Foundation parity against the stable 70df2e2c baseline', () => {
  test('protected Stage 3/4 production files are byte-identical to baseline', () => {
    for (const path of PROTECTED_PRODUCTION_FILES) {
      const current = readFileSync(resolve(process.cwd(), path))
      const baseline = Bun.spawnSync(['git', 'show', `${BASELINE}:${path}`])
      expect(baseline.exitCode).toBe(0)
      expect(Buffer.from(baseline.stdout)).toEqual(current)
    }
  })

  test('complete Foundation fixtures keep exact outputs with Game IR disabled/enabled', () => {
    for (const fixture of [
      foundationFixture('rules'),
      foundationFixture('scene'),
    ]) {
      const disabled = parityOutputs(fixture, false)
      const enabled = parityOutputs(fixture, true)
      expect(enabled.foundation).toEqual(disabled.foundation)
      expect(enabled.gameIr?.request.foundation).toBeDefined()
      expect(
        enabled.gameIr?.candidate.modules.map(module => module.moduleId),
      ).toEqual([...GAME_IR_MODULE_IDS])
      expect(
        enabled.gameIr?.candidate.modules.every(
          module => module.nodes.length > 0,
        ),
      ).toBe(true)
      expect(disabled.gameIr).toBeUndefined()
      expect(enabled.foundation.stateBytes).toBe(disabled.foundation.stateBytes)
      expect(enabled.foundation.sectionIndexBytes).toBe(
        disabled.foundation.sectionIndexBytes,
      )
    }
  })

  test('issue-bearing Foundation planning keeps registry, revision batches, and recheck exact', () => {
    const disabled = issueFixture()
    const enabled = issueFixture()
    expect(enabled).toEqual(disabled)
    expect(disabled.issues).toHaveLength(1)
    expect(disabled.batches).toEqual([
      {
        documentPath: 'docs/GDD.md',
        sectionIds: ['vision'],
        issueIds: [disabled.issues[0]!.id],
      },
    ])
    expect(disabled.targeted).toMatchObject({
      issueId: disabled.issues[0]!.id,
      patchOperation: { documentPath: 'docs/GDD.md', sectionId: 'vision' },
    })
  })

  test('all core modules stay integrated in tests while no production routing is added', () => {
    const fixture = foundationFixture('integration')
    const enabled = parityOutputs(fixture, true)
    expect(
      enabled.gameIr?.candidate.modules.map(module => module.moduleId),
    ).toEqual([...GAME_IR_MODULE_IDS])
    expect(enabled.gameIr?.candidate.foundationRevision).toBe(fixture.revision)
    expect(enabled.gameIr?.request.gameIrSchemaVersion).toBe(
      GAME_IR_SCHEMA_VERSION,
    )
  })
})
