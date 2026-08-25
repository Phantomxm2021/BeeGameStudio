import { createHash } from 'node:crypto'

/**
 * Keeps worker protocol payloads out of the user-facing workflow card. Worker
 * responses may include a fenced terminal object after the human-readable
 * update; that object remains available in the durable dispatch record.
 */
export function sanitizeWorkflowDisplayMessage(value: string): string {
  const lines = value.replaceAll('\r', '').split('\n')
  const visible: string[] = []
  let insideFence = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      insideFence = !insideFence
      continue
    }
    if (!insideFence) visible.push(line)
  }

  const message = visible.join('\n').trim()
  if (!message) return ''

  try {
    const payload: unknown = JSON.parse(message)
    if (payload !== null && typeof payload === 'object') return ''
  } catch {
    // Human-readable progress is not required to be JSON.
  }

  return message
}

/** Foundation review cards project durable task evidence, never worker prose. */
export function projectWorkflowCurrentMessage(input: {
  value: unknown
  phase: unknown
  documentStep: unknown
}): string {
  if (
    input.phase === 'DOCUMENT_REVIEW' &&
    input.documentStep === 'FOUNDATION_REVIEW'
  )
    return ''
  return typeof input.value === 'string'
    ? sanitizeWorkflowDisplayMessage(input.value)
    : ''
}

export type WorkflowDisplayReasonCode =
  | 'round_limit'
  | 'user_stopped'
  | 'derivation_failed'
  | 'dispatch_failed'
  | 'provider_failed'
  | 'workflow_blocked'

export type WorkflowDisplayReason = {
  message: string
  code: WorkflowDisplayReasonCode
  diagnosticId: string
}

/** Project internal workflow failures into the stable Dashboard/API shape. */
export function projectWorkflowDisplayReason(
  value: unknown,
): WorkflowDisplayReason | undefined {
  const reason = typeof value === 'string' ? value.trim() : ''
  if (!reason) return undefined
  const normalized = reason.toLowerCase().replaceAll('-', ' ')
  let code: WorkflowDisplayReasonCode = 'workflow_blocked'
  let message = 'Workflow is blocked and needs attention.'

  if (/round[ ._:]*limit/.test(normalized)) {
    code = 'round_limit'
    message = 'Automatic revision limit reached.'
  } else if (
    normalized.includes('user stopped') ||
    normalized.includes('operator stopped')
  ) {
    code = 'user_stopped'
    message = 'Workflow stopped by user.'
  } else if (normalized.includes('deriv')) {
    code = 'derivation_failed'
    message = 'Foundation audit could not be derived.'
  } else if (
    normalized.includes('provider') ||
    normalized.includes('model') ||
    normalized.includes('llm')
  ) {
    code = 'provider_failed'
    message = 'Workflow provider failed.'
  } else if (
    normalized.includes('dispatch') ||
    normalized.includes('worker') ||
    normalized.includes('transport')
  ) {
    code = 'dispatch_failed'
    message = 'Workflow dispatch failed.'
  }

  const diagnosticId = `workflow-${createHash('sha256')
    .update(reason)
    .digest('hex')
    .slice(0, 12)}`
  const explicitDiagnosticId = reason.match(
    /(?:diagnostic(?:\s+id)?|诊断编号)\s*[：:#-]?\s*([a-z0-9-]{8,})/i,
  )?.[1]
  return {
    message,
    code,
    diagnosticId: explicitDiagnosticId ?? diagnosticId,
  }
}
