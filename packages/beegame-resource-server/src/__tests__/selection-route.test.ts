import { describe, expect, test } from 'bun:test'
import {
  createInMemoryResourceRepository,
  type ResourceElement,
  type ResourcePack,
  type ResourceUsageTag,
} from '@bee-game-studio/beegame-resource-core'
import { createBeeGameResourceServerApp } from '../app'

const pack: ResourcePack = {
  id: 'modular-kit', name: 'Modular Kit',
  styles: ['Stylized'], gameTypes: ['Action'],
  dimension: '3D' as const, primaryCategory: '3d-assets', categories: ['models'],
  license: 'internal', version: '1.0.0', status: 'published' as const,
}

describe('agentic resource exploration routes', () => {
  test('returns an unsigned Pack catalog without authored requirement roles', async () => {
    const app = appFor({
      packs: [pack],
      elements: [
        element('ground', 'models/ground.glb', ['terrain']),
        element('tower', 'models/tower.glb', ['building']),
      ],
    })
    const response = await post(app, '/api/resource-catalog/packs', { filters: { dimensions: ['3D'], formats: ['glb'] } })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toEqual(expect.objectContaining({ packId: pack.id, readyElementCount: 2 }))
    expect(body.items[0]).not.toHaveProperty('roles')
    expect(body.facets.usageTags).toEqual(['building', 'terrain'])
    expect(JSON.stringify(body)).not.toContain('sourceUrl')
  })

  test('returns reusable elements only from the Pack chosen by the Agent', async () => {
    const app = appFor({ packs: [pack], elements: [{ ...element('ground', 'models/ground.glb', ['terrain']), specs: { boundsSizeY: 3, hasTextureCoordinates: true } }] })
    const response = await post(app, `/api/resource-catalog/packs/${pack.id}/elements`, {
      filters: { usageTags: ['terrain'], formats: ['glb'] },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({
      items: [expect.objectContaining({ packId: pack.id, elementId: 'ground', technicalFacts: { boundsSizeY: 3, hasTextureCoordinates: true } })],
    }))
  })

  test('queries exact reusable candidates across published Packs', async () => {
    const otherPack = {
      ...pack,
      id: 'other-kit',
      name: 'Other Kit',
      version: '2.0.0',
    }
    const app = appFor({
      packs: [pack, otherPack],
      elements: [
        {
          ...element('ground', 'models/ground.glb', ['terrain']),
          capabilities: ['modular'],
        },
        {
          ...element('wall', 'models/wall.glb', ['building']),
          capabilities: ['connection-points'],
        },
        {
          ...element('other-ground', 'models/other-ground.glb', ['terrain']),
          packId: otherPack.id,
          capabilities: ['connection-points'],
        },
      ],
    })

    const response = await post(app, '/api/resource-catalog/elements', {
      filters: {
        usageTags: ['terrain'],
        capabilities: ['connection-points'],
        formats: ['glb'],
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(
      expect.objectContaining({
        total: 1,
        catalogRevision: expect.any(String),
        normalizedFilters: {
          usageTags: ['terrain'],
          capabilities: ['connection-points'],
          formats: ['glb'],
        },
        items: [
          expect.objectContaining({
            packId: otherPack.id,
            elementId: 'other-ground',
          }),
        ],
      }),
    )
  })

  test('continues from the cursor when set ordering and signed cover URLs change', async () => {
    const repository = createInMemoryResourceRepository({
      packs: [{
        ...pack,
        styles: ['Stylized', 'Fantasy'],
        gameTypes: ['Action', 'Strategy'],
      }],
      elements: [
        element('ground', 'models/ground.glb', ['terrain', 'environment']),
        element('wall', 'models/wall.glb', ['building', 'environment']),
      ],
    })
    let reverseSets = false
    const app = createBeeGameResourceServerApp({
      repository: {
        ...repository,
        listPacks: async () => {
          reverseSets = !reverseSets
          return (await repository.listPacks()).map(item => ({
            ...item,
            coverPath: `https://signed.example/${reverseSets ? 'new' : 'old'}`,
            styles: reverseSets ? [...item.styles].reverse() : item.styles,
            gameTypes: reverseSets
              ? [...item.gameTypes].reverse()
              : item.gameTypes,
          }))
        },
        listElements: async (packId, category) =>
          (await repository.listElements(packId, category)).map(item => ({
            ...item,
            usageTags: reverseSets
              ? [...(item.usageTags ?? [])].reverse()
              : item.usageTags,
          })),
      },
      currentUser: { id: 'admin', role: 'owner' },
      getElementResourceUrl: async path => `https://storage.example/${path}`,
    })

    const first = await post(app, '/api/resource-catalog/elements', { limit: 1 })
    const firstBody = await first.json()
    const second = await post(app, '/api/resource-catalog/elements', {
      cursor: firstBody.nextCursor,
      limit: 1,
    })
    const secondBody = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(secondBody.catalogRevision).toBe(firstBody.catalogRevision)
    expect(secondBody.items).toHaveLength(1)
  })

  test('resolves signed dependency closures only for explicit selections', async () => {
    const repository = createInMemoryResourceRepository({
      packs: [pack],
      elements: [
        {
          ...element('scene', 'models/scene.glb', ['scene']), specs: { boundsSizeX: 8, hasNormals: true },
          dependencies: ['texture'],
          dependencyBindings: [{ referencePath: 'Textures/base.png', dependencyElementId: 'texture' }],
        },
        { ...element('texture', 'textures/base.png', ['terrain']), category: 'textures', kind: 'image' },
      ],
    })
    const app = createBeeGameResourceServerApp({
      repository,
      currentUser: { id: 'admin', role: 'owner' },
      getElementResourceUrl: async path => `https://storage.example/${path}`,
    })
    const response = await post(app, '/api/resource-library/resolve', {
      selections: [{
          resourceId: 'scene-root', packId: pack.id, expectedPackVersion: pack.version, elementId: 'scene', selectionReason: ['Primary scene kit'] }],
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.selections).toHaveLength(1)
    expect(body.selections[0]).toEqual(expect.objectContaining({
        resourceId: 'scene-root', elementId: 'scene', sourceUrl: expect.stringContaining('https://storage.example/'),
      technicalFacts: { boundsSizeX: 8, hasNormals: true },
    }))
    expect(body.selections[0].dependencies).toHaveLength(1)
    expect(body.selections[0].dependencies[0]).toEqual(expect.objectContaining({
      elementId: 'texture', referencePath: 'Textures/base.png', sourceUrl: expect.stringContaining('https://storage.example/'),
    }))
  })

  test('does not expose draft Packs during exploration', async () => {
    const app = appFor({
      packs: [{ ...pack, status: 'draft' as const }],
      elements: [element('ground', 'models/ground.glb', ['terrain'])],
    })
    const response = await post(app, `/api/resource-catalog/packs/${pack.id}/elements`, { filters: { formats: ['glb'] } })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: expect.objectContaining({ code: 'not_found' }) })
  })

  test('permits a service token only for exploration and explicit resolution', async () => {
    const app = createBeeGameResourceServerApp({
      repository: createInMemoryResourceRepository({ packs: [], elements: [] }),
      currentUser: { id: 'viewer', role: 'viewer' },
      serviceSelectionToken: 'resource-service-token',
      getElementResourceUrl: async () => 'unused',
    })
    const exploration = await post(app, '/api/resource-catalog/packs/empty/elements', { filters: { formats: ['glb'] } }, 'resource-service-token')
    const management = await app.fetch(new Request('http://resource.test/api/resource-packs', {
      headers: { 'x-beegame-resource-service-token': 'resource-service-token' },
    }))

    expect(exploration.status).toBe(404)
    expect(management.status).toBe(403)
  })
})

function appFor(seed: Parameters<typeof createInMemoryResourceRepository>[0]) {
  return createBeeGameResourceServerApp({
    repository: createInMemoryResourceRepository(seed),
    currentUser: { id: 'admin', role: 'owner' },
    getElementResourceUrl: async path => `https://storage.example/${path}`,
  })
}

function element(id: string, path: string, usageTags: ResourceUsageTag[]): ResourceElement {
  return {
    id, packId: pack.id, name: id, path, category: 'models', kind: 'model',
    assetKind: 'model' as const, specs: {}, usageTags, dependencies: [], status: 'ready' as const,
  }
}

function post(app: ReturnType<typeof createBeeGameResourceServerApp>, path: string, body: unknown, token?: string) {
  return app.fetch(new Request(`http://resource.test${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-beegame-resource-service-token': token } : {}),
    },
    body: JSON.stringify(body),
  }))
}
