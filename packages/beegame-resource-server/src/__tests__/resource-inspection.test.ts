import { describe, expect, test } from 'bun:test'
import { inspectUploadedResource } from '../resource-inspection'

describe('resource inspection', () => {
  test('reads PNG dimensions without decoding the image', async () => {
    const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71], 0); new DataView(bytes.buffer).setUint32(16, 512); new DataView(bytes.buffer).setUint32(20, 256)
    await expect(inspectUploadedResource(new File([bytes], 'atlas.png', { type: 'image/png' }))).resolves.toEqual({ width: 512, height: 256 })
  })

  test('reads GLTF mesh, material, and external texture facts', async () => {
    const document = { accessors: [{ count: 12 }, { count: 36 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }], materials: [{}], images: [{ uri: 'textures/tree.png' }] }
    const file = new File([JSON.stringify(document)], 'tree.gltf', { type: 'model/gltf+json' })
    await expect(inspectUploadedResource(file)).resolves.toEqual({ vertices: 12, triangles: 12, materialCount: 1, embeddedTextureCount: 1, textureReferences: 'textures/tree.png' })
  })
})
