import { createAgentWorkflowApp } from './app'
import { validateSecretStorageAtStartup } from './security/secret-crypto'
import { createResourceSelectionClient } from './beegame/resource-selection-client'
import { resolveResourceSelectionRuntimeConfig } from './beegame/resource-selection-config'

export { createAgentWorkflowApp }

const port = Number.parseInt(process.env.AGENT_WORKFLOW_PORT || '62174', 10)
const host = process.env.AGENT_WORKFLOW_HOST || '127.0.0.1'
let activeServer: ReturnType<typeof Bun.serve> | null = null

if (import.meta.main) {
  validateSecretStorageAtStartup()
  const resourceSelectionConfig = resolveResourceSelectionRuntimeConfig()
  activeServer = Bun.serve({
    hostname: host,
    port,
    fetch: createAgentWorkflowApp({
      modelConfigStore: {},
      ...(resourceSelectionConfig
        ? {
            resourceSelectionClient: createResourceSelectionClient(resourceSelectionConfig),
            resourceSelectionRuntimeConfig: resourceSelectionConfig,
          }
        : {}),
    }).fetch,
  })
  console.log(
    `Agent workflow server listening on http://${host}:${activeServer.port}`,
  )
}
