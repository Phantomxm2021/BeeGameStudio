import type { LightData, MaterialOverride, SceneAsset, SceneDocument, SceneNode, SceneSettings, Transform, VolumeVisual } from './model'

const DIGEST = /^[a-f0-9]{64}$/
const NODE_KINDS = new Set(['empty', 'box', 'sphere', 'plane', 'model', 'light'])
const LIGHT_KINDS = new Set(['ambient', 'directional', 'point', 'spot'])
const VOLUME_SHAPES = new Set(['box', 'sphere', 'capsule'])
const VOLUME_ROLES = new Set(['collider', 'trigger'])
const MATERIAL_MODES = new Set(['standard', 'unlit'])
const ALPHA_MODES = new Set(['opaque', 'mask', 'blend'])

function invalid(path: string, message: string): never {
  throw new Error(`Invalid scene ${path}: ${message}`)
}

function ownKeys(value: object, path: string): string[] {
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key === 'symbol')) invalid(path, 'symbol keys are not allowed')
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) invalid(`${path}.${String(key)}`, 'accessors are not allowed')
  }
  return keys as string[]
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'expected a plain object')
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) invalid(path, 'prototype is not JSON-safe')
  ownKeys(value, path)
  return value as Record<string, unknown>
}

function keys(value: object, allowed: readonly string[], path: string) {
  const allowedSet = new Set(allowed)
  for (const key of ownKeys(value, path)) if (!allowedSet.has(key)) invalid(`${path}.${key}`, 'unknown property')
}

function jsonValue(value: unknown, path: string, stack: WeakSet<object>) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(path, 'number must be finite'); return }
  if (typeof value !== 'object') invalid(path, 'value is not JSON-safe')
  if (stack.has(value)) invalid(path, 'cycle is not allowed')
  stack.add(value)
  if (Array.isArray(value)) {
    const own = ownKeys(value, path).filter(key => key !== 'length')
    for (let index = 0; index < value.length; index += 1) {
      if (!own.includes(String(index))) invalid(`${path}[${index}]`, 'sparse arrays are not allowed')
      jsonValue(value[index], `${path}[${index}]`, stack)
    }
    if (own.some(key => !/^\d+$/.test(key) || Number(key) >= value.length)) invalid(path, 'array has non-index properties')
  } else {
    const object = record(value, path)
    for (const key of ownKeys(object, path)) jsonValue(object[key], `${path}.${key}`, stack)
  }
  stack.delete(value)
}

function text(value: unknown, path: string) {
  if (typeof value !== 'string' || value.trim() === '') invalid(path, 'expected non-empty text')
  return value
}

function bool(value: unknown, path: string): value is boolean {
  if (typeof value !== 'boolean') invalid(path, 'expected boolean')
  return value
}

function number(value: unknown, path: string, predicate: (value: number) => boolean = () => true) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !predicate(value)) invalid(path, 'expected a finite number in the supported range')
  return value
}

function vector(value: unknown, path: string, positive = false): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) invalid(path, 'expected exactly three numbers')
  return value.map((item, index) => number(item, `${path}[${index}]`, positive ? item => item > 0 : undefined)) as [number, number, number]
}

export function assertTransform(input: unknown, path = 'transform'): asserts input is Transform {
  const value = record(input, path); keys(value, ['position', 'rotation', 'quaternion', 'scale'], path)
  vector(value.position, `${path}.position`); vector(value.rotation, `${path}.rotation`)
  const scale = vector(value.scale, `${path}.scale`)
  if (scale.some(item => item === 0)) invalid(`${path}.scale`, 'scale components must be non-zero')
  if (value.quaternion !== undefined) {
    if (!Array.isArray(value.quaternion) || value.quaternion.length !== 4) invalid(`${path}.quaternion`, 'expected exactly four numbers')
    const quaternion = value.quaternion.map((item, index) => number(item, `${path}.quaternion[${index}]`))
    const length = Math.hypot(...quaternion)
    if (Math.abs(length - 1) > 0.001) invalid(`${path}.quaternion`, 'quaternion must be normalized')
  }
}

