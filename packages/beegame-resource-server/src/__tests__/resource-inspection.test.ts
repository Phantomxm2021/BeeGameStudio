import { describe, expect, test } from 'bun:test'
import { inspectUploadedResource } from '../resource-inspection'

describe('resource inspection', () => {
  test('reads PNG dimensions without decoding the image', async () => {
    const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71], 0); new DataView(bytes.buffer).setUint32(16, 512); new DataView(bytes.buffer).setUint32(20, 256)
    await expect(inspectUploadedResource(new File([bytes], 'atlas.png', { type: 'image/png' }))).resolves.toEqual(expect.objectContaining({ width: 512, height: 256, contentHash: expect.any(String) }))
  })

  test('reads GLTF mesh, material, and external texture facts', async () => {
    const document = { accessors: [{ count: 12 }, { count: 36 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }], materials: [{}], images: [{ uri: 'textures/tree.png' }] }
    const file = new File([JSON.stringify(document)], 'tree.gltf', { type: 'model/gltf+json' })
    await expect(inspectUploadedResource(file)).resolves.toEqual(expect.objectContaining({ vertices: 12, triangles: 12, materialCount: 1, embeddedTextureCount: 1, textureReferences: 'textures/tree.png', contentHash: expect.any(String) }))
  })

  test('extracts OBJ geometry and its external material library without guessing textures', async () => {
    const file = new File(['mtllib props.mtl\nusemtl wood\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4'], 'crate.obj')
    await expect(inspectUploadedResource(file)).resolves.toEqual(expect.objectContaining({ vertices: 4, triangles: 2, materialCount: 1, materialReferences: 'props.mtl', contentHash: expect.any(String) }))
  })

  test('extracts deterministic ASCII FBX mesh and texture references', async () => {
    const file = new File(['; FBX 7.4.0\nVertices: *9 { a: 0,0,0,1,0,0,0,1,0 }\nPolygonVertexIndex: *3 { a: 0,1,-3 }\nMaterial::Wood, ""\nRelativeFilename: "textures/wood.png"'], 'crate.fbx')
    await expect(inspectUploadedResource(file)).resolves.toEqual(expect.objectContaining({ vertices: 3, triangles: 1, materialCount: 1, embeddedTextureCount: 0, textureReferences: 'textures/wood.png', contentHash: expect.any(String) }))
  })

  test('reports binary FBX as needing a dedicated processor instead of inventing metadata', async () => {
    await expect(inspectUploadedResource(new File(['Kaydara FBX Binary  \0\x1a\0'], 'binary.fbx'))).resolves.toEqual(expect.objectContaining({ inspectionStatus: 'binary_fbx_requires_processor', contentHash: expect.any(String) }))
  })
})
