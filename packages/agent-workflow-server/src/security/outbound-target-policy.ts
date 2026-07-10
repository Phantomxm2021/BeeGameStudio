import {
  resolveApprovedOutboundTarget,
  type OutboundTargetPolicyOptions,
} from '@bee-game-studio/security-core'

export type { OutboundTargetPolicyOptions } from '@bee-game-studio/security-core'

/** @deprecated Use resolveApprovedOutboundTarget from security-core. */
export async function validateOutboundTarget(
  value: string,
  options: OutboundTargetPolicyOptions = {},
): Promise<boolean> {
  return Boolean(await resolveApprovedOutboundTarget(value, options))
}
