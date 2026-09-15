import { expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { assertDeliveryRunInvariants, transitionDeliveryRun } from './transition'
import { parseDeliveryRun } from './schema'

test('legacy foundation review snapshots are rejected without mutation', () => {
  const run = {
    ...createTestDeliveryRun({ projectId: 'legacy-review', ownerId: 'owner' }),
    phase: 'DOCUMENT_REVIEW' as const,
    documentStep: 'FOUNDATION_REVIEW' as const,
    status: 'needs_action' as const,
  }
  const before = structuredClone(run)
  expect(() => assertDeliveryRunInvariants(run)).toThrow('Legacy Reviewer projects are unsupported')
  expect(run).toEqual(before)
  expect(() => transitionDeliveryRun(run, { type: 'retry' })).toThrow(/Legacy Reviewer|retired/)
  expect(run).toEqual(before)
})

test('obsolete foundation audit state is rejected by the current schema', () => {
  const run = createTestDeliveryRun({ projectId: 'legacy-audit', ownerId: 'owner' })
  expect(() => parseDeliveryRun({
    ...run,
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    foundationAuditState: { status: 'facts_staged' },
  })).toThrow()
})

test('ordinary resource retry remains available without a foundation link', () => {
  const run = {
    ...createTestDeliveryRun({ projectId: 'resource-retry', ownerId: 'owner' }),
    phase: 'RESOURCE_PREPARATION' as const,
    documentStep: undefined,
    status: 'needs_action' as const,
    blockedReason: 'resource worker failed',
  }
  const retried = transitionDeliveryRun(run, { type: 'retry' })
  expect(retried.phase).toBe('RESOURCE_PREPARATION')
  expect(retried.status).toBe('running')
  expect(retried.blockedReason).toBe('resource worker failed')
})

test('resource delivery state cannot contradict its single receipt', () => {
  const run = createTestDeliveryRun({ projectId: 'resource-receipt', ownerId: 'owner' })
  expect(() => parseDeliveryRun({
    ...run,
    resourceProductionState: {
      currentTask: 'RESOURCE_DELIVERED',
      irResultId: 'a'.repeat(64),
    },
  })).toThrow('delivered resources require')
  expect(() => parseDeliveryRun({
    ...run,
    resourceProductionState: {
      currentTask: 'RESOURCE_DELIVERY',
      deliveryReceipt: {
        bindings: [],
        catalogObserved: false,
        resourceDigest: 'resource',
        acceptedAt: run.updatedAt,
      },
    },
  })).toThrow('cannot retain an accepted receipt')
})

test('implementation retry preserves the deterministic host rejection', () => {
  const run = {
    ...createTestDeliveryRun({ projectId: 'implementation-retry', ownerId: 'owner' }),
    phase: 'IMPLEMENTATION' as const,
    documentStep: undefined,
    status: 'failed' as const,
    blockedReason: 'required IR artifact is missing',
    tasks: [{
      id: 'DIRECT_IMPLEMENTATION',
      title: 'Implement directly',
      checklistIds: [],
      resourceIds: [],
      contentIds: [],
      allowedPaths: ['./'],
      status: 'failed' as const,
      attempt: 1,
      evidenceRefs: [],
    }],
  }
  const retried = transitionDeliveryRun(run, {
    type: 'retry',
    taskId: 'DIRECT_IMPLEMENTATION',
  })
  expect(retried.status).toBe('running')
  expect(retried.blockedReason).toBe('required IR artifact is missing')
})

test('resource restart clears receipts without clearing the published IR binding', () => {
  const irResultId = 'a'.repeat(64)
  const run = {
    ...createTestDeliveryRun({ projectId: 'resource-ir-retry', ownerId: 'owner' }),
    phase: 'RESOURCE_PREPARATION' as const,
    documentStep: undefined,
    status: 'needs_action' as const,
    blockedReason: 'resource content changed',
    resourceProductionState: {
      currentTask: 'RESOURCE_DELIVERED' as const,
      irResultId,
      deliveryReceipt: {
        bindings: [{ requirementId: 'world.visual', resourceIds: ['world'] }],
        catalogObserved: true,
        resourceDigest: 'resource-digest',
        acceptedAt: '2026-08-05T00:00:00.000Z',
      },
    },
  }
  const restarted = transitionDeliveryRun(run, {
    type: 'resource_preparation_required',
    reason: 'resource preparation must be rerun',
  })
  expect(restarted.resourceProductionState).toEqual({
    currentTask: 'RESOURCE_DELIVERY',
    irResultId,
  })
})

test('failed acceptance stops for attention instead of automatically rerunning implementation', () => {
  const run = {
    ...createTestDeliveryRun({ projectId: 'acceptance-failed', ownerId: 'owner' }),
    phase: 'ACCEPTANCE' as const,
    documentStep: undefined,
    status: 'running' as const,
    tasks: [{
      id: 'DIRECT_IMPLEMENTATION',
      title: 'Implement directly',
      checklistIds: [],
      resourceIds: [],
      contentIds: [],
      allowedPaths: ['./'],
      status: 'completed' as const,
      attempt: 1,
      completedRevision: 'workspace-revision',
      evidenceRefs: ['.beegame/workflow/evidence/implementation.json'],
    }],
    revision: {
      document: 'document-revision',
      implementation: 'workspace-revision',
      workspace: 'workspace-revision',
    },
  }
  const stopped = transitionDeliveryRun(run, {
    type: 'acceptance_failed',
    evidence: {
      kind: 'acceptance',
      path: '.beegame/workflow/evidence/acceptance.json',
      status: 'failed',
      revision: 'workspace-revision',
      observedAt: '2026-09-15T00:00:00.000Z',
    },
  })
  expect(stopped.phase).toBe('ACCEPTANCE')
  expect(stopped.status).toBe('needs_action')
  expect(stopped.tasks[0]?.status).toBe('completed')

  const explicitlyRetried = transitionDeliveryRun(stopped, { type: 'retry' })
  expect(explicitlyRetried.phase).toBe('IMPLEMENTATION')
  expect(explicitlyRetried.status).toBe('running')
  expect(explicitlyRetried.tasks[0]?.status).toBe('pending')
  expect(explicitlyRetried.blockedReason).toContain(
    '.beegame/workflow/evidence/acceptance.json',
  )
})

test('publishing an edited Scene/UI package preserves implementation and reruns acceptance', () => {
  const irRevision = 'a'.repeat(64)
  const resourceRevision = 'b'.repeat(64)
  const oldContentRevision = 'c'.repeat(64)
  const newContentRevision = 'd'.repeat(64)
  const implementationRevision = 'e'.repeat(64)
  const observedAt = '2026-09-16T00:00:00.000Z'
  const run = {
    ...createTestDeliveryRun({ projectId: 'content-edit', ownerId: 'owner' }),
    phase: 'DELIVERY' as const,
    status: 'completed' as const,
    documentStep: undefined,
    completedAt: observedAt,
    revision: {
      document: 'f'.repeat(64),
      resource: resourceRevision,
      content: oldContentRevision,
      implementation: implementationRevision,
      workspace: implementationRevision,
    },
    resourceProductionState: {
      currentTask: 'RESOURCE_DELIVERED' as const,
      irResultId: irRevision,
      deliveryReceipt: {
        bindings: [],
        catalogObserved: false,
        resourceDigest: resourceRevision,
        acceptedAt: observedAt,
      },
    },
    gameContentReceipt: {
      schemaVersion: 'game-content-ready.v1' as const,
      contentRevision: oldContentRevision,
      irRevision,
      assetManifestRevision: resourceRevision,
      indexPath: 'content/index.json' as const,
      contentIds: ['scene.main', 'ui.hud'],
    },
    tasks: [{
      id: 'DIRECT_IMPLEMENTATION',
      title: 'Implement directly',
      checklistIds: [],
      resourceIds: [],
      contentIds: ['scene.main', 'ui.hud'],
      allowedPaths: ['./'],
      status: 'completed' as const,
      attempt: 1,
      completedRevision: implementationRevision,
      evidenceRefs: ['.beegame/workflow/evidence/implementation.json'],
    }],
    evidence: {
      resourcePreparation: {
        kind: 'resource_preparation' as const,
        path: 'assets/asset-manifest.json',
        status: 'passed' as const,
        revision: resourceRevision,
        observedAt,
      },
      gameContent: {
        kind: 'game_content' as const,
        path: 'content/index.json',
        status: 'passed' as const,
        revision: oldContentRevision,
        observedAt,
      },
      acceptance: {
        kind: 'acceptance' as const,
        path: '.beegame/workflow/evidence/acceptance.json',
        status: 'passed' as const,
        revision: implementationRevision,
        observedAt,
      },
    },
  }

  const published = transitionDeliveryRun(run, {
    type: 'game_content_published',
    receipt: {
      ...run.gameContentReceipt,
      contentRevision: newContentRevision,
    },
    evidence: {
      kind: 'game_content',
      path: 'content/index.json',
      status: 'passed',
      revision: newContentRevision,
      observedAt,
    },
  })

  expect(published.phase).toBe('ACCEPTANCE')
  expect(published.status).toBe('running')
  expect(published.revision.content).toBe(newContentRevision)
  expect(published.revision.implementation).toBe(implementationRevision)
  expect(published.tasks).toEqual(run.tasks)
  expect(published.evidence.acceptance).toBeUndefined()
  expect(published.completedAt).toBeUndefined()
})
