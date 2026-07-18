export type BeeGameNativeTaskNotification = {
  value: string
  uuid?: string
  isMeta?: boolean
}

export type NativeTerminalTaskNotification = {
  key: string
  taskId?: string
  toolUseId?: string
  status: 'completed' | 'failed' | 'stopped' | 'killed'
  result?: string
}

/**
 * Reads Claude Code's native task-notification transport envelope without
 * interpreting the task result or controlling the task lifecycle.
 */
export function parseNativeTerminalTaskNotification(
  command: { value: unknown; uuid?: string; mode?: string },
): NativeTerminalTaskNotification | undefined {
  if (typeof command.value !== 'string') return undefined
  const status = readXmlTransportField(command.value, 'status')
  if (
    status !== 'completed' &&
    status !== 'failed' &&
    status !== 'stopped' &&
    status !== 'killed'
  ) return undefined
  const taskId = readXmlTransportField(command.value, 'task-id')
  const toolUseId = readXmlTransportField(command.value, 'tool-use-id')
  const key = toolUseId || taskId || command.uuid
  if (!key) return undefined
  const result = readXmlTransportField(command.value, 'result', true)
  return {
    key,
    ...(taskId ? { taskId } : {}),
    ...(toolUseId ? { toolUseId } : {}),
    status,
    ...(result ? { result } : {}),
  }
}

function readXmlTransportField(
  value: string,
  field: string,
  useLastClosingTag = false,
): string | undefined {
  const opening = `<${field}>`
  const closing = `</${field}>`
  const start = value.indexOf(opening)
  if (start < 0) return undefined
  const contentStart = start + opening.length
  const end = useLastClosingTag
    ? value.lastIndexOf(closing)
    : value.indexOf(closing, contentStart)
  if (end < 0) return undefined
  const content = value.slice(contentStart, end).trim()
  return content || undefined
}
