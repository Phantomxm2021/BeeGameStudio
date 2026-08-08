import { describe, expect, test } from 'bun:test'
import {
  ResourceSemanticDecisionError,
  assertResourceSemanticVisualDecision,
  assertResourceSemanticVisualInput,
  applyResourceSemanticDecision,
  parseResourceSemanticModelDecision,
} from '../semantic-curation'
import type { ResourceElement } from '../types'
import type { ResourceSemanticModelDecision } from '../semantic-curation'

const contentHash = 'a'.repeat(64)

  const decision = (overrides: Record<string, unknown> = {}) => ({
  element_id: 'element-1',
  source_content_hash: contentHash,
  usageTags: ['terrain', 'environment'],
  confidence: 'high',
  evidence: [{
    source: 'content_profile',
    reference: 'components:mesh:0',
    observation: 'The inspected logical asset contains a mesh component.',
  }],
  curator_revision: 'semantic-curator-v1',
  ...overrides,
})

describe('canonical resource semantic decisions', () => {
  test('normalizes a supported high-confidence decision deterministically', () => {
    const parsed = parseResourceSemanticModelDecision(decision({ usageTags: ['environment', 'terrain', 'environment'] }))

    expect(parsed.usageTags).toEqual(['environment', 'terrain'])
    expect(parsed.sourceContentHash).toBe(contentHash)
    expect(parsed.elementId).toBe('element-1')
    expect(parsed.confidence).toBe('high')
  })

  test('rejects a role that confuses a texture asset kind with a usage tag', () => {
    expect(() => parseResourceSemanticModelDecision(decision({ usageTags: ['texture'] }))).toThrow(
      'usageTags must contain only canonical semantic roles',
    )
  })

  test('rejects malformed hashes and unsupported evidence', () => {
    expect(() => parseResourceSemanticModelDecision(decision({ source_content_hash: 'stale' }))).toThrow(
      ResourceSemanticDecisionError,
    )
    expect(() => parseResourceSemanticModelDecision(decision({ evidence: [{ source: 'filename', reference: 'tree', observation: 'tree' }] }))).toThrow(
      'evidence source is unsupported',
    )
  })

  test('requires non-empty evidence for every accepted model decision', () => {
    expect(() => parseResourceSemanticModelDecision(decision({ evidence: [] }))).toThrow(
      'evidence must contain at least one item',
    )
  })

  test('rejects an empty semantic tag decision before persistence', () => {
    expect(() => parseResourceSemanticModelDecision(decision({ usageTags: [] }))).toThrow(
      'usageTags must contain at least one canonical semantic role',
    )

    expect(() => applyResourceSemanticDecision({
      id: 'element-1', packId: 'pack-1', name: 'Asset', path: 'asset.png', category: 'textures', kind: 'image',
      specs: { contentHash }, usageTagsMode: 'inherit', dependencies: [], status: 'ready',
    }, {
      elementId: 'element-1', sourceContentHash: contentHash, usageTags: [], confidence: 'high', evidence: [{
        source: 'content_preview', reference: 'element-1', observation: 'The rendered preview was inspected.',
      }], curatorRevision: 'semantic-curator-v1',
    } as ResourceSemanticModelDecision)).toThrow(
      'usageTags must contain at least one canonical semantic role',
    )
  })

  test('requires the visual input mode to match the complete batch', () => {
    const individual = {
      mode: 'individual' as const,
      images: [{ elementId: 'element-1', mediaType: 'image/jpeg' as const, dataBase64: 'rendered' }],
    }
    expect(() => assertResourceSemanticVisualInput(individual, new Set(['element-1']))).not.toThrow()
    expect(() => assertResourceSemanticVisualInput(individual, new Set(['element-1', 'element-2', 'element-3']))).toThrow(
      'individual visual input requires one or two elements',
    )

    const atlas = {
      mode: 'atlas' as const,
      image: { mediaType: 'image/jpeg' as const, dataBase64: 'rendered-atlas' },
      cells: [
        { ordinal: 0, elementId: 'element-1' },
        { ordinal: 1, elementId: 'element-2' },
        { ordinal: 2, elementId: 'element-3' },
      ],
    }
    expect(() => assertResourceSemanticVisualInput(atlas, new Set(['element-1', 'element-2', 'element-3']))).not.toThrow()
    expect(() => assertResourceSemanticVisualInput(atlas, new Set(['element-1']))).toThrow(
      'Atlas visual input requires more than two elements',
    )
  })

  test('requires rendered preview evidence for every visual semantic decision', () => {
    const parsed = parseResourceSemanticModelDecision(decision())
    expect(() => assertResourceSemanticVisualDecision(parsed)).toThrow('content_preview')

    const visual = parseResourceSemanticModelDecision(decision({
      evidence: [{
        source: 'content_preview',
        reference: 'element-1',
        observation: 'The rendered preview shows a tower-like mesh.',
      }],
    }))
    expect(() => assertResourceSemanticVisualDecision(visual)).not.toThrow()
  })

  test('requires the stable element identity and curator revision', () => {
    expect(() => parseResourceSemanticModelDecision(decision({ element_id: '' }))).toThrow('element_id must be a non-empty string')
    expect(() => parseResourceSemanticModelDecision(decision({ curator_revision: '' }))).toThrow('curator_revision must be a non-empty string')
  })

  test('full analysis replaces existing AI tags with the latest decision', () => {
    const parsed = parseResourceSemanticModelDecision(decision({ usageTags: ['building'] }))
    const result = applyResourceSemanticDecision({
      id: 'element-1', packId: 'pack-1', name: 'Asset', path: 'asset.glb', category: 'models', kind: 'model',
      specs: { contentHash }, usageTags: ['environment'], usageTagsMode: 'override', dependencies: [], status: 'ready',
    }, parsed, { replaceExisting: true })

    expect(result.outcome).toBe('committed')
    expect(result.element.usageTags).toEqual(['building'])
  })

  test('commits medium and low confidence decisions through the canonical tag path', () => {
    for (const confidence of ['medium', 'low'] as const) {
      const parsed = parseResourceSemanticModelDecision(decision({ confidence }))
      const result = applyResourceSemanticDecision({
        id: 'element-1', packId: 'pack-1', name: 'Asset', path: 'asset.glb', category: 'models', kind: 'model',
        specs: { contentHash }, usageTagsMode: 'inherit', dependencies: [], status: 'ready',
      }, parsed)
      expect(result.outcome).toBe('committed')
      expect(result.element.usageTags).toEqual(['environment', 'terrain'])
    }
  })

  test('never analyzes or changes a manual-only element', () => {
    const parsed = parseResourceSemanticModelDecision(decision({ usageTags: ['building'] }))
    const element: ResourceElement = {
      id: 'element-1', packId: 'pack-1', name: 'Asset', path: 'asset.glb', category: 'models', kind: 'model' as const,
      specs: { contentHash }, usageTags: ['environment' as const], usageTagsMode: 'manual-only' as const, dependencies: [], status: 'ready',
    }

    const result = applyResourceSemanticDecision(element, parsed, { replaceExisting: true })

    expect(result.outcome).toBe('skipped')
    expect(result.element).toEqual(element)
  })
})
