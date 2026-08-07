import { describe, expect, test } from 'bun:test'
import { createSubprocessModelPreviewProcessor, createSubprocessModelProcessor } from '../model-processing'
import { extractAssimpPreviewGeometry, inspectAssimpDocument } from '../model-processor-worker'
import { renderResourceModelPreview } from '../model-preview'

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

  test('reports authored scene-space bounds after node transforms without inventing a unit scale', () => {
    const facts = inspectAssimpDocument({
      rootnode: {
        transformation: [
          1, 0, 0, 10,
          0, 1, 0, 20,
          0, 0, 1, 30,
          0, 0, 0, 1,
        ],
        meshes: [0],
        children: [],
      },
      meshes: [{ vertices: [-1, 0, 0, 1, 2, 3], faces: [], bones: [], animmeshes: [] }],
      animations: [],
      materials: [],
      textures: [],
    })

    expect(facts).toEqual(expect.objectContaining({
      boundsMinX: 9,
      boundsMinY: 20,
      boundsMinZ: 30,
      boundsMaxX: 11,
      boundsMaxY: 22,
      boundsMaxZ: 33,
      boundsSizeX: 2,
      boundsSizeY: 2,
      boundsSizeZ: 3,
      boundsCenterX: 10,
      boundsCenterY: 21,
      boundsCenterZ: 31.5,
      groundOffsetY: -20,
      centeringOffsetX: -10,
      centeringOffsetZ: -31.5,
    }))
    expect(facts).not.toHaveProperty('unitScale')
  })

  test('accepts object-shaped Assimp positions without losing bounds', () => {
    const facts = inspectAssimpDocument({
      rootnode: { meshes: [0], children: [] },
      meshes: [{ vertices: [{ x: -2, y: 1, z: -3 }, { x: 4, y: 5, z: 7 }], faces: [], bones: [], animmeshes: [] }],
      animations: [],
      materials: [],
      textures: [],
    })
    expect(facts).toEqual(expect.objectContaining({
      vertices: 2,
      boundsSizeX: 6,
      boundsSizeY: 4,
      boundsSizeZ: 10,
    }))
  })

  test('extracts a bounded engine-neutral preview geometry from Assimp output', () => {
    const geometry = extractAssimpPreviewGeometry({
      rootnode: { meshes: [0], children: [] },
      meshes: [{
        vertices: [-1, 0, 0, 1, 0, 0, 0, 2, 0],
        faces: [[0, 1, 2]],
      }],
    })

    expect(geometry).toEqual({
      meshes: [{
        vertices: [[-1, 0, 0], [1, 0, 0], [0, 2, 0]],
        faces: [[0, 1, 2]],
      }],
    })
  })

  test('renders model geometry into an image file for Atlas input', async () => {
    const preview = await renderResourceModelPreview({
      meshes: [{
        vertices: [[-1, 0, 0], [1, 0, 0], [0, 2, 0]],
        faces: [[0, 1, 2]],
      }],
    })

    expect(preview).toBeInstanceOf(File)
    expect(preview?.type).toBe('image/png')
    expect(preview?.size).toBeGreaterThan(0)
  })

  test('creates a model preview processor that returns a visual file', async () => {
    const processor = createSubprocessModelPreviewProcessor({ timeoutMs: 30_000 })
    const file = new File([
      'v 0 0 0\n',
      'v 1 0 0\n',
      'v 0 1 0\n',
      'f 1 2 3\n',
    ], 'triangle.obj', { type: 'text/plain' })

    await expect(processor(file)).resolves.toEqual(expect.objectContaining({
      type: 'image/png',
      size: expect.any(Number),
    }))
  }, 35_000)
})
