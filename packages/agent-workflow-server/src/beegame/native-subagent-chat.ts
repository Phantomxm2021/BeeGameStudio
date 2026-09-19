import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { parseNativeBackgroundTaskLaunch } from './native-background-task-output'
import { createResponseRedactor } from '@bee-game-studio/agent-workflow/native-response-trace'

export function isNativeTaskLifecycle(payload?: Record<string, unknown>): boolean {
  return payload?.type === 'system' &&
    ['task_started', 'task_progress', 'task_notification'].includes(String(payload.subtype))
}

type ChatEvent = { type: string; payload?: Record<string, unknown> }
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const str = (value: unknown): string => typeof value === 'string' ? value : ''
const redactVisible = createResponseRedactor({})

/** Passive projection only: never starts, waits for, or controls a native task. */
export function createNativeSubagentChatEnricher() {
  const inputs = new Map<string, Record<string, unknown>>()
  const launches = new Map<string, { toolUseID: string; outputFile?: string }>()
  return <T extends ChatEvent>(event: T, readOutput = true): T => {
    const p = event.payload
    if (!p) return event
    const toolUseID = str(p.toolUseID)
    if (['Agent', 'Task'].includes(str(p.toolName)) && toolUseID) {
      if (p.input) inputs.set(toolUseID, record(p.input))
      const launch = parseNativeBackgroundTaskLaunch(str(p.output))
      if (launch) {
        launches.set(launch.taskId, { toolUseID, outputFile: launch.outputFile })
        return { ...event, payload: { ...p, nativeBackgroundTask: launch } }
      }
    }
    if (!isNativeTaskLifecycle(p)) return event
    const taskId = str(p.task_id)
    const cached = launches.get(taskId)
    const id = str(p.tool_use_id) || cached?.toolUseID || taskId
    if (!id) return event
    const outputFile = str(p.output_file) || cached?.outputFile
    launches.set(taskId, { toolUseID: id, outputFile })
    const input = inputs.get(id) ?? (p.input ? record(p.input) : {
      ...(p.description ? { description: p.description } : {}),
      ...(p.prompt ? { prompt: p.prompt } : {}),
    })
    inputs.set(id, input)
    const trace = readOutput && outputFile ? readVisibleSubagentTrace(outputFile) : undefined
    return { ...event, payload: { ...p, toolUseID: id, toolName: 'Agent', input,
      ...(trace ? { subagentTrace: trace } : {}) } }
  }
}

/** Bounded visible transcript tail; omits private thinking and transport records. */
export function readVisibleSubagentTrace(path: string): string | undefined {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const length = Math.min(size, 128 * 1024)
    const bytes = Buffer.alloc(length)
    readSync(fd, bytes, 0, length, size - length)
    const lines = bytes.toString('utf8').split('\n')
    if (size > length) lines.shift()
    const visible: string[] = []
    for (const line of lines) {
      let row: Record<string, unknown>
      try { row = record(redactVisible(JSON.parse(line))) } catch { continue }
      if (row.type !== 'assistant' && row.type !== 'user') continue
      const content = record(row.message).content
      if (!Array.isArray(content)) continue
      for (const block of content.map(record)) {
        if (block.type === 'text' && row.type === 'assistant') visible.push(str(block.text))
        if (block.type === 'tool_use') visible.push(`[${str(block.id)}] ${str(block.name)} ${JSON.stringify(block.input ?? {})}`)
        if (block.type === 'tool_result') {
          const output = typeof block.content === 'string' ? block.content :
            Array.isArray(block.content) ? block.content.map(item => str(record(item).text)).join('\n') : ''
          visible.push(`[${str(block.tool_use_id)}] ${block.is_error ? 'failed' : 'result'}: ${output}`)
        }
      }
    }
    const trace = visible.filter(Boolean).join('\n\n')
    const truncated = size > length || trace.length > 16_000
    return trace ? `${truncated ? '[Recent visible activity; earlier output omitted]\n' : ''}${trace.slice(-16_000)}` : undefined
  } catch { return undefined }
  finally { if (fd !== undefined) closeSync(fd) }
}
