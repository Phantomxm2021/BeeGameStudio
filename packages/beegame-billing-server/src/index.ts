import {
  createBeeGameBillingApp,
  type BeeGameBillingAppOptions,
} from '@claude-code-best/agent-workflow-server/billing'

export function createBeeGameBillingServerApp(
  options: BeeGameBillingAppOptions = {},
): ReturnType<typeof createBeeGameBillingApp> {
  return createBeeGameBillingApp(options)
}

const port = Number.parseInt(
  process.env.BEEGAME_BILLING_PORT ||
    process.env.AGENT_WORKFLOW_PORT ||
    '62175',
  10,
)
const host =
  process.env.BEEGAME_BILLING_HOST ||
  process.env.AGENT_WORKFLOW_HOST ||
  '127.0.0.1'

if (import.meta.main) {
  const server = Bun.serve({
    hostname: host,
    port,
    fetch: createBeeGameBillingServerApp().fetch,
  })
  console.log(`BeeGame billing server listening on http://${host}:${server.port}`)
}
