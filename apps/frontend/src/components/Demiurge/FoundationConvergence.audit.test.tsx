import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowCard } from './WorkflowCard'
import { toProjectRuntimeDisplayModel } from '../../viewModels/displayModels'

vi.mock('../../contexts/ToastContext', () => ({ useToastContext: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }))

function projection(options: { legacy?: boolean; accepted?: boolean } = {}) {
  const { legacy = false, accepted = false } = options
  const context = { runId: 'audit-run', controlSequence: 3, policyVersion: legacy ? null : 'foundation-acceptance.v1',
    automaticRepairLimit: legacy ? null : 2, completedRepairCount: legacy ? null : 2,
    availableActions: legacy ? ['switch_policy'] : accepted ? [] : ['accept_risk', 'grant_repair_budget'] }
  const raw = { runId: 'audit-run', status: legacy ? 'stopped' : 'needs_action', phase: 'DOCUMENT_REVIEW',
    foundationDecisionContext: context,
    block: { code: legacy ? 'user_stopped' : 'foundation_adjudication', message: legacy ? 'User paused' : 'Automatic repair budget exhausted' },
    stageSnapshots: [{ stageId: 'DOCUMENT_REVIEW', status: legacy ? 'stopped' : 'needs_action', currentPhase: 'DOCUMENT_REVIEW',
      phaseIndex: 3, phaseCount: 10, block: { code: legacy ? 'user_stopped' : 'foundation_adjudication', message: legacy ? 'User paused' : 'Automatic repair budget exhausted' } }],
    ...(!legacy ? { acceptanceDecision: { policyVersion: 'foundation-acceptance.v1', reviewResultId: 'report',
      reviewResultDigest: 'report-digest', documentSetDigest: 'document-digest',
      disposition: accepted ? 'accepted_with_advisories' : 'needs_action', advisoryFindingIds: accepted ? ['finding'] : [],
      blockingFindingIds: accepted ? [] : ['finding'], waivedFindingIds: [], automaticRepairLimit: 2, completedRepairCount: 2,
      reason: accepted ? 'Low advisory retained' : 'Budget exhausted' },
      reviewReport: { resultId: 'report', resultDigest: 'report-digest', documentSetDigest: 'document-digest',
        kind: 'issues_found', summary: 'Original report is unchanged',
        findings: [{ id: 'finding', severity: accepted ? 'LOW' : 'HIGH', title: 'Original issue title', actual: 'Original actual', expected: 'Original expected' }] } } : {}),
  }
  return toProjectRuntimeDisplayModel({ workflow: raw }).workflow!
}

describe('independent Foundation UI audit using the HTTP projection shape', () => {
  it('merges top-level report/context into a stage deck and submits the bound risk decision', async () => {
    const onDecision = vi.fn().mockResolvedValue(undefined)
    render(<WorkflowCard workflow={projection()} onFoundationDecision={onDecision} />)
    fireEvent.click(screen.getByText(/查看原始审查报告/))
    expect(screen.getByText('Original actual', { exact: false })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '选择发现 finding' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Accept this listed design risk' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '接受所选风险' })) })
    expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ action: 'accept_risk', runId: 'audit-run', controlSequence: 3,
      policyVersion: 'foundation-acceptance.v1', automaticRepairLimit: 2, completedRepairCount: 2,
      findingIds: ['finding'], reportResultId: 'report', reportResultDigest: 'report-digest', documentSetDigest: 'document-digest' }))
  })

  it('can display accepted LOW advisories without offering a mutation', () => {
    render(<WorkflowCard workflow={projection({ accepted: true })} onFoundationDecision={vi.fn()} />)
    expect(screen.getByText('通过，附 1 项建议')).toBeInTheDocument()
    fireEvent.click(screen.getByText(/查看原始审查报告/))
    expect(screen.getByText('Original issue title')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '接受所选风险' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '追加预算并修订' })).not.toBeInTheDocument()
  })

  it('allows an explicitly advertised legacy policy switch without inventing an absent review report', async () => {
    const onDecision = vi.fn().mockResolvedValue(undefined)
    render(<WorkflowCard workflow={projection({ legacy: true })} onFoundationDecision={onDecision} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Adopt the new policy; remain paused' } })
    const button = screen.getByRole('button', { name: '对旧任务采用新政策' })
    expect(button).toBeEnabled()
    await act(async () => { fireEvent.click(button) })
    expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ action: 'switch_policy', runId: 'audit-run', controlSequence: 3,
      policyVersion: null, automaticRepairLimit: null, completedRepairCount: null }))
    expect(onDecision.mock.calls[0][0].reportResultId).toBeUndefined()
  })

  it('projects trusted top-level call and historical timing onto the latest stage', () => {
    const workflow = toProjectRuntimeDisplayModel({ workflow: {
      ...projection(),
      currentCallElapsedMs: 1200,
      historicalElapsedMs: 4800,
      stageSnapshots: [{ stageId: 'DOCUMENT_REVIEW', status: 'needs_action', phaseIndex: 3 }],
    } }).workflow!
    expect(workflow.currentCallElapsedMs).toBe(1200)
    expect(workflow.historicalElapsedMs).toBe(4800)
    expect(workflow.stageSnapshots?.[0]?.currentCallElapsedMs).toBe(1200)
    expect(workflow.stageSnapshots?.[0]?.historicalElapsedMs).toBe(4800)
  })
})
