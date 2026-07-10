import { createAgentWorkflowApp } from './app'
import { createResourceSelectionClient } from './beegame/resource-selection-client'

export { createAgentWorkflowApp }

const port = Number.parseInt(process.env.AGENT_WORKFLOW_PORT || '62174', 10)
const host = process.env.AGENT_WORKFLOW_HOST || '127.0.0.1'
let activeServer: ReturnType<typeof Bun.serve> | null = null

if (import.meta.main) {
  const resourceServerUrl = process.env.BEEGAME_RESOURCE_SERVER_URL?.trim()
  const resourceServiceToken = process.env.BEEGAME_RESOURCE_SERVICE_TOKEN?.trim()
  activeServer = Bun.serve({
    hostname: host,
    port,
    fetch: createAgentWorkflowApp({
      modelConfigStore: {},
      ...(resourceServerUrl && resourceServiceToken
        ? { resourceSelectionClient: createResourceSelectionClient({ baseUrl: resourceServerUrl, serviceToken: resourceServiceToken }) }
        : {}),
    }).fetch,
  })
  console.log(
    `Agent workflow server listening on http://${host}:${activeServer.port}`,
  )
}