function assertMaterial(input: unknown, path: string): asserts input is MaterialOverride {
  const value = record(input, path); keys(value, ['mode', 'color', 'metalness', 'roughness', 'opacity', 'alphaMode', 'textureAssetId'], path)
  if (typeof value.mode !== 'string' || !MATERIAL_MODES.has(value.mode)) invalid(`${path}.mode`, 'unsupported material mode')
  text(value.color, `${path}.color`); number(value.metalness, `${path}.metalness`, n => n >= 0 && n <= 1); number(value.roughness, `${path}.roughness`, n => n >= 0 && n <= 1); number(value.opacity, `${path}.opacity`, n => n >= 0 && n <= 1)
  if (typeof value.alphaMode !== 'string' || !ALPHA_MODES.has(value.alphaMode)) invalid(`${path}.alphaMode`, 'unsupported alpha mode')
  if (value.textureAssetId !== undefined) text(value.textureAssetId, `${path}.textureAssetId`)
}

function assertLight(input: unknown, path: string): asserts input is LightData {
  const value = record(input, path); keys(value, ['kind', 'color', 'intensity', 'distance', 'angle', 'penumbra'], path)
  if (typeof value.kind !== 'string' || !LIGHT_KINDS.has(value.kind)) invalid(`${path}.kind`, 'unsupported light kind')
  text(value.color, `${path}.color`); number(value.intensity, `${path}.intensity`, n => n >= 0)
  if (value.distance !== undefined) number(value.distance, `${path}.distance`, n => n >= 0)
  if (value.angle !== undefined) number(value.angle, `${path}.angle`, n => n > 0 && n <= Math.PI)
  if (value.penumbra !== undefined) number(value.penumbra, `${path}.penumbra`, n => n >= 0 && n <= 1)
}

function assertVolume(input: unknown, path: string): asserts input is VolumeVisual {
  const value = record(input, path); keys(value, ['role', 'shape', 'size', 'offset', 'rotation'], path)
  if (typeof value.role !== 'string' || !VOLUME_ROLES.has(value.role)) invalid(`${path}.role`, 'unsupported volume role')
  if (typeof value.shape !== 'string' || !VOLUME_SHAPES.has(value.shape)) invalid(`${path}.shape`, 'unsupported volume shape')
  vector(value.size, `${path}.size`, true); vector(value.offset, `${path}.offset`); vector(value.rotation, `${path}.rotation`)
}

function assertSource(input: unknown, path: string) {
  const value = record(input, path); keys(value, ['source', 'contentDigest', 'contentRevision', 'contentSchemaVersion', 'adapterId', 'adapterVersion'], path)
  const source = record(value.source, `${path}.source`)
  if (source.kind === 'fixture') { keys(source, ['kind', 'fixtureId', 'fixtureDigest'], `${path}.source`); text(source.fixtureId, `${path}.source.fixtureId`); if (typeof source.fixtureDigest !== 'string' || !DIGEST.test(source.fixtureDigest)) invalid(`${path}.source.fixtureDigest`, 'expected lowercase SHA-256') }
  else if (source.kind === 'published-ir') { keys(source, ['kind', 'publicationId', 'candidateDigest', 'sourceInputDigest'], `${path}.source`); text(source.publicationId, `${path}.source.publicationId`); for (const key of ['candidateDigest', 'sourceInputDigest']) if (typeof source[key] !== 'string' || !DIGEST.test(source[key])) invalid(`${path}.source.${key}`, 'expected lowercase SHA-256') }
  else invalid(`${path}.source.kind`, 'unsupported source kind')
  if (typeof value.contentDigest !== 'string' || !DIGEST.test(value.contentDigest)) invalid(`${path}.contentDigest`, 'expected lowercase SHA-256')
  text(value.contentRevision, `${path}.contentRevision`); text(value.contentSchemaVersion, `${path}.contentSchemaVersion`); text(value.adapterId, `${path}.adapterId`); text(value.adapterVersion, `${path}.adapterVersion`)
}

