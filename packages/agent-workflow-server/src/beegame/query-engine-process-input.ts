import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'
import type {
  BeeGameApprovedOutboundTargets,
  BeeGameSessionRunnerStartInput,
} from './session-manager'
import type { SerializedQueryEngineStartInput } from './query-engine-worker-protocol'

export function serializeQueryEngineStartInput(
  input: BeeGameSessionRunnerStartInput,
): SerializedQueryEngineStartInput {
  return {
    sessionId: input.sessionId,
    ...(input.deliveryEvidenceDataRoot
      ? { deliveryEvidenceDataRoot: input.deliveryEvidenceDataRoot }
      : {}),
    ...(input.resumeSessionId
      ? { resumeSessionId: input.resumeSessionId }
      : {}),
    ...(input.language ? { language: input.language } : {}),
    cwd: input.cwd,
    env: input.env,
    ...(input.resourceSelectionConfig
      ? { resourceSelectionConfig: input.resourceSelectionConfig }
      : {}),
    ...(input.workflowWorker ? { workflowWorker: true } : {}),
    ...(input.workflowWorkerType
      ? { workflowWorkerType: input.workflowWorkerType }
      : {}),
    ...(input.workflowAllowedPaths
      ? { workflowAllowedPaths: [...input.workflowAllowedPaths] }
      : {}),
    ...(input.workflowProtectedPaths
      ? { workflowProtectedPaths: [...input.workflowProtectedPaths] }
      : {}),
    ...(input.workflowReadOnlyPaths
      ? { workflowReadOnlyPaths: [...input.workflowReadOnlyPaths] }
      : {}),
    ...(input.workflowDocumentAuthorMode
      ? { workflowDocumentAuthorMode: input.workflowDocumentAuthorMode }
      : {}),
    ...(input.workflowDocumentRepairPlanContract
      ? {
          workflowDocumentRepairPlanContract:
            input.workflowDocumentRepairPlanContract,
        }
      : {}),
    ...(input.workflowCanonicalDocumentCommitContract
      ? {
          workflowCanonicalDocumentCommitContract:
            input.workflowCanonicalDocumentCommitContract,
        }
      : {}),
    ...(input.workflowResourceContentCommitContract
      ? {
          workflowResourceContentCommitContract:
            input.workflowResourceContentCommitContract,
        }
      : {}),
    ...(input.workflowDocumentReviewContract
      ? { workflowDocumentReviewContract: input.workflowDocumentReviewContract }
      : {}),
    approvedOutboundTargets: Object.fromEntries(
      Object.entries(input.approvedOutboundTargets).map(([key, target]) => [
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
  return {
    sessionId: input.sessionId,
    ...(input.deliveryEvidenceDataRoot
      ? { deliveryEvidenceDataRoot: input.deliveryEvidenceDataRoot }
      : {}),
    ...(input.resumeSessionId
      ? { resumeSessionId: input.resumeSessionId }
      : {}),
    ...(input.language ? { language: input.language } : {}),
    cwd: input.cwd,
    env: input.env,
    ...(input.resourceSelectionConfig
      ? { resourceSelectionConfig: input.resourceSelectionConfig }
      : {}),
    ...(input.workflowWorker ? { workflowWorker: true } : {}),
    ...(input.workflowWorkerType
      ? { workflowWorkerType: input.workflowWorkerType }
      : {}),
    ...(input.workflowAllowedPaths
      ? { workflowAllowedPaths: [...input.workflowAllowedPaths] }
      : {}),
    ...(input.workflowProtectedPaths
      ? { workflowProtectedPaths: [...input.workflowProtectedPaths] }
      : {}),
    ...(input.workflowReadOnlyPaths
      ? { workflowReadOnlyPaths: [...input.workflowReadOnlyPaths] }
      : {}),
    ...(input.workflowDocumentAuthorMode
      ? { workflowDocumentAuthorMode: input.workflowDocumentAuthorMode }
      : {}),
    ...(input.workflowDocumentRepairPlanContract
      ? {
          workflowDocumentRepairPlanContract:
            input.workflowDocumentRepairPlanContract,
        }
      : {}),
    ...(input.workflowCanonicalDocumentCommitContract
      ? {
          workflowCanonicalDocumentCommitContract:
            input.workflowCanonicalDocumentCommitContract,
        }
      : {}),
    ...(input.workflowResourceContentCommitContract
      ? {
          workflowResourceContentCommitContract:
            input.workflowResourceContentCommitContract,
        }
      : {}),
    ...(input.workflowDocumentReviewContract
      ? { workflowDocumentReviewContract: input.workflowDocumentReviewContract }
      : {}),
    approvedOutboundTargets: Object.fromEntries(
      Object.entries(input.approvedOutboundTargets).map(([key, target]) => [
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
