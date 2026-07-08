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
