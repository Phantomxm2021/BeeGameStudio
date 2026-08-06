import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compactPlaceholderPng } from './provisional-resource-adapters'
import { readBeeGameAssetManifest, writeBeeGameAssetManifest } from './asset-contracts'
import { commitResourceInventory } from './resource-inventory-commit'
import {
  getOrCreateResourceInventoryTransaction,
  getOrCreateResourceMatchObservation,
} from './resource-match-observation'
import { resourceInventoryPlanRevision } from './resource-inventory-revision'
import type { ProjectResourceSelectionClient } from './project-resource-application'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))))

describe('durable resource inventory commit', () => {
  test('rejects a placeholder while the frozen catalog has a selectable candidate', async () => {
    const workspacePath = await workspace(['visual.tower'])
    const client = clientFor({ 'visual.tower': 'matched' })
    await observe(workspacePath, client)
    await expect(commitResourceInventory({
      workspacePath, dispatchId: 'dispatch-a', client,
      provisionalAdapters: [], fetchImpl: async () => new Response(),
      input: { decisions: [placeholder('visual.tower')] },
      assertMutationAuthority: async () => undefined,
    })).rejects.toThrow('selectable Resource Library candidates')
  })

  test('commits a replaceable placeholder only for a service-proven no-match', async () => {
    const workspacePath = await workspace(['visual.tower'])
    const client = clientFor({ 'visual.tower': 'no-match' })
    await observe(workspacePath, client)
    const result = await commitResourceInventory({
      workspacePath, dispatchId: 'dispatch-a', client,
      provisionalAdapters: [{
        format: 'png', description: 'test png',
        author: () => ({ bytes: compactPlaceholderPng('neutral'), descriptor: {}, technicalFacts: { format: 'png' } }),
      }],
      fetchImpl: async () => new Response(),
      input: { decisions: [placeholder('visual.tower')] },
      assertMutationAuthority: async () => undefined,
    })
    expect(result).toEqual(expect.objectContaining({
      state: 'committed', bindings: [{ requirementId: 'visual.tower', resourceIds: ['placeholder.visual.tower'] }],
    }))
    const receipt = JSON.parse(await readFile(result.receiptPath, 'utf8'))
    expect(receipt).toEqual(expect.objectContaining({ state: 'committed', stagedResourceIds: ['placeholder.visual.tower'] }))
    expect((await readdir(join(workspacePath, '.beegame/workflow/resource-inventory-commits'))).some(name => name.endsWith('.staging'))).toBe(false)
    expect(await readdir(join(workspacePath, '.beegame/workflow/resource-inventory-current'))).toEqual([])
  })

  test('resumes a prepared commit without selecting or downloading completed resources again', async () => {
    const workspacePath = await workspace(['visual.a', 'visual.b'])
    let matches = 0
    const downloads = new Map<string, number>()
    let failSecond = true
    const client = clientFor({ 'visual.a': 'matched', 'visual.b': 'matched' }, () => { matches += 1 })
    await observe(workspacePath, client)
    const input = { decisions: [library('visual.a'), library('visual.b')] } as const
    const fetchImpl = async (request: RequestInfo | URL) => {
      const id = String(request).split('/').at(-1)!
      downloads.set(id, (downloads.get(id) ?? 0) + 1)
      if (id === 'visual.b' && failSecond) return new Response('failed', { status: 503 })
      return new Response(new Uint8Array(compactPlaceholderPng('cyan')))
    }
    await expect(commitResourceInventory({
      workspacePath, dispatchId: 'dispatch-a', client,
      provisionalAdapters: [], fetchImpl, input,
      assertMutationAuthority: async () => undefined,
    })).rejects.toThrow('visual.b')
    expect((await readBeeGameAssetManifest(workspacePath)).resources).toEqual([])
    failSecond = false
    await expect(commitResourceInventory({
      workspacePath, dispatchId: 'dispatch-b', client,
      provisionalAdapters: [], fetchImpl, input,
      assertMutationAuthority: async () => undefined,
    })).resolves.toEqual(expect.objectContaining({ state: 'committed' }))
    expect(matches).toBe(1)
    expect(downloads.get('visual.a')).toBe(1)
    expect(downloads.get('visual.b')).toBe(2)
  })

  test('does not publish staged resources after mutation authority is revoked', async () => {
    const workspacePath = await workspace(['visual.a'])
    const client = clientFor({ 'visual.a': 'matched' })
    await observe(workspacePath, client)
    let checks = 0
    await expect(commitResourceInventory({
      workspacePath,
      dispatchId: 'dispatch-a',
      client,
      provisionalAdapters: [],
      fetchImpl: async () => new Response(new Uint8Array(compactPlaceholderPng('cyan'))),
      input: { decisions: [library('visual.a')] },
      assertMutationAuthority: async () => {
        checks += 1
        if (checks > 4) throw new Error('dispatch is no longer active')
      },
    })).rejects.toThrow('dispatch is no longer active')
    expect((await readBeeGameAssetManifest(workspacePath)).resources).toEqual([])

    const receiptRoot = join(workspacePath, '.beegame/workflow/resource-inventory-commits')
    const [receiptName] = (await readdir(receiptRoot)).filter(name => name.endsWith('.json'))
    const receiptPath = join(receiptRoot, receiptName!)
    const stagingPath = `${receiptPath.slice(0, -'.json'.length)}.staging`
    const stagedManifest = await readBeeGameAssetManifest(stagingPath)
    const resource = stagedManifest.resources[0]!
    const replacement = new Uint8Array(compactPlaceholderPng('neutral'))
    const resourcePath = resource.file_paths[0]!
    await writeFile(join(stagingPath, resourcePath), replacement)
    resource.local_file_hashes = {
      [resourcePath]: createHash('sha256').update(replacement).digest('hex'),
    }
    await writeBeeGameAssetManifest(stagingPath, stagedManifest)

    await expect(commitResourceInventory({
      workspacePath,
      dispatchId: 'dispatch-b',
      client,
      provisionalAdapters: [],
      fetchImpl: async () => new Response(new Uint8Array(compactPlaceholderPng('cyan'))),
      input: { decisions: [library('visual.a')] },
      assertMutationAuthority: async () => undefined,
    })).rejects.toThrow('output hashes differ from the durable receipt')
    expect((await readBeeGameAssetManifest(workspacePath)).resources).toEqual([])
  })

  test('creates only one transaction under concurrent dispatch startup', async () => {
    const workspacePath = await workspace(['visual.a'])
    const planRevision = resourceInventoryPlanRevision(
      await readBeeGameAssetManifest(workspacePath),
    )
    const transactions = await Promise.all(Array.from({ length: 8 }, () =>
      getOrCreateResourceInventoryTransaction({ workspacePath, planRevision }),
    ))
    expect(new Set(transactions.map(item => item.transactionId))).toHaveLength(1)
  })

  test('performs only one bounded match under concurrent replacement dispatches', async () => {
    const workspacePath = await workspace(['visual.a'])
    const manifest = await readBeeGameAssetManifest(workspacePath)
    const planRevision = resourceInventoryPlanRevision(manifest)
    const transaction = await getOrCreateResourceInventoryTransaction({ workspacePath, planRevision })
    let matches = 0
    const match = async () => {
      matches += 1
      await Promise.resolve()
      return clientFor({ 'visual.a': 'matched' }).matchRequirements({
        requirements: [{ requirementId: 'visual.a', profile: {
          dimensions: ['2D'], assetKinds: ['image'], usageTags: [], capabilities: [], styles: [],
        } }],
        deliveryCapabilities: directPng,
      })
    }
    const observations = await Promise.all(Array.from({ length: 8 }, () =>
      getOrCreateResourceMatchObservation({
        workspacePath,
        transactionId: transaction.transactionId,
        planRevision,
        match,
      }),
    ))
    expect(matches).toBe(1)
    expect(new Set(observations.map(item => item.observedAt))).toHaveLength(1)
  })

  test('reconciles an exact orphan file left before the canonical manifest publication', async () => {
    const workspacePath = await workspace(['visual.a'])
    const client = clientFor({ 'visual.a': 'matched' })
    await observe(workspacePath, client)
    const bytes = new Uint8Array(compactPlaceholderPng('cyan'))
    const orphanPath = join(workspacePath, 'assets/runtime/library/visual.a')
    await mkdir(join(workspacePath, 'assets/runtime/library'), { recursive: true })
    await writeFile(orphanPath, bytes)
    await expect(commitResourceInventory({
      workspacePath,
      dispatchId: 'dispatch-a',
      client,
      provisionalAdapters: [],
      fetchImpl: async () => new Response(bytes),
      input: { decisions: [library('visual.a')] },
      assertMutationAuthority: async () => undefined,
    })).resolves.toEqual(expect.objectContaining({ state: 'committed' }))
    expect((await readBeeGameAssetManifest(workspacePath)).resources.map(item => item.id)).toEqual([
      'library.visual.a',
    ])
  })

  test('refuses to commit without the current bounded-match transaction', async () => {
    const workspacePath = await workspace(['visual.a'])
    await expect(commitResourceInventory({
      workspacePath,
      dispatchId: 'dispatch-a',
      client: clientFor({ 'visual.a': 'matched' }),
      provisionalAdapters: [],
      fetchImpl: async () => new Response(new Uint8Array(compactPlaceholderPng('cyan'))),
      input: { decisions: [library('visual.a')] },
      assertMutationAuthority: async () => undefined,
    })).rejects.toThrow('requires the current bounded-match transaction')
  })

  test('binds multiple selected library resources to one requirement', async () => {
    const workspacePath = await workspace(['visual.a'])
    const client = clientFor({ 'visual.a': 'matched', 'visual.alternate': 'matched' })
    await observe(workspacePath, client)
    const alternate = {
      ...library('visual.a'),
      resourceId: 'library.visual.alternate',
      elementId: 'visual.alternate',
      destinationPath: 'assets/runtime/library/visual.alternate',
    }
    const result = await commitResourceInventory({
      workspacePath,
      dispatchId: 'dispatch-a',
      client,
      provisionalAdapters: [],
      fetchImpl: async () => new Response(new Uint8Array(compactPlaceholderPng('cyan'))),
      input: { decisions: [library('visual.a'), alternate] },
      assertMutationAuthority: async () => undefined,
    })
    expect(result.bindings).toEqual([{
      requirementId: 'visual.a',
      resourceIds: ['library.visual.a', 'library.visual.alternate'],
    }])
  })

  test('reuses one acquired resource across multiple requirement bindings', async () => {
    const workspacePath = await workspace(['visual.a', 'visual.b'])
    const client = clientFor({ 'visual.a': 'matched', 'visual.b': 'matched' })
    await observe(workspacePath, client)
    const shared = library('visual.a')
    const result = await commitResourceInventory({
      workspacePath,
      dispatchId: 'dispatch-a',
      client,
      provisionalAdapters: [],
      fetchImpl: async () => new Response(new Uint8Array(compactPlaceholderPng('cyan'))),
      input: { decisions: [shared, { ...shared, requirementId: 'visual.b' }] },
      assertMutationAuthority: async () => undefined,
    })
    expect(result.bindings).toEqual([
      { requirementId: 'visual.a', resourceIds: ['library.visual.a'] },
      { requirementId: 'visual.b', resourceIds: ['library.visual.a'] },
    ])
    expect((await readBeeGameAssetManifest(workspacePath)).resources).toHaveLength(1)
  })

  test('rejects a structurally corrupted durable receipt instead of replaying it', async () => {
    const workspacePath = await workspace(['visual.a'])
    const client = clientFor({ 'visual.a': 'matched' })
    await observe(workspacePath, client)
    const input = { decisions: [library('visual.a')] } as const
    await expect(commitResourceInventory({
      workspacePath, dispatchId: 'dispatch-a', client,
      provisionalAdapters: [],
      fetchImpl: async () => new Response('failed', { status: 503 }), input,
      assertMutationAuthority: async () => undefined,
    })).rejects.toThrow('visual.a')
    const receiptRoot = join(workspacePath, '.beegame/workflow/resource-inventory-commits')
    const [receiptName] = (await readdir(receiptRoot)).filter(name => name.endsWith('.json'))
    const receiptPath = join(receiptRoot, receiptName!)
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    receipt.bindings = [{ requirementId: 'unrelated', resourceIds: ['library.visual.a'] }]
    await writeFile(receiptPath, JSON.stringify(receipt))

    await expect(commitResourceInventory({
      workspacePath, dispatchId: 'dispatch-a', client,
      provisionalAdapters: [],
      fetchImpl: async () => new Response(new Uint8Array(compactPlaceholderPng('cyan'))), input,
      assertMutationAuthority: async () => undefined,
    })).rejects.toThrow('Resource inventory receipt is invalid')
  })

  test('rejects a changed decision set instead of creating a second prepared receipt', async () => {
    const workspacePath = await workspace(['visual.a'])
    const client = clientFor({ 'visual.a': 'matched' })
    await observe(workspacePath, client)
    await expect(commitResourceInventory({
      workspacePath,
      dispatchId: 'dispatch-a',
      client,
      provisionalAdapters: [],
      fetchImpl: async () => new Response('failed', { status: 503 }),
      input: { decisions: [library('visual.a')] },
      assertMutationAuthority: async () => undefined,
    })).rejects.toThrow('visual.a')
    await expect(commitResourceInventory({
      workspacePath,
      dispatchId: 'dispatch-b',
      client,
      provisionalAdapters: [],
      fetchImpl: async () => new Response(libraryBytes),
      input: { decisions: [{ ...library('visual.a'), destinationPath: 'assets/runtime/changed' }] },
      assertMutationAuthority: async () => undefined,
    })).rejects.toThrow('does not match the current frozen decision set')
    expect((await readdir(join(workspacePath, '.beegame/workflow/resource-inventory-commits'))).filter(name => name.endsWith('.json'))).toHaveLength(1)
  })
})

