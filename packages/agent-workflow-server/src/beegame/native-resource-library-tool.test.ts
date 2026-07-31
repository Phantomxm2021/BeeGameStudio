import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBeeGameAssetManifest } from './asset-contracts'
import { createNativeResourceLibraryTool } from './native-resource-library-tool'
import type { ProjectResourceSelectionClient } from './project-resource-application'

type ToolDefinition = {
  alwaysLoad: boolean
  inputSchema: { parse(input: unknown): unknown }
  prompt(): Promise<string>
  checkPermissions(
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
  call(input: Record<string, unknown>): Promise<{ data: unknown }>
}

describe('native Resource Library tool', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('asks once for one explicit batch while all exploration stays read-only', async () => {
    workspace = await createWorkspace()
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client(),
    }) as ToolDefinition

    await expect(
      tool.checkPermissions({
        action: 'query_candidates',
        requirement_ids: ['ground'],
      }),
    ).resolves.toMatchObject({ behavior: 'allow' })
    await expect(
      tool.checkPermissions({
        action: 'record_no_match',
        requirement_ids: ['ground'],
        outcome: 'authored-asset',
        reasons: ['No suitable candidate'],
      }),
    ).resolves.toMatchObject({ behavior: 'allow' })
    await expect(
      tool.checkPermissions({ action: 'refresh_import_metadata' }),
    ).resolves.toMatchObject({ behavior: 'ask' })
    await expect(
      tool.checkPermissions({
        action: 'import_elements',
        selections: [
          {
            import_id: 'ground-a',
            pack_id: 'pack-a',
            expected_pack_version: '1.0.0',
            element_id: 'ground-a',
            destination_path: 'assets/library/ground',
            selection_reason: ['Primary environment kit'],
          },
          {
            import_id: 'tower-a',
            pack_id: 'pack-a',
            expected_pack_version: '1.0.0',
            element_id: 'tower-a',
            destination_path: 'assets/library/tower',
            selection_reason: ['Primary environment kit'],
          },
        ],
      }),
    ).resolves.toMatchObject({
      behavior: 'ask',
      message: expect.stringContaining('2 explicitly selected'),
    })
  })

  test('imports exactly the elements supplied by Claude Code and binds their requirements', async () => {
    workspace = await createWorkspace()
    const observed: unknown[] = []
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client({
        queryCandidates: async () => candidatePage({
          items: [catalogElement('pack-a', 'ground-a')],
          total: 1,
          facets: facets(),
        }),
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

    await tool.call({
      action: 'query_candidates',
      requirement_ids: ['ground'],
    })
    const result = await tool.call({
      action: 'import_elements',
      selections: [
        {
          import_id: 'ground-a',
          requirement_ids: ['ground'],
          pack_id: 'pack-a',
          expected_pack_version: '1.0.0',
          element_id: 'ground-a',
          destination_path: 'assets/library/ground',
          selection_reason: ['Primary environment kit'],
        },
      ],
    })

    expect(observed).toEqual([
      [
        expect.objectContaining({
          importId: 'ground-a',
          packId: 'pack-a',
          elementId: 'ground-a',
          destinationPath: 'assets/library/ground',
        }),
      ],
    ])
    expect(JSON.stringify(result)).not.toContain('signed.example')
    expect(result).toEqual({
      data: expect.objectContaining({
        imported: [
          expect.objectContaining({
            import_id: 'ground-a',
            status: 'available',
          }),
        ],
        failures: [],
      }),
    })
    const manifest = await readBeeGameAssetManifest(workspace)
    expect(manifest.imports?.[0]?.technical_facts).toEqual({
      boundsSizeY: 6,
      hasTextureCoordinates: true,
    })
  })

  test('groups repeated import failures instead of returning the entire manifest', async () => {
    workspace = await createWorkspace()
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client({
        queryCandidates: async () => candidatePage({
          items: [
            catalogElement('pack-a', 'one-id'),
            catalogElement('pack-a', 'two-id'),
          ],
          total: 2,
          facets: facets(),
        }),
        resolveSelections: async selections =>
          selections.map(selection => ({
            importId: selection.importId,
            destinationPath: selection.destinationPath,
            packId: selection.packId,
            packVersion: '1.0.0',
            elementId: selection.elementId,
            elementPath: 'models/model.fbx',
            sourceUrl: 'https://signed.example/model',
            selectionReason: selection.selectionReason,
          })),
      }),
    }) as ToolDefinition

    await tool.call({
      action: 'query_candidates',
      requirement_ids: ['ground'],
    })
    const result = await tool.call({
      action: 'import_elements',
      selections: ['one', 'two'].map(importId => ({
        import_id: importId,
        requirement_ids: ['ground'],
        pack_id: 'pack-a',
        expected_pack_version: '1.0.0',
        element_id: `${importId}-id`,
        destination_path: `assets/${importId}`,
        selection_reason: ['Scene asset'],
      })),
    })
    expect(result).toEqual({
      data: expect.objectContaining({
        imported: [],
        failures: [
          {
            error: 'Resource format .fbx is not accepted by requirement ground',
            import_ids: ['one', 'two'],
          },
        ],
        manifest: expect.objectContaining({
          requirement_count: 1,
          import_count: 0,
          composition_count: 0,
        }),
      }),
    })
    expect(JSON.stringify(result)).not.toContain('resource_requirement')
  })

  test('rejects concurrent operations instead of queuing precommitted catalog reads', async () => {
    workspace = await createWorkspace()
    let releaseQuery!: () => void
    const queryPending = new Promise<void>(resolve => {
      releaseQuery = resolve
    })
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client({
        queryCandidates: async () => {
          await queryPending
          return candidatePage({ items: [], total: 0, facets: facets() })
        },
      }),
    }) as ToolDefinition

    const first = tool.call({
      action: 'query_candidates',
      requirement_ids: ['ground'],
    })
    await Promise.resolve()
    await expect(
      tool.call({
        action: 'query_candidates',
        requirement_ids: ['ground'],
      }),
    ).rejects.toThrow('accepts one operation at a time')
    releaseQuery()
    await first
  })

  test('enforces catalog budget before the next candidate read', async () => {
    workspace = await createWorkspace()
    let catalogCalls = 0
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      catalogReadLimit: 2,
      client: client({
        queryCandidates: async () => {
          catalogCalls += 1
          return candidatePage({ items: [], total: 0, facets: facets() })
        },
        resolveSelections: async selections =>
          selections.map(selection => ({
            importId: selection.importId,
            destinationPath: selection.destinationPath,
            packId: selection.packId,
            packVersion: '1.0.0',
            elementId: selection.elementId,
            elementPath: 'models/ground.glb',
            sourceUrl: 'https://signed.example/ground',
            selectionReason: selection.selectionReason,
          })),
      }),
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3])),
    }) as ToolDefinition

    const first = await tool.call({
      action: 'query_candidates',
      requirement_ids: ['ground'],
    })
    const second = await tool.call({
      action: 'query_candidates',
      requirement_ids: ['ground'],
    })
    expect(first).toEqual({
      data: expect.objectContaining({
        catalog_budget: { limit: 2, used: 1, remaining: 1 },
      }),
    })
    expect(second).toEqual({
      data: expect.objectContaining({
        catalog_budget: { limit: 2, used: 2, remaining: 0 },
      }),
    })
    await expect(
      tool.call({
        action: 'query_candidates',
        requirement_ids: ['ground'],
      }),
    ).rejects.toThrow('catalog budget is exhausted after 2 reads')
    expect(catalogCalls).toBe(2)
  })

  test('does not consume catalog budget when a read fails before returning catalog data', async () => {
    workspace = await createWorkspace()
    let attempts = 0
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      catalogReadLimit: 1,
      client: client({
        queryCandidates: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('catalog unavailable')
          return candidatePage({ items: [], total: 0, facets: facets() })
        },
      }),
    }) as ToolDefinition

    await expect(
      tool.call({
        action: 'query_candidates',
        requirement_ids: ['ground'],
      }),
    ).rejects.toThrow('catalog unavailable')
    await expect(tool.call({
      action: 'query_candidates',
      requirement_ids: ['ground'],
    })).resolves.toEqual({
      data: expect.objectContaining({
        catalog_budget: { limit: 1, used: 1, remaining: 0 },
      }),
    })
    expect(attempts).toBe(2)
  })

  test('queries one canonical requirement group across Packs', async () => {
    workspace = await createWorkspace()
    const calls: Array<Record<string, unknown>> = []
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client({
        queryCandidates: async input => {
          calls.push(input as Record<string, unknown>)
          return candidatePage({
            items: [],
            total: 0,
            facets: facets(),
          })
        },
      }),
    }) as ToolDefinition

    await expect(
      tool.call({ action: 'query_candidates', requirement_ids: ['ground'] }),
    ).resolves.toEqual({
      data: expect.objectContaining({
        total: 0,
        decision_ready: true,
      }),
    })
    expect(calls).toEqual([
      {
        filters: { usageTags: ['terrain'], formats: ['glb'] },
        limit: 16,
      },
    ])
  })

  test('records the approved no-match only after complete candidate pagination', async () => {
    workspace = await createWorkspace()
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client({
        queryCandidates: async () => candidatePage({
          items: [],
          total: 0,
          facets: facets(),
        }),
      }),
    }) as ToolDefinition

    await expect(
      tool.call({
        action: 'record_no_match',
        requirement_ids: ['ground'],
        outcome: 'authored-asset',
        reasons: ['The complete exact catalog query returned no candidate.'],
      }),
    ).rejects.toThrow('Complete query_candidates pagination')

    await tool.call({ action: 'query_candidates', requirement_ids: ['ground'] })
    await expect(
      tool.call({
        action: 'record_no_match',
        requirement_ids: ['ground'],
        outcome: 'authored-asset',
        reasons: ['The complete exact catalog query returned no candidate.'],
      }),
    ).resolves.toEqual({
      data: {
        result: 'recorded',
        requirement_ids: ['ground'],
        outcome: 'authored-asset',
      },
    })

    const manifest = await readBeeGameAssetManifest(workspace)
    expect(manifest.requirements[0]).toMatchObject({
      id: 'ground',
      status: 'planned',
      source_decision: {
        type: 'authored-asset',
        basis: 'catalog-no-match',
        discovery_receipt: {
          candidate_ids: [],
          candidate_count: 0,
          total_compatible: 0,
          decision_ready: true,
        },
      },
    })
    expect(manifest.requirements[0]).not.toHaveProperty('resource_requirement')
  })

  test('does not expose a structural self-certification action', async () => {
    workspace = await createWorkspace()
    const tool = createNativeResourceLibraryTool({
      buildTool: definition => definition,
      workspacePath: workspace,
      client: client(),
    }) as ToolDefinition

    await expect(tool.prompt()).resolves.toContain(
      'cannot mark a target-runtime composition complete',
    )
    await expect(tool.prompt()).resolves.toContain('native Validator')
    await expect(tool.prompt()).resolves.toContain(
      'never hand-author their records',
    )
    expect(() =>
      tool.inputSchema.parse({ action: 'verify_integration' }),
    ).toThrow()
    expect(() =>
      tool.inputSchema.parse({ action: 'inspect_project' }),
    ).toThrow()
  })
})