export function assertSceneNode(input: unknown, path = 'node'): asserts input is SceneNode {
  const value = record(input, path); keys(value, ['id', 'name', 'kind', 'parentId', 'children', 'visible', 'locked', 'editable', 'transform', 'source', 'material', 'light', 'volume', 'assetId', 'unknown'], path)
  text(value.id, `${path}.id`); text(value.name, `${path}.name`); if (typeof value.kind !== 'string' || !NODE_KINDS.has(value.kind)) invalid(`${path}.kind`, 'unsupported node kind')
  if (value.parentId !== null) text(value.parentId, `${path}.parentId`)
  if (!Array.isArray(value.children) || new Set(value.children).size !== value.children.length) invalid(`${path}.children`, 'expected unique child IDs')
  value.children.forEach((child, index) => text(child, `${path}.children[${index}]`)); bool(value.visible, `${path}.visible`); bool(value.locked, `${path}.locked`); if (value.editable !== undefined) bool(value.editable, `${path}.editable`)
  assertTransform(value.transform, `${path}.transform`)
  if (value.source !== undefined) { const source = record(value.source, `${path}.source`); keys(source, ['irId', 'occurrenceId'], `${path}.source`); for (const key of ['irId', 'occurrenceId']) if (source[key] !== undefined) text(source[key], `${path}.source.${key}`) }
  if (value.material !== undefined) assertMaterial(value.material, `${path}.material`)
  if (value.light !== undefined) assertLight(value.light, `${path}.light`)
  if (value.volume !== undefined) assertVolume(value.volume, `${path}.volume`)
  if (value.assetId !== undefined) text(value.assetId, `${path}.assetId`)
  if (value.unknown !== undefined) jsonValue(value.unknown, `${path}.unknown`, new WeakSet())
}

function assertAsset(input: unknown, path: string): asserts input is SceneAsset {
  const value = record(input, path); keys(value, ['id', 'name', 'mimeType', 'path', 'bytes', 'uri', 'dependencies', 'diagnostics'], path)
  text(value.id, `${path}.id`); text(value.name, `${path}.name`); text(value.mimeType, `${path}.mimeType`); const assetPath = text(value.path, `${path}.path`)
  if (assetPath.startsWith('/') || assetPath.includes('\\') || /^[A-Za-z]:/.test(assetPath) || assetPath.split('/').some(segment => segment === '..' || segment === '')) invalid(`${path}.path`, 'must be a safe relative path')
  if (value.bytes !== undefined && (typeof value.bytes !== 'string' || !/^data:[^,]*;base64,[A-Za-z0-9+/]*={0,2}$/.test(value.bytes))) invalid(`${path}.bytes`, 'expected a base64 data URI')
  if (value.uri !== undefined && (typeof value.uri !== 'string' || !/^(blob:|data:|https?:\/\/|\/)/.test(value.uri))) invalid(`${path}.uri`, 'expected a browser-loadable URI')
  if (value.dependencies !== undefined) { if (!Array.isArray(value.dependencies) || new Set(value.dependencies).size !== value.dependencies.length) invalid(`${path}.dependencies`, 'expected unique dependency references'); value.dependencies.forEach((dependency, index) => text(dependency, `${path}.dependencies[${index}]`)) }
  if (value.diagnostics !== undefined) { if (!Array.isArray(value.diagnostics)) invalid(`${path}.diagnostics`, 'expected string array'); value.diagnostics.forEach((diagnostic, index) => text(diagnostic, `${path}.diagnostics[${index}]`)) }
}

export function assertSceneSettings(input: unknown): asserts input is SceneSettings {
  const value = record(input, 'settings')
  keys(value, ['background', 'showGrid', 'ambientColor', 'ambientIntensity', 'exposure', 'fogEnabled', 'fogColor', 'fogNear', 'fogFar', 'selectionColor', 'selectionWidth'], 'settings')
  if (value.selectionColor !== undefined && (typeof value.selectionColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.selectionColor))) invalid('settings.selectionColor', 'expected a six-digit hex color')
  if (value.selectionWidth !== undefined) number(value.selectionWidth, 'settings.selectionWidth', n => n >= 1 && n <= 8)
  for (const field of ['background', 'ambientColor', 'fogColor']) {
    if (typeof value[field] !== 'string' || !/^#[0-9a-f]{6}$/i.test(value[field] as string)) invalid(`settings.${field}`, 'expected a six-digit hex color')
  }
  bool(value.showGrid, 'settings.showGrid'); bool(value.fogEnabled, 'settings.fogEnabled')
  number(value.ambientIntensity, 'settings.ambientIntensity', n => n >= 0 && n <= 20)
  number(value.exposure, 'settings.exposure', n => n >= .1 && n <= 5)
  const near = number(value.fogNear, 'settings.fogNear', n => n >= 0)
  number(value.fogFar, 'settings.fogFar', n => n > near)
}

