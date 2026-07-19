import { describe, expect, test } from 'bun:test'
import { createSubprocessModelProcessor } from '../model-processing'
import { inspectAssimpDocument } from '../model-processor-worker'

describe('isolated model processing', () => {
  test('extracts objective geometry, rig, animation, material, and dependency facts', () => {
    const facts = inspectAssimpDocument({
      rootnode: { children: [{ children: [] }] },
      meshes: [{ vertices: [-1, 0, 0, 1, 0, 0, 0, 2, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], texturecoords: [[0, 0, 0, 1, 0, 0, 0.5, 1, 0]], faces: [[0, 1, 2]], bones: [{ name: 'joint' }], animmeshes: [{}] }],
      animations: [{}],
      materials: [{ properties: [{ key: '$tex.file', value: 'Textures/base.png' }] }],
      textures: [{}],
    })
    expect(facts).toEqual(expect.objectContaining({
      vertices: 3,
      triangles: 1,
      meshCount: 1,
      skinCount: 1,
      skinnedMeshCount: 1,
      animationCount: 1,
      materialCount: 1,
      embeddedTextureCount: 1,
      morphTargetCount: 1,
      sceneNodeCount: 2,
      hasNormals: true,
      hasTextureCoordinates: true,
      boundsMinX: -1,
      boundsMaxY: 2,
      boundsSizeX: 2,
      inspectionStatus: 'complete',
      externalReferences: '["Textures/base.png"]',
    }))
  })

  test('runs Assimp in a child process instead of the resource API process', async () => {
    const processor = createSubprocessModelProcessor({ timeoutMs: 30_000 })
    const file = new File([
      'v 0 0 0\n',
      'v 1 0 0\n',
      'v 0 1 0\n',
      'f 1 2 3\n',
    ], 'triangle.obj', { type: 'text/plain' })
    await expect(processor(file)).resolves.toEqual(expect.objectContaining({
      vertices: 3,
      triangles: 1,
      meshCount: 1,
      inspectionStatus: 'complete',
      processor: 'assimpjs',
    }))
  }, 35_000)
})
