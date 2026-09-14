import { createHash } from 'node:crypto'

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const reference = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 512
  ? createHash('sha256').update(value).digest('hex').slice(0, 24) : undefined
const text = (value: unknown): string => typeof value === 'string' ? value.slice(0, 65536)
  : Array.isArray(value) ? value.slice(0, 32).map(block => {
    const item = record(block)
    return item?.type === 'text' && typeof item.text === 'string' ? item.text.slice(0, 2048) : ''
  }).join('\n') : ''
const tag = (value: string, name: string) => value.match(new RegExp('<' + name + '>([^<]{1,512})</' + name + '>'))?.[1]?.trim()
const safeNumber = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined

const errorDetails = (body: string) => {
  if (/TASK_RESULT_NOT_FOUND|No task found with ID:/i.test(body)) return {
    errorClass: 'not_found', errorCode: 'TASK_RESULT_NOT_FOUND', errorSummary: 'Task ID unavailable in memory and no durable result receipt was found.' }
  if (/permission|not permitted|access denied|outside the task execution permissions/i.test(body)) return {
    errorClass: 'permission_denied', errorCode: 'TOOL_PERMISSION_DENIED', errorSummary: 'Tool execution was denied by the permission boundary.' }
  if (/syntaxerror|syntax error|unexpected token/i.test(body)) return {
    errorClass: 'syntax_error', errorCode: 'TOOL_SYNTAX_ERROR', errorSummary: 'Tool input or command could not be parsed.' }
  if (/timed? out|timeout/i.test(body)) return {
    errorClass: 'timeout', errorCode: 'TOOL_TIMEOUT', errorSummary: 'Tool execution exceeded its timeout.' }
  if (/not found|no such file/i.test(body)) return {
    errorClass: 'not_found', errorCode: 'TOOL_RESOURCE_NOT_FOUND', errorSummary: 'A requested tool resource or file was not found.' }
  if (/exit code|command failed/i.test(body)) return {
    errorClass: 'command_failed', errorCode: 'TOOL_COMMAND_FAILED', errorSummary: 'Tool command returned a failure.' }
  return { errorClass: 'unknown', errorCode: 'TOOL_ERROR_UNCLASSIFIED', errorSummary: 'Unclassified tool error; correlate the fingerprint with the private task result receipt.' }
}

/** Only bounded enums, template summaries, timings and hashed correlation IDs leave this module.
 * Error classes are diagnostic hints, not a semantic verdict on model output. */
export function createNativeToolDiagnostics(now = () => performance.now()) {
  const calls = new Map<string, { name: string; started: number; parentRef?: string; taskRef?: string }>()
  return {
    started(block: Record<string, any>, parent: unknown) {
      const args = record(block.input) ?? {}
      const name = typeof block.name === 'string' && /^[A-Za-z_]{1,64}$/.test(block.name) ? block.name : 'unknown'
      const parentRef = reference(parent)
      const taskRef = reference(name === 'TaskOutput' ? args.task_id : name === 'Agent' ? args.resume : undefined)
      calls.set(String(block.id), { name, started: now(), parentRef, taskRef })
      return { tool: name, parentRef, taskRef,
        ...(name === 'Agent' ? { background: args.run_in_background === true, resume: typeof args.resume === 'string' } : {}),
        ...(name === 'TaskOutput' ? { block: args.block !== false, timeoutMs: safeNumber(args.timeout) } : {}) }
    },
    finished(block: Record<string, any>, parent: unknown) {
      const call = calls.get(String(block.tool_use_id))
      calls.delete(String(block.tool_use_id))
      const body = text(block.content)
      const retrieval = tag(body, 'retrieval_status')
      const retrievalSource = tag(body, 'retrieval_source')
      const status = tag(body, 'status')
      const task = tag(body, 'task_id') ?? body.match(/(?:^|\n)agentId: ([a-zA-Z0-9_-]{1,512})(?:\s|$)/)?.[1]
      // Retrieving a failed task is a successful tool call with a nested error.
      const error = block.is_error === true || (status === 'failed' && tag(body, 'error')) ? errorDetails(body) : undefined
      return { tool: call?.name, parentRef: call?.parentRef ?? reference(parent),
        taskRef: reference(task) ?? call?.taskRef,
        durationMs: call ? Math.max(0, Math.round(now() - call.started)) : undefined,
        ...(retrieval && ['success', 'timeout', 'not_ready'].includes(retrieval) ? { retrievalStatus: retrieval } : {}),
        ...(retrievalSource === 'receipt' ? { retrievalSource } : {}),
        ...(status && ['pending', 'running', 'completed', 'failed', 'stopped', 'killed'].includes(status) ? { taskStatus: status } : {}),
        ...(error ? { ...error, errorRef: createHash('sha256').update(body).digest('hex').slice(0, 24) } : {}) }
    },
  }
}
