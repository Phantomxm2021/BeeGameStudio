/** Read-only display projection of visible native subagent transcript blocks. */
export type SubagentActivityEntry =
  | { id: string; kind: 'message'; text: string; truncated?: boolean }
  | { id: string; kind: 'permission'; toolName: string; message: string;
      status: 'pending' | 'allowed' | 'denied' | 'cancelled'; truncated?: boolean }
  | { id: string; kind: 'tool'; toolName: string; filePath?: string; command?: string;
      input?: string; output?: string; attachments?: unknown[]; attachmentError?: string; elapsedTimeSeconds?: number;
      status: 'running' | 'completed' | 'failed' | 'cancelled'; truncated?: boolean }

export type SubagentActivitySnapshot = {
  entries: SubagentActivityEntry[]
  truncated: boolean
}

export function readSubagentActivity(value: unknown): SubagentActivitySnapshot | undefined {
  if (!value || typeof value !== 'object' || !('entries' in value) || !Array.isArray(value.entries)) return undefined
  const valid = value.entries.every(entry => entry && typeof entry === 'object' && typeof entry.id === 'string' &&
    (entry.kind === 'message' ? typeof entry.text === 'string' : entry.kind === 'permission' ?
      typeof entry.toolName === 'string' && typeof entry.message === 'string' &&
      ['pending', 'allowed', 'denied', 'cancelled'].includes(entry.status) : entry.kind === 'tool' &&
      typeof entry.toolName === 'string' && ['running', 'completed', 'failed', 'cancelled'].includes(entry.status) &&
      (entry.attachments === undefined || Array.isArray(entry.attachments)) &&
      (entry.elapsedTimeSeconds === undefined || typeof entry.elapsedTimeSeconds === 'number' && Number.isFinite(entry.elapsedTimeSeconds) && entry.elapsedTimeSeconds >= 0) &&
      ['filePath', 'command', 'input', 'output', 'attachmentError'].every(key => entry[key] === undefined || typeof entry[key] === 'string')))
  return valid ? { entries: value.entries, truncated: 'truncated' in value && value.truncated === true } : undefined
}

/** Merge display records across live updates and history pages, not execution state. */
export function mergeSubagentActivity(
  previous?: SubagentActivitySnapshot,
  next?: SubagentActivitySnapshot,
  incomingOlder = false,
): SubagentActivitySnapshot | undefined {
  if (!previous) return next
  if (!next) return previous
  const entries = new Map((incomingOlder ? next : previous).entries.map(entry => [entry.id, entry]))
  for (const entry of (incomingOlder ? previous : next).entries) {
    const existing = entries.get(entry.id)
    const keepTerminal = existing?.kind === 'tool' && entry.kind === 'tool' &&
      existing.status !== 'running' && entry.status === 'running' ||
      existing?.kind === 'permission' && entry.kind === 'permission' &&
      existing.status !== 'pending' && entry.status === 'pending'
    const keepFullText = existing?.kind === 'message' && entry.kind === 'message' &&
      entry.truncated && existing.text.length > entry.text.length
    entries.set(entry.id, keepTerminal ? { ...entry, ...existing } : keepFullText ? existing : { ...existing, ...entry })
  }
  return { entries: [...entries.values()], truncated: previous.truncated || next.truncated }
}
