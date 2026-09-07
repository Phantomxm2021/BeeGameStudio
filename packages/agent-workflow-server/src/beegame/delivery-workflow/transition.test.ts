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
  expect(retried.blockedReason).toBeUndefined()
})
