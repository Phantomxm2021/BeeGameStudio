import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { fromDataUri } from './assets'
import type { SceneAsset, Transform } from './model'

export type ModelSelection = { ownerId: string; nodeIndex: number }
export type ModelPart = {
  index: number; name: string; kind: 'group' | 'mesh' | 'camera'; children: number[]
  transform: Transform; meshIndex?: number
}
export type ModelMaterial = { name: string; color: number[]; metalness: number; roughness: number; texture: string | null }
export type ModelMesh = { name: string; vertices: number; triangles: number; materials: number[] }
export type ModelStructure = { roots: number[]; nodes: Record<number, ModelPart>; meshes: ModelMesh[]; materials: ModelMaterial[] }

/** Inspect the embedded glTF document without loading a second GPU copy. */
export function readModelStructure(asset: SceneAsset | undefined): ModelStructure | null {
  if (!asset?.bytes) return null
  try {
    const bytes = fromDataUri(asset.bytes)
    let jsonBytes = bytes
    if (bytes.length >= 20 && new DataView(bytes.buffer).getUint32(0, true) === 0x46546c67) {
      const view = new DataView(bytes.buffer)
      if (view.getUint32(4, true) !== 2 || view.getUint32(16, true) !== 0x4e4f534a) return null
      jsonBytes = bytes.subarray(20, 20 + view.getUint32(12, true))
    }
    const gltf = JSON.parse(new TextDecoder().decode(jsonBytes))
    const nodes: ModelStructure['nodes'] = {}
    const visit = (index: number, ancestors: Set<number>) => {
      const node = gltf.nodes?.[index]
      if (!node || ancestors.has(index)) return false
      if (nodes[index]) return true
      const position = new Vector3(...(node.translation ?? [0, 0, 0]))
      const quaternion = new Quaternion(...(node.rotation ?? [0, 0, 0, 1]))
      const scale = new Vector3(...(node.scale ?? [1, 1, 1]))
      if (node.matrix) new Matrix4().fromArray(node.matrix).decompose(position, quaternion, scale)
      const euler = new Euler().setFromQuaternion(quaternion)
      const kind = node.mesh !== undefined ? 'mesh' : node.camera !== undefined ? 'camera' : 'group'
      nodes[index] = {
        index, name: node.name || gltf.meshes?.[node.mesh]?.name || `${kind === 'mesh' ? 'Mesh' : kind === 'camera' ? 'Camera' : 'Node'} ${index}`,
        kind, children: [], meshIndex: node.mesh,
        transform: { position: position.toArray(), rotation: [euler.x, euler.y, euler.z], scale: scale.toArray() },
      }
      const path = new Set(ancestors).add(index)
      nodes[index].children = (node.children ?? []).filter((child: number) => visit(child, path))
      return true
    }
    const roots = (gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? []).filter((index: number) => visit(index, new Set()))
    const meshes: ModelMesh[] = (gltf.meshes ?? []).map((mesh: any, index: number) => ({
      name: mesh.name || `Mesh ${index}`,
      vertices: (mesh.primitives ?? []).reduce((sum: number, primitive: any) => sum + (gltf.accessors?.[primitive.attributes?.POSITION]?.count ?? 0), 0),
      triangles: (mesh.primitives ?? []).reduce((sum: number, primitive: any) => {
        const count = gltf.accessors?.[primitive.indices ?? primitive.attributes?.POSITION]?.count ?? 0
        return sum + ((primitive.mode ?? 4) === 4 ? count / 3 : [5, 6].includes(primitive.mode) ? Math.max(0, count - 2) : 0)
      }, 0),
      materials: [...new Set<number>((mesh.primitives ?? []).map((primitive: any) => primitive.material).filter((index: unknown) => typeof index === 'number'))],
    }))
    const materials: ModelMaterial[] = (gltf.materials ?? []).map((material: any, index: number) => {
      const pbr = material.pbrMetallicRoughness ?? {}
      const texture = gltf.textures?.[pbr.baseColorTexture?.index]
      const image = gltf.images?.[texture?.source]
      return { name: material.name || `Material ${index}`, color: pbr.baseColorFactor ?? [1, 1, 1, 1], metalness: pbr.metallicFactor ?? 1, roughness: pbr.roughnessFactor ?? 1, texture: texture ? image?.name || (image?.uri && !image.uri.startsWith('data:') ? image.uri : 'Embedded texture') : null }
    })
    return { roots, nodes, meshes, materials }
  } catch { return null }
}
