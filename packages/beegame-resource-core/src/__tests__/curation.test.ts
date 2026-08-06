import { describe, expect, test } from 'bun:test'
import {
  buildResourceSemanticSuggestion,
  confirmSemanticSuggestion,
  rejectSemanticSuggestion,
  resolveEffectiveResourceMetadata,
} from '../metadata-policy'
import type { ResourceElement, ResourceFolder, ResourcePack, ResourceSemanticSuggestion } from '../types'

const pack: ResourcePack = {
  id: 'pack', name: 'Pack', styles: ['stylized'], gameTypes: [], dimension: '3D',
  primaryCategory: '3d-assets', categories: ['models'], license: 'internal', version: '1.0.0', status: 'published',
  elementDefaults: { usageTags: ['prop'] },
}

const folder: ResourceFolder = {
  id: 'folder', packId: 'pack', name: 'Buildings', path: 'Buildings',
  elementDefaults: { usageTags: ['building'] },
}

const element: ResourceElement = {
  id: 'element', packId: 'pack', name: 'element', path: 'Buildings/element.glb',
  category: 'models', kind: 'model', assetKind: 'model', specs: {}, dependencies: [], status: 'ready',
}

const suggestion = (overrides: Partial<ResourceSemanticSuggestion> = {}): ResourceSemanticSuggestion => ({
  usageTags: [], styles: [], relations: [], evidence: ['confirmed inherited policy'], confidence: 'medium',
  generatedAt: '2026-01-01T00:00:00.000Z', generatorRevision: 'test', ...overrides,
})

describe('canonical resource curation', () => {
  test('keeps a pending semantic suggestion out of effective tags', () => {
    const pending = { ...element, semanticSuggestion: suggestion({ usageTags: ['building'] }) }
    expect(resolveEffectiveResourceMetadata(pack, [], pending).usageTags).toEqual(['prop'])
  })

  test('confirms a suggestion into the only searchable semantic field', () => {
    const pending = { ...element, semanticSuggestion: suggestion({ usageTags: ['building'] }) }
    const confirmed = confirmSemanticSuggestion(pending, { usageTags: ['building'] })
    expect(confirmed).toMatchObject({ usageTags: ['building'], usageTagsMode: 'override' })
    expect(confirmed.semanticSuggestion).toBeUndefined()
  })

  test('rejects a suggestion without changing confirmed metadata', () => {
    const pending = {
      ...element,
      usageTags: ['prop'] as const,
      usageTagsMode: 'override' as const,
      semanticSuggestion: suggestion({ usageTags: ['building'] }),
    }
    expect(rejectSemanticSuggestion(pending)).toMatchObject({ usageTags: ['prop'], usageTagsMode: 'override' })
    expect(rejectSemanticSuggestion(pending).semanticSuggestion).toBeUndefined()
  })

  test('builds a suggestion from confirmed folder policy without reading the filename', () => {
    const proposed = buildResourceSemanticSuggestion(pack, [folder], element, '2026-01-01T00:00:00.000Z', 'test')
    expect(proposed).toEqual(expect.objectContaining({ usageTags: ['building'], generatorRevision: 'test' }))
  })
})
