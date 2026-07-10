import { strFromU8, unzipSync } from 'fflate'
import { RESOURCE_CATEGORIES, RESOURCE_PACK_PRIMARY_CATEGORIES, type ResourceElement, type ResourcePack } from '@bee-game-studio/beegame-resource-core'

type ImportOptions = {
  baseUrl: string
  serviceRoleKey: string
  bucket?: string
  fetchImpl?: typeof fetch
  uploadConcurrency?: number
}

export function createSupabaseResourcePackImporter(options: ImportOptions) {
  const fetchImpl = options.fetchImpl ?? fetch
  const bucket = options.bucket ?? 'beegame-resource-packs'
  const supabaseUrl = options.baseUrl.replace(/\/+$/, '')
  return async (request: Request): Promise<ResourcePack> => {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new ResourceImportError(400, 'invalid_file', 'A ZIP file is required')
    if (!file.name.toLowerCase().endsWith('.zip')) throw new ResourceImportError(400, 'invalid_file_type', 'Only ZIP resource packs are supported')
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer()))
    const paths = Object.keys(archive).filter((path) => isAssetPath(path))
    if (paths.length === 0) throw new ResourceImportError(400, 'empty_pack', 'The ZIP does not contain resource files')
    const manifest = readManifest(archive)
    const packId = manifest?.id || slugify(file.name.replace(/\.zip$/i, '')) || `pack-${crypto.randomUUID()}`
    const elements = paths.map((path, index) => toElement(packId, path, index))
    const pack = toPack(packId, file.name, elements, paths, findPreview(archive), manifest)
    const uploaded: string[] = []
    try {
      const uploadPaths = paths.concat(findPreview(archive) ? [findPreview(archive)!] : [])
      await runWithConcurrency(uploadPaths, Math.max(1, options.uploadConcurrency ?? 1), async (path) => {
        const objectPath = `${packId}/${path}`
        let response: Response
        try {
          response = await uploadWithRetry(() => fetchImpl(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, {
            method: 'POST',
            headers: { authorization: `Bearer ${options.serviceRoleKey}`, apikey: options.serviceRoleKey, 'content-type': contentType(path), 'x-upsert': 'true' },
            body: archive[path].buffer.slice(archive[path].byteOffset, archive[path].byteOffset + archive[path].byteLength) as ArrayBuffer,
          }))
        } catch (error) {
          throw new Error(`${error instanceof Error ? error.message : 'Storage upload failed'} for ${path}`)
        }
        uploaded.push(objectPath)
        await new Promise((resolve) => setTimeout(resolve, 150))
      })
      const packRow = { id: pack.id, name: pack.name, style: pack.style, game_types: pack.gameTypes, dimension: pack.dimension, primary_category: pack.primaryCategory, categories: pack.categories, license: pack.license, version: pack.version, status: pack.status, cover_path: pack.coverPath, element_count: elements.length }
      await postJson(`${supabaseUrl}/rest/v1/beegame_resource_packs`, packRow, fetchImpl, options.serviceRoleKey)
      await postJson(`${supabaseUrl}/rest/v1/beegame_resource_elements`, elements.map((element) => ({ id: element.id, pack_id: element.packId, name: element.name, path: element.path, category: element.category, kind: element.kind, preview: element.preview, specs: element.specs, dependencies: element.dependencies, status: element.status, style_override: element.styleOverride, dimension_override: element.dimensionOverride })), fetchImpl, options.serviceRoleKey)
      return pack
    } catch (error) {
      await Promise.all(uploaded.map((path) => fetchImpl(`${supabaseUrl}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers: { authorization: `Bearer ${options.serviceRoleKey}`, apikey: options.serviceRoleKey } })))
      throw error
    }
  }
}

export class ResourceImportError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

function readManifest(archive: Record<string, Uint8Array>): Partial<ResourcePack> | undefined {
  const entry = archive['pack.json'] || archive['manifest.json']
  if (!entry) return undefined
  try { return JSON.parse(strFromU8(entry)) as Partial<ResourcePack> } catch { throw new ResourceImportError(400, 'invalid_manifest', 'Pack manifest is not valid JSON') }
}

function isAssetPath(path: string): boolean {
  return !path.endsWith('/') && !path.split('/').some((part) => part.startsWith('.')) && !path.endsWith('pack.json') && !path.endsWith('manifest.json') && !/^preview\.(?:jpe?g|png|webp|gif|mp4|webm)$/i.test(path)
}

function findPreview(archive: Record<string, Uint8Array>): string | undefined { return Object.keys(archive).find((path) => /^preview\.(?:jpe?g|png|webp|gif|mp4|webm)$/i.test(path)) }
function slugify(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
function contentType(path: string): string { const ext = path.split('.').pop()?.toLowerCase(); return ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'mp4' ? 'video/mp4' : ext === 'webm' ? 'video/webm' : 'application/octet-stream' }
function toPack(id: string, filename: string, elements: ResourceElement[], paths: string[], previewPath?: string, manifest?: Partial<ResourcePack>): ResourcePack {
  const has3d = paths.some((path) => /\.(fbx|glb|gltf|obj|blend)$/i.test(path)); const has2d = paths.some((path) => /\.(png|jpe?g|svg|webp)$/i.test(path))
  return { id, name: manifest?.name || filename.replace(/\.zip$/i, ''), style: manifest?.style || 'unassigned', gameTypes: manifest?.gameTypes || ['unassigned'], dimension: manifest?.dimension || (has3d && !has2d ? '3D' : has2d && !has3d ? '2D' : 'agnostic'), primaryCategory: resolvePrimaryCategory(manifest?.primaryCategory, elements), categories: manifest?.categories || [...new Set(elements.map((element) => element.category))] as ResourcePack['categories'], license: manifest?.license || 'unassigned', version: manifest?.version || '0.1.0', status: manifest?.status || 'draft', coverPath: manifest?.coverPath || previewPath, }
}
function resolvePrimaryCategory(value: unknown, elements: ResourceElement[]): ResourcePack['primaryCategory'] {
  if (typeof value === 'string' && (RESOURCE_PACK_PRIMARY_CATEGORIES as readonly string[]).includes(value)) return value as ResourcePack['primaryCategory']
  const categories = [...new Set(elements.map((element) => element.category))]
  if (categories.length !== 1) return 'mixed'
  const primaryByElementCategory: Partial<Record<ResourceElement['category'], ResourcePack['primaryCategory']>> = {
    ui: 'ui-kit', audio: 'audio', fonts: 'fonts', vfx: 'vfx', scenes: 'world-scene',
  }
  return primaryByElementCategory[categories[0]] ?? 'mixed'
}
function toElement(packId: string, path: string, index: number): ResourceElement { const ext = path.split('.').pop()?.toLowerCase() || ''; const kind = ['fbx', 'glb', 'gltf', 'obj', 'blend'].includes(ext) ? 'model' : ['mp3', 'wav', 'ogg'].includes(ext) ? 'audio' : 'image'; return { id: `${packId}-${index}`, packId, name: path.split('/').pop() || path, path, category: inferCategory(path, ext), kind, specs: {}, dependencies: [], status: 'ready' } }
function inferCategory(path: string, ext: string): ResourceElement['category'] {
  const explicit = path.split('/').find((part) => (RESOURCE_CATEGORIES as readonly string[]).includes(part))
  if (explicit) return explicit as ResourceElement['category']
  if (['fbx', 'glb', 'gltf', 'obj', 'blend'].includes(ext)) return 'models'
  if (['mp3', 'wav', 'ogg'].includes(ext)) return 'audio'
  if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) return 'fonts'
  if (['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif'].includes(ext)) return 'textures'
  if (['mp4', 'webm'].includes(ext)) return 'vfx'
  return 'environment'
}
async function postJson(url: string, body: unknown, fetchImpl: typeof fetch, key: string): Promise<void> { const response = await fetchImpl(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json', prefer: 'return=minimal' }, body: JSON.stringify(body) }); if (!response.ok) { const detail = await response.text().catch(() => ''); throw new Error(`Metadata persistence failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ''}`) } }

async function uploadWithRetry(upload: () => Promise<Response>, attempts = 6): Promise<Response> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await upload()
    if (response.ok) return response
    const retryable = response.status === 429 || response.status >= 500
    if (!retryable || attempt === attempts - 1) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Storage upload failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`)
    }
    const retryAfter = Number(response.headers.get('retry-after') || 0)
    const delay = retryAfter > 0 ? retryAfter * 1000 : 1000 * (2 ** attempt)
    await new Promise((resolve) => setTimeout(resolve, Math.min(delay + Math.round(Math.random() * 500), 30000)))
  }
  throw new Error('Storage upload failed')
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const run = async () => { while (cursor < items.length) { const index = cursor; cursor += 1; await worker(items[index]) } }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
}
