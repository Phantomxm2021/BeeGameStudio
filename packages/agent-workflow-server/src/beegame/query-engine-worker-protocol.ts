import type {
  BeeGamePromptInput,
  BeeGameSessionRunnerStartInput,
  DashboardPermissionDecision,
  DashboardPermissionRequest,
  DashboardSDKMessage,
} from './session-manager'
import type { BeeGameNativeTaskNotification } from './native-task-notification'

export type SerializedQueryEngineStartInput = Omit<
  BeeGameSessionRunnerStartInput,
  'approvedOutboundTargets' | 'onNativeTaskNotification' | 'requestPermission'
> & {
  approvedOutboundTargets: Record<string, {
    url: string
    addresses: string[]
    trustedDevelopmentProxy?: true
  }>
}

export type QueryEngineParentMessage =
  | { type: 'runtime.init'; input: SerializedQueryEngineStartInput }
  | {
    type: 'turn.submit'
    turnId: string
    prompt: BeeGamePromptInput
    confirmedBriefContext?: string
  }
  | { type: 'turn.stop'; turnId?: string }
  | {
    type: 'permission.resolve'
    requestId: string
    decision: DashboardPermissionDecision
  }
  | { type: 'runtime.dispose' }

export type SerializedQueryEngineError = {
  message: string
  name: string
  code?: string
  causeCode?: string
  retryable: boolean
}

const RETRYABLE_TRANSPORT_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_SIGNATURE_FAILURE',
  'CERTIFICATE_VERIFY_FAILED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'EAI_AGAIN',
  'ECONNRESET',
  'ETIMEDOUT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_CERTIFICATE_VERIFY_FAILED',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
])

function errorProperty(error: unknown, key: 'code' | 'retryable'): unknown {
  return error && typeof error === 'object'
    ? (error as Record<string, unknown>)[key]
    : undefined
}

function nestedErrorCode(error: unknown): string | undefined {
  let current = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as { cause?: unknown }).cause
    const code = errorProperty(current, 'code')
    if (typeof code === 'string' && code) return code
  }
  return undefined
}

export function serializeQueryEngineError(
  error: unknown,
  fallbackMessage: string,
): SerializedQueryEngineError {
  const code = errorProperty(error, 'code')
  const causeCode = nestedErrorCode(error)
  const normalizedCode = typeof code === 'string' && code ? code : undefined
  const retryable =
    errorProperty(error, 'retryable') === true ||
    (normalizedCode !== undefined && RETRYABLE_TRANSPORT_CODES.has(normalizedCode)) ||
    (causeCode !== undefined && RETRYABLE_TRANSPORT_CODES.has(causeCode))
  return {
    message: error instanceof Error ? error.message : fallbackMessage,
    name: error instanceof Error ? error.name : 'Error',
    ...(normalizedCode ? { code: normalizedCode } : {}),
    ...(causeCode ? { causeCode } : {}),
    retryable,
  }
}

export class QueryEngineWorkerError extends Error {
  readonly code?: string
  readonly causeCode?: string
  readonly retryable: boolean

  constructor(serialized: SerializedQueryEngineError) {
    super(serialized.message)
    this.name = serialized.name
    this.code = serialized.code
    this.causeCode = serialized.causeCode
    this.retryable = serialized.retryable
  }
}

export function isRetryableQueryEngineError(error: unknown): boolean {
  return error instanceof QueryEngineWorkerError && error.retryable
}

export type QueryEngineWorkerMessage =
  | { type: 'runtime.ready' }
  | { type: 'runtime.error'; error: SerializedQueryEngineError }
  | { type: 'turn.message'; turnId: string; message: DashboardSDKMessage }
  | {
    type: 'session.task-notification'
    notification: BeeGameNativeTaskNotification
  }
  | { type: 'turn.completed'; turnId: string }
  | { type: 'turn.failed'; turnId: string; error: SerializedQueryEngineError }
  | {
    type: 'session.permission.request'
    requestId: string
    request: DashboardPermissionRequest
  }
