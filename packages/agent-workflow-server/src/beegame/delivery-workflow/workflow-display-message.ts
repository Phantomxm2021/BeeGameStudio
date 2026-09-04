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

/** Foundation review and revision cards project durable task evidence, never worker prose. */
export function projectWorkflowCurrentMessage(input: {
  value: unknown
  phase: unknown
  documentStep: unknown
}): string {
  if (
    (input.phase === 'DOCUMENT_REVIEW' &&
      input.documentStep === 'FOUNDATION_REVIEW') ||
    (input.phase === 'FOUNDATION_REVISION' &&
      input.documentStep === 'FOUNDATION_REVISION')
  )
    return ''
  return typeof input.value === 'string'
    ? sanitizeWorkflowDisplayMessage(input.value)
    : ''
}

export type WorkflowDisplayReasonCode =
  | 'user_stopped'
  | 'document_contract_failed'
  | 'revision_validation_failed'
  | 'derivation_failed'
  | 'dispatch_failed'
  | 'provider_failed'
  | 'workflow_blocked'

export type WorkflowDisplayReason = {
  message: string
  detail: string
  code: WorkflowDisplayReasonCode
  diagnosticId: string
  stage?: string
  taskId?: string
  documentPath?: string
  retryable?: boolean
}

const MAX_WORKFLOW_DISPLAY_DETAIL_LENGTH = 800

/**
 * Preserve the actionable technical cause without exposing host paths,
 * credentials, or an unbounded worker/protocol payload in the Dashboard.
 */
export function sanitizeWorkflowDisplayDetail(value: string): string {
  const withoutFences = value
    .replace(/```[\s\S]*?```/g, '[structured payload omitted]')
    .replace(
      /\b(?:authorization|api[-_ ]?key|access[-_ ]?token|secret)\s*[:=]\s*[^\s,;]+/gi,
      match => `${match.split(/[:=]/, 1)[0]}: [redacted]`,
    )
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(
      /(?:\/Users|\/home|\/private|\/tmp|[A-Za-z]:\\)[^\n\r;]*/g,
      '[host path redacted]',
    )
    .replace(/\s+/g, ' ')
    .trim()

  if (withoutFences.length <= MAX_WORKFLOW_DISPLAY_DETAIL_LENGTH)
    return withoutFences
  return `${withoutFences.slice(0, MAX_WORKFLOW_DISPLAY_DETAIL_LENGTH - 1)}…`
}

export type WorkflowDisplayReasonContext = {
  stage?: string
  taskId?: string
  documentPath?: string
  retryable?: boolean
}

const workflowDisplayReasonCodes = new Set<WorkflowDisplayReasonCode>([
  'user_stopped',
  'document_contract_failed',
  'revision_validation_failed',
  'derivation_failed',
  'dispatch_failed',
  'provider_failed',
  'workflow_blocked',
])

/** Project internal workflow failures into the stable Dashboard/API shape. */
export function projectWorkflowDisplayReason(
  value: unknown,
  context: WorkflowDisplayReasonContext = {},
): WorkflowDisplayReason | undefined {
  // Stage snapshots already carry the stable public projection. Preserve it
  // instead of feeding the localized message back through the raw-reason
  // classifier ("Workflow stopped by user." does not contain "user stopped").
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { message?: unknown }).message === 'string' &&
    workflowDisplayReasonCodes.has(
      (value as { code?: unknown }).code as WorkflowDisplayReasonCode,
    ) &&
    typeof (value as { diagnosticId?: unknown }).diagnosticId === 'string'
  ) {
    const projected = value as Record<string, unknown>
    const projectedContext: WorkflowDisplayReasonContext = {
      ...(typeof projected.stage === 'string'
        ? { stage: projected.stage }
        : {}),
      ...(typeof projected.taskId === 'string'
        ? { taskId: projected.taskId }
        : {}),
      ...(typeof projected.documentPath === 'string'
        ? { documentPath: projected.documentPath }
        : {}),
      ...(typeof projected.retryable === 'boolean'
        ? { retryable: projected.retryable }
        : {}),
    }
    return {
      message: (value as { message: string }).message,
      detail:
        typeof projected.detail === 'string' && projected.detail.trim()
          ? sanitizeWorkflowDisplayDetail(projected.detail)
          : (value as { message: string }).message,
      code: (value as { code: WorkflowDisplayReasonCode }).code,
      diagnosticId: (value as { diagnosticId: string }).diagnosticId,
      ...projectedContext,
      ...context,
    }
  }
  const reason = typeof value === 'string' ? value.trim() : ''
  if (!reason) return undefined
  const normalized = reason.toLowerCase().replaceAll('-', ' ')
  let code: WorkflowDisplayReasonCode = 'workflow_blocked'
  let message = 'Workflow is blocked and needs attention.'

  if (
    normalized.includes('user stopped') ||
    normalized.includes('operator stopped')
  ) {
    code = 'user_stopped'
    message = 'Workflow stopped by user.'
  } else if (
    normalized.includes('revision') &&
    (normalized.includes('validation') ||
      normalized.includes('fix target') ||
      normalized.includes('issue coverage') ||
      normalized.includes('authorized scope') ||
      normalized.includes('unauthorized'))
  ) {
    code = 'revision_validation_failed'
    if (
      normalized.includes('outside') ||
      normalized.includes('unauthorized') ||
      normalized.includes('scope')
    )
      message =
        'Foundation revision validation failed: the document changed outside the authorized scope.'
    else if (normalized.includes('issue coverage'))
      message =
        'Foundation revision validation failed: the revision did not cover its assigned issues.'
    else
      message = 'Foundation revision validation failed.'
  } else if (
    (normalized.includes('document') || normalized.includes('markdown')) &&
    (normalized.includes('contract') ||
      normalized.includes('format') ||
      normalized.includes('structured output') ||
      normalized.includes('invalid'))
  ) {
    code = 'document_contract_failed'
    message =
      'Document authoring failed: the generated Markdown did not satisfy the document contract.'
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
    .update(
      JSON.stringify({
        reason,
        stage: context.stage ?? '',
        taskId: context.taskId ?? '',
        documentPath: context.documentPath ?? '',
      }),
    )
    .digest('hex')
    .slice(0, 12)}`
  const explicitDiagnosticId = reason.match(
    /(?:diagnostic(?:\s+id)?|诊断编号)\s*[：:#-]?\s*([a-z0-9-]{8,})/i,
  )?.[1]
  return {
    message,
    detail: sanitizeWorkflowDisplayDetail(reason),
    code,
    diagnosticId: explicitDiagnosticId ?? diagnosticId,
    ...context,
  }
}
