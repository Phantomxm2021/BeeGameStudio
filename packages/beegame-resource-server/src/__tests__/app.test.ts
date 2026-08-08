import { describe, expect, test } from 'bun:test'
import { createInMemoryResourceRepository } from '../../../beegame-resource-core/src'
import { createBeeGameResourceServerApp } from '../app'
import { createSupabaseResourceLifecycleHandlers, createSupabaseResourcePackAccessChecker } from '../index'
import type { R2ResourceStorage } from '../r2-resource-storage'

const resourceStorage: R2ResourceStorage = {
  upload: async () => ({ storageObjectId: 'object-new' }),
  getFile: async () => undefined,
  createDownloadUrl: async (storageObjectId, packId) => `https://r2.test/${packId}/${storageObjectId}`,
  updateLogicalPath: async () => undefined,
  delete: async () => true,
  listPackObjects: async () => [],
}

const repository = createInMemoryResourceRepository({
  packs: [{
    id: 'pack-1', name: 'Example Pack',
      styles: ['Stylized'], gameTypes: ['adventure'],
    dimension: '2D', primaryCategory: '2d-art', categories: ['sprites'], license: 'internal', version: '1.0.0', status: 'published',
  }],
  elements: [{
    id: 'element-1', packId: 'pack-1', name: 'Character Idle', path: 'characters/idle.png',
    category: 'sprites', kind: 'sprite-sheet', preview: { kind: 'image', path: 'previews/idle.png' },
    specs: { width: 256, height: 256, contentHash: 'a'.repeat(64) }, assetKind: 'sprite-sheet', usageTags: ['character'], dependencies: [], status: 'ready',
  }],
})

function repositoryPack(id: string) {
  return {
    id, name: 'Semantic Pack', styles: ['Stylized'], gameTypes: ['strategy'],
    dimension: '3D' as const, primaryCategory: '3d-assets' as const, categories: ['models' as const], license: 'internal', version: '1.0.0', status: 'published' as const,
  }
}

