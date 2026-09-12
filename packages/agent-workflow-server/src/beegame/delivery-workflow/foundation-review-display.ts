import { projectWorkflowDisplayReason } from './workflow-display-message'

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/** Shared by the API and persisted-card projection; never edits stage results. */
export function projectFoundationReviewDisplay(value: unknown, status: unknown) {
  const link = record(value)
  if (!link) return undefined
  const invocation = record(link.invocation), outcome = record(invocation?.outcome)
  const terminal = Boolean(link.convergenceStop || link.reviewOnlyComplete || link.acceptedReview)
  const taskStatus = link.convergenceStop ? 'blocked' as const : link.acceptedReview || outcome?.status === 'completed' ? 'completed' as const
    : status === 'running' ? 'running' as const : status === 'stopped' ? 'stopped' as const
    : status === 'needs_action' ? 'blocked' as const : 'failed' as const
  const resumeAvailable = false
  if (!link.convergenceStop) return { taskStatus, terminal, resumeAvailable,
    ...(link.acceptanceDecision ? { acceptanceDecision: link.acceptanceDecision } : {}) }
  const message = link.convergenceStop === 'no_document_change_blocked'
    ? '候选文档未发生变化且复审仍有阻断项，自动修订已停止；需要用户处理。'
    : '自动审查修订未收敛，自动修订预算已用完；审查未通过，候选稿已保留，尚未发布。'
  const reason = projectWorkflowDisplayReason(message, { retryable: false })!
  return { taskStatus, terminal, resumeAvailable, block: { ...reason, message, code: 'foundation_adjudication',
    detail: link.convergenceStop === 'no_document_change_blocked'
      ? '最后一轮问题和候选文档已保留；普通恢复不会重新启动修订。'
      : '已达到自动修订轮数上限，最后一轮问题和候选文档已保留。',
    nextAction: '查看阻断项；用户可明确接受绑定风险或授权额外修订预算。' } }
}
