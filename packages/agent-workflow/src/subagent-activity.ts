/** Read-only display projection of visible native subagent transcript blocks. */
export type SubagentActivityEntry =
  | { id: string; kind: 'message'; text: string; truncated?: boolean }
  | { id: string; kind: 'tool'; toolName: string; filePath?: string; command?: string;
      input?: string; output?: string; status: 'running' | 'completed' | 'failed'; truncated?: boolean }

export type SubagentActivitySnapshot = {
  entries: SubagentActivityEntry[]
  truncated: boolean
}

export function readSubagentActivity(value: unknown): SubagentActivitySnapshot | undefined {
  if (!value || typeof value !== 'object' || !('entries' in value) || !Array.isArray(value.entries)) return undefined
  const valid = value.entries.every(entry => entry && typeof entry === 'object' && typeof entry.id === 'string' &&
    (entry.kind === 'message' ? typeof entry.text === 'string' : entry.kind === 'tool' &&
      typeof entry.toolName === 'string' && ['running', 'completed', 'failed'].includes(entry.status) &&
      ['filePath', 'command', 'input', 'output'].every(key => entry[key] === undefined || typeof entry[key] === 'string')))
  return valid ? { entries: value.entries, truncated: 'truncated' in value && value.truncated === true } : undefined
}
