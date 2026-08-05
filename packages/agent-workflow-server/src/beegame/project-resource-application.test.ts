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
  test('forwards Pack listing and selected Pack inspection without semantic inference', async () => {
    const calls: unknown[] = []
    const application = new ProjectResourceApplication(resourceClient(calls))
    await application.listPacks({ limit: 8 })
    await application.inspectPack('pack-a', { limit: 4 })
    expect(calls).toEqual([
      ['list', { limit: 8 }],
      ['inspect', 'pack-a', { limit: 4 }],
    ])
  })

  test('acquires exact identities into the declared inventory root', async () => {
    const workspace = await createWorkspace()
    try {
      const result = await new ProjectResourceApplication(
        resourceClient(),
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
    const client = resourceClient()
    client.resolveResources = async () => {
      called = true
      return []
    }
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
        new ProjectResourceApplication(client).acquireResources(workspace, [
          selection,
          selection,
        ]),
      ).rejects.toThrow('Resource ids must be unique')
      expect(called).toBe(false)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

function resourceClient(calls: unknown[] = []): ProjectResourceSelectionClient {
  return {
    listPacks: async input => {
      calls.push(['list', input])
      return { items: [], total: 0, facets: facets() }
    },
    inspectPack: async (packId, input) => {
      calls.push(['inspect', packId, input])
      return { items: [], total: 0, facets: facets() }
    },
    resolveResources: async selections =>
      selections.map(selection => ({
        resourceId: selection.resourceId,
        packId: selection.packId,
        packVersion: selection.expectedPackVersion,
        elementId: selection.elementId,
        elementPath: 'model.glb',
        sourceUrl: 'https://download.invalid/model',
        selectionReason: selection.selectionReason,
        dependencies: [],
      })),
  }
}

function facets() {
  return {
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
  }
}

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-app-'))
  await writeBeeGameAssetManifest(workspace, {
    version: 8,
    project_target: {
      asset_format_capabilities: ['glb'],
      resource_library_usage: 'optional',
      runtime_asset_root: 'assets/runtime',
      content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    },
    requirements: [{ id: 'world.visual', required: true }],
    resources: [],
  })
  return workspace
}
