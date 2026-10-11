import { join } from 'node:path'
import { appendRuntimeDiagnostic } from './project-records'
import { parseNativeDiagnostic } from '@bee-game-studio/agent-workflow/native-diagnostics'

const MAX_RUNTIME_DIAGNOSTIC_BYTES = 4 * 1024 * 1024
const RUNTIME_DIAGNOSTIC_ARCHIVES = 3

type RuntimeObservationInput = {
  workspacePath: string
  sessionId: string
  provider: string
  model: string
  launchContract?: {
    selectedEnvironmentKeys: string[]
    forwardedEnvironmentKeys: string[]
    endpointClass: 'default' | 'first_party' | 'custom'
    configDirectoryConfigured: boolean
    credentialConfigured: boolean
  }
  errorSink?: (message: string) => void
  clock?: () => Date
  streamGapObservationMs?: number
}

export type RuntimeObservability = ReturnType<typeof createRuntimeObservability>

export function createRuntimeObservability(input: RuntimeObservationInput) {
  const path = runtimeObservationPath(input.workspacePath)
  const errorSink = input.errorSink ?? (message => console.error(`[Bee Game Studio API error] ${message}`))
  const clock = input.clock ?? (() => new Date())
  const streamGapObservationMs = input.streamGapObservationMs ?? 30_000
  let requestId = ''
  let eventCount = 0
  let byteCount = 0
  let lastEventType = ''
  let turnActive = false
  let stdoutChunkCount = 0
  let stdoutByteCount = 0
  let lastStdoutChunkAtMs: number | undefined
  let maxStdoutChunkGapMs = 0
  let compactingAtMs: number | undefined
  let compactingStatusActive = false
  let compactRequestAtMs: number | undefined
  let compactRequestCount = 0
  const compactionTiming = (nowMs: number) => {
    const useRequest = compactRequestAtMs !== undefined && (compactingAtMs === undefined || compactRequestAtMs <= compactingAtMs)
    const start = useRequest ? compactRequestAtMs : compactingAtMs
    return start === undefined ? {} : {
      elapsedMs: Math.max(0, nowMs - start),
      elapsedBasis: useRequest ? 'first_compact_request_observed' : 'compacting_status_observed',
      ...(compactingAtMs !== undefined ? { statusElapsedMs: Math.max(0, nowMs - compactingAtMs) } : {}),
      ...(compactRequestAtMs !== undefined ? { compactRequestCount,
        note: 'Observed compaction interval, not server execution time. Unattributed CLI requests may include concurrent compactions.' } : {}),
    }
  }
  let queue = Promise.resolve()

  const enqueue = (record: Record<string, unknown>): void => {
    queue = queue.then(async () => {
      try {
        await appendObservation(path, record)
      } catch (error) {
        // Observability is deliberately passive. Diagnostic storage failures
        // never alter the native runtime or document workflow.
        safeErrorSink(
          errorSink,
          `runtime diagnostic write failed: ${errorMessage(error)}`,
        )
      }
    })
  }

  return {
    beginTurn(turn: { requestId: string }): void {
      requestId = turn.requestId
      eventCount = 0
      byteCount = 0
      lastEventType = ''
      turnActive = true
      stdoutChunkCount = 0
      stdoutByteCount = 0
      lastStdoutChunkAtMs = undefined
      maxStdoutChunkGapMs = 0
      compactingAtMs = undefined
      compactingStatusActive = false
      compactRequestAtMs = undefined
      compactRequestCount = 0
      enqueue({
        type: 'turn_started',
        timestamp: clock().toISOString(),
        sessionId: input.sessionId,
        requestId,
        provider: input.provider,
        model: input.model,
        ...(input.launchContract
          ? { launchContract: input.launchContract }
          : {}),
      })
    },
    observeStdoutChunk(chunk: Uint8Array): void {
      if (!turnActive) return
      const now = clock()
      const nowMs = now.getTime()
      const chunkBytes = chunk.byteLength
      stdoutChunkCount += 1
      stdoutByteCount += chunkBytes
      if (lastStdoutChunkAtMs !== undefined) {
        const gapMs = Math.max(0, nowMs - lastStdoutChunkAtMs)
        maxStdoutChunkGapMs = Math.max(maxStdoutChunkGapMs, gapMs)
        if (gapMs >= streamGapObservationMs) {
          enqueue({
            type: 'stdout_resumed',
            timestamp: now.toISOString(),
            sessionId: input.sessionId,
            requestId,
            gapMs,
            chunkBytes,
          })
        }
      }
      lastStdoutChunkAtMs = nowMs
    },
    observeDiagnostic(value: unknown): void {
      const diagnostic = parseNativeDiagnostic(value)
      if (!diagnostic) return
      const now = clock()
      // SDK status can arrive only when compaction has already finished. Start
      // the passive interval at the actual observed request, not that status.
      // Known child requests must not be assigned to the main turn's boundary.
      if (turnActive && diagnostic.event === 'request_start' && diagnostic.source === 'compact' &&
          (!diagnostic.actor || diagnostic.actor === 'main')) {
        compactRequestAtMs ??= now.getTime()
        compactRequestCount += 1
      }
      enqueue({
        type: 'native_diagnostic',
        timestamp: now.toISOString(),
        sessionId: input.sessionId,
        ...(turnActive ? { requestId } : {}),
        diagnostic,
      })
    },
    observeLine(line: string): void {
      byteCount += Buffer.byteLength(line)
    },
    observeMessage(message: Record<string, unknown>): void {
      eventCount += 1
      lastEventType = stringField(message, 'type') || 'unknown'
      if (message.type === 'system' && message.subtype === 'status') {
        if (message.status === 'compacting') compactingStatusActive = true
        if (message.status === 'compacting' && compactingAtMs === undefined) {
          compactingAtMs = clock().getTime()
          enqueue({ type: 'compaction_started', timestamp: clock().toISOString(), sessionId: input.sessionId, requestId,
            note: 'SDK compacting status observed; delivery may be delayed. This timestamp is not the compact request start.' })
        } else if (message.status === null && compactingStatusActive && compactingAtMs !== undefined) {
          compactingStatusActive = false
          enqueue({ type: 'compaction_status_cleared', timestamp: clock().toISOString(), sessionId: input.sessionId, requestId,
            ...compactionTiming(clock().getTime()),
            note: 'Status cleared is not proof of successful compaction or complete usage.' })
          // Keep unresolved evidence until an actual boundary or turn end.
        }
      }
      if (message.type === 'system' && message.subtype === 'compact_boundary') {
        enqueue({ type: 'compaction_boundary', timestamp: clock().toISOString(), sessionId: input.sessionId, requestId,
          ...compactionTiming(clock().getTime()) })
        compactingAtMs = undefined
        compactingStatusActive = false
        compactRequestAtMs = undefined
        compactRequestCount = 0
      }
      if (message.type !== 'assistant') return
      const envelope = objectField(message, 'message')
      const content = Array.isArray(envelope?.content) ? envelope.content : []
      for (const block of content) {
        if (!block || typeof block !== 'object' || Array.isArray(block)) continue
        const candidate = block as Record<string, unknown>
        if (candidate.type !== 'tool_use') continue
        enqueue({
          type: 'tool_started',
          timestamp: clock().toISOString(),
          sessionId: input.sessionId,
          requestId,
          toolUseId: stringField(candidate, 'id'),
          toolName: stringField(candidate, 'name'),
        })
      }
    },
    finishTurn(result: {
      outcome: 'success' | 'error' | 'aborted' | 'cancelled_by_user'
      error?: unknown
      stopReason?: string
    }): void {
      const finishedAt = clock()
      const error = result.error === undefined ? undefined : errorMessage(result.error)
      if (error) safeErrorSink(errorSink, error)
      enqueue({
        type: 'turn_terminal',
        timestamp: finishedAt.toISOString(),
        sessionId: input.sessionId,
        requestId,
        provider: input.provider,
        model: input.model,
        outcome: result.outcome,
        ...(result.stopReason ? { stopReason: result.stopReason } : {}),
        eventCount,
        byteCount,
        lastEventType,
        stdoutChunkCount,
        stdoutByteCount,
        maxStdoutChunkGapMs,
        stdoutSilenceAtTerminalMs:
          lastStdoutChunkAtMs === undefined
            ? 0
            : Math.max(0, finishedAt.getTime() - lastStdoutChunkAtMs),
        ...(compactingAtMs !== undefined || compactRequestAtMs !== undefined ? { compaction: { status: 'unfinished',
          ...compactionTiming(finishedAt.getTime()), usage: 'unknown' } } : {}),
        ...(error ? { error } : {}),
      })
      turnActive = false
    },
    async flush(): Promise<void> {
      await queue
    },
  }
}

