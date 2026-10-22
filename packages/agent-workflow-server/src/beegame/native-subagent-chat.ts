type ChatEvent = { type: string; payload?: Record<string, unknown> }
const str = (value: unknown): string => typeof value === 'string' ? value : ''

/** Attach the known BGS child owner to permission records. */
export function createNativeSubagentChatEnricher() {
  const childOwners = new Map<string, string>()
  const toolOwners = new Map<string, string>()
  return <T extends ChatEvent>(event: T): T => {
    const p = event.payload
    if (!p) return event
    const toolUseID = str(p.toolUseID)
    const parent = str(p.parentToolUseID)
    if (toolUseID && parent) toolOwners.set(toolUseID, parent)
    if (str(p.childThreadId) && parent) childOwners.set(str(p.childThreadId), parent)
    if (event.type === 'permission.requested' || event.type === 'permission.resolved') {
      const owner = parent || toolOwners.get(toolUseID) || childOwners.get(str(p.agentId))
      return owner ? { ...event, payload: { ...p, parentToolUseID: owner } } : event
    }
    return event
  }
}
