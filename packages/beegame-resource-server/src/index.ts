import { createInMemoryResourceRepository } from '@bee-game-studio/beegame-resource-core'
import { createBeeGameResourceServerApp } from './app'
import { resolveBeeGameResourceListenOptions } from './env'
import { createSupabaseResourceRepository } from './supabase-resource-repository'

export { createBeeGameResourceServerApp } from './app'
export type { BeeGameResourceServerAppOptions } from './app'

if (import.meta.main) {
  const { host, port } = resolveBeeGameResourceListenOptions()
  const app = createBeeGameResourceServerApp({
    repository: createConfiguredResourceRepository(),
  })
  const server = Bun.serve({ hostname: host, port, fetch: app.fetch })
  console.log(`BeeGame resource server listening on http://${host}:${server.port}`)
}

function createConfiguredResourceRepository(
  env: NodeJS.ProcessEnv = process.env,
) {
  const baseUrl = env.BEEGAME_SUPABASE_URL?.trim()
  const serviceRoleKey = env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (baseUrl && serviceRoleKey) {
    return createSupabaseResourceRepository({ baseUrl, serviceRoleKey })
  }
  if (env.BEEGAME_RESOURCE_REPOSITORY === 'memory' || env.NODE_ENV !== 'production') {
    return createInMemoryResourceRepository({ packs: [], elements: [] })
  }
  throw new Error('Resource repository requires Supabase configuration in production')
}
