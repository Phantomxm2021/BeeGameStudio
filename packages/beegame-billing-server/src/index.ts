import {
  createBeeGameBillingServerApp,
  type BeeGameBillingServerAppOptions,
} from './app'
import {
  getBeeGameBillingEnvDiagnostics,
  loadBeeGameBillingEnv,
  resolveBeeGameBillingListenOptions,
  summarizeBeeGameBillingEnv,
} from './env'

export { createBeeGameBillingServerApp }
export type { BeeGameBillingServerAppOptions }

if (import.meta.main) {
  const envLoad = await loadBeeGameBillingEnv()
  const envSummary = summarizeBeeGameBillingEnv()
  const { host, port } = resolveBeeGameBillingListenOptions()
  const server = Bun.serve({
    hostname: host,
    port,
    // A request performs authentication before its ledger query. The default
    // 10s can close that connection before both operations finish.
    // Match the dashboard server; individual auth calls still abort at 8s.
    idleTimeout: 30,
    fetch: createBeeGameBillingServerApp().fetch,
  })
  console.log(
    `BeeGame billing env file: ${envLoad.loadedPath ?? 'not found'}`,
  )
  console.log(`BeeGame billing cwd: ${process.cwd()}`)
  console.log(
    `BeeGame billing configured env: ${envSummary.configured.length ? envSummary.configured.join(', ') : 'none'}`,
  )
  if (envSummary.missing.length) {
    console.warn(`BeeGame billing missing env: ${envSummary.missing.join(', ')}`)
  }
  console.log(
    `BeeGame billing env diagnostics: ${
      getBeeGameBillingEnvDiagnostics(envLoad)
        .map(item => `${item.key}=${item.configured ? `set(${item.source},len=${item.length})` : 'missing'}`)
        .join(', ')
    }`,
  )
  console.log(`BeeGame billing server listening on http://${host}:${server.port}`)
}
