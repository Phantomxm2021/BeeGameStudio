import type { BeeGameSessionRunnerStartInput } from './session-manager'
import type { SerializedQueryEngineStartInput } from './query-engine-worker-protocol'

function assertWorkflowWorkerIdentity(input: {
  workflowWorker?: boolean
  workflowWorkerType?: string
  workflowDispatchId?: string
}): void {
  if (!input.workflowWorker) return
  if (!input.workflowWorkerType?.trim())
    throw new Error('Workflow worker type is required.')
  if (!input.workflowDispatchId?.trim())
    throw new Error('Workflow worker dispatch identity is required.')
}

export function serializeQueryEngineStartInput(
  input: BeeGameSessionRunnerStartInput,
): SerializedQueryEngineStartInput {
  assertWorkflowWorkerIdentity(input)
  const {
    onNativeTaskNotification: _onNativeTaskNotification,
    requestPermission: _requestPermission,
    ...serializableInput
  } = input
  return serializableInput
}

export function deserializeQueryEngineStartInput(
  input: SerializedQueryEngineStartInput,
): BeeGameSessionRunnerStartInput {
  assertWorkflowWorkerIdentity(input)
  return input
}
