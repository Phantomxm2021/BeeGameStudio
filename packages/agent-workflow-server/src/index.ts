import { createAgentWorkflowApp } from './app'

export { createAgentWorkflowApp }

const port = Number.parseInt(process.env.AGENT_WORKFLOW_PORT || '3020', 10)

if (import.meta.main) {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: createAgentWorkflowApp().fetch,
  })
  console.log(
    `Agent workflow server listening on http://127.0.0.1:${server.port}`,
  )
}
