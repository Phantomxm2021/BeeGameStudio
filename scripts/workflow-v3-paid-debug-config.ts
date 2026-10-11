import { buildRuntimeEnv } from './beegame-dev-lib'
import { BEEGAME_FIXED_SERVICE_PORTS } from '../packages/agent-workflow-server/src/beegame/fixed-service-ports'
import { resolveResourceSelectionRuntimeConfig } from '../packages/agent-workflow-server/src/beegame/resource-selection-config'

/** The opt-in local acceptance host shares normal runtime service wiring.
 * Pure configuration: no credentials printed, service starts or paid calls. */
export function paidDebugRuntimeConfig(baseEnv: Record<string, string | undefined>) {
  const workspacePath = baseEnv.AGENT_WORKFLOW_WORKSPACE_PATH?.trim()
  if (!workspacePath) throw Error('AGENT_WORKFLOW_WORKSPACE_PATH is required')
  // Reject partial explicit configuration before a local fallback can mask it.
  resolveResourceSelectionRuntimeConfig(baseEnv)
  const env = buildRuntimeEnv({ baseEnv, workspacePath, ports: BEEGAME_FIXED_SERVICE_PORTS })
  return { env, resources: resolveResourceSelectionRuntimeConfig(env)! }
}
