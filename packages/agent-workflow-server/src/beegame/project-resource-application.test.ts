import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBeeGameAssetManifest } from './asset-contracts'
import {
  ProjectResourceApplication,
  type ProjectResourceSelectionClient,
} from './project-resource-application'

describe('ProjectResourceApplication', () => {
  test('caps catalog page size without adding semantic filters', async () => {
    let observed: unknown
    const application = new ProjectResourceApplication({
      browseCatalog: async input => {
        observed = input
        return catalogPage()
      },
      resolveResources: async () => [],
    })
    await application.browseCatalog({ limit: 200 })
    expect(observed).toEqual({ limit: 64 })
  })

  test('acquires independently identified resources into the declared inventory root', async () => {
    const workspace = await createWorkspace()
    const client: ProjectResourceSelectionClient = {
      browseCatalog: async () => catalogPage(),
      resolveResources: async selections =>
        selections.map(selection => ({
          resourceId: selection.resourceId,
        packId: selection.packId,
          packVersion: selection.expectedPackVersion,
        elementId: selection.elementId,
          elementPath: 'model.glb',
          sourceUrl: 'https://download.invalid/model',
        selectionReason: selection.selectionReason,
          assetKind: 'model',
          dependencies: [],
      })),
    }
    try {
      const result = await new ProjectResourceApplication(
        client,
        async () => new Response(new Uint8Array([1, 2, 3])),
      ).acquireResources(workspace, [
        {
          resourceId: 'material-a',
          packId: 'pack-a',
          expectedPackVersion: '1.0.0',
          elementId: 'element-a',
          destinationPath: 'assets/runtime/library',
          selectionReason: ['Observed technical and semantic fit.'],
        },
    ])
      expect(result.resources).toEqual([
        expect.objectContaining({
          resourceId: 'material-a',
          status: 'verified',
          rootPath: 'assets/runtime/library/model.glb',
        }),
    ])
      expect(result.manifest.resources).toHaveLength(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects duplicate project resource identities before service resolution', async () => {
    const workspace = await createWorkspace()
    let called = false
    const application = new ProjectResourceApplication({
      browseCatalog: async () => catalogPage(),
      resolveResources: async () => {
        called = true
        return []
      },
  })
    const selection = {
      resourceId: 'same-id',
      packId: 'pack-a',
      expectedPackVersion: '1.0.0',
      elementId: 'element-a',
      destinationPath: 'assets/runtime/library',
      selectionReason: ['Observed fit.'],
    }
    try {
      await expect(
        application.acquireResources(workspace, [selection, selection]),
      ).rejects.toThrow('Resource ids must be unique')
      expect(called).toBe(false)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-app-'))
  await writeBeeGameAssetManifest(workspace, {
    version: 7,
    project_target: {
      asset_format_capabilities: ['glb'],
      resource_library_usage: 'optional',
      runtime_asset_root: 'assets/runtime',
      content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    },
    requirements: [
      { id: 'world.visual', required: true },
    ],
    resources: [],
  })
  return workspace
}

function catalogPage() {
  return {
    items: [],
    total: 0,
    facets: {
      dimensions: [],
      primaryCategories: [],
      categories: [],
      styles: [],
      gameTypes: [],
      packTags: [],
      usageTags: [],
      assetKinds: [],
      capabilities: [],
      formats: [],
    },
    catalogRevision: 'a'.repeat(64),
    normalizedFilters: {},
  }
}
