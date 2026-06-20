import { createAgentWorkflowApp } from './app'

export { createAgentWorkflowApp }

const port = Number.parseInt(process.env.AGENT_WORKFLOW_PORT || '3020', 10)

export default {
  port,
  fetch: createAgentWorkflowApp().fetch,
}
