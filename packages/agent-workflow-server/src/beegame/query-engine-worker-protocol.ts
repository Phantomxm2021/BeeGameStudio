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
  }
  | { type: 'turn.stop'; turnId?: string }
  | {
    type: 'permission.resolve'
    requestId: string
    decision: DashboardPermissionDecision
  }
  | { type: 'runtime.dispose' }

export type QueryEngineWorkerMessage =
  | { type: 'runtime.ready' }
  | { type: 'runtime.error'; message: string }
  | { type: 'turn.message'; turnId: string; message: DashboardSDKMessage }
  | {
    type: 'session.task-notification'
    notification: BeeGameNativeTaskNotification
  }
  | { type: 'turn.completed'; turnId: string }
  | { type: 'turn.failed'; turnId: string; message: string }
  | {
    type: 'session.permission.request'
    requestId: string
    request: DashboardPermissionRequest
  }