const directPng = [{ sourceFormat: 'png', disposition: 'direct' as const, targetFormat: 'png', adapterId: 'direct-png' }]
const libraryBytes = new Uint8Array(compactPlaceholderPng('cyan'))
const libraryHash = createHash('sha256').update(libraryBytes).digest('hex')

function placeholder(requirementId: string) {
  return {
    requirementId, kind: 'placeholder' as const,
    resourceId: `placeholder.${requirementId}`, format: 'png',
    reason: 'The current catalog revision has no classified match.',
    selectionReason: ['Service-proven no-match for the current catalog revision.'],
    assetKind: 'image', destinationPath: `assets/runtime/placeholders/${requirementId}.png`,
  }
}

function library(requirementId: string) {
  return {
    requirementId, kind: 'library' as const, resourceId: `library.${requirementId}`,
    packId: 'pack-a', expectedPackVersion: '1.0.0', elementId: requirementId,
    selectionReason: ['Selected from the bounded structured match.'],
    destinationPath: `assets/runtime/library/${requirementId}`,
  }
}

function clientFor(
  statuses: Record<string, 'matched' | 'no-match'>,
  onMatch: () => void = () => undefined,
): ProjectResourceSelectionClient {
  return {
    matchRequirements: async request => {
      onMatch()
      return {
        catalogRevision: 'revision-a',
        groups: request.requirements.map(requirement => ({
          requirementId: requirement.requirementId,
          status: statuses[requirement.requirementId] ?? 'no-match',
          candidates: statuses[requirement.requirementId] === 'matched'
            ? Object.entries(statuses).filter(([, status]) => status === 'matched').map(([elementId]) => ({
                packId: 'pack-a', packVersion: '1.0.0', packName: 'Pack', packStyles: [], packGameTypes: [],
                elementId, elementName: elementId,
                elementPath: `${elementId}.png`, category: 'textures', usageTags: [],
                dimension: '2D' as const, assetKind: 'image' as const, capabilities: [], relations: [], dependencyCount: 0,
                delivery: directPng[0]!,
              }))
            : [],
          unclassifiedElementCount: 0,
        })),
      }
    },
    resolveResources: async (_catalogRevision, selections) => selections.map(selection => ({
      resourceId: selection.resourceId, packId: selection.packId,
      packVersion: selection.expectedPackVersion, elementId: selection.elementId,
      elementPath: `${selection.elementId}.png`, sourceUrl: `https://resource.invalid/${selection.elementId}`,
      sourceHash: libraryHash,
      selectionReason: selection.selectionReason, assetKind: 'image', dependencies: [],
    })),
  }
}

