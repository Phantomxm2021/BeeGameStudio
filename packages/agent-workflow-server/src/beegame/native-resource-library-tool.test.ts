import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeResourceLibraryTool } from './native-resource-library-tool'
import type { ProjectResourceSelectionClient } from './project-resource-application'

type ToolDefinition = {
  alwaysLoad: boolean
  inputSchema: { parse(input: unknown): unknown }
  prompt(): Promise<string>
  checkPermissions(input: Record<string, unknown>): Promise<Record<string, unknown>>
  call(input: Record<string, unknown>): Promise<{ data: unknown }>
}

describe('native Resource Library tool', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('exposes a paginated catalog without requirement roles or signed URLs', async () => {
    workspace = await createWorkspace()
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client({
        browsePacks: async () => ({
          items: [{
            packId: 'pack-a', packVersion: '1.0.0', packName: 'Kit', style: 'Stylized', styles: ['Stylized'],
            gameTypes: ['Adventure'], dimension: '3D', primaryCategory: '3d-assets',
            categories: ['models'], tags: [], readyElementCount: 12, assetKinds: ['model'],
            usageTags: ['environment'], capabilities: ['modular'], formats: ['glb'], license: 'internal', compatibleEngines: [],
          }],
          total: 1,
          facets: facets(),
        }),
      }),
    }) as ToolDefinition

    const result = await tool.call({
      action: 'browse_packs',
      filters: { dimensions: ['3D'], formats: ['glb'] },
    })

    expect(tool.alwaysLoad).toBe(true)
    expect(JSON.stringify(result)).not.toContain('sourceUrl')
    expect(result).toEqual({ data: expect.objectContaining({ items: [expect.objectContaining({ packId: 'pack-a' })] }) })
    await expect(tool.prompt()).resolves.toContain('Catalog results are paginated')
    await expect(tool.prompt()).resolves.toContain('BeeGame does not select resources')
    await expect(tool.prompt()).resolves.not.toContain('author the engine-native assembly yourself')
  })

  test('asks once for one explicit batch while all exploration stays read-only', async () => {
    workspace = await createWorkspace()
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client(),
    }) as ToolDefinition

    await expect(tool.checkPermissions({ action: 'browse_pack_elements', pack_id: 'pack-a', filters: { asset_kinds: ['model'] } })).resolves.toMatchObject({ behavior: 'allow' })
    await expect(tool.checkPermissions({ action: 'index_pack_elements', pack_id: 'pack-a' })).resolves.toMatchObject({ behavior: 'allow' })
    await expect(tool.checkPermissions({ action: 'refresh_import_metadata' })).resolves.toMatchObject({ behavior: 'ask' })
    await expect(tool.checkPermissions({
      action: 'import_elements',
      selections: [
        { import_id: 'ground-a', pack_id: 'pack-a', expected_pack_version: '1.0.0', element_id: 'ground-a', destination_path: 'assets/library/ground', selection_reason: ['Primary environment kit'] },
        { import_id: 'tower-a', pack_id: 'pack-a', expected_pack_version: '1.0.0', element_id: 'tower-a', destination_path: 'assets/library/tower', selection_reason: ['Primary environment kit'] },
      ],
    })).resolves.toMatchObject({
      behavior: 'ask',
      message: expect.stringContaining('2 explicitly selected'),
    })
  })

  test('returns a bounded Pack inventory page with exact stable paths', async () => {
    workspace = await createWorkspace()
    const calls: Array<{ cursor?: string; limit?: number }> = []
    const makeElement = (id: string, path: string) => ({
      packId: 'pack-a', packVersion: '1.0.0', packName: 'Kit', packStyle: 'Stylized', packStyles: ['Stylized'],
      packGameTypes: ['Strategy'], elementId: id, elementName: path.split('/').pop()!, elementPath: path,
      preview: { kind: 'model' as const, path },
      category: 'environment' as const, dimension: '3D' as const, usageTags: [], assetKind: 'model' as const,
      capabilities: [],
      contentProfile: {
        packaging: 'self-contained' as const,
        components: [{ id: 'mesh-root', kind: 'mesh' as const, name: 'Root', roles: ['environment'] }],
        inspection: { status: 'complete' as const, source: 'server' as const },
      },
      technicalFacts: { boundsSizeY: 6, hasTextureCoordinates: true, externalReferences: '["too-large-for-index"]' },
      relations: id === 'rock-a' ? [{ kind: 'component-of' as const, targetElementId: 'tree-a', role: 'detail' }] : [], dependencyCount: 0,
    })
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client({
        browsePackElements: async (_packId, input) => {
          calls.push({ ...(input.cursor ? { cursor: input.cursor } : {}), ...(input.limit ? { limit: input.limit } : {}) })
          if (!input.cursor) return { items: [makeElement('tree-a', 'models/tree-a.glb')], total: 2, nextCursor: 'cursor-1', facets: facets() }
          return { items: [makeElement('rock-a', 'models/rock-a.glb')], total: 2, facets: facets() }
        },
      }),
    }) as ToolDefinition

    const result = await tool.call({ action: 'index_pack_elements', pack_id: 'pack-a' })

    expect(calls).toEqual([{ limit: 48 }, { cursor: 'cursor-1', limit: 47 }])
    expect(result).toEqual({ data: expect.objectContaining({
      packId: 'pack-a',
      total: 2,
      items: [
        expect.objectContaining({ elementName: 'tree-a.glb', elementPath: 'models/tree-a.glb', preview: { kind: 'model', path: 'models/tree-a.glb' } }),
        expect.objectContaining({ elementName: 'rock-a.glb', elementPath: 'models/rock-a.glb', relations: [{ kind: 'component-of', targetElementId: 'tree-a', role: 'detail' }] }),
      ],
    }) })
    expect((result.data as { items: Array<{ technicalFacts?: Record<string, unknown> }> }).items[0]?.technicalFacts).toEqual({ boundsSizeY: 6, hasTextureCoordinates: true })
    expect((result.data as { items: Array<{ contentProfile?: unknown }> }).items[0]?.contentProfile).toEqual({
      packaging: 'self-contained',
      components: [{ id: 'mesh-root', kind: 'mesh', name: 'Root', roles: ['environment'] }],
      inspection: { status: 'complete', source: 'server' },
    })
    await expect(tool.prompt()).resolves.not.toContain('never restart the same Pack from its first page')
  })

  test('does not flood Agent context with a large Pack inventory', async () => {
    workspace = await createWorkspace()
    const elements = Array.from({ length: 48 }, (_, index) => ({
      packId: 'pack-a', packVersion: '1.0.0', packName: 'Kit', packStyle: 'Stylized', packStyles: ['Stylized'],
      packGameTypes: ['Strategy'], elementId: `asset-${index}`, elementName: `asset-${index}.glb`, elementPath: `models/asset-${index}.glb`,
      category: 'environment' as const, dimension: '3D' as const, usageTags: [], assetKind: 'model' as const,
      capabilities: [], relations: [], dependencyCount: 0,
    }))
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client({
        browsePackElements: async () => ({ items: elements, total: 200, nextCursor: 'cursor-48', facets: facets() }),
      }),
    }) as ToolDefinition

    const result = await tool.call({ action: 'index_pack_elements', pack_id: 'pack-a' })
    expect(result).toEqual({ data: expect.objectContaining({
      total: 200,
      nextCursor: 'cursor-48',
    }) })
    expect((result.data as { items: unknown[] }).items).toHaveLength(48)
  })

  test('imports exactly the elements supplied by Claude Code without a slot binding', async () => {
    workspace = await createWorkspace()
    const observed: unknown[] = []
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client({
        resolveSelections: async selections => {
          observed.push(selections)
          return selections.map(selection => ({
            importId: selection.importId,
            destinationPath: selection.destinationPath,
            packId: selection.packId,
            packVersion: '1.0.0',
            elementId: selection.elementId,
            elementPath: 'models/ground.glb',
            sourceUrl: 'https://signed.example/ground',
            technicalFacts: { boundsSizeY: 6, hasTextureCoordinates: true },
            selectionReason: selection.selectionReason,
          }))
        },
      }),
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3])),
    }) as ToolDefinition

    const result = await tool.call({
      action: 'import_elements',
      selections: [{ import_id: 'ground-a', pack_id: 'pack-a', expected_pack_version: '1.0.0', element_id: 'ground-a', destination_path: 'assets/library/ground', selection_reason: ['Primary environment kit'] }],
    })

    expect(observed).toEqual([[expect.objectContaining({
      importId: 'ground-a', packId: 'pack-a', elementId: 'ground-a', destinationPath: 'assets/library/ground',
    })]])
    expect(JSON.stringify(result)).not.toContain('signed.example')
    expect(result).toEqual({ data: expect.objectContaining({
      imported: [expect.objectContaining({ import_id: 'ground-a', status: 'available' })],
      failures: [],
    }) })
    const manifest = JSON.parse(await Bun.file(join(workspace, 'assets/asset-manifest.json')).text()) as { imports: Array<{ technical_facts?: unknown }> }
    expect(manifest.imports[0]?.technical_facts).toEqual({ boundsSizeY: 6, hasTextureCoordinates: true })
  })

  test('resolves an exact compact-inventory path only when importing', async () => {
    workspace = await createWorkspace()
    const makeElement = (id: string, path: string) => ({
      packId: 'pack-a', packVersion: '1.0.0', packName: 'Kit', packStyle: 'Stylized', packStyles: ['Stylized'],
      packGameTypes: ['Strategy'], elementId: id, elementName: path.split('/').pop()!, elementPath: path,
      category: 'environment' as const, dimension: '3D' as const, usageTags: [], assetKind: 'model' as const,
      capabilities: [], relations: [], dependencyCount: 0,
    })
    const resolved: unknown[] = []
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client({
        browsePackElements: async () => ({ items: [makeElement('tree-id', 'models/tree.glb')], total: 1, facets: facets() }),
        resolveSelections: async selections => {
          resolved.push(selections)
          return selections.map(selection => ({
            importId: selection.importId, destinationPath: selection.destinationPath, packId: selection.packId,
            packVersion: '1.0.0', elementId: selection.elementId, elementPath: 'models/tree.glb',
            sourceUrl: 'https://signed.example/tree', selectionReason: selection.selectionReason,
          }))
        },
      }),
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3])),
    }) as ToolDefinition

    await tool.call({
      action: 'import_elements',
      selections: [{ import_id: 'tree', pack_id: 'pack-a', expected_pack_version: '1.0.0', element_path: 'models/tree.glb', destination_path: 'assets/library/tree', selection_reason: ['Scene vegetation'] }],
    })
    expect(resolved).toEqual([[expect.objectContaining({ elementId: 'tree-id' })]])
  })

  test('groups repeated import failures instead of returning the entire manifest', async () => {
    workspace = await createWorkspace()
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client({
        resolveSelections: async selections => selections.map(selection => ({
          importId: selection.importId, destinationPath: selection.destinationPath, packId: selection.packId,
          packVersion: '1.0.0', elementId: selection.elementId, elementPath: 'models/model.fbx',
          sourceUrl: 'https://signed.example/model', selectionReason: selection.selectionReason,
        })),
      }),
    }) as ToolDefinition

    const result = await tool.call({
      action: 'import_elements',
      selections: ['one', 'two'].map(importId => ({ import_id: importId, pack_id: 'pack-a', expected_pack_version: '1.0.0', element_id: `${importId}-id`, destination_path: `assets/${importId}`, selection_reason: ['Scene asset'] })),
    })
    expect(result).toEqual({ data: expect.objectContaining({
      imported: [],
      failures: [{ error: 'Asset format .fbx is not supported by the target runtime contract', import_ids: ['one', 'two'] }],
      manifest: expect.objectContaining({ requirement_count: 1, import_count: 0, composition_count: 0 }),
    }) })
    expect(JSON.stringify(result)).not.toContain('resource_requirement')
  })

  test('does not expose a structural self-certification action', async () => {
    workspace = await createWorkspace()
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client(),
    }) as ToolDefinition

    await expect(tool.prompt()).resolves.toContain('cannot mark a target-runtime composition complete')
    await expect(tool.prompt()).resolves.toContain('native Validator')
    await expect(tool.prompt()).resolves.toContain('do not hand-author or repeatedly rewrite them')
    expect(() => tool.inputSchema.parse({ action: 'verify_integration' })).toThrow()
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

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-native-resource-tool-'))
  await mkdir(join(workspace, 'assets'), { recursive: true })
  await writeFile(join(workspace, 'assets', 'asset-manifest.json'), JSON.stringify({
    version: 4,
    project_target: {
      integration_mode: 'filesystem',
      asset_format_capabilities: ['glb'],
      resource_library_usage: 'preferred',
    },
    slots: [{
      id: 'ground',
      target: { path: 'public/assets/ground.glb' },
      resource_requirement: { accepted_formats: ['glb'], tags: ['ground'] },
    }],
  }))
  return workspace
}
