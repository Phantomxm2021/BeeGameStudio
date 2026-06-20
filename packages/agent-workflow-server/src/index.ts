import { createAgentWorkflowApp } from './app'

export { createAgentWorkflowApp }
export { createClaudeCodeRuntimeAdapter } from './runtime/claude-code-runtime-adapter'
export { createNullRuntimeAdapter } from './runtime/null-runtime-adapter'
export type {
  ClaudeCodeRuntimeControlInput,
  ClaudeCodeRuntimeLauncher,
  ClaudeCodeRuntimeLaunchInput,
} from './runtime/claude-code-runtime-adapter'
export type {
  RuntimeAdapter,
  RuntimeEvent,
  RuntimeRunControlInput,
  RuntimeStartInput,
} from './runtime/types'

const port = Number.parseInt(process.env.AGENT_WORKFLOW_PORT || '3020', 10)

export default {
  port,
  fetch: createAgentWorkflowApp().fetch,
}
