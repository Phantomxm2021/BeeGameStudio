import type {
  BeeGamePromptInput,
  BeeGameSessionRunnerStartInput,
  DashboardPermissionDecision,
  DashboardPermissionRequest,
  DashboardSDKMessage,
} from './session-manager'

export type SerializedQueryEngineStartInput = Omit<
  BeeGameSessionRunnerStartInput,
  'approvedOutboundTargets' | 'agentDefinitions'
> & {
  approvedOutboundTargets: Record<string, { url: string; addresses: string[] }>
  agentDefinitions?: Array<{
    agentType: string
    whenToUse: string
    tools?: string[]
    disallowedTools?: string[]
    source: string
    permissionMode?: 'plan'
    systemPrompt: string
    maxTurns?: number
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
  | { type: 'turn.completed'; turnId: string }
  | { type: 'turn.failed'; turnId: string; message: string }
  | {
    type: 'permission.request'
    turnId: string
    requestId: string
    request: DashboardPermissionRequest
  }
