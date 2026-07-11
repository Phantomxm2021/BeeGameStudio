import { describe, expect, test } from 'bun:test'
import { evaluateResourcePackPublishReadiness } from '../publish-readiness'
import type { ResourceElement, ResourcePack } from '../types'

const pack: ResourcePack = {
  id: 'forest', name: 'Forest', style: 'Stylized', gameTypes: ['adventure'], dimension: '3D',
  primaryCategory: '3d-assets', categories: ['models'], license: 'internal', version: '1.0.0', status: 'draft',
}
const ready: ResourceElement = {
  id: 'tree', packId: 'forest', name: 'Tree', path: 'models/tree.glb', category: 'models', kind: 'model',
  specs: { size: 1024, mimeType: 'model/gltf-binary' }, dependencies: [], status: 'ready',
}

describe('resource pack publish readiness', () => {
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
        { ...ready, id: 'binary', specs: { ...ready.specs, inspectionStatus: 'binary_fbx_requires_processor', previewStatus: 'failed', contentHash: 'same-content' } },
        { ...ready, id: 'copy', name: 'Tree Copy', path: 'models/tree-copy.glb', specs: { ...ready.specs, contentHash: 'same-content', size: 513 * 1024 * 1024 } },
      ],
    )
    expect(report.canPublish).toBe(true)
    expect(report.warnings.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'license_evidence_missing', 'model_inspection_incomplete', 'preview_failed', 'duplicate_content', 'file_size_large',
    ]))
  })
})
