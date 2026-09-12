import { expect, test } from 'bun:test'
import { projectFoundationReviewDisplay } from './foundation-review-display'
import { projectCurrentStageCard } from './workflow-stage-card-history'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'

test('round cap shows a durable stop without old resume compatibility', () => {
  const link = { invocation: { stage: 'revision', outcome: { status: 'completed' } },
    convergenceStop: 'repair_budget_exhausted' }
  const display = projectFoundationReviewDisplay(link, 'needs_action')!
  expect(display).toMatchObject({ taskStatus: 'blocked', terminal: true, resumeAvailable: false,
    block: { code: 'foundation_adjudication', retryable: false } })
  expect(display.block!.message).toContain('审查未通过')
  expect(display.block!.nextAction).not.toBe('resume')
  const run = { ...createTestDeliveryRun({ projectId: 'display', ownerId: 'owner' }),
    phase: 'FOUNDATION_REVISION' as const, documentStep: 'FOUNDATION_REVISION' as const,
    status: 'needs_action' as const, blockedReason: 'old misleading failure', foundationReviewStage: link as never }
  const card = projectCurrentStageCard({ run, workspacePath: process.cwd() })!
  expect(card.tasks[0]!.status).toBe('blocked')
  expect(card.completedTaskCount).toBe(0)
  expect(card.block).toEqual(display.block)
  expect(card.block!.nextAction).not.toBe('retry')
})

test('execution failure stays failed and terminal policies never offer resume', () => {
  expect(projectFoundationReviewDisplay({ invocation: { outcome: { status: 'failed' } } }, 'failed'))
    .toMatchObject({ taskStatus: 'failed', terminal: false })
  expect(projectFoundationReviewDisplay({ invocation: { outcome: { status: 'needs_action' } } }, 'needs_action'))
    .toMatchObject({ taskStatus: 'blocked', terminal: false })
  for (const flag of ['acceptedReview', 'reviewOnlyComplete', 'convergenceStop'])
    expect(projectFoundationReviewDisplay({ [flag]: true }, 'stopped')!.terminal).toBe(true)
})

test('decision display sanitizes model text without changing candidate bytes', () => {
  const link = { convergenceStop: 'repair_budget_exhausted', candidate: {
    unresolvedIssues: [{ reason: 'needs_decision: api_key=secretvalue; /Users/example/private.txt' }] } }
  const before = JSON.stringify(link)
  const display = projectFoundationReviewDisplay(link, 'needs_action')!
  expect(display.block!.detail).not.toContain('secretvalue')
  expect(display.block!.detail).not.toContain('/Users/')
  expect(JSON.stringify(link)).toBe(before)
})

test('repair guard does not invent issue origins or treat execution as acceptance', () => {
  const display = projectFoundationReviewDisplay({ convergenceStop: 'repair_budget_exhausted', invocation: { outcome: {
    status: 'completed', result: { audit: { convergence: { findings: [{ origin: 'unresolved_previous' }, { origin: 'revision_introduced' }, { origin: 'uncertain' }] } } },
  } } }, 'needs_action')!
  expect(display.taskStatus).toBe('blocked')
  expect(display.block?.message).toContain('审查未通过')
  expect(display.block?.detail).toContain('最后一轮问题和候选文档已保留')
})
