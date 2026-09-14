function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/** Shared by the API and persisted-card projection; never edits stage results. */
export function projectFoundationReviewDisplay(value: unknown, status: unknown) {
  const link = record(value)
  if (!link) return undefined
  const invocation = record(link.invocation), outcome = record(invocation?.outcome)
  const terminal = Boolean(link.acceptedReview)
  const taskStatus = terminal ? 'completed' as const
    : outcome?.status === 'needs_action' || status === 'needs_action' ? 'blocked' as const
    : outcome?.status === 'stopped' || status === 'stopped' ? 'stopped' as const
    : outcome?.status === 'failed' ? 'failed' as const
    : 'running' as const
  const resumeAvailable = false
  return { taskStatus, terminal, resumeAvailable, block: undefined }
}
