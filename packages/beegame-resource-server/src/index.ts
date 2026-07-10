import { createInMemoryResourceRepository } from '@bee-game-studio/beegame-resource-core'
import { createBeeGameResourceServerApp } from './app'
import { resolveBeeGameResourceListenOptions } from './env'
import { createSupabaseResourceRepository } from './supabase-resource-repository'
import { createSupabaseResourcePackImporter } from './import-resource-pack'

export { createBeeGameResourceServerApp } from './app'
export type { BeeGameResourceServerAppOptions } from './app'

if (import.meta.main) {
  await loadResourceSupabaseEnv()
  const { host, port } = resolveBeeGameResourceListenOptions()
  const baseUrl = process.env.BEEGAME_SUPABASE_URL
  const serviceRoleKey = process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY
  const app = createBeeGameResourceServerApp({
    repository: createConfiguredResourceRepository(),
    importResourcePack: baseUrl && serviceRoleKey ? createSupabaseResourcePackImporter({ baseUrl, serviceRoleKey, uploadConcurrency: Number(process.env.BEEGAME_RESOURCE_UPLOAD_CONCURRENCY || 1) }) : undefined,
    updateResourcePack: baseUrl && serviceRoleKey ? async (packId, body) => {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/beegame_resource_packs?id=eq.${encodeURIComponent(packId)}`, { method: 'PATCH', headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error(`Resource Pack update failed (${response.status})`)
      const rows = await response.json() as unknown[]
      return rows[0]
    } : undefined,
    addResourceElement: baseUrl && serviceRoleKey ? async (packId, request) => {
      const form = await request.formData(); const file = form.get('file'); const category = String(form.get('category') || 'assets')
      if (!(file instanceof File)) throw new Error('Element file is required')
      const path = `${packId}/${category}/${file.name}`
      const storageUrl = `${baseUrl.replace(/\/+$/, '')}/storage/v1/object/beegame-resource-packs/${path.split('/').map(encodeURIComponent).join('/')}`
      const headers = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'true' }
      const uploaded = await fetch(storageUrl, { method: 'POST', headers, body: await file.arrayBuffer() })
      if (!uploaded.ok) throw new Error('Element storage upload failed')
      const id = `${packId}-${crypto.randomUUID()}`; const row = { id, pack_id: packId, name: file.name, path: `${category}/${file.name}`, category, kind: 'file', specs: { size: file.size, type: file.type }, dependencies: [], status: 'ready' }
      const saved = await fetch(`${baseUrl.replace(/\/+$/, '')}/rest/v1/beegame_resource_elements`, { method: 'POST', headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(row) })
      if (!saved.ok) { await fetch(storageUrl, { method: 'DELETE', headers }); throw new Error('Element metadata persistence failed') }
      return (await saved.json() as unknown[])[0]
    } : undefined,
  })
  const server = Bun.serve({ hostname: host, port, fetch: app.fetch })
  console.log(`BeeGame resource server listening on http://${host}:${server.port}`)
}

async function loadResourceSupabaseEnv(): Promise<void> {
  for (const path of ['.env.billing', 'docker/.env.billing', '.env.local']) {
    const file = Bun.file(path)
    if (!(await file.exists())) continue
    const text = await file.text()
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(BEEGAME_SUPABASE_(?:URL|SERVICE_ROLE_KEY|ANON_KEY))\s*=\s*(.*)\s*$/)
      if (match?.[1] && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  }
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
