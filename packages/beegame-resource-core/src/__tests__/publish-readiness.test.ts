import { describe, expect, test } from 'bun:test'
import { evaluateResourceElementSelectionReadiness, evaluateResourcePackPublishReadiness } from '../publish-readiness'
import type { ResourceElement, ResourcePack } from '../types'

const pack: ResourcePack = {
  id: 'forest', name: 'Forest',
  styles: ['Stylized'], gameTypes: ['adventure'], dimension: '3D',
  primaryCategory: '3d-assets', categories: ['models'], license: 'internal', version: '1.0.0', status: 'draft',
}
const ready: ResourceElement = {
  id: 'tree', packId: 'forest', name: 'Tree', path: 'models/tree.glb', category: 'models', kind: 'model',
  assetKind: 'model', contentProfile: { packaging: 'self-contained', components: [{ id: 'mesh:0', kind: 'mesh' }], inspection: { status: 'complete', source: 'server' } }, specs: { size: 1024, mimeType: 'model/gltf-binary', contentHash: 'a'.repeat(64) }, usageTags: ['environment'], dependencies: [], status: 'ready',
}

describe('resource pack publish readiness', () => {
  test('keeps a valid root selectable when an unrelated root is invalid', () => {
    const valid = evaluateResourceElementSelectionReadiness(pack, ready, [ready, { ...ready, id: 'invalid', specs: {} }])
    const invalid = evaluateResourceElementSelectionReadiness(pack, { ...ready, id: 'invalid', specs: {} }, [ready, { ...ready, id: 'invalid', specs: {} }])
    expect(valid.selectionReady).toBe(true)
    expect(invalid.selectionReady).toBe(false)
  })

  test('isolates a root whose required dependency is not ready', () => {
    const root = { ...ready, dependencies: ['dependency'] }
    const dependency = { ...ready, id: 'dependency', status: 'failed' as const, usageTags: [] }
    const report = evaluateResourceElementSelectionReadiness(pack, root, [root, dependency])
    expect(report.selectionReady).toBe(false)
    expect(report.blocking.map(issue => issue.code)).toContain('dependency_not_ready')
  })

  test('allows a ready Pack with recorded license and version', () => {
    expect(evaluateResourcePackPublishReadiness(pack, [ready])).toEqual({ blocking: [], warnings: [], canPublish: true })
  })

  test('reports only concrete blocking repository facts', () => {
    const report = evaluateResourcePackPublishReadiness(
      { ...pack, license: 'unassigned', version: '' },
      [{ ...ready, dependencies: ['missing'], specs: { ...ready.specs, unresolvedTextureReferences: 'albedo.png' } }, { ...ready, id: 'duplicate' }],
    )
    expect(report.canPublish).toBe(false)
    expect(report.blocking.map((issue) => issue.code)).toEqual(expect.arrayContaining(['license_missing', 'version_missing', 'dependency_missing', 'unresolved_texture', 'duplicate_path']))
  })

  test('reports actionable non-blocking processing and governance warnings', () => {
    const report = evaluateResourcePackPublishReadiness(
      { ...pack, license: 'CC-BY-4.0' },
      [
        { ...ready, id: 'binary', specs: { ...ready.specs, inspectionStatus: 'binary_fbx_requires_processor', previewStatus: 'failed', contentHash: 'b'.repeat(64) } },
        { ...ready, id: 'copy', name: 'Tree Copy', path: 'models/tree-copy.glb', specs: { ...ready.specs, contentHash: 'b'.repeat(64), size: 513 * 1024 * 1024 } },
      ],
    )
    expect(report.canPublish).toBe(true)
    expect(report.warnings.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'license_evidence_missing', 'model_inspection_incomplete', 'preview_failed', 'duplicate_content', 'file_size_large',
    ]))
  })

  test('blocks publication when a ready element has no explicit semantic capability', () => {
    const report = evaluateResourcePackPublishReadiness(pack, [{ ...ready, usageTags: [] }])
    expect(report.canPublish).toBe(false)
    expect(report.blocking).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'usage_tags_missing', elementId: ready.id }),
    ]))
  })

  test('blocks publication when a ready root lacks immutable identity or typed asset identity', () => {
    const missingHash = evaluateResourcePackPublishReadiness(pack, [{
      ...ready,
      specs: { size: 1024, mimeType: 'model/gltf-binary' },
    }])
    expect(missingHash.blocking).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'content_hash_missing', elementId: ready.id }),
    ]))

    const missingKind = evaluateResourcePackPublishReadiness(pack, [{
      ...ready,
      assetKind: undefined,
    }])
    expect(missingKind.blocking).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'asset_kind_missing', elementId: ready.id }),
    ]))
  })

  test('does not require semantic usage tags on dependency-only files', () => {
    const report = evaluateResourcePackPublishReadiness(pack, [{
      ...ready,
      dependencies: ['texture'],
      dependencyBindings: [{ referencePath: 'Textures/base.png', dependencyElementId: 'texture' }],
    }, {
      ...ready,
      id: 'texture',
      name: 'base.png',
      path: 'Textures/base.png',
      kind: 'image',
      assetKind: 'image',
      contentProfile: undefined,
      usageTags: [],
    }])

    expect(report.blocking.map(issue => issue.code)).not.toContain('usage_tags_missing')
  })

  test('requires each detected external reference to be mapped to a ready dependency', () => {
    const dependent = {
      ...ready,
      specs: { ...ready.specs, externalReferences: JSON.stringify(['materials/paint.bin']) },
      dependencies: ['paint'],
    }
    const report = evaluateResourcePackPublishReadiness(pack, [dependent, { ...ready, id: 'paint', path: 'materials/paint.bin' }])
    expect(report.blocking).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'external_dependency_unmapped', elementId: ready.id }),
    ]))

    const resolved = evaluateResourcePackPublishReadiness(pack, [{ ...dependent, dependencyBindings: [{ referencePath: 'materials/paint.bin', dependencyElementId: 'paint' }] }, { ...ready, id: 'paint', path: 'materials/paint.bin' }])
    expect(resolved.blocking.map(issue => issue.code)).not.toContain('external_dependency_unmapped')
  })

  test('compares exporter references and mappings using portable normalized paths', () => {
    const report = evaluateResourcePackPublishReadiness(pack, [{
      ...ready,
      specs: {
        ...ready.specs,
        externalReferences: JSON.stringify(['Textures\\paint.png']),
        unresolvedTextureReferences: 'Textures\\paint.png',
      },
      dependencies: ['paint'],
      dependencyBindings: [{ referencePath: 'Textures/paint.png', dependencyElementId: 'paint' }],
    }, { ...ready, id: 'paint', path: 'Textures/paint.png' }])

    expect(report.blocking.map(issue => issue.code)).not.toContain('external_dependency_unmapped')
    expect(report.blocking.map(issue => issue.code)).not.toContain('unresolved_texture')
  })

  test('blocks a required semantic relation whose target is missing or not ready', () => {
    const report = evaluateResourcePackPublishReadiness(pack, [{
      ...ready,
      id: 'run',
      assetKind: 'animation-clip',
      relations: [{ kind: 'animation-for', targetElementId: 'hero-rig', required: true }],
    }])
    expect(report.blocking).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'semantic_relation_missing', elementId: 'run' }),
    ]))
  })
})
