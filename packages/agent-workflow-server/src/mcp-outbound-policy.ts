import { resolveApprovedOutboundTarget, type OutboundTargetPolicyOptions } from '@bee-game-studio/security-core'
import {
  createPublicOutboundDns,
  resolvePublicIpv4,
  type PublicIpv4Resolver,
} from './public-outbound-policy'

/** MCP has its own public HTTPS policy; model-provider exceptions never apply. */
export function createMcpOutboundPolicy(
  options: OutboundTargetPolicyOptions = {},
  resolvePublic4: PublicIpv4Resolver = resolvePublicIpv4,
): OutboundTargetPolicyOptions {
  const dns = createPublicOutboundDns(options, resolvePublic4)
  return {
    allowedHosts: [],
    allowHttp: false,
    allowTrustedDevelopmentProxy: false,
    ...dns,
  }
}

export function resolveMcpOutboundTarget(
  value: string,
  options?: OutboundTargetPolicyOptions,
  resolver: typeof resolveApprovedOutboundTarget = resolveApprovedOutboundTarget,
) {
  return resolver(value, createMcpOutboundPolicy(options))
}
