import { appendFileSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { appendBoundedDiagnosticRecord } from './bounded-diagnostic-log'

/**
 * The only two project-local runtime record classes:
 * - transcript: durable, user-visible Chat events;
 * - diagnostics: bounded, non-UI troubleshooting facts.
 *
 * Workflow state and billing retain their own journals because they are
 * authoritative business records, not runtime logs.
 */
export type ChatTranscriptRecord = {
  id: number
  sessionId: string
  turnId?: string
  type: string
  text: string
  payload?: Record<string, unknown>
  createdAt: Date
}

export function appendChatTranscript(path: string, event: ChatTranscriptRecord): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${JSON.stringify({
      id: event.id,
      sessionId: event.sessionId,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      type: event.type,
      text: event.text,
      ...(event.payload ? { payload: event.payload } : {}),
      createdAt: event.createdAt.toISOString(),
    })}\n`, 'utf8')
    if (event.type === 'session.started' || event.type === 'session.resumed')
      maintainTranscriptIgnore(path)
  } catch {
    // A history write must never interrupt an active agent turn.
  }
}

/** Keep BGS-owned transcript JSONL out of an ordinary recursive source search.
 * The marker is deliberately local to the reserved directory: explicit file
 * reads and --no-ignore remain available, while source JSONL elsewhere is
 * unaffected. Existing user content and symlinks are never overwritten. */
function maintainTranscriptIgnore(transcriptPath: string): void {
  const directory = dirname(transcriptPath)
  if (basename(directory) !== 'transcripts') return
  try {
    if (!lstatSync(directory).isDirectory()) return
    writeFileSync(join(directory, '.ignore'), '/*.jsonl\n', { encoding: 'utf8', flag: 'wx' })
  } catch {
    // Preserve any existing marker; the transcript event is already saved.
  }
}

export function appendRuntimeDiagnostic(input: {
  path: string
  record: Record<string, unknown>
  maxBytes: number
  archiveCount: number
}): void {
  try {
    mkdirSync(dirname(input.path), { recursive: true })
    appendBoundedDiagnosticRecord(input.path, `${JSON.stringify(input.record)}\n`, {
      maxBytes: input.maxBytes,
      archiveCount: input.archiveCount,
    })
  } catch {
    // Diagnostics are intentionally passive.
  }
}
