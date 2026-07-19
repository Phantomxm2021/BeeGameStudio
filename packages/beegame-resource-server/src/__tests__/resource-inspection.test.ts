import { describe, expect, test } from 'bun:test'
import { contentProfileFromInspection, inspectUploadedResource } from '../resource-inspection'

describe('resource inspection', () => {
  test('reads PNG dimensions without decoding the image', async () => {
    const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71], 0); new DataView(bytes.buffer).setUint32(16, 512); new DataView(bytes.buffer).setUint32(20, 256)
    await expect(inspectUploadedResource(new File([bytes], 'atlas.png', { type: 'image/png' }))).resolves.toEqual(expect.objectContaining({ width: 512, height: 256, contentHash: expect.any(String) }))
  })

  test('reads GLTF mesh, material, and external texture facts', async () => {
    const document = { accessors: [{ count: 12, min: [-2, 0, -1], max: [2, 6, 1] }, { count: 36 }, { count: 12 }, { count: 12 }], meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 2, TEXCOORD_0: 3 }, indices: 1 }] }], skins: [{}], animations: [{}, {}], materials: [{}], images: [{ uri: 'textures/tree.png' }] }
    const file = new File([JSON.stringify(document)], 'tree.gltf', { type: 'model/gltf+json' })
    await expect(inspectUploadedResource(file)).resolves.toEqual(expect.objectContaining({ vertices: 12, triangles: 12, meshCount: 1, skinCount: 1, animationCount: 2, materialCount: 1, embeddedTextureCount: 0, hasNormals: true, hasTextureCoordinates: true, boundsMinX: -2, boundsMaxY: 6, boundsSizeZ: 2, textureReferences: 'textures/tree.png', contentHash: expect.any(String) }))
  })

  test('turns inspection facts into embedded subresources without creating repository elements', () => {
    const profile = contentProfileFromInspection({ meshCount: 1, skinCount: 1, animationCount: 3, materialCount: 2, externalReferences: JSON.stringify(['Textures/base.png']) })
    expect(profile.packaging).toBe('external-dependencies')
    expect(profile.components.filter(component => component.kind === 'animation-clip')).toHaveLength(3)
    expect(profile.components.filter(component => component.kind === 'skeleton')).toHaveLength(1)
  })

  test('does not turn glTF data URIs into external file dependencies', async () => {
    const file = new File([JSON.stringify({ meshes: [], images: [{ uri: 'data:image/png;base64,AA==' }], buffers: [{ uri: 'data:application/octet-stream;base64,AA==' }] })], 'embedded.gltf')
    const facts = await inspectUploadedResource(file)
    expect(facts.embeddedTextureCount).toBe(1)
    expect(facts.externalReferences).toBeUndefined()
  })

  test('extracts OBJ geometry and its external material library without guessing textures', async () => {
    const file = new File(['mtllib props.mtl\nusemtl wood\nv -1 0 0\nv 1 0 0\nv 1 2 0\nv -1 2 0\nvt 0 0\nvn 0 0 1\nf 1 2 3 4'], 'crate.obj')
    await expect(inspectUploadedResource(file)).resolves.toEqual(expect.objectContaining({ vertices: 4, triangles: 2, materialCount: 1, hasNormals: true, hasTextureCoordinates: true, boundsMinX: -1, boundsMaxY: 2, boundsSizeX: 2, materialReferences: 'props.mtl', contentHash: expect.any(String) }))
  })

  test('extracts deterministic ASCII FBX mesh and texture references', async () => {
    const file = new File(['; FBX 7.4.0\nVertices: *9 { a: -1,0,0,1,0,0,0,2,0 }\nPolygonVertexIndex: *3 { a: 0,1,-3 }\nNormals: *3 { a: 0,0,1 }\nUV: *2 { a: 0,0 }\nMaterial::Wood, ""\nRelativeFilename: "textures/wood.png"'], 'crate.fbx')
    await expect(inspectUploadedResource(file)).resolves.toEqual(expect.objectContaining({ vertices: 3, triangles: 1, materialCount: 1, embeddedTextureCount: 0, hasNormals: true, hasTextureCoordinates: true, boundsMinX: -1, boundsMaxY: 2, textureReferences: 'textures/wood.png', contentHash: expect.any(String) }))
  })

  test('reports binary FBX as needing a dedicated processor instead of inventing metadata', async () => {
    await expect(inspectUploadedResource(new File(['Kaydara FBX Binary  \0\x1a\0'], 'binary.fbx'))).resolves.toEqual(expect.objectContaining({ inspectionStatus: 'binary_fbx_requires_processor', contentHash: expect.any(String) }))
  })

  test('delegates binary FBX inspection to the configured isolated processor', async () => {
    const file = new File(['Kaydara FBX Binary  \0\x1a\0'], 'binary.fbx')
    await expect(inspectUploadedResource(file, {
      modelProcessor: async received => ({
        inspectionStatus: 'complete',
        processor: 'isolated-test',
        meshCount: received === file ? 2 : 0,
      }),
    })).resolves.toEqual(expect.objectContaining({ inspectionStatus: 'complete', processor: 'isolated-test', meshCount: 2 }))
  })
})