export function assertSceneDocument(input: unknown): asserts input is SceneDocument {
  jsonValue(input, 'document', new WeakSet())
  const value = record(input, 'document'); keys(value, ['schemaVersion', 'id', 'name', 'settings', 'revision', 'source', 'rootIds', 'nodes', 'assets', 'diagnostics', 'appliedTransactions', 'unknown'], 'document')
  if (value.settings !== undefined) assertSceneSettings(value.settings)
  if (value.schemaVersion !== 'scene-authoring.v1') invalid('document.schemaVersion', 'unsupported schema')
  text(value.id, 'document.id'); text(value.name, 'document.name'); number(value.revision, 'document.revision', n => Number.isInteger(n) && n >= 0); assertSource(value.source, 'document.source')
  if (!Array.isArray(value.rootIds) || new Set(value.rootIds).size !== value.rootIds.length) invalid('document.rootIds', 'expected unique root list')
  value.rootIds.forEach((id, index) => text(id, `document.rootIds[${index}]`))
  const nodes = record(value.nodes, 'document.nodes'); const assets = record(value.assets, 'document.assets')
  for (const [id, node] of Object.entries(nodes)) { if (id !== (node as any)?.id) invalid(`document.nodes.${id}`, 'map key must equal node.id'); assertSceneNode(node, `document.nodes.${id}`) }
  for (const [id, asset] of Object.entries(assets)) { if (id !== (asset as any)?.id) invalid(`document.assets.${id}`, 'map key must equal asset.id'); assertAsset(asset, `document.assets.${id}`) }
  if (value.rootIds.some(id => !nodes[id])) invalid('document.rootIds', 'references missing node')
  const roots = new Set(value.rootIds as string[]); for (const node of Object.values(nodes) as SceneNode[]) if (node.parentId === null ? !roots.has(node.id) : roots.has(node.id)) invalid(`document.nodes.${node.id}.parentId`, 'does not agree with rootIds')
  for (const node of Object.values(nodes) as SceneNode[]) {
    const seenChildren = new Set<string>(); for (const childId of node.children) { if (seenChildren.has(childId)) invalid(`document.nodes.${node.id}.children`, 'duplicate child'); seenChildren.add(childId); const child = nodes[childId] as SceneNode; if (!child) invalid(`document.nodes.${node.id}.children`, `missing child ${childId}`); if (child.parentId !== node.id) invalid(`document.nodes.${node.id}.children`, `parent mismatch for ${childId}`) }
    if (node.assetId !== undefined && !assets[node.assetId]) invalid(`document.nodes.${node.id}.assetId`, `missing asset ${node.assetId}`)
    if (node.material?.textureAssetId !== undefined && !assets[node.material.textureAssetId]) invalid(`document.nodes.${node.id}.material.textureAssetId`, `missing asset ${node.material.textureAssetId}`)
  }
  const assetList = Object.values(assets) as SceneAsset[]
  for (const asset of assetList) for (const dependency of asset.dependencies ?? []) if (!assetList.some(candidate => candidate.id === dependency || candidate.path === dependency)) invalid(`document.assets.${asset.id}.dependencies`, `missing dependency ${dependency}`)
  const visited = new Set<string>(); const visiting = new Set<string>()
  const walk = (id: string) => { if (visiting.has(id)) invalid(`document.nodes.${id}`, 'hierarchy cycle'); if (visited.has(id)) return; visiting.add(id); for (const child of (nodes[id] as SceneNode).children) walk(child); visiting.delete(id); visited.add(id) }
  for (const root of value.rootIds as string[]) { if ((nodes[root] as SceneNode).parentId !== null) invalid(`document.nodes.${root}.parentId`, 'root must not have a parent'); walk(root) }
  if (visited.size !== Object.keys(nodes).length) invalid('document.nodes', 'contains unreachable nodes')
  if (!Array.isArray(value.diagnostics)) invalid('document.diagnostics', 'expected string array'); value.diagnostics.forEach((diagnostic, index) => text(diagnostic, `document.diagnostics[${index}]`))
  if (value.appliedTransactions !== undefined) { const transactions = record(value.appliedTransactions, 'document.appliedTransactions'); for (const [key, fingerprint] of Object.entries(transactions)) { text(key, `document.appliedTransactions.${key}`); if (typeof fingerprint !== 'string' || !DIGEST.test(fingerprint)) invalid(`document.appliedTransactions.${key}`, 'expected lowercase SHA-256 fingerprint') } }
  if (value.unknown !== undefined) jsonValue(value.unknown, 'document.unknown', new WeakSet())
}
