export const DOCUMENT_NATIVE_WRITE_MAX_BYTES = 16 * 1024

const DOCUMENT_NATIVE_WRITE_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
])

export interface WorkflowToolInputBudgetState {
  readonly activeByBlockIndex: Map<number, { toolName: string; observedBytes: number }>
}

export interface WorkflowToolInputOverflow {
  code: 'document_native_write_input_too_large'
  toolName: string
  maxBytes: number
  observedBytes: number
}

export function createWorkflowToolInputBudgetState(): WorkflowToolInputBudgetState {
  return { activeByBlockIndex: new Map() }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function observeWorkflowToolInput(
  state: WorkflowToolInputBudgetState,
  message: unknown,
): WorkflowToolInputOverflow | undefined {
  const envelope = objectValue(message)
  if (envelope?.type !== 'stream_event') return undefined
  const event = objectValue(envelope.event) ?? envelope
  const index = typeof event.index === 'number' ? event.index : undefined
  if (index === undefined) return undefined

  if (event.type === 'content_block_start') {
    const block = objectValue(event.content_block)
    const toolName = typeof block?.name === 'string' ? block.name : undefined
    if (block?.type === 'tool_use' && toolName && DOCUMENT_NATIVE_WRITE_TOOLS.has(toolName))
      state.activeByBlockIndex.set(index, { toolName, observedBytes: 0 })
    return undefined
  }

  if (event.type === 'content_block_stop') {
    state.activeByBlockIndex.delete(index)
    return undefined
  }

  if (event.type !== 'content_block_delta') return undefined
  const active = state.activeByBlockIndex.get(index)
  if (!active) return undefined
  const delta = objectValue(event.delta)
  if (delta?.type !== 'input_json_delta' || typeof delta.partial_json !== 'string')
    return undefined

  active.observedBytes += Buffer.byteLength(delta.partial_json, 'utf8')
  if (active.observedBytes <= DOCUMENT_NATIVE_WRITE_MAX_BYTES) return undefined
  return {
    code: 'document_native_write_input_too_large',
    toolName: active.toolName,
    maxBytes: DOCUMENT_NATIVE_WRITE_MAX_BYTES,
    observedBytes: active.observedBytes,
  }
}

