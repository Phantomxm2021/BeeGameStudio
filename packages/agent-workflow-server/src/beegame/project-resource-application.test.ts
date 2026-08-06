import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBeeGameAssetManifest } from './asset-contracts'
import {
  ProjectResourceApplication,
  type ProjectResourceSelectionClient,
} from './project-resource-application'

describe('ProjectResourceApplication', () => {
  test('forwards one structured requirement match without semantic inference', async () => {
    const calls: unknown[] = []
    const application = new ProjectResourceApplication(resourceClient(calls))
    const input = { requirements: [], deliveryCapabilities: [] }
    await application.matchRequirements(input)
    expect(calls).toEqual([['match', input]])
  })

  test('acquires exact identities into the declared inventory root', async () => {
    const workspace = await createWorkspace()
    try {
      const result = await new ProjectResourceApplication(
        resourceClient(),
        async () => new Response(new Uint8Array([1, 2, 3])),
      ).acquireResources(workspace, 'revision-a', [
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
        new ProjectResourceApplication(client).acquireResources(workspace, 'revision-a', [
          selection,
          selection,
        ]),
      ).rejects.toThrow('Resource ids must be unique')
      expect(called).toBe(false)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects downloaded bytes that differ from the frozen Catalog content hash', async () => {
    const workspace = await createWorkspace()
    const client = resourceClient()
    const resolve = client.resolveResources
    client.resolveResources = async (catalogRevision, selections) =>
      (await resolve(catalogRevision, selections)).map(selection => ({
        ...selection,
        sourceHash: 'b'.repeat(64),
      }))
    try {
      const result = await new ProjectResourceApplication(
        client,
        async () => new Response(new Uint8Array([1, 2, 3])),
      ).acquireResources(workspace, 'revision-a', [{
        resourceId: 'material-a',
        packId: 'pack-a',
        expectedPackVersion: '1.0.0',
        elementId: 'element-a',
        destinationPath: 'assets/runtime/library',
        selectionReason: ['Observed fit.'],
      }])
      expect(result.resources).toEqual([expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('frozen Catalog content hash'),
      })])
      expect(result.manifest.resources).toEqual([])
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

function resourceClient(calls: unknown[] = []): ProjectResourceSelectionClient {
  return {
    matchRequirements: async input => {
      calls.push(['match', input])
      return { catalogRevision: 'revision-a', groups: [] }
    },
    resolveResources: async (_catalogRevision, selections) =>
      selections.map(selection => ({
        resourceId: selection.resourceId,
        packId: selection.packId,
        packVersion: selection.expectedPackVersion,
        elementId: selection.elementId,
        elementPath: 'model.glb',
        sourceUrl: 'https://download.invalid/model',
        sourceHash: createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex'),
        selectionReason: selection.selectionReason,
        dependencies: [],
      })),
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
    requirements: [{ id: 'world.visual', required: true, acquisition_profile: {
      dimensions: ['3D'], asset_kinds: ['model'], usage_tags: ['scene'], capabilities: [], styles: [],
    } }],
    resources: [],
  })
  return workspace
}
