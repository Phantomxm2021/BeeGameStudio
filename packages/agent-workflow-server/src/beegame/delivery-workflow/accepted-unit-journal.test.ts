import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveAcceptedWorkflowUnits } from './accepted-unit-journal'
import { createDeliveryWorkflowController } from './controller'
import { createRunStore } from './run-store'
import { acceptedWorkflowUnitSchema, parseDeliveryRun } from './schema'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
  type DeliveryRun,
} from './types'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'

function run(): DeliveryRun {
  return createTestDeliveryRun({
    runId: 'accepted-unit-run',
    projectId: 'accepted-unit-project',
    ownerId: 'accepted-unit-owner',
    foundationDraftComplete: false,
  })
}

function reviewRun(completedCheckIds: string[]): DeliveryRun {
  const base = run()
  const checks = completedCheckIds.map(id => ({
    id,
    status: 'pass' as const,
    conclusion: `Accepted ${id}.`,
    evidence: [{ path: 'docs/GDD.md', anchor: '$' }],
    findingIds: [],
    assessments: [],
  }))
  return {
    ...base,
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    documentReviewState: {
      ...base.documentReviewState,
      activeCycle: {
        cycleId: 'review-cycle',
        originScope: 'foundation',
        scope: 'foundation',
        mode: 'initial',
        sourceRevision: 'document-revision',
        requiredCheckIds: [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS],
        completedCheckIds:
          completedCheckIds as (typeof FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS)[number][],
        checks:
          checks as DeliveryRun['documentReviewState']['activeCycle'] extends infer _
            ? any
            : never,
        checkEvidenceDigests: Object.fromEntries(
          completedCheckIds.map(id => [id, { 'docs/GDD.md': 'digest' }]),
        ),
        findings: [],
        acceptedSemanticResult:
          completedCheckIds.length ===
          FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS.length,
        changedPaths: [],
        sourceArtifactDigests: { 'docs/GDD.md': 'digest' },
      },
    },
  }
}

