import { AgentAdapterRegistry } from '../agentAdapter.js'
import type { AgentRunParams, AgentRunResult } from '../types.js'

export function createTestRegistry(
  run: (params: AgentRunParams) => Promise<AgentRunResult>,
): AgentAdapterRegistry {
  return new AgentAdapterRegistry()
    .register({
      id: 'test',
      capabilities: { structuredOutput: true },
      run,
    })
    .default('test')
}

export function createResultRegistry(
  results: Map<string, AgentRunResult>,
): AgentAdapterRegistry {
  return createTestRegistry(
    async (params: AgentRunParams): Promise<AgentRunResult> =>
      results.get(params.prompt) ?? {
        kind: 'dead',
        reason: 'runagent-threw',
      },
  )
}
