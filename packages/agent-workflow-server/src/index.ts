import { createAgentWorkflowApp } from './app'
import { validateSecretStorageAtStartup } from './security/secret-crypto'

export { createAgentWorkflowApp }

const port = Number.parseInt(process.env.AGENT_WORKFLOW_PORT || '62174', 10)
const host = process.env.AGENT_WORKFLOW_HOST || '127.0.0.1'
let activeServer: ReturnType<typeof Bun.serve> | null = null

if (import.meta.main) {
  validateSecretStorageAtStartup()
  activeServer = Bun.serve({
    hostname: host,
    port,
    fetch: createAgentWorkflowApp({ modelConfigStore: {} }).fetch,
  })
  console.log(
    `Agent workflow server listening on http://${host}:${activeServer.port}`,
  )
}