async function workspace(requirementIds: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'beegame-inventory-commit-'))
  roots.push(root)
  await writeBeeGameAssetManifest(root, {
    version: 8,
    project_target: {
      asset_format_capabilities: ['png'], resource_library_usage: 'preferred',
      runtime_asset_root: 'assets/runtime', content_root: 'assets/content', generated_asset_root: 'assets/generated',
    },
    requirements: requirementIds.map(id => ({ id, required: true, acquisition_profile: {
      dimensions: ['2D'], asset_kinds: ['image'], usage_tags: [], capabilities: [], styles: [],
    } })),
    resources: [],
  })
  return root
}

async function observe(
  workspacePath: string,
  client: ProjectResourceSelectionClient,
): Promise<void> {
  const manifest = await readBeeGameAssetManifest(workspacePath)
  const planRevision = resourceInventoryPlanRevision(manifest)
  const transaction = await getOrCreateResourceInventoryTransaction({
    workspacePath,
    planRevision,
  })
  await getOrCreateResourceMatchObservation({
    workspacePath,
    transactionId: transaction.transactionId,
    planRevision,
    match: () => client.matchRequirements({
      requirements: manifest.requirements.map(requirement => ({
        requirementId: requirement.id,
        profile: {
          dimensions: requirement.acquisition_profile.dimensions,
          assetKinds: requirement.acquisition_profile.asset_kinds,
          usageTags: requirement.acquisition_profile.usage_tags,
          capabilities: requirement.acquisition_profile.capabilities,
          styles: requirement.acquisition_profile.styles,
        },
      })),
      deliveryCapabilities: directPng,
    }),
  })
}
