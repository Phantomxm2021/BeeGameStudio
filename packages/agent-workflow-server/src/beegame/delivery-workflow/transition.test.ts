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
        contentDigest: 'content',
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
        contentDigest: 'content-digest',
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
