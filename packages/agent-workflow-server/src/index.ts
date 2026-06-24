import { createAgentWorkflowApp } from './app'

export { createAgentWorkflowApp }

const port = Number.parseInt(process.env.AGENT_WORKFLOW_PORT || '62174', 10)
let activeServer: ReturnType<typeof Bun.serve> | null = null

if (import.meta.main) {
  activeServer = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: createAgentWorkflowApp({ modelConfigStore: {} }).fetch,
  })
  console.log(
    `Agent workflow server listening on http://127.0.0.1:${activeServer.port}`,
  )
}
