import { describe, expect, it } from 'vitest'
import { dataUri } from '../src/assets'
import { readModelStructure } from '../src/model-structure'
import { keyboardLabels } from '../src/platform'

const fixture = {
  asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Model root', children: [1], matrix: [.01, 0, 0, 0, 0, .01, 0, 0, 0, 0, .01, 0, 0, 2, 0, 1] }, { mesh: 0 }],
  meshes: [{ name: 'Body', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
  accessors: [{ count: 24 }, { count: 36 }],
  materials: [{ name: 'Paint', pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: .6, baseColorTexture: { index: 0 } } }],
  textures: [{ source: 0 }], images: [{ bufferView: 0, mimeType: 'image/png' }],
}
const asset = (bytes: Uint8Array) => ({ id: 'model', path: 'model.glb', name: 'model.glb', mimeType: 'model/gltf-binary', bytes: dataUri(bytes) })

describe('imported model inspection', () => {
  it('reads nested nodes, source transforms, geometry counts and original material properties', () => {
    const result = readModelStructure(asset(new TextEncoder().encode(JSON.stringify(fixture))))!
    expect(result.roots).toEqual([0]); expect(result.nodes[0].children).toEqual([1])
    expect(result.nodes[0].transform.position).toEqual([0, 2, 0]); expect(result.nodes[0].transform.scale).toEqual([.01, .01, .01])
    expect(result.nodes[1].name).toBe('Body'); expect(result.nodes[1].meshIndex).toBe(0)
    expect(result.meshes[0]).toMatchObject({ vertices: 24, triangles: 12, materials: [0] })
    expect(result.materials[0]).toMatchObject({ name: 'Paint', metalness: 0, roughness: .6, texture: 'Embedded texture' })
  })
  it('reads the JSON chunk of a binary glTF without decoding its geometry or textures', () => {
    const json = new TextEncoder().encode(JSON.stringify(fixture)); const length = Math.ceil(json.length / 4) * 4
    const bytes = new Uint8Array(20 + length); bytes.fill(32); const view = new DataView(bytes.buffer)
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true)
    view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true); bytes.set(json, 20)
    expect(readModelStructure(asset(bytes))?.nodes[1].kind).toBe('mesh')
  })
  it('ignores cyclic and missing children and tolerates unavailable or corrupt model data', () => {
    const cyclic = structuredClone(fixture); cyclic.nodes[0].children = [0, 1, 999]
    expect(readModelStructure(asset(new TextEncoder().encode(JSON.stringify(cyclic))))?.nodes[0].children).toEqual([1])
    expect(readModelStructure(undefined)).toBeNull(); expect(readModelStructure(asset(new Uint8Array([1, 2])))).toBeNull()
  })
})

it('uses macOS key symbols and Windows/Linux key labels', () => {
  expect(keyboardLabels('MacIntel')).toMatchObject({ modifier: '⌘', alt: '⌥', shift: '⇧', delete: '⌫' })
  for (const platform of ['Win32', 'Linux x86_64']) expect(keyboardLabels(platform)).toMatchObject({ modifier: 'Ctrl', alt: 'Alt', shift: 'Shift', delete: 'Del' })
})
