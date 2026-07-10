import { createInMemoryResourceRepository } from '@bee-game-studio/beegame-resource-core'
import { createBeeGameResourceServerApp } from './app'
import { resolveBeeGameResourceListenOptions } from './env'

export { createBeeGameResourceServerApp } from './app'
export type { BeeGameResourceServerAppOptions } from './app'

if (import.meta.main) {
  const { host, port } = resolveBeeGameResourceListenOptions()
  const app = createBeeGameResourceServerApp({
    repository: createInMemoryResourceRepository({ packs: [], elements: [] }),
  })
  const server = Bun.serve({ hostname: host, port, fetch: app.fetch })
  console.log(`BeeGame resource server listening on http://${host}:${server.port}`)
}
