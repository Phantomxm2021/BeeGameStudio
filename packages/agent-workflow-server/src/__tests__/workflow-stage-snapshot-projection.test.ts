import { describe, expect, test } from 'bun:test'
import { workflowStageSnapshotsForDisplay } from '../app'
import { DELIVERY_PROGRESS_STAGES } from '../beegame/delivery-workflow/display-progress'

const usage = {
  input_tokens: 10,
  cache_read_tokens: 2,
  cache_creation_tokens: 3,
  completion_tokens: 5,
  total_tokens: 20,
}

const issueSummary = {
  total: 2,
  blocker: 1,
  high: 1,
  medium: 0,
  low: 0,
}

function stageSnapshot(stageId: 'DOCUMENT_DRAFTING' | 'DOCUMENT_REVIEW' | 'FOUNDATION_REVISION', phaseIndex: number, task: Record<string, unknown>) {
  return {
    stageId,
    phaseIndex,
    phaseCount: DELIVERY_PROGRESS_STAGES.length,
    status: 'running',
    currentPhase: stageId,
    tasks: [{ id: 'task', title: 'task', status: 'running', ...task }],
    completedTaskCount: 0,
    totalTaskCount: 1,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:01.000Z',
    elapsedMs: 1,
  }
}

describe('workflow stage snapshot display projection', () => {
  test('live decision handoff replaces legacy retryable failure metadata', () => {
    const result = workflowStageSnapshotsForDisplay({ phase: 'FOUNDATION_REVISION', status: 'needs_action',
      foundationReviewStage: { convergenceStop: 'repair_budget_exhausted', invocation: { outcome: { status: 'completed' } },
        candidate: { repairClaims: [{}], unresolvedIssues: [{ reason: 'needs_decision: choose A or B' }] } },
      stageSnapshots: [{ ...stageSnapshot('FOUNDATION_REVISION', 4, {}),
        block: { message: 'old failure', nextAction: 'retry', retryable: true } }] },
      [{ id: 'foundation-public-stage', title: 'Foundation Revision', status: 'completed', operation: 'revise' }])
    expect(result?.[0]?.block).toMatchObject({ code: 'foundation_adjudication', retryable: false })
    expect((result?.[0]?.block as Record<string, unknown>).nextAction).not.toBe('retry')
    expect((result?.[0]?.block as Record<string, unknown>).message).toContain('候选稿已保留')
    expect(result?.[0]?.completedTaskCount).toBe(1)
  })
  test('revision API preserves current native progress but never stale or raw worker prose', () => {
    for (const status of ['running', 'needs_action']) {
      for (const currentMessage of ['模型响应 27 · Read docs/GDD.md', '模型响应 27 · 正在接收模型响应（流事件 123）', 'raw worker prose']) {
        const result = workflowStageSnapshotsForDisplay({ phase:'FOUNDATION_REVISION', documentStep:'FOUNDATION_REVISION', status,
          currentMessage, stageSnapshots:[{ ...stageSnapshot('FOUNDATION_REVISION',4,{}), message:'stale prose', thinking:'idle' }] }, [])
        expect(result?.[0]).toMatchObject({ currentPhase:'FOUNDATION_REVISION', documentStep:'FOUNDATION_REVISION' })
        if (status === 'running' && currentMessage.startsWith('模型响应')) expect(result?.[0]?.message).toBe(currentMessage)
        else expect(result?.[0]).not.toHaveProperty('message')
        expect(result?.[0]).not.toHaveProperty('thinking')
      }
    }
  })
  test('keeps live Round3 evidence metadata while rejecting invalid historical metadata', () => {
    const result = workflowStageSnapshotsForDisplay(
      {
        phase: 'FOUNDATION_REVISION',
        documentStep: 'FOUNDATION_REVISION',
        foundationAuditState: { status: 'planning', round: 3 },
        stageSnapshots: [
          stageSnapshot('DOCUMENT_DRAFTING', 2, {
            round: -1,
            issueSummary: { total: 999, blocker: 'leak-registry-body' },
            usage: { input_tokens: -1, rawFeedback: 'do not expose' },
            durationMs: -1,
          }),
          stageSnapshot('FOUNDATION_REVISION', 4, {}),
        ],
      },
      [
        {
          id: 'task',
          title: 'task',
          status: 'running',
          operation: 'revise',
          attempt: 1,
          round: 3,
          issueSummary,
          usage,
          durationMs: 123,
          failureReason: 'safe display reason',
        },
      ],
    )

    const snapshots = result as
      | Array<{ tasks?: Array<Record<string, unknown>> }>
      | undefined
    expect(snapshots).toHaveLength(2)
    expect(snapshots?.[1]?.tasks?.[0]).toMatchObject({
      round: 3,
      issueSummary,
      usage,
      durationMs: 123,
    })
    expect(snapshots?.[0]?.tasks?.[0]).not.toHaveProperty('round')
    expect(snapshots?.[0]?.tasks?.[0]).not.toHaveProperty('issueSummary')
    expect(snapshots?.[0]?.tasks?.[0]).not.toHaveProperty('usage')
    expect(snapshots?.[0]?.tasks?.[0]).not.toHaveProperty('durationMs')
  })

  test('does not downgrade an already projected stopped reason to generic blocked', () => {
    const result = workflowStageSnapshotsForDisplay(
      {
        phase: 'FOUNDATION_REVISION',
        documentStep: 'FOUNDATION_REVISION',
        foundationAuditState: { status: 'planning' },
        stageSnapshots: [{
          ...stageSnapshot('FOUNDATION_REVISION', 4, {}),
          block: {
            message: 'Workflow stopped by user.',
            code: 'user_stopped',
            diagnosticId: 'workflow-stop-1234',
          },
        }],
      },
      [],
    )
    expect(result?.[0]).toMatchObject({
      block: {
        message: 'Workflow stopped by user.',
        code: 'user_stopped',
        diagnosticId: 'workflow-stop-1234',
      },
    })
  })

  test('does not reclassify an already projected stopped task reason', () => {
    const result = workflowStageSnapshotsForDisplay(
      {
        phase: 'FOUNDATION_REVISION',
        documentStep: 'FOUNDATION_REVISION',
        foundationAuditState: { status: 'planning' },
        stageSnapshots: [stageSnapshot('FOUNDATION_REVISION', 4, {})],
      },
      [{
        id: 'task',
        title: 'task',
        status: 'stopped',
        operation: 'revise',
        failureReason: 'Workflow stopped by user.',
        failureCode: 'user_stopped',
        diagnosticId: 'workflow-stop-1234',
      }],
    )
    const snapshots = result as
      | Array<{ tasks?: Array<Record<string, unknown>> }>
      | undefined
    expect(snapshots?.[0]?.tasks?.[0]).toMatchObject({
      status: 'stopped',
      failureReason: 'Workflow stopped by user.',
      failureCode: 'user_stopped',
      diagnosticId: 'workflow-stop-1234',
    })
  })
})
