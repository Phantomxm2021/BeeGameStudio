import { describe, expect, test } from 'bun:test'
import { contentProfileFromInspection, inspectResourceBytes, inspectUploadedResource } from '../resource-inspection'

function wavFixture(values = [0, 1000, -1000, 500], sampleRate = 8000, channels = 2): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + values.length * 2), view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('RIFF'), 0); view.setUint32(4, bytes.length - 8, true); bytes.set(new TextEncoder().encode('WAVEfmt '), 8)
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); bytes.set(new TextEncoder().encode('data'), 36)
  view.setUint32(40, values.length * 2, true)
  values.forEach((value, index) => view.setInt16(44 + index * 2, value, true))
  return bytes
}

describe('resource inspection', () => {
  test('reads PNG dimensions without decoding the image', async () => {
    const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71], 0); new DataView(bytes.buffer).setUint32(16, 512); new DataView(bytes.buffer).setUint32(20, 256)
    await expect(inspectUploadedResource(new File([bytes], 'atlas.png', { type: 'image/png' }))).resolves.toEqual(expect.objectContaining({ width: 512, height: 256, contentHash: expect.any(String) }))
  })

  test('reads narrow PCM16 WAV physical facts without making a quality claim', async () => {
    const facts = await inspectUploadedResource(new File([wavFixture()], 'tone.wav', { type: 'audio/wav' }))
    expect(facts).toEqual(expect.objectContaining({
      encoding: 'PCM16', sampleRate: 8000, channelCount: 2, frames: 2, durationMs: 0.25, contentHash: expect.any(String),
    }))
    expect(facts).not.toHaveProperty('quality')
    expect(facts).not.toHaveProperty('capabilities')
  })

  test('leaves non-PCM WAV facts unknown instead of guessing', async () => {
    const bytes = wavFixture(); new DataView(bytes.buffer).setUint16(20, 3, true)
    const facts = await inspectUploadedResource(new File([bytes], 'compressed.wav', { type: 'audio/wav' }))
    expect(facts.contentHash).toEqual(expect.any(String))
    expect(facts.encoding).toBeUndefined()
    expect(facts.sampleRate).toBeUndefined()
    expect(facts.channelCount).toBeUndefined()
    expect(facts.durationMs).toBeUndefined()
  })

  test('keeps malformed WAV facts unknown without throwing', () => {
    const dataOverflow = wavFixture()
    new DataView(dataOverflow.buffer).setUint32(40, 0xffff, true)
    const truncatedChunkHeader = wavFixture().slice(0, 42)
    new DataView(truncatedChunkHeader.buffer).setUint32(4, truncatedChunkHeader.length - 8, true)
    const blockAlignMismatch = wavFixture()
    new DataView(blockAlignMismatch.buffer).setUint16(32, 2, true)
    const byteRateMismatch = wavFixture()
    new DataView(byteRateMismatch.buffer).setUint32(28, 16_000, true)
    for (const bytes of [dataOverflow, truncatedChunkHeader, blockAlignMismatch, byteRateMismatch]) {
      expect(() => inspectResourceBytes('broken.wav', bytes)).not.toThrow()
      expect(inspectResourceBytes('broken.wav', bytes)).toEqual({})
    }
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


// Header/chunk fixtures exercise metadata boundaries; they do not claim pixel decoding.
function pngMetadata(color:number, chunks:Array<[string,Uint8Array]>) {
  const header=new Uint8Array(13),view=new DataView(header.buffer)
  view.setUint32(0,8);view.setUint32(4,8);header[8]=8;header[9]=color
  const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),...([['IHDR',header],...chunks] as Array<[string,Uint8Array]>).map(([name,data])=>{
    const chunk=new Uint8Array(12+data.length);new DataView(chunk.buffer).setUint32(0,data.length)
    chunk.set(new TextEncoder().encode(name),4);chunk.set(data,8);return chunk
  })]
  const result=new Uint8Array(parts.reduce((n,part)=>n+part.length,0));let offset=0
  for(const part of parts){result.set(part,offset);offset+=part.length}return result
}
test('PNG metadata distinguishes alpha channels, transparency chunks, absence and incomplete evidence',()=>{
  const end:Array<[string,Uint8Array]>=[['IDAT',new Uint8Array([0])],['IEND',new Uint8Array()]]
  for(const color of [0,2,3,4,6]) {
    const palette:Array<[string,Uint8Array]>=color===3?[['PLTE',new Uint8Array(6)]]:[]
    const bytes=pngMetadata(color,[...palette,...end])
    expect(inspectResourceBytes('image.png',bytes).hasAlpha).toBe(color===4||color===6)
    expect(inspectResourceBytes('image.png',bytes.slice(0,-1))).not.toHaveProperty('hasAlpha')
    if([0,2,3].includes(color)) {
      const transparent=pngMetadata(color,[...palette,['tRNS',new Uint8Array(color===2?6:2)],...end])
      expect(inspectResourceBytes('image.png',transparent).hasAlpha).toBe(true)
    }
  }
  const invalid=pngMetadata(6,[['tRNS',new Uint8Array(1)],...end])
  expect(inspectResourceBytes('image.png',invalid)).not.toHaveProperty('hasAlpha')
  const overflow=pngMetadata(2,end);new DataView(overflow.buffer).setUint32(33,0xffffffff)
  expect(inspectResourceBytes('image.png',overflow)).not.toHaveProperty('hasAlpha')
})


test('static WebP facts come from real lossy/lossless containers; truncated or unsupported streams stay unknown', async () => {
  const {default:sharp}=await import('sharp')
  for (const lossless of [false,true]) {
    const bytes=await sharp({create:{width:17,height:9,channels:4,background:{r:200,g:20,b:10,alpha:0.4}}}).webp({lossless}).toBuffer()
    expect(inspectResourceBytes('sprite.webp',bytes)).toMatchObject({width:17,height:9,hasAlpha:true})
    expect(await inspectUploadedResource(new File([bytes],'sprite.webp'))).toMatchObject({width:17,height:9,hasAlpha:true,contentHash:expect.any(String)})
    expect(inspectResourceBytes('sprite.webp',bytes.subarray(0,bytes.length-1))).toEqual({})
    const corrupt=Buffer.from(bytes);corrupt.writeUInt32LE(0xffffffff,16)
    expect(inspectResourceBytes('sprite.webp',corrupt)).toEqual({})
  }
  const opaque=await sharp({create:{width:5,height:3,channels:3,background:'#ef1010'}}).webp().toBuffer()
  expect(inspectResourceBytes('opaque.webp',opaque)).toMatchObject({width:5,height:3,hasAlpha:false})
  const fake=Buffer.alloc(30);fake.write('RIFF');fake.writeUInt32LE(22,4);fake.write('WEBPVP8X',8);fake.writeUInt32LE(10,16)
  expect(inspectResourceBytes('missing-image.webp',fake)).toEqual({})
})
