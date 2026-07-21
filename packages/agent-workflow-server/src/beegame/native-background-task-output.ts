import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs'

export type NativeBackgroundTaskLaunch = {
  taskId: string
  outputFile: string
}

export type NativeCompletedTaskOutput = {
  taskId: string
  status: 'completed' | 'failed' | 'stopped' | 'killed'
  result?: string
}

type NativeBackgroundTaskUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  totalTokens: number
}

const usageCache = new Map<string, { size: number; usage?: NativeBackgroundTaskUsage }>()
const TERMINAL_TAIL_BYTES = 128 * 1024

/**
 * Claude Code reports an asynchronously launched native Agent through the
 * Agent tool result before it later emits task_started/task_notification SDK
 * events. Preserve the opaque task id and output file only for passive token
 * accounting. Delivery evidence never reads this file and is captured from
 * Claude Code's native terminal notification instead.
 */
export function parseNativeBackgroundTaskLaunch(
  output: string,
): NativeBackgroundTaskLaunch | undefined {
  let taskId = ''
  let outputFile = ''
  for (const rawLine of output.split('\n')) {
    const separator = rawLine.indexOf(':')
    if (separator < 0) continue
    const field = rawLine.slice(0, separator).trim()
    const value = rawLine.slice(separator + 1).trim()
    // Claude Code may append a human-readable explanation after the opaque id,
    // for example `agentId: abc123 (internal ID - do not mention ...)`. Only
    // the first non-whitespace token is the native task identity. Keeping the
    // annotation creates a second, impossible task that can never match the
    // later task_started/task_notification SDK events.
    if (field === 'agentId') taskId = firstToken(value)
    else if (field === 'output_file') outputFile = value
  }
  return taskId && outputFile ? { taskId, outputFile } : undefined
}

function firstToken(value: string): string {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 9 || code === 10 || code === 13 || code === 32) {
      return value.slice(0, index)
    }
  }
  return value
}

/**
 * Reads the structured result emitted by Claude Code's native TaskOutput tool.
 * The caller must still link the opaque task id to an observed Agent dispatch;
 * this function does not infer task ownership or workflow meaning.
 */
export function parseNativeCompletedTaskOutput(
  payload: unknown,
): NativeCompletedTaskOutput | undefined {
  if (!isRecord(payload) || payload.toolName !== 'TaskOutput') return undefined
  const nativeTaskResult = isRecord(payload.nativeTaskResult)
    ? payload.nativeTaskResult
    : undefined
  if (!nativeTaskResult) return undefined
  const taskId = stringValue(nativeTaskResult.taskId)
  const status = stringValue(nativeTaskResult.status)
  if (
    !taskId ||
    (status !== 'completed' &&
      status !== 'failed' &&
      status !== 'stopped' &&
      status !== 'killed')
  ) return undefined
  const result = stringValue(nativeTaskResult.result)
  return {
    taskId,
    status,
    ...(result ? { result } : {}),
  }
}

/** Reads accounting from a completed native subagent JSONL transcript. */
export function readNativeBackgroundTaskUsage(
  path: string,
): NativeBackgroundTaskUsage | undefined {
  if (!path || !existsSync(path)) return undefined
  let file: number | undefined
  try {
    file = openSync(path, 'r')
    const size = fstatSync(file).size
    const cached = usageCache.get(path)
    if (cached?.size === size) return cached.usage
    if (!hasTerminalAssistantMessage(file, size)) {
      usageCache.set(path, { size })
      return undefined
    }
    const byMessageId = new Map<string, Omit<NativeBackgroundTaskUsage, 'totalTokens'>>()
    for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
      const line = rawLine.trim()
      if (!line) continue
      try {
        const record = JSON.parse(line) as unknown
        if (!isRecord(record) || record.type !== 'assistant') continue
        const message = isRecord(record.message) ? record.message : undefined
        const usage = message && isRecord(message.usage) ? message.usage : undefined
        const messageId = message && stringValue(message.id)
        if (!messageId || !usage) continue
        byMessageId.set(messageId, {
          inputTokens: numberValue(usage.input_tokens),
          outputTokens: numberValue(usage.output_tokens),
          cacheReadInputTokens: numberValue(usage.cache_read_input_tokens),
          cacheCreationInputTokens: numberValue(usage.cache_creation_input_tokens),
        })
      } catch {
        continue
      }
    }
    const usage = [...byMessageId.values()].reduce<NativeBackgroundTaskUsage>(
      (total, current) => {
        total.inputTokens += current.inputTokens
        total.outputTokens += current.outputTokens
        total.cacheReadInputTokens += current.cacheReadInputTokens
        total.cacheCreationInputTokens += current.cacheCreationInputTokens
        total.totalTokens +=
          current.inputTokens +
          current.outputTokens +
          current.cacheReadInputTokens +
          current.cacheCreationInputTokens
        return total
      },
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        totalTokens: 0,
      },
    )
    usageCache.set(path, { size, usage })
    return usage
  } catch {
    return undefined
  } finally {
    if (file !== undefined) closeSync(file)
  }
}

function hasTerminalAssistantMessage(file: number, size: number): boolean {
  const length = Math.min(size, TERMINAL_TAIL_BYTES)
  const bytes = Buffer.alloc(length)
  readSync(file, bytes, 0, length, Math.max(0, size - length))
  const lines = bytes.toString('utf8').split('\n')
  if (size > length) lines.shift()
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim()
    if (!line) continue
    try {
      const record = JSON.parse(line) as unknown
      if (!isRecord(record) || record.type !== 'assistant') continue
      const message = isRecord(record.message) ? record.message : undefined
      return message?.stop_reason === 'end_turn'
    } catch {
      continue
    }
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0
}