function client(
  overrides: Partial<ProjectResourceSelectionClient> = {},
): ProjectResourceSelectionClient {
  return {
    queryCandidates: async () =>
      candidatePage({ items: [], total: 0, facets: facets() }),
    resolveSelections: async () => [],
    ...overrides,
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

function candidatePage<T extends { items: unknown[]; total: number; facets: ReturnType<typeof facets> }>(
  page: T,
) {
  return {
    ...page,
    catalogRevision: 'a'.repeat(64),
    normalizedFilters: {},
  }
}

function catalogElement(packId: string, elementId: string) {
  return {
    packId,
    packVersion: '1.0.0',
    packName: 'Kit',
    packStyle: 'Stylized',
    packStyles: ['Stylized'],
    packGameTypes: ['Strategy'],
    elementId,
    elementName: elementId,
    elementPath: `models/${elementId}.glb`,
    category: 'models' as const,
    dimension: '3D' as const,
    usageTags: ['terrain'] as const,
    assetKind: 'model' as const,
    capabilities: [],
    relations: [],
    dependencyCount: 0,
  }
}

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(
    join(tmpdir(), 'beegame-native-resource-tool-'),
  )
  await mkdir(join(workspace, 'assets'), { recursive: true })
  await writeFile(
    join(workspace, 'assets', 'asset-manifest.json'),
    JSON.stringify({
      version: 5,
      project_target: {
        integration_mode: 'filesystem',
        asset_format_capabilities: ['glb'],
        resource_library_usage: 'preferred',
        runtime_asset_root: 'assets/library',
      },
      requirements: [
        {
          id: 'ground',
          status: 'planned',
          resource_requirement: {
            accepted_formats: ['glb'],
            tags: ['terrain'],
            import_budget: 4,
            no_match: 'authored-asset',
          },
        },
      ],
      imports: [],
      compositions: [],
    }),
  )
  return workspace
}
