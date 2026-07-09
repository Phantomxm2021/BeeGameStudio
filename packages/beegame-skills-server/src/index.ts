import {
  createBeeGameSkillsServerApp,
  type BeeGameSkillsServerAppOptions,
} from './app'
import {
  getBeeGameSkillsEnvDiagnostics,
  loadBeeGameSkillsEnv,
  resolveBeeGameSkillsListenOptions,
} from './env'

export {
  createBeeGameSkillsServerApp,
}
export type {
  BeeGameSkillsServerAppOptions,
}

if (import.meta.main) {
  const envLoad = await loadBeeGameSkillsEnv()
  const { host, port } = resolveBeeGameSkillsListenOptions()
  const server = Bun.serve({
    hostname: host,
    port,
    fetch: createBeeGameSkillsServerApp().fetch,
  })
  console.log(`BeeGame skills env file: ${envLoad.loadedPath ?? 'not found'}`)
  console.log(`BeeGame skills cwd: ${process.cwd()}`)
  console.log(
    `BeeGame skills env diagnostics: ${
      getBeeGameSkillsEnvDiagnostics(envLoad)
        .map(item => `${item.key}=${item.configured ? `set(${item.source},len=${item.length})` : 'missing'}`)
        .join(', ')
    }`,
  )
  console.log(`BeeGame skills server listening on http://${host}:${server.port}`)
}
