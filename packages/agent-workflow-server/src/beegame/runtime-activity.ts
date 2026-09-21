import { isNativeTaskLifecycle } from './native-subagent-chat'

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
    if (event.type.startsWith('assistant.') || event.type.startsWith('tool.') || isNativeTaskLifecycle(payload))
      agentEventAt = latest(agentEventAt, at)
    if (event.type.startsWith('tool.'))
      toolEventAt = latest(toolEventAt, at)
    if (isNativeTaskLifecycle(payload))
      subagentEventAt = latest(subagentEventAt, at)
  }
  return { workflowUpdatedAt: typeof workflowUpdatedAt === 'string' ? workflowUpdatedAt : null,
    agentEventAt, toolEventAt, subagentEventAt }
}
