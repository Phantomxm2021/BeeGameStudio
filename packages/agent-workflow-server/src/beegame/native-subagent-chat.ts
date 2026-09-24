import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { parseNativeBackgroundTaskLaunch } from './native-background-task-output'
import { createResponseRedactor } from '@bee-game-studio/agent-workflow/native-response-trace'
import type { SubagentActivityEntry, SubagentActivitySnapshot } from '@bee-game-studio/agent-workflow/subagent-activity'

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
  const launches = new Map<string, { toolUseID: string; outputFile?: string; toolName: 'Agent' | 'Task' }>()
  return <T extends ChatEvent>(event: T, readOutput = true): T => {
    const p = event.payload
    if (!p) return event
    const toolUseID = str(p.toolUseID)
    if (['Agent', 'Task'].includes(str(p.toolName)) && toolUseID) {
      if (p.input) inputs.set(toolUseID, record(p.input))
      const launch = parseNativeBackgroundTaskLaunch(str(p.output))
      if (launch) {
        launches.set(launch.taskId, { toolUseID, outputFile: launch.outputFile, toolName: 'Agent' })
        return { ...event, payload: { ...p, nativeBackgroundTask: launch } }
      }
    }
    if (str(p.toolName) === 'TaskOutput' && event.type === 'tool.completed') {
      const result = record(p.nativeTaskResult)
      const taskId = str(result.taskId)
      const launch = launches.get(taskId)
      if (launch && ['completed', 'failed', 'stopped', 'killed'].includes(str(result.status))) {
        const activity = readOutput && launch.outputFile ? readVisibleSubagentActivity(launch.outputFile) : undefined
        return { ...event, payload: { ...p, nativeBackgroundTaskResult: {
          toolUseID: launch.toolUseID, toolName: launch.toolName, status: result.status,
          ...(str(result.result) ? { result: result.result } : {}),
        }, backgroundAgentInput: inputs.get(launch.toolUseID) ?? {},
          ...(activity ? { subagentActivity: activity } : {}) } }
      }
    }
    if (!isNativeTaskLifecycle(p)) return event
    const taskId = str(p.task_id)
    const cached = launches.get(taskId)
    const id = str(p.tool_use_id) || cached?.toolUseID || taskId
    if (!id) return event
    const outputFile = str(p.output_file) || cached?.outputFile
    const toolName = str(p.task_type) === 'local_bash' ? 'Task' : cached?.toolName ?? 'Agent'
    launches.set(taskId, { toolUseID: id, outputFile, toolName })
    const input = inputs.get(id) ?? (p.input ? record(p.input) : {
      ...(p.description ? { description: p.description } : {}),
      ...(p.prompt ? { prompt: p.prompt } : {}),
    })
    inputs.set(id, input)
    const activity = readOutput && outputFile ? readVisibleSubagentActivity(outputFile) : undefined
    return { ...event, payload: { ...p, toolUseID: id, toolName, input,
      ...(activity ? { subagentActivity: activity } : {}) } }
  }
}

/** Bounded visible transcript tail; omits private thinking and transport records. */
export function readVisibleSubagentActivity(path: string): SubagentActivitySnapshot | undefined {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const size = fstatSync(fd).size
    const length = Math.min(size, 128 * 1024)
    const bytes = Buffer.alloc(length)
    readSync(fd, bytes, 0, length, size - length)
    const lines = bytes.toString('utf8').split('\n')
    if (size > length) lines.shift()
    const entries: SubagentActivityEntry[] = []
    const tools = new Map<string, Extract<SubagentActivityEntry, { kind: 'tool' }>>()
    const clip = (value: string, entry: SubagentActivityEntry) => {
      if (value.length <= 8000) return value
      entry.truncated = true
      return value.slice(0, 8000)
    }
    for (const line of lines) {
      let row: Record<string, unknown>
      try { row = record(redactVisible(JSON.parse(line))) } catch { continue }
      if (row.type !== 'assistant' && row.type !== 'user') continue
      const content = record(row.message).content
      if (!Array.isArray(content)) continue
      for (const [blockIndex, block] of content.map(record).entries()) {
        if (block.type === 'text' && row.type === 'assistant' && str(block.text)) {
          const messageId = str(row.uuid) || str(record(row.message).id) || `${size - length}-${entries.length}`
          const entry: SubagentActivityEntry = { id: `message-${messageId}-${blockIndex}`, kind: 'message', text: '' }
          entry.text = clip(str(block.text), entry)
          entries.push(entry)
        }
        if (block.type === 'tool_use') {
          const input = record(block.input)
          const id = str(block.id)
          const entry: Extract<SubagentActivityEntry, { kind: 'tool' }> = {
            id, kind: 'tool', toolName: str(block.name), status: 'running',
            ...(str(input.file_path || input.path) ? { filePath: str(input.file_path || input.path) } : {}),
          }
          if (str(input.command)) entry.command = clip(str(input.command), entry)
          if (!entry.command && !entry.filePath) entry.input = clip(JSON.stringify(input), entry)
          entries.push(entry)
          tools.set(id, entry)
        }
        if (block.type === 'tool_result') {
          const output = typeof block.content === 'string' ? block.content :
            Array.isArray(block.content) ? block.content.map(item => str(record(item).text)).join('\n') : ''
          const id = str(block.tool_use_id)
          let entry = tools.get(id)
          if (!entry) {
            // A bounded tail may not contain the invocation. Do not guess its type.
            entry = { id, kind: 'tool', toolName: '', status: 'completed' }
            entries.push(entry)
            tools.set(id, entry)
          }
          entry.status = block.is_error ? 'failed' : 'completed'
          entry.output = clip(output, entry)
        }
      }
    }
    let truncated = size > length || entries.some(entry => entry.truncated)
    // Trim whole entries, never detach a file/command from its output.
    let total = entries.reduce((sum, entry) => sum + JSON.stringify(entry).length, 0)
    while (entries.length > 1 && (total > 24_000 || entries.length > 40)) {
      total -= JSON.stringify(entries.shift()!).length
      truncated = true
    }
    return entries.length ? { entries, truncated } : undefined
  } catch { return undefined }
  finally { if (fd !== undefined) closeSync(fd) }
}
