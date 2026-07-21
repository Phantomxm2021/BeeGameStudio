import { createAgentWorkflowApp } from './app'
import { validateSecretStorageAtStartup } from './security/secret-crypto'
import { resolveResourceSelectionRuntimeConfig } from './beegame/resource-selection-config'

export { createAgentWorkflowApp }

const port = Number.parseInt(process.env.AGENT_WORKFLOW_PORT || '62174', 10)
const host = process.env.AGENT_WORKFLOW_HOST || '127.0.0.1'
let activeServer: ReturnType<typeof Bun.serve> | null = null

if (import.meta.main) {
  validateSecretStorageAtStartup()
  const resourceSelectionConfig = resolveResourceSelectionRuntimeConfig()
  const cleanupHandlers: Array<() => void> = []
  activeServer = Bun.serve({
    hostname: host,
    port,
    fetch: createAgentWorkflowApp({
      registerCleanup: cleanup => cleanupHandlers.push(cleanup),
      modelConfigStore: {},
      ...(resourceSelectionConfig
        ? {
            resourceSelectionRuntimeConfig: resourceSelectionConfig,
          }
        : {}),
    }).fetch,
  })
  console.log(
    `Agent workflow server listening on http://${host}:${activeServer.port}`,
  )
  let shuttingDown = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      if (shuttingDown) return
      shuttingDown = true
      for (const cleanup of cleanupHandlers) cleanup()
      activeServer?.stop(true)
      process.exit(signal === 'SIGINT' ? 130 : 143)
    })
  }
}