describe('resource service app', () => {
  test('starts semantic curation only for ready elements without effective tags', async () => {
    const localRepository = createInMemoryResourceRepository({
      packs: [repositoryPack('semantic-pack')],
      elements: [
        { id: 'tagged', packId: 'semantic-pack', name: 'Tagged', path: 'a/tagged.glb', category: 'models', kind: 'model', specs: { contentHash: 'a'.repeat(64) }, usageTags: ['building'], dependencies: ['empty-override'], status: 'ready' },
        { id: 'untagged', packId: 'semantic-pack', name: 'Untagged', path: 'b/untagged.glb', category: 'models', kind: 'model', specs: { contentHash: 'b'.repeat(64) }, dependencies: [], status: 'ready' },
        { id: 'empty-override', packId: 'semantic-pack', name: 'Empty Override', path: 'c/empty-override.glb', category: 'models', kind: 'model', specs: { contentHash: 'c'.repeat(64) }, usageTags: [], usageTagsMode: 'override', dependencies: [], status: 'ready' },
        { id: 'manual-only', packId: 'semantic-pack', name: 'Manual Only', path: 'c/manual-only.glb', category: 'models', kind: 'model', specs: { contentHash: 'c'.repeat(64) }, dependencies: [], usageTagsMode: 'manual-only', status: 'ready' },
      ],
    })
    let started: { packId: string; elementIds?: readonly string[]; options?: { kind?: string; analysisMode?: string; curatorRevision?: string; ownerId?: string; modelConfigId?: string } } | undefined
    const job = { id: 'semantic-job-1', packId: 'semantic-pack', kind: 'semantic-curate-elements' as const, status: 'queued' as const, totalItems: 1, completedItems: 0, failedItems: 0, createdAt: '2026-08-07T00:00:00.000Z', updatedAt: '2026-08-07T00:00:00.000Z' }
    const app = createBeeGameResourceServerApp({
      repository: localRepository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      semanticCuration: { curatorRevision: 'semantic-curator-v1', resolveModelConfigId: async () => 'model-1' },
      resourceProcessing: { start: async (packId, elementIds, options) => { started = { packId, elementIds, options }; return job }, latest: async () => job, get: async () => job, retry: async () => job, cancel: async () => ({ ...job, status: 'cancelled' }) },
    })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/semantic-pack/semantic-curation', { method: 'POST' }))

    expect(response.status).toBe(202)
    expect(started).toEqual({ packId: 'semantic-pack', elementIds: ['untagged'], options: { kind: 'semantic-curate-elements', analysisMode: 'missing', curatorRevision: 'semantic-curator-v1', ownerId: 'admin-1', modelConfigId: 'model-1' } })
  })

  test('starts full semantic reanalysis for every ready non-manual element', async () => {
    const localRepository = createInMemoryResourceRepository({
      packs: [repositoryPack('semantic-pack')],
      elements: [
        { id: 'tagged', packId: 'semantic-pack', name: 'Tagged', path: 'a/tagged.glb', category: 'models', kind: 'model', specs: { contentHash: 'a'.repeat(64) }, usageTags: ['building'], dependencies: [], status: 'ready' },
        { id: 'manual', packId: 'semantic-pack', name: 'Manual', path: 'b/manual.glb', category: 'models', kind: 'model', specs: { contentHash: 'b'.repeat(64) }, usageTags: ['environment'], usageTagsMode: 'manual-only', dependencies: [], status: 'ready' },
        { id: 'existing', packId: 'semantic-pack', name: 'Existing', path: 'c/existing.glb', category: 'models', kind: 'model', specs: { contentHash: 'c'.repeat(64) }, usageTags: ['prop'], dependencies: [], status: 'ready' },
      ],
    })
    let started: { elementIds?: readonly string[]; options?: { kind?: string; analysisMode?: string; curatorRevision?: string; ownerId?: string; modelConfigId?: string } } | undefined
    const job = { id: 'semantic-job-1', packId: 'semantic-pack', kind: 'semantic-curate-elements' as const, status: 'queued' as const, totalItems: 2, completedItems: 0, failedItems: 0, createdAt: '2026-08-07T00:00:00.000Z', updatedAt: '2026-08-07T00:00:00.000Z' }
    const app = createBeeGameResourceServerApp({
      repository: localRepository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      semanticCuration: { curatorRevision: 'semantic-curator-v1', resolveModelConfigId: async () => 'model-1' },
      resourceProcessing: { start: async (_packId, elementIds, options) => { started = { elementIds, options }; return job }, latest: async () => job, get: async () => job, retry: async () => job, cancel: async () => ({ ...job, status: 'cancelled' }) },
    })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/semantic-pack/semantic-curation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'all' }) }))

    expect(response.status).toBe(202)
    expect(started).toEqual({ elementIds: ['tagged', 'existing'], options: { kind: 'semantic-curate-elements', analysisMode: 'all', curatorRevision: 'semantic-curator-v1', ownerId: 'admin-1', modelConfigId: 'model-1' } })
  })

  test('returns 503 instead of creating a semantic job without a configured model', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      resourceProcessing: { start: async () => { throw new Error('must not start') }, latest: async () => undefined, get: async () => undefined, retry: async () => undefined, cancel: async () => undefined },
    })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/semantic-curation', { method: 'POST' }))

    expect(response.status).toBe(503)
  })

  test('restores the latest durable semantic curation job without requiring model configuration', async () => {
    const job = { id: 'semantic-job-1', packId: 'pack-1', kind: 'semantic-curate-elements' as const, status: 'completed' as const, totalItems: 1, completedItems: 1, failedItems: 0, createdAt: '2026-08-07T00:00:00.000Z', updatedAt: '2026-08-07T00:00:05.000Z' }
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      resourceProcessing: { start: async () => job, latest: async () => job, get: async () => job, retry: async () => job, cancel: async () => undefined },
    })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/semantic-curation'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ job })
  })

  test('exposes health without requiring an authenticated resource administrator', async () => {
    const app = createBeeGameResourceServerApp({ repository })
    const response = await app.fetch(new Request('http://resource.test/health'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  test('allows browser cross-origin requests and preflight checks', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })
    const preflight = await app.fetch(new Request('http://resource.test/api/resource-packs', { method: 'OPTIONS' }))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*')
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs'))
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('lists Pack summaries for an Admin user', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ packs: [expect.objectContaining({ id: 'pack-1', elementCount: 1 })] })
  })

  test('catalog summary count matches the same element-level readiness used for discovery', async () => {
    const localRepository = createInMemoryResourceRepository({
      packs: [repositoryPack('count-pack')],
      elements: [
        { id: 'selectable', packId: 'count-pack', name: 'Selectable', path: 'selectable.glb', category: 'models', kind: 'model', assetKind: 'model', specs: { contentHash: 'a'.repeat(64) }, usageTags: ['environment'], dependencies: [], status: 'ready' },
        { id: 'uncurated', packId: 'count-pack', name: 'Uncurated', path: 'uncurated.glb', category: 'models', kind: 'model', assetKind: 'model', specs: { contentHash: 'b'.repeat(64) }, dependencies: [], status: 'ready' },
      ],
    })
    const app = createBeeGameResourceServerApp({ repository: localRepository })

    const response = await app.fetch(new Request('http://resource.test/api/resource-catalog/packs', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    }))

    expect(response.status).toBe(200)
    expect((await response.json()).items).toEqual([
      expect.objectContaining({ packId: 'count-pack', readyElementCount: 1 }),
    ])
  })

  test('writes a Pack creation audit event without exposing audit storage to the browser', async () => {
    const events: Array<{ actorId: string; action: string; packId?: string }> = []
    const app = createBeeGameResourceServerApp({
      repository: createInMemoryResourceRepository({ packs: [], elements: [] }),
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      recordAuditEvent: async event => { events.push(event) },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Pack',
          styles: ['Stylized'], gameTypes: ['Adventure'], dimension: '3D', primaryCategory: '3d-assets', categories: [], license: 'internal', version: '1.0.0' }),
    }))
    expect(response.status).toBe(201)
    expect(events).toEqual([expect.objectContaining({ actorId: 'admin-1', action: 'pack.created' })])
  })

  test('records element and folder lifecycle actions in the audit stream', async () => {
    const events: Array<{ action: string; packId?: string; elementId?: string }> = []
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      addResourceElement: async () => ({ id: 'uploaded-1', name: 'New image' }),
      recordAuditEvent: async (event) => { events.push(event) },
    })
    const folder = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/folders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'New folder' }) }))
    expect(folder.status).toBe(201)
    const form = new FormData(); form.set('file', new File(['x'], 'new.png', { type: 'image/png' }))
    const upload = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/elements', { method: 'POST', body: form }))
    expect(upload.status).toBe(201)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'folder.created', packId: 'pack-1' }),
      expect.objectContaining({ action: 'element.uploaded', packId: 'pack-1', elementId: 'uploaded-1' }),
    ]))
  })

  test('rejects folder semantic defaults because element tags are the only semantic authority', async () => {
    const localRepository = createInMemoryResourceRepository({
      packs: [{ id: 'policy-pack', name: 'Policy',
          styles: ['Stylized'], gameTypes: ['action'], dimension: '3D', primaryCategory: '3d-assets', categories: ['models'], license: 'internal', version: '1.0.0', status: 'draft' }],
      elements: [{ id: 'asset', packId: 'policy-pack', name: 'asset.glb', path: 'models/asset.glb', category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready' }],
    })
    await localRepository.createFolder('policy-pack', { id: 'models', name: 'models' })
    const app = createBeeGameResourceServerApp({ repository: localRepository, currentUser: { id: 'admin', role: 'owner', permissions: ['resources.manage'] } })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/policy-pack/folders/models', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ elementDefaults: { usageTags: ['environment'] } }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ error: expect.objectContaining({ code: 'element_defaults_removed' }) }))
  })

  test('creates and resumes an audited persistent processing job', async () => {
    const now = '2026-07-19T00:00:00.000Z'
    const job = { id: 'job-1', packId: 'pack-1', kind: 'inspect-elements' as const, status: 'queued' as const, totalItems: 1, completedItems: 0, failedItems: 0, createdAt: now, updatedAt: now }
    const events: Array<{ action: string }> = []
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      resourceProcessing: { start: async () => job, latest: async () => job, get: async () => job, retry: async () => job, cancel: async () => ({ ...job, status: 'cancelled' }) },
      recordAuditEvent: async event => { events.push(event) },
    })
    const created = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/processing-jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ elementIds: ['element-1'] }) }))
    const restored = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/processing-jobs'))

    expect(created.status).toBe(202)
    await expect(created.json()).resolves.toEqual({ job })
    await expect(restored.json()).resolves.toEqual({ job })
    expect(events).toContainEqual(expect.objectContaining({ action: 'processing.started' }))
  })

  test('reinspects an existing element through an explicit audited route', async () => {
    const events: Array<{ action: string; elementId?: string }> = []
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      inspectResourceElement: async (_packId, elementId) => ({ ...(await repository.getElement('pack-1', elementId)), contentProfile: { packaging: 'self-contained', components: [], inspection: { status: 'complete', source: 'server' } } }),
      recordAuditEvent: async event => { events.push(event) },
    })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/elements/element-1/inspection', { method: 'POST' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ element: expect.objectContaining({ id: 'element-1', contentProfile: expect.objectContaining({ packaging: 'self-contained' }) }) })
    expect(events).toEqual([expect.objectContaining({ action: 'element.inspected', elementId: 'element-1' })])
  })

  test('deletes a non-empty folder recursively through the browser route', async () => {
    const localRepository = createInMemoryResourceRepository({
      packs: [{ id: 'folder-pack', name: 'Folders',
          styles: ['Stylized'], gameTypes: ['adventure'], dimension: '3D', primaryCategory: '3d-assets', categories: ['models'], license: 'internal', version: '1.0.0', status: 'draft' }],
      elements: [
        { id: 'folder-element', packId: 'folder-pack', name: 'tree.glb', path: 'models/tree.glb', category: 'models', kind: 'model', specs: {}, dependencies: [], status: 'ready' },
      ],
    })
    await localRepository.createFolder('folder-pack', { id: 'models', name: 'models' })
    await localRepository.createFolder('folder-pack', { id: 'nested', name: 'nested', parentId: 'models' })
    const events: Array<{ action: string; metadata?: Record<string, unknown> }> = []
    const app = createBeeGameResourceServerApp({
      repository: localRepository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      recordAuditEvent: async event => { events.push(event) },
    })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/folder-pack/folders/models', { method: 'DELETE' }))

    expect(response.status).toBe(204)
    await expect(localRepository.listFolders('folder-pack')).resolves.toEqual([])
    await expect(localRepository.listElements('folder-pack')).resolves.toEqual([])
    expect(events).toContainEqual(expect.objectContaining({ action: 'folder.deleted', metadata: { folderId: 'models' } }))
  })

  test('rejects a non-admin user', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'viewer-1', role: 'viewer', permissions: [] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs'))
    expect(response.status).toBe(403)
  })

  test('enforces Pack ownership in the service layer when a service-role repository is used', async () => {
    const attempted: string[] = []
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'manager-1', role: 'admin', permissions: ['resources.manage'] },
      canManagePack: async (_user, packId) => packId === 'owned-pack',
      deleteResourcePack: async packId => { attempted.push(packId); return true },
    })

    const list = await app.fetch(new Request('http://resource.test/api/resource-packs'))
    expect(await list.json()).toEqual({ packs: [] })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1', { method: 'DELETE' }))
    expect(response.status).toBe(403)
    expect(attempted).toEqual([])
  })

  test('permits service-role lifecycle access only to the Pack creator or platform owner', async () => {
    const checker = createSupabaseResourcePackAccessChecker({
      baseUrl: 'https://supabase.example',
      serviceRoleKey: 'service-key',
      fetchImpl: async () => Response.json([{ created_by: 'creator-1' }]),
    })
    await expect(checker({ id: 'creator-1', role: 'admin' }, 'pack-1')).resolves.toBe(true)
    await expect(checker({ id: 'other-user', role: 'admin' }, 'pack-1')).resolves.toBe(false)
    await expect(checker({ id: 'platform-owner', role: 'owner' }, 'pack-1')).resolves.toBe(true)
  })

  test('deletes an administrator Pack through the DELETE route', async () => {
    const deleted: string[] = []
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      deleteResourcePack: async (id) => { deleted.push(id); return true },
    })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1', { method: 'DELETE' }))

    expect(response.status).toBe(204)
    expect(deleted).toEqual(['pack-1'])
  })

  test('archives a Pack without deleting its resource history', async () => {
    const app = createBeeGameResourceServerApp({
      repository: createInMemoryResourceRepository({
        packs: [{ id: 'archive-pack', name: 'Archive',
            styles: ['Stylized'], gameTypes: ['adventure'], dimension: '2D', primaryCategory: '2d-art', categories: [], license: 'internal', version: '1.0.0', status: 'published' }],
        elements: [],
      }),
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/archive-pack/archive', { method: 'POST' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ pack: expect.objectContaining({ id: 'archive-pack', status: 'archived', deprecatedAt: expect.any(String) }) })
  })

  test('re-publishes an archived Pack and clears its archive marker', async () => {
    const app = createBeeGameResourceServerApp({
      repository: createInMemoryResourceRepository({
        packs: [{ id: 'archived-pack', name: 'Archived',
            styles: ['Stylized'], gameTypes: ['adventure'], dimension: '2D', primaryCategory: '2d-art', categories: [], license: 'internal', version: '1.0.0', status: 'archived', deprecatedAt: '2026-07-12T00:00:00.000Z' }],
        elements: [{ id: 'archived-element', packId: 'archived-pack', name: 'character.png', path: 'sprites/character.png', category: 'sprites', kind: 'image', assetKind: 'image', specs: { contentHash: 'a'.repeat(64) }, usageTags: ['character'], dependencies: [], status: 'ready' }],
      }),
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/archived-pack/publish', { method: 'POST' }))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { pack: Record<string, unknown> }
    expect(body.pack).toEqual(expect.objectContaining({ id: 'archived-pack', status: 'published' }))
    expect(body.pack).not.toHaveProperty('deprecatedAt')
  })

  test('returns 404 when a lifecycle update or deletion reports no Pack', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      updateResourcePack: async () => undefined,
      deleteResourcePack: async () => false,
    })

    const updated = await app.fetch(new Request('http://resource.test/api/resource-packs/missing', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Missing' }),
    }))
    const deleted = await app.fetch(new Request('http://resource.test/api/resource-packs/missing', { method: 'DELETE' }))

    expect(updated.status).toBe(404)
    expect(deleted.status).toBe(404)
  })

  test('returns a CORS JSON error when a lifecycle handler throws', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      updateResourcePack: async () => { throw new Error('database unavailable') },
    })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Changed' }),
    }))

    expect(response.status).toBe(500)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    await expect(response.json()).resolves.toEqual({ error: { code: 'resource_lifecycle_failed', message: 'database unavailable' } })
  })

  test('uploads a supported cover and rejects an unsupported one', async () => {
    const uploads: string[] = []
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      uploadPackCover: async (id, request) => {
        uploads.push(`${id}:${(await request.formData()).get('file') instanceof File}`)
        return { ...(await repository.getPack(id))!, coverPath: 'cover/new.png' }
      },
    })
    const good = new FormData()
    good.set('file', new File(['x'], 'cover.png', { type: 'image/png' }))
    const accepted = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/cover', { method: 'POST', body: good }))
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toEqual({ pack: expect.objectContaining({ coverPath: 'cover/new.png' }) })
    expect(uploads).toEqual(['pack-1:true'])

    const bad = new FormData()
    bad.set('file', new File(['x'], 'cover.exe', { type: 'application/octet-stream' }))
    const rejected = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/cover', { method: 'POST', body: bad }))
    expect(rejected.status).toBe(400)
  })

  test('returns a signed element URL only when the element belongs to the Pack', async () => {
    const signed: string[] = []
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      getElementResourceUrl: async (packId, elementId) => { signed.push(`${packId}/${elementId}`); return 'https://signed.test/file' },
    })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/elements/element-1/resource-url'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ url: 'https://signed.test/file' })
    const missing = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/elements/missing/resource-url'))
    expect(missing.status).toBe(404)
    expect(signed).toEqual(['pack-1/element-1'])
  })

  test('returns the canonical R2 URL through the resource-url route', async () => {
    const lifecycle = createSupabaseResourceLifecycleHandlers({
      baseUrl: 'https://project.supabase.co', serviceRoleKey: 'secret',
      r2Storage: resourceStorage,
      fetchImpl: async (input) => {
        const url = String(input)
        if (url.includes('beegame_resource_elements')) return Response.json([{ pack_id: 'pack-1', path: 'characters/idle.png', storage_object_id: 'object-idle' }])
        return Response.json([])
      },
    })
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      ...lifecycle,
    })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/elements/element-1/resource-url'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      url: 'https://r2.test/pack-1/object-idle',
    })
  })

  test('returns elements with an explicit category filter', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })
    const response = await app.fetch(new Request(
        'http://resource.test/api/resource-packs/pack-1/elements?category=sprites',
      ))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ elements: [expect.objectContaining({ id: 'element-1' })] })
  })

  test('rejects unsupported element usage capabilities before a lifecycle mutation', async () => {
    let mutated = false
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
      updateResourceElement: async () => { mutated = true; return { id: 'element-1' } },
    })

    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/elements/element-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usageTags: ['unsupported-free-text'] }),
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: { code: 'invalid_request', message: 'Element usageTags must contain supported values' } })
    expect(mutated).toBe(false)
  })

  test('returns a publish readiness report before changing Pack state', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/publish-readiness'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ report: expect.objectContaining({ canPublish: true, blocking: [] }) })
  })

  test('filters elements by folder path without treating it as a category', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/elements?folderPath=characters'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ elements: [expect.objectContaining({ id: 'element-1' })] })
  })

  test('keeps CORS headers when a folder repository read fails', async () => {
    const failingRepository = { ...repository, listFolders: async () => { throw new Error('folders unavailable') } }
    const app = createBeeGameResourceServerApp({
      repository: failingRepository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/pack-1/folders'))
    expect(response.status).toBe(500)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.json()).toEqual({ error: { code: 'resource_read_failed', message: 'folders unavailable' } })
  })

  test('returns 404 for an unknown Pack', async () => {
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin-1', role: 'owner', permissions: ['resources.manage'] },
    })
    const response = await app.fetch(new Request('http://resource.test/api/resource-packs/missing'))
    expect(response.status).toBe(404)
  })
})
