import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { createNativeResourceLibraryTool } from './native-resource-library-tool'
import { getOrCreateResourceInventoryTransaction } from './resource-match-observation'
import { resourceInventoryPlanRevision } from './resource-inventory-revision'
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
      expect(tool.inputSchema.safeParse({ action: 'unsupported' }).success).toBe(false)
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
        requirementId: 'visual.tower', status: 'no-match', diagnostics: [{ code: 'coverage_gap', count: 1 }], bundles: [],
      }] }
    }
    const tool = createTool(workspace, client)
    try {
      await expect(tool.call({ action: 'match_requirements' })).resolves.toEqual({
        data: expect.objectContaining({
          catalog_revision: 'revision-a',
          requirements: [{
            requirement_id: 'visual.tower',
            status: 'no-match',
            placeholder_asset_kinds: ['model'],
            diagnostics: [{ code: 'coverage_gap', count: 1 }],
            bundles: [],
          }],
        }),
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

  test('reuses the transaction frozen observation after worker reconstruction', async () => {
    const workspace = await createWorkspace()
    let calls = 0
    const client = resourceClient()
    client.matchRequirements = async request => {
      calls += 1
      return {
        catalogRevision: 'revision-a',
        groups: request.requirements.map(requirement => ({
          requirementId: requirement.requirementId,
          status: 'no-match' as const,
          diagnostics: [],
          bundles: [],
        })),
      }
    }
    try {
      await createTool(workspace, client).call({ action: 'match_requirements' })
      await createTool(workspace, client).call({ action: 'match_requirements' })
      expect(calls).toBe(1)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rematches only the current inventory when its unprepared policy identity is stale', async () => {
    const workspace = await createWorkspace()
    let calls = 0
    const client = resourceClient()
    client.matchRequirements = async request => {
      calls += 1
      return {
        catalogRevision: `revision-${calls}`,
        groups: request.requirements.map(requirement => ({
          requirementId: requirement.requirementId,
          status: 'no-match' as const,
          diagnostics: [],
          bundles: [],
        })),
      }
    }
    try {
      await createTool(workspace, client).call({ action: 'match_requirements' })
      const currentRoot = join(workspace, '.beegame/workflow/resource-inventory-current')
      const [currentName] = await readdir(currentRoot)
      const currentPath = join(currentRoot, currentName!)
      const first = JSON.parse(await readFile(currentPath, 'utf8'))
      first.version = 1
      delete first.policyRevision
      await writeFile(currentPath, `${JSON.stringify(first, null, 2)}\n`)
      const observationRoot = join(workspace, '.beegame/workflow/resource-match-observations')
      const [observationName] = await readdir(observationRoot)
      const observationPath = join(observationRoot, observationName!)
      const retiredObservation = JSON.parse(await readFile(observationPath, 'utf8'))
      retiredObservation.version = 1
      delete retiredObservation.policyRevision
      retiredObservation.result = { retired: true }
      await writeFile(observationPath, `${JSON.stringify(retiredObservation, null, 2)}\n`)

      await createTool(workspace, client).call({ action: 'match_requirements' })

      const refreshed = JSON.parse(await readFile(currentPath, 'utf8'))
      expect(calls).toBe(2)
      expect(refreshed.transactionId).not.toBe(first.transactionId)
      expect(refreshed.policyRevision).toBeString()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('rejects a corrupted current transaction instead of treating it as a stale policy', async () => {
    const workspace = await createWorkspace()
    const client = resourceClient()
    try {
      await createTool(workspace, client).call({ action: 'match_requirements' })
      const currentRoot = join(workspace, '.beegame/workflow/resource-inventory-current')
      const [currentName] = await readdir(currentRoot)
      const currentPath = join(currentRoot, currentName!)
      const corrupted = JSON.parse(await readFile(currentPath, 'utf8'))
      corrupted.unexpected = true
      await writeFile(currentPath, `${JSON.stringify(corrupted, null, 2)}\n`)

      await expect(createTool(workspace, client).call({ action: 'match_requirements' }))
        .rejects.toThrow('Resource inventory transaction is invalid')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test('serializes stale transaction replacement across isolated processes', async () => {
    const workspace = await createWorkspace()
    try {
      const manifest = JSON.parse(await readFile(join(workspace, 'assets/asset-manifest.json'), 'utf8'))
      const planRevision = resourceInventoryPlanRevision(manifest)
      await getOrCreateResourceInventoryTransaction({ workspacePath: workspace, planRevision })
      const currentRoot = join(workspace, '.beegame/workflow/resource-inventory-current')
      const [currentName] = await readdir(currentRoot)
      const currentPath = join(currentRoot, currentName!)
      const stale = JSON.parse(await readFile(currentPath, 'utf8'))
      stale.version = 1
      delete stale.policyRevision
      await writeFile(currentPath, `${JSON.stringify(stale, null, 2)}\n`)

      const moduleUrl = new URL('./resource-match-observation.ts', import.meta.url).href
      const source = `
        const module = await import(${JSON.stringify(moduleUrl)});
        const transaction = await module.getOrCreateResourceInventoryTransaction({
          workspacePath: ${JSON.stringify(workspace)},
          planRevision: ${JSON.stringify(planRevision)},
        });
        console.log(transaction.transactionId);
      `
      const children = Array.from({ length: 8 }, () => Bun.spawn([
        process.execPath,
        '-e',
        source,
      ], { stdout: 'pipe', stderr: 'pipe' }))
      const transactionIds = await Promise.all(children.map(async child => {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        expect(exitCode, stderr).toBe(0)
        return stdout.trim()
      }))

      expect(new Set(transactionIds).size).toBe(1)
      const current = JSON.parse(await readFile(currentPath, 'utf8'))
      expect(current.transactionId).toBe(transactionIds[0])
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
    assertDispatchAuthority: async () => undefined,
    resolveDeliveryCapabilities: () => [{
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
    }, {
      id: 'visual.optional', required: false,
      acquisition_profile: {
        dimensions: ['3D'], asset_kinds: ['model'], usage_tags: ['building'],
        capabilities: [], styles: ['stylized'],
      },
    }],
    resources: [],
  })
  return workspace
}
