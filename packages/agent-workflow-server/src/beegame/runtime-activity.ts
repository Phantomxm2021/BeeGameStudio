/** Observations, not a heartbeat or a timeout policy. Absence is not zero or "stuck". */
export function runtimeActivity(events: Array<{ type: string; createdAt: Date | string; payload?: unknown }>, workflowUpdatedAt?: unknown) {
  const latest = (current: string | null, at: string): string => current && current > at ? current : at
  let agentEventAt: string | null = null
  let toolEventAt: string | null = null
  let subagentEventAt: string | null = null
  for (const event of events) {
    const date = new Date(event.createdAt)
    if (!Number.isFinite(date.getTime())) continue
    const at = date.toISOString()
    const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? event.payload as Record<string, unknown> : undefined
    // Older saved transcripts use task_*; live BGS events carry childThreadId.
    const childLifecycle = event.type === 'system.status' && (typeof payload?.childThreadId === 'string' ||
      (payload?.type === 'system' && ['task_started', 'task_progress', 'task_notification'].includes(String(payload.subtype))))
    if (event.type.startsWith('assistant.') || event.type.startsWith('tool.') || childLifecycle)
      agentEventAt = latest(agentEventAt, at)
    if (event.type.startsWith('tool.'))
      toolEventAt = latest(toolEventAt, at)
    if (childLifecycle)
      subagentEventAt = latest(subagentEventAt, at)
  }
  return { workflowUpdatedAt: typeof workflowUpdatedAt === 'string' ? workflowUpdatedAt : null,
    agentEventAt, toolEventAt, subagentEventAt }
}