describe('accepted workflow unit journal', () => {
  test('builds the one strict nested dependency payload for accepted review units', () => {
    const before = reviewRun([])
    const after = reviewRun(['brief_alignment'])

    const [accepted] = deriveAcceptedWorkflowUnits(before, after)
    const parsed = acceptedWorkflowUnitSchema.safeParse(accepted)

    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.payload).toEqual({
      check: after.documentReviewState.activeCycle?.checks[0],
      findings: [],
      dependencyDigests: {
        brief_alignment:
          after.documentReviewState.activeCycle?.checkEvidenceDigests
            .brief_alignment,
      },
    })
  })

  test('derives every newly accepted semantic unit from a reconciled run transition', () => {
    const beforeDocument = {
      ...run(),
      foundationDraftState: { completedPaths: [] },
    }
    const afterDocument = {
      ...beforeDocument,
      revision: { ...beforeDocument.revision, document: 'document-revision' },
      foundationDraftState: {
        completedPaths: [CANONICAL_FOUNDATION_DOCUMENTS[0]],
      },
    }
    expect(deriveAcceptedWorkflowUnits(beforeDocument, afterDocument)).toEqual([
      expect.objectContaining({
        unitId: `document:${CANONICAL_FOUNDATION_DOCUMENTS[0]}`,
        kind: 'document',
      }),
    ])

    const beforePacket = reviewRun([])
    const afterPacket = reviewRun([
      'brief_alignment',
      'cross_document_consistency',
    ])
    expect(deriveAcceptedWorkflowUnits(beforePacket, afterPacket)).toEqual([
      expect.objectContaining({ unitId: 'review:brief_alignment' }),
      expect.objectContaining({ unitId: 'review:cross_document_consistency' }),
    ])

    const beforeChecklist = run()
    const approvedChecklist = createTestDeliveryRun({
      runId: beforeChecklist.runId,
      projectId: beforeChecklist.projectId,
      ownerId: beforeChecklist.ownerId,
      checklistApproved: true,
    })
    const afterChecklist = {
      ...beforeChecklist,
      documentReviewState: {
        ...beforeChecklist.documentReviewState,
        checklistApproval:
          approvedChecklist.documentReviewState.checklistApproval,
      },
    }
    expect(
      deriveAcceptedWorkflowUnits(beforeChecklist, afterChecklist),
    ).toEqual([
      expect.objectContaining({
        unitId: 'review:checklist_traceability',
        kind: 'review-check',
      }),
      expect.objectContaining({
        unitId: 'checklist:docs/acceptance/gameplay-checklist.md',
        kind: 'checklist',
      }),
    ])

    const beforeInventory = run()
    const afterInventory = {
      ...beforeInventory,
      phase: 'RESOURCE_PREPARATION' as const,
      resourceProductionState: {
        currentTask: 'RESOURCE_CONTENT' as const,
        inventoryReceipt: {
          revision: 'inventory-revision',
          bindings: [
            { requirementId: 'requirement-1', resourceIds: ['resource-1'] },
          ],
          catalogObserved: true,
          acceptedAt: '2026-08-05T00:00:00.000Z',
        },
      },
    }
    expect(
      deriveAcceptedWorkflowUnits(beforeInventory, afterInventory),
    ).toEqual([
      expect.objectContaining({
        unitId: 'resource:inventory',
        kind: 'resource-inventory',
      }),
    ])

    const afterContent = {
      ...afterInventory,
      resourceProductionState: {
        ...afterInventory.resourceProductionState,
        currentTask: 'RESOURCE_GATE' as const,
        contentReceipt: {
          contentDigest: 'content-digest',
          acceptedAt: '2026-08-05T00:00:00.000Z',
        },
      },
    }
    expect(deriveAcceptedWorkflowUnits(afterInventory, afterContent)).toEqual([
      expect.objectContaining({
        unitId: 'resource:content',
        kind: 'resource-content',
      }),
    ])

    const afterGate = {
      ...afterContent,
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'COMPREHENSIVE_REVIEW' as const,
      revision: { ...afterContent.revision, resource: 'resource-revision' },
      evidence: {
        resourcePreparation: {
          path: '.beegame/workflow/evidence/resource-gate.json',
          kind: 'resource_preparation' as const,
          revision: 'resource-revision',
          status: 'passed' as const,
          observedAt: '2026-08-05T00:00:00.000Z',
        },
      },
    }
    expect(deriveAcceptedWorkflowUnits(afterContent, afterGate)).toEqual([
      expect.objectContaining({
        unitId: 'resource:gate',
        kind: 'resource-gate',
      }),
    ])

    const planned = {
      ...afterGate,
      phase: 'IMPLEMENTATION' as const,
      tasks: [
        {
          id: 'task-1',
          title: 'Task',
          checklistIds: ['check-1'],
          resourceIds: ['resource-1'],
          contentIds: ['content-1'],
          dependsOn: [],
          allowedPaths: ['src/'],
          expectedArtifacts: ['src/file.ts'],
          verification: [
            {
              kind: 'test' as const,
              commandOrAction: 'bun test',
              expectedResult: 'pass',
            },
          ],
          status: 'pending' as const,
          attempt: 0,
          evidenceRefs: [],
        },
      ],
    }
    expect(deriveAcceptedWorkflowUnits(afterGate, planned)).toEqual([
      expect.objectContaining({ unitId: 'plan:atomic', kind: 'atomic-plan' }),
    ])

    const implemented = {
      ...planned,
      tasks: planned.tasks.map(task => ({
        ...task,
        status: 'completed' as const,
        completedRevision: 'implementation-revision',
        evidenceRefs: ['.beegame/workflow/evidence/task-1.json'],
      })),
      revision: {
        ...planned.revision,
        implementation: 'implementation-revision',
      },
    }
    expect(deriveAcceptedWorkflowUnits(planned, implemented)).toEqual([
      expect.objectContaining({
        unitId: 'implementation:task-1',
        kind: 'implementation-task',
      }),
    ])

    const audited = {
      ...implemented,
      phase: 'ACCEPTANCE' as const,
      evidence: {
        implementationAudit: {
          path: '.beegame/workflow/evidence/audit.json',
          kind: 'implementation_audit' as const,
          revision: 'implementation-revision',
          status: 'passed' as const,
          observedAt: '2026-08-05T00:00:00.000Z',
        },
      },
    }
    expect(deriveAcceptedWorkflowUnits(implemented, audited)).toEqual([
      expect.objectContaining({
        unitId: 'audit:implementation',
        kind: 'implementation-audit',
      }),
    ])

    const accepted = {
      ...audited,
      phase: 'DELIVERY' as const,
      evidence: {
        ...audited.evidence,
        acceptance: {
          path: '.beegame/workflow/evidence/acceptance.json',
          kind: 'acceptance' as const,
          revision: 'implementation-revision',
          status: 'passed' as const,
          observedAt: '2026-08-05T00:00:00.000Z',
        },
      },
    }
    expect(deriveAcceptedWorkflowUnits(audited, accepted)).toEqual([
      expect.objectContaining({
        unitId: 'acceptance:delivery',
        kind: 'acceptance',
      }),
    ])
  })

  test('commits ordinary and accepted events once and flushes the complete marker', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'accepted-unit-journal-'))
    const store = createRunStore(workspace, 'accepted-unit-owner')
    const before = run()
    const next = {
      ...before,
      foundationDraftState: {
        completedPaths: [CANONICAL_FOUNDATION_DOCUMENTS[0]],
      },
    }
    const acceptedUnits = deriveAcceptedWorkflowUnits(before, next)

    await store.commit(
      next,
      {
        runId: next.runId,
        type: 'document.reconciled',
        phase: next.phase,
        status: next.status,
        revision: next.revision,
      },
      acceptedUnits,
    )

    const events = await store.readEvents()
    expect(events.map(event => event.type)).toEqual([
      'document.reconciled',
      'workflow.unit.accepted',
    ])
    expect(
      events.filter(event => event.type === 'workflow.unit.accepted'),
    ).toHaveLength(1)
    expect((await store.load())?.pendingEvents).toBeUndefined()
  })

  test('journals the final review check when reconciliation replaces its cycle with an approval', () => {
    const before = reviewRun([
      ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS.slice(0, -1),
    ])
    const completed = reviewRun([...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS])
    const cycle = completed.documentReviewState.activeCycle!
    const after = {
      ...completed,
      documentStep: 'CHECKLIST_DRAFTING' as const,
      documentReviewState: {
        ...completed.documentReviewState,
        activeCycle: undefined,
        foundationApproval: {
          scope: 'foundation' as const,
          revision: cycle.sourceRevision,
          checks: cycle.checks,
          checkEvidenceDigests: cycle.checkEvidenceDigests,
          evidencePath: '.beegame/workflow/evidence/foundation-review.json',
          approvedAt: '2026-08-05T00:00:00.000Z',
        },
      },
    }

    expect(deriveAcceptedWorkflowUnits(before, after)).toEqual([
      expect.objectContaining({
        unitId: `review:${FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS.at(-1)}`,
      }),
    ])
  })

  test('does not re-derive an approval after a JSON round trip', () => {
    const baseline = createTestDeliveryRun({
      runId: 'round-trip-run',
      projectId: 'round-trip-project',
      ownerId: 'accepted-unit-owner',
      checklistApproved: true,
    })
    const persisted = JSON.parse(JSON.stringify(baseline)) as DeliveryRun
    const next = JSON.parse(
      JSON.stringify({ ...persisted, currentMessage: 'unchanged acceptance' }),
    ) as DeliveryRun

    expect(deriveAcceptedWorkflowUnits(persisted, next)).toEqual([])
  })

  test('controller persistence does not append accepted events or redispatch accepted work after a JSON round trip', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'accepted-unit-controller-'))
    const base = createTestDeliveryRun({
      runId: 'controller-round-trip-run',
      projectId: 'controller-round-trip-project',
      ownerId: 'accepted-unit-owner',
      checklistApproved: true,
    })
    const store = createRunStore(workspace, base.ownerId)
    await store.save(base)
    const withoutApproval = {
      ...base,
      documentReviewState: {
        ...base.documentReviewState,
        checklistApproval: undefined,
      },
    }
    const acceptedUnits = deriveAcceptedWorkflowUnits(withoutApproval, base)
    for (const [index, unit] of acceptedUnits.entries())
      await store.appendEvent({
        eventId: `accepted-before-${index}`,
        runId: base.runId,
        type: 'workflow.unit.accepted',
        phase: unit.phase,
        status: base.status,
        revision: base.revision,
        createdAt: unit.acceptedAt,
        projectId: base.projectId,
        ownerId: base.ownerId,
        unit,
      })

    const startedWorkers: string[] = []
    const controller = createDeliveryWorkflowController({
      workspacePath: workspace,
      ownerId: base.ownerId,
      workerPort: {
        async start(request) {
          startedWorkers.push(request.workerType)
          return {
            sessionId: 'controller-round-trip',
            dispatchId: request.dispatchId!,
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })

    await controller.requestChange(
      JSON.parse(JSON.stringify(base)) as DeliveryRun,
      'A durable change request.',
    )

    expect(
      (await store.readEvents()).filter(
        event => event.type === 'workflow.unit.accepted',
      ),
    ).toHaveLength(acceptedUnits.length)
    expect(startedWorkers).toEqual(['change-impact-analyzer'])
  })

  test('records the canonical content digest when content is accepted before the gate', () => {
    const before = {
      ...run(),
      phase: 'RESOURCE_PREPARATION' as const,
      resourceProductionState: { currentTask: 'RESOURCE_CONTENT' as const },
    }
    const after = {
      ...before,
      resourceProductionState: {
        currentTask: 'RESOURCE_GATE' as const,
        contentReceipt: {
          contentDigest: 'content-digest',
          acceptedAt: '2026-08-05T00:00:00.000Z',
        },
      },
    }

    expect(deriveAcceptedWorkflowUnits(before, after)).toEqual([
      expect.objectContaining({
        unitId: 'resource:content',
        inputRevision: 'content-digest',
        dependencyDigests: { content: 'content-digest' },
        payload: { contentDigest: 'content-digest' },
      }),
    ])
  })

  test('rejects a pending accepted event whose payload does not match its kind', () => {
    const base = run()
    expect(() =>
      parseDeliveryRun({
        ...base,
        pendingEvents: [
          {
            eventId: 'invalid-accepted-event',
            runId: base.runId,
            type: 'workflow.unit.accepted',
            phase: base.phase,
            status: base.status,
            revision: base.revision,
            createdAt: '2026-08-05T00:00:00.000Z',
            projectId: base.projectId,
            ownerId: base.ownerId,
            unit: {
              eventSchemaVersion: 1,
              unitId: 'document:docs/GDD.md',
              kind: 'document',
              phase: base.phase,
              predecessorUnitIds: [],
              inputRevision: base.revision.document,
              dependencyDigests: {},
              acceptedAt: '2026-08-05T00:00:00.000Z',
              payload: { receiptRef: 'not-a-document-payload' },
            },
          },
        ],
      }),
    ).toThrow()
  })

  test('recovers a marker after the snapshot write and after a partial append', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'accepted-unit-crash-'))
    const store = createRunStore(workspace, 'accepted-unit-owner')
    const before = run()
    const next = {
      ...before,
      foundationDraftState: {
        completedPaths: [CANONICAL_FOUNDATION_DOCUMENTS[0]],
      },
    }
    const unit = deriveAcceptedWorkflowUnits(before, next)[0]
    const ordinary = {
      eventId: 'ordinary-event',
      runId: next.runId,
      type: 'document.reconciled',
      phase: next.phase,
      status: next.status,
      revision: next.revision,
      createdAt: '2026-08-05T00:00:00.000Z',
    }
    const accepted = {
      eventId: 'accepted-event',
      runId: next.runId,
      type: 'workflow.unit.accepted',
      phase: unit.phase,
      status: next.status,
      revision: next.revision,
      createdAt: unit.acceptedAt,
      projectId: next.projectId,
      ownerId: next.ownerId,
      unit,
    }
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.snapshot,
      `${JSON.stringify({ ...next, pendingEvents: [ordinary, accepted] })}\n`,
      'utf8',
    )
    await store.appendEvent(ordinary)

    await expect(store.load()).resolves.toMatchObject({ runId: next.runId })
    const events = await store.readEvents()
    expect(events.map(event => event.eventId)).toEqual([
      'ordinary-event',
      'accepted-event',
    ])
    expect(await readFile(store.paths.snapshot, 'utf8')).not.toContain(
      'pendingEvents',
    )
  })

  test('migrates a version-12 singular marker, flushes it once, and removes it', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'accepted-unit-v12-marker-'))
    const store = createRunStore(workspace, 'accepted-unit-owner')
    const base = run()
    const event = {
      eventId: 'v12-marker-event',
      runId: base.runId,
      type: 'workflow.progress',
      phase: base.phase,
      status: base.status,
      revision: base.revision,
      createdAt: '2026-08-05T00:00:00.000Z',
    }
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.snapshot,
      `${JSON.stringify({ ...base, schemaVersion: 12, pendingEvent: event })}\n`,
      'utf8',
    )

    await expect(store.load({ migrate: true })).resolves.toMatchObject({
      schemaVersion: 13,
      runId: base.runId,
    })
    expect((await store.readEvents()).map(entry => entry.eventId)).toEqual([
      'v12-marker-event',
    ])
    expect(await readFile(store.paths.snapshot, 'utf8')).not.toContain(
      'pendingEvent',
    )
  })

  test('rejects an invalid tasks.planned receipt before appending it', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'task-graph-write-'))
    const base = run()
    const store = createRunStore(workspace, base.ownerId)

    await expect(
      store.appendEvent({
        runId: base.runId,
        type: 'tasks.planned',
        phase: 'IMPLEMENTATION',
        status: 'running',
        revision: base.revision,
        taskGraph: 'invalid-task-graph',
      }),
    ).rejects.toThrow('tasks.planned')
    await expect(store.readEvents()).resolves.toEqual([])
  })

  test('rejects an invalid tasks.planned receipt while reading the journal', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'task-graph-read-'))
    const base = run()
    const store = createRunStore(workspace, base.ownerId)
    await mkdir(store.paths.directory, { recursive: true })
    await writeFile(
      store.paths.events,
      `${JSON.stringify({
        eventId: 'invalid-task-graph-event',
        runId: base.runId,
        type: 'tasks.planned',
        phase: 'IMPLEMENTATION',
        status: 'running',
        revision: base.revision,
        createdAt: '2026-08-05T00:00:00.000Z',
        taskGraph: [],
      })}\n`,
      'utf8',
    )

    await expect(store.readEvents()).rejects.toThrow('tasks.planned')
  })
})
