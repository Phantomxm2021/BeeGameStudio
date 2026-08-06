import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { createNativeResourceLibraryTool } from './native-resource-library-tool'
import type { ProjectResourceSelectionClient } from './project-resource-application'

type ToolDefinition = {
  call(input: unknown): Promise<{ data: Record<string, unknown> }>
  checkPermissions(input: unknown): Promise<Record<string, unknown>>
  prompt(): Promise<string>
  inputSchema: { safeParse(input: unknown): { success: boolean } }
}

describe('native ResourceLibrary tool', () => {
  test('exposes one read-only bounded match action and no browsing or import lane', async () => {
    const workspace = await createWorkspace()
    const tool = createTool(workspace, resourceClient())
    try {
      expect(tool.inputSchema.safeParse({ action: 'match_requirements' }).success).toBe(true)
      for (const action of ['list_packs', 'inspect_pack', 'import_resources']) {
        expect(tool.inputSchema.safeParse({ action }).success).toBe(false)
      }
      expect((await tool.checkPermissions({ action: 'match_requirements' })).behavior).toBe('allow')
      expect(await tool.prompt()).toContain('one bounded match')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('derives profiles from the canonical Manifest instead of model input', async () => {
    const workspace = await createWorkspace()
    let received: unknown
    const client = resourceClient()
    client.matchRequirements = async input => {
      received = input
      return { catalogRevision: 'revision-a', groups: [{
        requirementId: 'visual.tower', status: 'no-match', candidates: [], unclassifiedElementIds: [],
      }] }
    }
    const tool = createTool(workspace, client)
    try {
      await expect(tool.call({ action: 'match_requirements' })).resolves.toEqual({
        data: expect.objectContaining({ catalog_revision: 'revision-a' }),
      })
      expect(received).toEqual({
        requirements: [{ requirementId: 'visual.tower', profile: {
          dimensions: ['3D'], assetKinds: ['model'], usageTags: ['building'],
          capabilities: [], styles: ['stylized'],
        } }],
        deliveryCapabilities: [{
          sourceFormat: 'fbx', disposition: 'convert', targetFormat: 'glb', adapterId: 'model-converter',
        }],
        maxCandidatesPerRequirement: 8,
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects model-supplied profiles and pagination controls', async () => {
    const workspace = await createWorkspace()
    const tool = createTool(workspace, resourceClient())
    try {
      expect(tool.inputSchema.safeParse({ action: 'match_requirements', cursor: 'next' }).success).toBe(false)
      expect(tool.inputSchema.safeParse({ action: 'match_requirements', requirements: [] }).success).toBe(false)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

function createTool(workspacePath: string, client: ProjectResourceSelectionClient): ToolDefinition {
  return createNativeResourceLibraryTool({
    buildTool: definition => definition,
    workspacePath,
    client,
    deliveryCapabilities: [{
      sourceFormat: 'fbx', disposition: 'convert', targetFormat: 'glb', adapterId: 'model-converter',
    }],
  }) as ToolDefinition
}

function resourceClient(): ProjectResourceSelectionClient {
  return {
    matchRequirements: async () => ({ catalogRevision: 'revision-a', groups: [] }),
    resolveResources: async () => [],
  }
}

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-native-resource-'))
  await writeBeeGameAssetManifest(workspace, {
    version: 8,
    project_target: {
      asset_format_capabilities: ['glb'], resource_library_usage: 'optional',
      runtime_asset_root: 'assets/runtime', content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    },
    requirements: [{
      id: 'visual.tower', required: true,
      acquisition_profile: {
        dimensions: ['3D'], asset_kinds: ['model'], usage_tags: ['building'],
        capabilities: [], styles: ['stylized'],
      },
    }],
    resources: [],
  })
  return workspace
}
