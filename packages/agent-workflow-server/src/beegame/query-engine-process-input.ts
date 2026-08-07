import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'
import type {
  BeeGameApprovedOutboundTargets,
  BeeGameSessionRunnerStartInput,
} from './session-manager'
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
    approvedOutboundTargets,
    onNativeTaskNotification: _onNativeTaskNotification,
    requestPermission: _requestPermission,
    ...serializableInput
  } = input
  return {
    ...serializableInput,
    approvedOutboundTargets: Object.fromEntries(
      Object.entries(approvedOutboundTargets).map(([key, target]) => [
        key,
        {
          url: target.url.toString(),
          addresses: [...target.addresses],
          ...(target.trustedDevelopmentProxy
            ? { trustedDevelopmentProxy: true as const }
            : {}),
        },
      ]),
    ),
  }
}

export function deserializeQueryEngineStartInput(
  input: SerializedQueryEngineStartInput,
): BeeGameSessionRunnerStartInput {
  assertWorkflowWorkerIdentity(input)
  const { approvedOutboundTargets, ...runnerInput } = input
  return {
    ...runnerInput,
    approvedOutboundTargets: Object.fromEntries(
      Object.entries(approvedOutboundTargets).map(([key, target]) => [
        key,
        createApprovedTarget(
          target.url,
          target.addresses,
          target.trustedDevelopmentProxy,
        ),
      ]),
    ) as BeeGameApprovedOutboundTargets,
  }
}

function createApprovedTarget(
  url: string,
  addresses: string[],
  trustedDevelopmentProxy?: true,
): ApprovedOutboundTarget {
  const parsed = new URL(url)
  return {
    url: parsed,
    addresses,
    ...(trustedDevelopmentProxy ? { trustedDevelopmentProxy } : {}),
    lookup(hostname, _options, callback) {
      if (hostname !== parsed.hostname || addresses.length === 0) {
        callback(new Error('Outbound URL is not permitted'), '', 4)
        return
      }
      const address = addresses[0]!
      callback(null, address, address.includes(':') ? 6 : 4)
    },
  }
}