export async function appendDocumentReceiptObservation(input: {
  workspacePath: string
  sessionId: string
  dispatchId: string
  targetPath: string
  digest: string
}): Promise<void> {
  try {
    await appendObservation(runtimeObservationPath(input.workspacePath), {
      type: 'document_receipt',
      timestamp: new Date().toISOString(),
      sessionId: input.sessionId,
      dispatchId: input.dispatchId,
      targetPath: input.targetPath,
      digest: input.digest,
    })
  } catch (error) {
    console.error(
      `[Bee Game Studio diagnostics] document receipt logging failed: ${errorMessage(error)}`,
    )
  }
}

function runtimeObservationPath(workspacePath: string): string {
  return join(workspacePath, '.beegame', 'logs', 'native-runtime.jsonl')
}

async function appendObservation(
  path: string,
  record: Record<string, unknown>,
): Promise<void> {
  appendRuntimeDiagnostic({
    path,
    record,
    maxBytes: MAX_RUNTIME_DIAGNOSTIC_BYTES,
    archiveCount: RUNTIME_DIAGNOSTIC_ARCHIVES,
  })
}

function safeErrorSink(sink: (message: string) => void, message: string): void {
  try {
    sink(message)
  } catch {
    // A UI/log sink is not workflow authority.
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 4_096)
}

function objectField(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const field = value[key]
  return field && typeof field === 'object' && !Array.isArray(field)
    ? field as Record<string, unknown>
    : undefined
}

function stringField(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === 'string' ? value[key] : ''
}
