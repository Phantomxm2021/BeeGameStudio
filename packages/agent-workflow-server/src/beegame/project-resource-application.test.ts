import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ProjectResourceApplication,
  type ProjectResourceSelectionClient,
} from './project-resource-application'
import { readBeeGameAssetManifest } from './asset-contracts'

describe('project resource application', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('forwards catalog filters without creating requirement roles', async () => {
    const observed: unknown[] = []
    const application = new ProjectResourceApplication(client({
      browsePacks: async input => {
        observed.push(input)
        return { items: [], total: 0, facets: facets() }
      },
    }))

    await application.browsePacks({
      filters: { dimensions: ['3D'], assetKinds: ['model'], capabilities: ['modular'] },
    })

    expect(observed).toEqual([expect.objectContaining({
      filters: expect.objectContaining({ dimensions: ['3D'], assetKinds: ['model'], capabilities: ['modular'] }),
    })])
  })

  test('imports several elements independently so one artistic responsibility cannot overwrite another', async () => {
    workspace = await createWorkspace()
    const application = new ProjectResourceApplication(client({
      resolveSelections: async selections => selections.map(selection => ({
        importId: selection.importId,
        destinationPath: selection.destinationPath,
        packId: selection.packId,
        packVersion: '1.0.0',
        elementId: selection.elementId,
        elementPath: `models/${selection.elementId}.glb`,
        sourceUrl: `https://resource.test/${selection.elementId}.glb`,
        technicalFacts: { boundsSizeY: 4, hasNormals: true },
        selectionReason: selection.selectionReason,
      })),
    }), async () => new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46])))

    const result = await application.importExplicitSelections(workspace, [
      { importId: 'tower-a', packId: 'kit', expectedPackVersion: '1.0.0', elementId: 'tower-a', destinationPath: 'assets/library/towers', selectionReason: ['Primary scene kit'] },
      { importId: 'tower-b', packId: 'kit', expectedPackVersion: '1.0.0', elementId: 'tower-b', destinationPath: 'assets/library/towers-b', selectionReason: ['Primary scene kit'] },
    ])

    expect(result.results).toEqual([
      expect.objectContaining({ importId: 'tower-a', status: 'available' }),
      expect.objectContaining({ importId: 'tower-b', status: 'available' }),
    ])
    expect(result.manifest.imports?.map(entry => entry.id)).toEqual(['tower-a', 'tower-b'])
    expect(result.manifest.imports?.[0]?.technical_facts).toEqual({ boundsSizeY: 4, hasNormals: true })
    expect(result.manifest.requirements[0]?.resource_binding).toBeUndefined()
  })

  test('does not add an import or leave a root file when dependency download fails', async () => {
    workspace = await createWorkspace()
    const application = new ProjectResourceApplication(client({
      resolveSelections: async selections => [{
        importId: selections[0]!.importId,
        packId: 'new-pack', packVersion: '2.0.0', elementId: 'new-element',
        elementPath: 'models/new.glb', sourceUrl: 'https://resource.test/new.glb',
        selectionReason: selections[0]!.selectionReason,
        dependencies: [{
          key: 'root.0', parentKey: 'root', elementId: 'texture',
          elementPath: 'textures/new.png', referencePath: 'Textures/new.png',
          sourceUrl: 'https://resource.test/new.png',
        }],
      }],
    }), async input => String(input).endsWith('.png')
      ? new Response('missing', { status: 500 })
      : new Response(new Uint8Array([1, 2, 3])))

    const result = await application.importExplicitSelections(workspace, [{
      importId: 'new-element', packId: 'new-pack', expectedPackVersion: '2.0.0', elementId: 'new-element', destinationPath: 'assets/library/new-element', selectionReason: ['Primary model root'],
    }])

    expect(result.results[0]).toEqual(expect.objectContaining({ status: 'failed', error: expect.stringContaining('Resource dependency download failed') }))
    expect((await readBeeGameAssetManifest(workspace)).imports).toEqual([])
    await expect(readFile(join(workspace, 'assets', 'library', 'new-element', 'new.glb'))).rejects.toThrow()
  })

  test('refreshes objective metadata for pinned existing imports without replacing project files or usage evidence', async () => {
    workspace = await createWorkspace()
    const application = new ProjectResourceApplication(client({
      resolveSelections: async selections => selections.map(selection => ({
        importId: selection.importId,
        packId: selection.packId,
        packVersion: '1.0.0',
        elementId: selection.elementId,
        elementPath: 'models/root.glb',
        sourceUrl: 'https://resource.test/root.glb',
        selectionReason: selection.selectionReason,
        contentProfile: { packaging: 'self-contained' },
        technicalFacts: { boundsSizeY: 7, hasNormals: true },
      })),
    }), async () => new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46])))
    await application.importExplicitSelections(workspace, [{
      importId: 'root', packId: 'kit', expectedPackVersion: '1.0.0', elementId: 'root', destinationPath: 'assets/library/root', selectionReason: ['Approved kit'],
    }])
    const before = await readBeeGameAssetManifest(workspace)
    before.imports![0] = { ...before.imports![0]!, technical_facts: undefined, status: 'referenced', usage_evidence: { references: ['src/scene.ts'] } }
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src/scene.ts'), 'export const scene = true')
    await writeFile(join(workspace, 'assets/asset-manifest.json'), JSON.stringify(before))

    const refreshed = await application.refreshImportedMetadata(workspace)

    expect(refreshed.refreshedImportIds).toEqual(['root'])
    expect(refreshed.unresolvedImportIds).toEqual([])
    expect(refreshed.manifest.imports?.[0]).toEqual(expect.objectContaining({
      status: 'referenced',
      usage_evidence: { references: ['src/scene.ts'], runtime_event_ids: [] },
      technical_facts: { boundsSizeY: 7, hasNormals: true },
      content_profile: { packaging: 'self-contained' },
    }))
    await expect(readFile(join(workspace, 'assets/library/root/root.glb'))).resolves.toEqual(Buffer.from([0x67, 0x6c, 0x54, 0x46]))
  })
})

function client(overrides: Partial<ProjectResourceSelectionClient> = {}): ProjectResourceSelectionClient {
  return {
    browsePacks: async () => ({ items: [], total: 0, facets: facets() }),
    browsePackElements: async () => ({ items: [], total: 0, facets: facets() }),
    inspectPack: async packId => ({ pack: { id: packId }, folders: [] }),
    resolveSelections: async () => [],
    ...overrides,
  }
}

function facets() {
  return { dimensions: [], primaryCategories: [], categories: [], styles: [], gameTypes: [], packTags: [], usageTags: [], assetKinds: [], capabilities: [], formats: [] }
}

async function createWorkspace(slotOverrides: Record<string, unknown> = {}): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-project-resources-'))
  await mkdir(join(workspace, 'assets'), { recursive: true })
  await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
    version: 4,
    project_target: {
      integration_mode: 'filesystem',
      asset_format_capabilities: ['glb', 'png'],
      resource_library_usage: 'preferred',
    },
    slots: [{
      id: 'primary-character',
      target: { path: 'public/assets/character.glb' },
      resource_requirement: {
        category: 'models', dimension: '3D', accepted_formats: ['glb'], tags: ['character'],
      },
      ...slotOverrides,
    }],
  }))
  return workspace
}
