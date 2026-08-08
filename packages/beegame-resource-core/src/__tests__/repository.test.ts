import { describe, expect, test } from 'bun:test'
import {
  createInMemoryResourceRepository,
  type ResourceElement,
  type ResourcePack,
} from '../repository'
import type { ResourceSemanticModelDecision } from '../semantic-curation'

const pack: ResourcePack = {
  id: 'pack-1',
  name: 'Example Pack',
  styles: ['Stylized'],
  gameTypes: ['adventure'],
  dimension: '2D',
  primaryCategory: 'ui-kit',
  categories: ['sprites', 'ui'],
  license: 'internal',
  version: '1.0.0',
  status: 'published',
}

const element: ResourceElement = {
  id: 'element-1',
  packId: 'pack-1',
  name: 'Character Idle',
  path: 'characters/idle.png',
  category: 'sprites',
  kind: 'sprite-sheet',
  preview: { kind: 'image', path: 'previews/idle.png' },
  specs: { width: 256, height: 256, frames: 4, contentHash: 'a'.repeat(64) },
  assetKind: 'sprite-sheet',
  usageTags: ['character'],
  dependencies: [],
  status: 'ready',
}

describe('in-memory resource repository', () => {
  test('commits high-confidence semantic tags without changing technical facts', async () => {
    const repository = createInMemoryResourceRepository({
      packs: [pack],
      elements: [{ ...element, usageTags: undefined, usageTagsMode: 'inherit', specs: { ...element.specs, width: 512 } }],
    })
    const decision: ResourceSemanticModelDecision = {
      elementId: 'element-1', sourceContentHash: 'a'.repeat(64), usageTags: ['ui'], confidence: 'high',
      evidence: [{ source: 'content_preview', reference: 'preview:0', observation: 'The preview shows a user-interface element.' }],
      curatorRevision: 'semantic-curator-v1',
    }

    const result = await repository.commitSemanticDecision!('pack-1', decision)
    const stored = await repository.getElement('pack-1', 'element-1')

    expect(result.outcome).toBe('committed')
    expect(result.receiptId).toContain('element-1')
    expect(stored).toEqual(expect.objectContaining({ usageTags: ['ui'], usageTagsMode: 'override', assetKind: 'sprite-sheet', specs: expect.objectContaining({ width: 512 }) }))
  })

  test('applies every AI usage tag regardless of confidence', async () => {
    const repository = createInMemoryResourceRepository({
      packs: [pack],
      elements: [{ ...element, usageTags: undefined, usageTagsMode: 'inherit' }],
    })
    const decision: ResourceSemanticModelDecision = {
      elementId: 'element-1', sourceContentHash: 'a'.repeat(64), usageTags: ['ui'], confidence: 'medium',
      evidence: [{ source: 'technical_facts', reference: 'mimeType', observation: 'The inspected format is an image.' }],
      curatorRevision: 'semantic-curator-v1',
    }

    const result = await repository.commitSemanticDecision!('pack-1', decision)
    const stored = await repository.getElement('pack-1', 'element-1')

    expect(result.outcome).toBe('committed')
    expect(stored).toEqual(expect.objectContaining({ usageTags: ['ui'], usageTagsMode: 'override' }))
  })

  test('rejects a semantic decision when the content hash is stale', async () => {
    const repository = createInMemoryResourceRepository({ packs: [pack], elements: [element] })
    const decision: ResourceSemanticModelDecision = {
      elementId: 'element-1', sourceContentHash: 'c'.repeat(64), usageTags: ['ui'], confidence: 'high',
      evidence: [{ source: 'content_profile', reference: 'components:0', observation: 'A component is present.' }],
      curatorRevision: 'semantic-curator-v1',
    }

    await expect(repository.commitSemanticDecision!('pack-1', decision)).rejects.toThrow('content hash is stale')
  })

  test('lists Pack summaries with element counts', async () => {
    const repository = createInMemoryResourceRepository({ packs: [pack], elements: [element] })
    await expect(repository.listPacks()).resolves.toEqual([
      { ...pack, elementCount: 1 },
    ])
  })

  test('lists elements by Pack and category', async () => {
    const repository = createInMemoryResourceRepository({ packs: [pack], elements: [element] })
    await expect(repository.listElements('pack-1', 'sprites')).resolves.toEqual([
      { ...element, usageTagsMode: 'override', usageTagsSource: 'element' },
    ])
    await expect(repository.listElements('pack-1', 'ui')).resolves.toEqual([])
  })

  test('does not resolve Pack or folder metadata into element semantics', async () => {
    const repository = createInMemoryResourceRepository({
      packs: [{ ...pack }],
      elements: [{ ...element, usageTags: undefined, usageTagsMode: 'inherit', path: 'characters/heroes/idle.png' }],
    })
    await repository.createFolder('pack-1', { id: 'characters', name: 'characters' })
    await repository.createFolder('pack-1', { id: 'heroes', name: 'heroes', parentId: 'characters' })

    await expect(repository.getElement('pack-1', 'element-1')).resolves.toEqual(expect.objectContaining({
      usageTags: [], usageTagsMode: 'inherit', usageTagsSource: 'none', kind: 'sprite-sheet',
    }))
  })

  test('lists unclassified elements for semantic curation instead of treating them as confirmed', async () => {
    const repository = createInMemoryResourceRepository({
      packs: [{ ...pack }],
      elements: [{ ...element, usageTags: undefined, usageTagsMode: 'inherit' }],
    })

    const queue = await repository.listCuration!('pack-1')

    expect(queue.items.map(item => item.id)).toEqual(['element-1'])
    expect(queue.counts.missingSemanticTags).toBe(1)
  })

  test('does not treat an empty override tag set as confirmed semantic metadata', async () => {
    const repository = createInMemoryResourceRepository({
      packs: [{ ...pack }],
      elements: [{ ...element, usageTags: [], usageTagsMode: 'override' }],
    })

    const queue = await repository.listCuration!('pack-1')

    expect(queue.items.map(item => item.id)).toEqual(['element-1'])
    expect(queue.counts.missingSemanticTags).toBe(1)
  })

  test('excludes an untagged dependency-only element from semantic curation', async () => {
    const repository = createInMemoryResourceRepository({
      packs: [{ ...pack }],
      elements: [
        { ...element, usageTags: [], usageTagsMode: 'override' },
        { ...element, id: 'model-1', name: 'Model', path: 'models/model.glb', category: 'models', kind: 'model', assetKind: 'model', dependencies: ['element-1'], usageTags: ['prop'], usageTagsMode: 'override' },
      ],
    })

    const queue = await repository.listCuration!('pack-1')

    expect(queue.items.map(item => item.id)).toEqual([])
    expect(queue.counts.missingSemanticTags).toBe(0)
  })

  test('commits a high-confidence decision over unclassified element metadata', async () => {
    const repository = createInMemoryResourceRepository({
      packs: [{ ...pack }],
      elements: [{ ...element, usageTags: undefined, usageTagsMode: 'inherit' }],
    })
    const decision: ResourceSemanticModelDecision = {
      elementId: 'element-1', sourceContentHash: 'a'.repeat(64), usageTags: ['character'], confidence: 'high',
      evidence: [{ source: 'content_preview', reference: 'preview:0', observation: 'The preview shows a character.' }],
      curatorRevision: 'semantic-curator-v1',
    }

    await expect(repository.commitSemanticDecision!('pack-1', decision)).resolves.toEqual(expect.objectContaining({ outcome: 'committed' }))
    await expect(repository.getElement('pack-1', 'element-1')).resolves.toEqual(expect.objectContaining({ usageTags: ['character'], usageTagsMode: 'override', usageTagsSource: 'element' }))
  })

  test('returns undefined for an unknown Pack', async () => {
    const repository = createInMemoryResourceRepository({ packs: [pack], elements: [element] })
    await expect(repository.getPack('missing')).resolves.toBeUndefined()
  })

  test('deletes a Pack with its elements and folders', async () => {
    const repository = createInMemoryResourceRepository({ packs: [pack], elements: [element] })
    await repository.createFolder('pack-1', { id: 'folder-1', name: 'models' })

    await expect(repository.deletePack('pack-1')).resolves.toBe(true)
    await expect(repository.getPack('pack-1')).resolves.toBeUndefined()
    await expect(repository.listElements('pack-1')).resolves.toEqual([])
    await expect(repository.listFolders('pack-1')).resolves.toEqual([])
  })

  test('treats an already deleted Pack as absent', async () => {
    const repository = createInMemoryResourceRepository({ packs: [], elements: [] })

    await expect(repository.deletePack('missing')).resolves.toBe(false)
  })

  test('reactivates an archived Pack by publishing it and clears its archive marker', async () => {
    const archivedAt = '2026-07-12T00:00:00.000Z'
    const repository = createInMemoryResourceRepository({
      packs: [{ ...pack, status: 'archived', deprecatedAt: archivedAt }],
      elements: [element],
    })

    const published = await repository.publishPack(pack.id)

    expect(published).toEqual({ ...pack, status: 'published' })
    const stored = await repository.getPack(pack.id)
    expect(stored).toEqual(expect.objectContaining({ ...pack, status: 'published' }))
    expect(stored).not.toHaveProperty('deprecatedAt')
  })

  test('recursively deletes a folder with nested folders and elements', async () => {
    const repository = createInMemoryResourceRepository({
      packs: [pack],
      elements: [
        element,
        { ...element, id: 'element-2', name: 'Tree', path: 'characters/forest/tree.png' },
        { ...element, id: 'element-3', name: 'UI', path: 'ui/button.png', category: 'ui' },
      ],
    })
    await repository.createFolder('pack-1', { id: 'characters', name: 'characters' })
    await repository.createFolder('pack-1', { id: 'forest', name: 'forest', parentId: 'characters' })
    await repository.createFolder('pack-1', { id: 'ui', name: 'ui' })

    await expect(repository.deleteFolder('pack-1', 'characters')).resolves.toBe(true)
    await expect(repository.listElements('pack-1')).resolves.toEqual([expect.objectContaining({ id: 'element-3' })])
    await expect(repository.listFolders('pack-1')).resolves.toEqual([expect.objectContaining({ id: 'ui' })])
  })
})
