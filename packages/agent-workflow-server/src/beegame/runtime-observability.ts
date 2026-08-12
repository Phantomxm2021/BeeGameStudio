import { mkdir, appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

type RuntimeObservationInput = {
  workspacePath: string
  sessionId: string
  provider: string
  model: string
  errorSink?: (message: string) => void
}

export type RuntimeObservability = ReturnType<typeof createRuntimeObservability>

export function createRuntimeObservability(input: RuntimeObservationInput) {
  const path = runtimeObservationPath(input.workspacePath)
  const errorSink = input.errorSink ?? (message => console.error(`[Bee Game Studio API error] ${message}`))
  let requestId = ''
  let eventCount = 0
  let byteCount = 0
  let lastEventType = ''
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
      enqueue({
        type: 'turn_started',
        timestamp: new Date().toISOString(),
        sessionId: input.sessionId,
        requestId,
        provider: input.provider,
        model: input.model,
      })
    },
    observeLine(line: string): void {
      byteCount += Buffer.byteLength(line)
    },
    observeMessage(message: Record<string, unknown>): void {
      eventCount += 1
      lastEventType = stringField(message, 'type') || 'unknown'
      if (message.type !== 'assistant') return
      const envelope = objectField(message, 'message')
      const content = Array.isArray(envelope?.content) ? envelope.content : []
      for (const block of content) {
        if (!block || typeof block !== 'object' || Array.isArray(block)) continue
        const candidate = block as Record<string, unknown>
        if (candidate.type !== 'tool_use') continue
        enqueue({
          type: 'tool_started',
          timestamp: new Date().toISOString(),
          sessionId: input.sessionId,
          requestId,
          toolUseId: stringField(candidate, 'id'),
          toolName: stringField(candidate, 'name'),
        })
      }
    },
    finishTurn(result: { outcome: 'success' | 'error' | 'aborted'; error?: unknown }): void {
      const error = result.error === undefined ? undefined : errorMessage(result.error)
      if (error) safeErrorSink(errorSink, error)
      enqueue({
        type: 'turn_terminal',
        timestamp: new Date().toISOString(),
        sessionId: input.sessionId,
        requestId,
        provider: input.provider,
        model: input.model,
        outcome: result.outcome,
        eventCount,
        byteCount,
        lastEventType,
        ...(error ? { error } : {}),
      })
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
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8')
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
