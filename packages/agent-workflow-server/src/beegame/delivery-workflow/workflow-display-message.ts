import { createHash } from 'node:crypto'
import type { GameIrCompilationDiagnostic } from './types'

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
  | 'user_stopped'
  | 'derivation_failed'
  | 'dispatch_failed'
  | 'provider_failed'
  | 'game_ir_compilation'
  | 'game_ir_publication'
  | 'workflow_blocked'

export type WorkflowDisplayReason = {
  message: string
  code: WorkflowDisplayReasonCode
  diagnosticId: string
}

const workflowDisplayReasonCodes = new Set<WorkflowDisplayReasonCode>([
  'user_stopped',
  'derivation_failed',
  'dispatch_failed',
  'provider_failed',
  'game_ir_compilation',
  'game_ir_publication',
  'workflow_blocked',
])

/** Project internal workflow failures into the stable Dashboard/API shape. */
export function projectWorkflowDisplayReason(
  value: unknown,
): WorkflowDisplayReason | undefined {
  if (
    value !== null &&
    typeof value === 'object' &&
    (value as Partial<GameIrCompilationDiagnostic>).phase === 'GAME_IR_COMPILATION' &&
    (value as Partial<GameIrCompilationDiagnostic>).workerType === 'game-ir-compiler' &&
    typeof (value as Partial<GameIrCompilationDiagnostic>).reasonCode === 'string' &&
    typeof (value as Partial<GameIrCompilationDiagnostic>).diagnosticRef === 'string'
  ) {
    const diagnostic = value as GameIrCompilationDiagnostic
    const publication = diagnostic.reasonCode === 'publication'
    return {
      code: publication ? 'game_ir_publication' : 'game_ir_compilation',
      message: publication
        ? 'Game IR publication needs attention.'
        : 'Game IR compilation needs attention.',
      diagnosticId: diagnostic.diagnosticRef,
    }
  }
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
  )
    return {
      message: (value as { message: string }).message,
      code: (value as { code: WorkflowDisplayReasonCode }).code,
      diagnosticId: (value as { diagnosticId: string }).diagnosticId,
    }
  const reason = typeof value === 'string' ? value.trim() : ''
  if (!reason) return undefined
  const normalized = reason.toLowerCase().replaceAll('-', ' ').replaceAll('_', ' ')
  let code: WorkflowDisplayReasonCode = 'workflow_blocked'
  let message = 'Workflow is blocked and needs attention.'

  if (
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
  } else if (normalized.includes('game ir compilation')) {
    code = 'game_ir_compilation'
    message = 'Game IR compilation needs attention.'
  } else if (normalized.includes('game ir publication')) {
    code = 'game_ir_publication'
    message = 'Game IR publication needs attention.'
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
