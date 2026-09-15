import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { SceneDocument, SceneNode, Transform } from './model'
import { clone, identityTransform } from './model'
import { sha256Json } from './persistence'
import { assertSceneDocument } from './validation'

type Obj = Record<string, unknown>
type IrNode = { id: string; kind: string; value: Obj; edges: Array<{ type: string; targetId: string }>; raw: Obj }
function obj(value: unknown, label: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid published scene: ${label} must be an object`)
  return value as Obj
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid published scene: ${label} must be text`)
  return value
}
function hash(value: unknown, label: string): string {
  const result = text(value, label)
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`Invalid published scene: ${label} must be SHA-256`)
  return result
}
function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid published scene: ${label} must be finite`)
  return value
}
function vector(value: unknown, label: string): Vector3 {
  const v = obj(value, label)
  return new Vector3(finite(v.x, `${label}.x`), finite(v.y, `${label}.y`), finite(v.z, `${label}.z`))
}
function parseNode(value: unknown): IrNode {
  const raw = obj(value, 'node')
  if (!Array.isArray(raw.edges)) throw new Error('Invalid published scene: missing edge list')
  return { id: text(raw.id, 'node id'), kind: text(raw.kind, 'node kind'), value: obj(raw.value, 'node value'), raw,
    edges: raw.edges.map(e => { const edge = obj(e, 'edge'); return { type: text(edge.type, 'edge type'), targetId: text(edge.targetId, 'edge target') } }) }
}
const edge = (n: IrNode, role: string) => n.edges.find(e => e.type === role)?.targetId

/** Accepts the actual GameIrPublishedReader JSON shape; authorization remains with its host. */
export async function importPublishedScene(input: unknown, content?: Partial<SceneDocument>): Promise<SceneDocument> {
  const reader = obj(input, 'reader'), manifest = obj(reader.manifest, 'manifest'), candidate = obj(reader.candidate, 'candidate'), digests = obj(reader.digests, 'digests')
  if (candidate.schemaVersion !== 'game-ir.v2' || manifest.gameIrSchemaVersion !== 'game-ir.v2') throw new Error('Unsupported Game IR schema')
  if (candidate.sourceRevision !== manifest.sourceRevision) throw new Error('Published scene source revision mismatch')
  const candidateDigest = hash(digests.candidate, 'candidate digest')
  if (manifest.candidateDigest !== candidateDigest || await sha256Json(candidate) !== candidateDigest) throw new Error('Published scene candidate digest mismatch')
  if (!Array.isArray(candidate.modules) || !Array.isArray(reader.modules) || await sha256Json(candidate.modules) !== await sha256Json(reader.modules)) throw new Error('Published scene modules do not match candidate')
  const modules = candidate.modules.map(m => obj(m, 'module'))
  if (new Set(modules.map(m => m.moduleId)).size !== modules.length) throw new Error('Duplicate published modules')
  const world = modules.find(m => m.moduleId === 'world-scene')
  if (!world || !Array.isArray(world.nodes)) throw new Error('Published reader has no world-scene module')
  const rawNodes = world.nodes.map(parseNode), byId = new Map(rawNodes.map(n => [n.id, n]))
  if (byId.size !== rawNodes.length) throw new Error('Duplicate World/Scene node ID')
  const scenes = rawNodes.filter(n => n.kind === 'world-scene.scene')
  const spatial = rawNodes.filter(n => n.kind === 'world-scene.node')
  const nodes: Record<string, SceneNode> = {}, rootIds: string[] = [], diagnostics: string[] = []
  const convention = new Map<string, { supported: boolean; factor: number }>()
  const sid = (id: string) => `ir-scene.${id}`
  const nid = (id: string) => `ir-node.${id}`
  for (const scene of scenes) {
    const c = obj(scene.value.coordinateConvention, 'coordinate convention')
    const supported = c.dimensions === '3d' && c.handedness === 'right' && c.upAxis === '+y' && c.forwardAxis === '-z' && (c.distanceUnit === 'meter' || c.distanceUnit === 'centimeter')
    convention.set(scene.id, { supported, factor: c.distanceUnit === 'centimeter' ? 0.01 : 1 })
    if (!supported) diagnostics.push(`Scene ${scene.id}: unsupported coordinate convention; original transforms retained as source data, projection read-only`)
    nodes[sid(scene.id)] = { id: sid(scene.id), name: text(scene.value.label, 'scene label'), kind: 'empty', parentId: null, children: [], visible: true, locked: true, editable: false, transform: identityTransform(), source: { irId: scene.id }, unknown: { irSource: clone(scene.raw) } }
    rootIds.push(sid(scene.id))
  }
  const localRaw = new Map<string, Matrix4>(), worldMatrices = new Map<string, Matrix4>(), visiting = new Set<string>()
  for (const n of spatial) {
    const owner = edge(n, 'scene'), c = owner && convention.get(owner)
    if (!owner || !c) throw new Error(`Node ${n.id} has no valid scene`)
    const parent = edge(n, 'parent')
    if (parent && (byId.get(parent)?.kind !== 'world-scene.node' || edge(byId.get(parent)!, 'scene') !== owner)) throw new Error(`Node ${n.id} has invalid or cross-scene parent`)
    const transform = obj(n.value.transform, 'transform')
    if (c.supported) {
      if (transform.dimensions !== '3d' || !['local', 'world'].includes(String(transform.space))) throw new Error(`Node ${n.id} has invalid transform space`)
      const r = obj(transform.rotation, 'quaternion')
      const rotation = new Quaternion(finite(r.x, 'rotation.x'), finite(r.y, 'rotation.y'), finite(r.z, 'rotation.z'), finite(r.w, 'rotation.w'))
      if (Math.abs(rotation.length() - 1) > 0.001) throw new Error(`Node ${n.id} quaternion must be normalized`)
      localRaw.set(n.id, new Matrix4().compose(vector(transform.position, 'position').multiplyScalar(c.factor), rotation.normalize(), vector(transform.scale, 'scale')))
    }
    nodes[nid(n.id)] = { id: nid(n.id), name: text(n.value.label, 'node label'), kind: 'empty', parentId: parent ? nid(parent) : sid(owner), children: [], visible: true, locked: true, editable: false, transform: identityTransform(), source: { irId: n.id }, unknown: { irSource: clone(n.raw) } }
  }
  function worldMatrix(n: IrNode): Matrix4 {
    const cached = worldMatrices.get(n.id)
    if (cached) return cached
    if (visiting.has(n.id)) throw new Error('Published scene hierarchy has a cycle')
    visiting.add(n.id)
    const parent = edge(n, 'parent')
    const parentWorld = parent ? worldMatrix(byId.get(parent)!) : new Matrix4()
    const raw = localRaw.get(n.id) ?? new Matrix4()
    const matrix = obj(n.value.transform, 'transform').space === 'world' ? raw.clone() : parentWorld.clone().multiply(raw)
    worldMatrices.set(n.id, matrix); visiting.delete(n.id)
    return matrix
  }
  for (const n of spatial) {
    const authored = nodes[nid(n.id)], owner = edge(n, 'scene')!
    if (convention.get(owner)?.supported) {
      const parent = edge(n, 'parent'), parentWorld = parent ? worldMatrix(byId.get(parent)!) : new Matrix4()
      if (Math.abs(parentWorld.determinant()) < 1e-12) diagnostics.push(`Node ${n.id}: singular parent transform cannot be projected`)
      else {
        const local = parentWorld.clone().invert().multiply(worldMatrix(n)), p = new Vector3(), q = new Quaternion(), s = new Vector3()
        local.decompose(p, q, s)
        const rebuilt = new Matrix4().compose(p, q, s)
        if (rebuilt.elements.some((v, i) => Math.abs(v - local.elements[i]) > 1e-6)) diagnostics.push(`Node ${n.id}: shear cannot be represented by editable TRS; source retained`)
        // The editor owns one rotation representation (XYZ Euler radians).
        // Preserve the source quaternion in irSource, rather than persisting
        // a second editable value that could drift after a gizmo operation.
        else { const e = new Euler().setFromQuaternion(q, 'XYZ'); authored.transform = { position: p.toArray(), rotation: [e.x, e.y, e.z], scale: s.toArray() } as Transform }
      }
    } else worldMatrix(n) // still detects malformed cycles in unsupported content
    if (!authored.parentId || !nodes[authored.parentId]) throw new Error(`Missing authored parent for ${n.id}`)
    nodes[authored.parentId].children.push(authored.id)
  }
  for (const scene of scenes) {
    const root = edge(scene, 'root')
    if (!root || !nodes[nid(root)] || edge(byId.get(root)!, 'parent') || edge(byId.get(root)!, 'scene') !== scene.id) throw new Error(`Scene ${scene.id} has an invalid root relationship`)
  }
  const zones = rawNodes.filter(n => n.kind === 'world-scene.zone')
  if (zones.length) diagnostics.push(`${zones.length} semantic zone(s) retained; an explicit collider/trigger role is required for volume editing`)
  const source = { kind: 'published-ir' as const, publicationId: text(manifest.publicationId, 'publication id'), candidateDigest, sourceInputDigest: hash(manifest.sourceInputDigest, 'source input digest') }
  const result: SceneDocument = { schemaVersion: 'scene-authoring.v1', id: content?.id ?? `scene-${source.publicationId}`, name: content?.name ?? 'Published Scene', revision: content?.revision ?? 1,
    source: { source, contentDigest: '', contentRevision: String(content?.revision ?? 1), contentSchemaVersion: 'beegame-content-v1', adapterId: 'three-scene-v1', adapterVersion: '1.0.0' },
    rootIds, nodes, assets: {}, diagnostics, unknown: { irSource: clone(world), sourceMaps: clone(reader.sourceMaps ?? {}) } }
  if (content?.nodes) {
    for (const n of Object.values(content.nodes)) if (n.source?.irId && !byId.has(n.source.irId)) throw new Error(`Authored node ${n.id} references absent IR node ${n.source.irId}`)
    result.nodes = clone(content.nodes); result.rootIds = clone(content.rootIds ?? rootIds); result.assets = clone(content.assets ?? {}); result.unknown = { ...clone(content.unknown ?? {}), ...result.unknown }
  }
  const digestable = clone(result)
  digestable.source.contentDigest = ''
  result.source.contentDigest = await sha256Json(digestable)
  assertSceneDocument(result)
  return result
}
