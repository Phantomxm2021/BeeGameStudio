import type { SceneAsset, SceneComponent, SceneDocument, SceneNode, SceneSettings, Transform } from './model'
import { parseGridData, parseTilemapData, parseTilemapRendererData, parseTileSet, validateTilemapGrid } from './tilemap-data'

const DIGEST = /^[a-f0-9]{64}$/
const COMPONENT_TYPES = new Set([
  'sprite-renderer', 'mesh-filter', 'mesh-renderer', 'skinned-mesh-renderer',
  'grid', 'tilemap', 'tilemap-renderer', 'animator',
  'box-collider-2d', 'circle-collider-2d', 'capsule-collider-2d', 'polygon-collider-2d', 'rigidbody-2d',
  'box-collider', 'sphere-collider', 'capsule-collider', 'mesh-collider', 'rigidbody',
  'audio-source', 'audio-listener', 'particle-system', 'particle-system-renderer',
  'light-2d', 'light', 'camera', 'canvas', 'canvas-renderer', 'rect-transform', 'image', 'text',
])
function invalid(path: string, message: string): never { throw new Error(`Invalid scene ${path}: ${message}`) }
function record(value: unknown, path: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'expected a plain object'); return value as Record<string, unknown> }
function text(value: unknown, path: string): string { if (typeof value !== 'string' || !value.trim()) invalid(path, 'expected non-empty text'); return value }
function number(value: unknown, path: string): number { if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path, 'expected finite number'); return value }
function bool(value: unknown, path: string): boolean { if (typeof value !== 'boolean') invalid(path, 'expected boolean'); return value }
function vec(value: unknown, length: 2 | 3 | 4, path: string): number[] { if (!Array.isArray(value) || value.length !== length) invalid(path, `expected ${length} numbers`); return value.map((entry, index) => number(entry, `${path}[${index}]`)) }
function json(value: unknown, path: string, seen = new WeakSet<object>()) { if (value === null || ['string', 'boolean'].includes(typeof value)) return; if (typeof value === 'number') { number(value, path); return } if (typeof value !== 'object') invalid(path, 'not JSON-safe'); if (seen.has(value)) invalid(path, 'cycle'); seen.add(value); if (Array.isArray(value)) value.forEach((entry, index) => json(entry, `${path}[${index}]`, seen)); else Object.entries(record(value, path)).forEach(([key, entry]) => json(entry, `${path}.${key}`, seen)); seen.delete(value) }

export function assertTransform(input: unknown, path = 'transform'): asserts input is Transform { const value = record(input, path); vec(value.position, 3, `${path}.position`); vec(value.rotation, 3, `${path}.rotation`); const scale = vec(value.scale, 3, `${path}.scale`); if (scale.some(entry => entry === 0)) invalid(`${path}.scale`, 'cannot contain zero'); if (value.quaternion !== undefined) { const quaternion = vec(value.quaternion, 4, `${path}.quaternion`); const magnitude = Math.hypot(...quaternion); if (Math.abs(magnitude - 1) > 1e-4) invalid(`${path}.quaternion`, 'must be normalized') } }
function assertMaterial(input: unknown, path: string) { const value = record(input, path); if (!['standard', 'unlit'].includes(String(value.mode))) invalid(`${path}.mode`, 'unsupported'); text(value.color, `${path}.color`); for (const key of ['metalness', 'roughness', 'opacity']) { const n = number(value[key], `${path}.${key}`); if (n < 0 || n > 1) invalid(`${path}.${key}`, 'out of range') } if (!['opaque', 'mask', 'blend'].includes(String(value.alphaMode))) invalid(`${path}.alphaMode`, 'unsupported') }
function assertComponent(input: unknown, path: string, ids: Set<string>): asserts input is SceneComponent {
  const component = record(input, path); const id = text(component.id, `${path}.id`); if (ids.has(id)) invalid(`${path}.id`, 'duplicate component ID'); ids.add(id); const type = text(component.type, `${path}.type`); if (!COMPONENT_TYPES.has(type)) invalid(`${path}.type`, 'unsupported component'); bool(component.enabled, `${path}.enabled`)
  if (type === 'grid') parseGridData(component.properties)
  if (type === 'tilemap') parseTilemapData(component.properties)
  if (type === 'tilemap-renderer') parseTilemapRendererData(component.properties)
  if (type === 'sprite-renderer') { text(component.assetId, `${path}.assetId`); assertMaterial(component.material, `${path}.material`) }
  else if (type === 'image') { if (component.assetId !== undefined) text(component.assetId, `${path}.assetId`); assertMaterial(component.material, `${path}.material`) }
  else if (type === 'mesh-filter' || type === 'skinned-mesh-renderer' || type === 'tilemap') { text(component.assetId, `${path}.assetId`); json(component.properties, `${path}.properties`); if (type === 'skinned-mesh-renderer') assertMaterial(component.material, `${path}.material`) }
  else if (type === 'mesh-renderer') { if (component.assetId !== undefined) text(component.assetId, `${path}.assetId`); assertMaterial(component.material, `${path}.material`); json(component.properties, `${path}.properties`) }
  else if (type === 'box-collider-2d') { vec(component.size, 2, `${path}.size`); vec(component.offset, 2, `${path}.offset`); bool(component.isTrigger, `${path}.isTrigger`) }
  else if (type === 'circle-collider-2d') { number(component.radius, `${path}.radius`); vec(component.offset, 2, `${path}.offset`); bool(component.isTrigger, `${path}.isTrigger`) }
  else if (type === 'capsule-collider-2d') { vec(component.size, 2, `${path}.size`); vec(component.offset, 2, `${path}.offset`); if (!['horizontal', 'vertical'].includes(String(component.direction))) invalid(`${path}.direction`, 'unsupported'); bool(component.isTrigger, `${path}.isTrigger`) }
  else if (type === 'polygon-collider-2d') { if (!Array.isArray(component.points) || component.points.length < 3) invalid(`${path}.points`, 'expected at least three points'); component.points.forEach((point, index) => vec(point, 2, `${path}.points[${index}]`)); vec(component.offset, 2, `${path}.offset`); bool(component.isTrigger, `${path}.isTrigger`) }
  else if (type === 'box-collider') { vec(component.size, 3, `${path}.size`); vec(component.center, 3, `${path}.center`); bool(component.isTrigger, `${path}.isTrigger`) }
  else if (type === 'sphere-collider') { number(component.radius, `${path}.radius`); vec(component.center, 3, `${path}.center`); bool(component.isTrigger, `${path}.isTrigger`) }
  else if (type === 'capsule-collider') { number(component.radius, `${path}.radius`); number(component.height, `${path}.height`); vec(component.center, 3, `${path}.center`); if (!['x', 'y', 'z'].includes(String(component.direction))) invalid(`${path}.direction`, 'unsupported'); bool(component.isTrigger, `${path}.isTrigger`) }
  else if (type === 'mesh-collider') { if (component.assetId !== undefined) text(component.assetId, `${path}.assetId`); bool(component.convex, `${path}.convex`); bool(component.isTrigger, `${path}.isTrigger`); json(component.properties, `${path}.properties`) }
  else if (type === 'particle-system-renderer') { if (component.assetId !== undefined) text(component.assetId, `${path}.assetId`); if (component.textureAssetId !== undefined) text(component.textureAssetId, `${path}.textureAssetId`); assertMaterial(component.material, `${path}.material`); json(component.properties, `${path}.properties`) }
  else if (type === 'light-2d' || type === 'light') { const light = record(component.light, `${path}.light`); if (!['ambient', 'directional', 'point', 'spot'].includes(String(light.kind))) invalid(`${path}.light.kind`, 'unsupported'); text(light.color, `${path}.light.color`); if (number(light.intensity, `${path}.light.intensity`) < 0) invalid(`${path}.light.intensity`, 'negative'); if (light.alpha !== undefined) { const alpha = number(light.alpha, `${path}.light.alpha`); if (alpha < 0 || alpha > 1) invalid(`${path}.light.alpha`, 'outside 0..1') } }
  else if (type === 'camera') { bool(component.orthographic, `${path}.orthographic`); if (component.orthographicSize !== undefined && number(component.orthographicSize, `${path}.orthographicSize`) <= 0) invalid(`${path}.orthographicSize`, 'must be positive'); if (component.nearClip !== undefined) number(component.nearClip, `${path}.nearClip`); if (component.farClip !== undefined) number(component.farClip, `${path}.farClip`); json(component.properties, `${path}.properties`) }
  else if (type === 'rigidbody') { bool(component.isKinematic, `${path}.isKinematic`); bool(component.useGravity, `${path}.useGravity`); if (number(component.mass, `${path}.mass`) <= 0) invalid(`${path}.mass`, 'must be positive'); json(component.properties, `${path}.properties`) }
  else if (type === 'canvas') { if (!['screen-space-overlay', 'screen-space-camera', 'world-space'].includes(String(component.renderMode))) invalid(`${path}.renderMode`, 'unsupported'); json(component.properties, `${path}.properties`) }
  else if (type === 'rect-transform') { for (const key of ['anchorMin', 'anchorMax', 'pivot', 'anchoredPosition', 'sizeDelta']) vec(component[key], 2, `${path}.${key}`); json(component.properties, `${path}.properties`) }
  else if (type === 'text') { if (typeof component.text !== 'string') invalid(`${path}.text`, 'expected text'); json(component.properties, `${path}.properties`) }
  else if (['grid', 'rigidbody-2d', 'audio-source', 'audio-listener', 'particle-system', 'canvas-renderer'].includes(type)) json(component.properties, `${path}.properties`)
  else if (type === 'animator') json(component.controller, `${path}.controller`)
}

function assertSource(input: unknown, path: string) {
  const value = record(input, path), source = record(value.source, `${path}.source`)
  if (source.kind === 'fixture') {
    text(source.fixtureId, `${path}.source.fixtureId`)
    if (typeof source.fixtureDigest !== 'string' || !DIGEST.test(source.fixtureDigest)) invalid(`${path}.source.fixtureDigest`, 'expected SHA-256')
  } else if (source.kind === 'published-ir' || source.kind === 'content-package') {
    text(source.publicationId, `${path}.source.publicationId`)
    for (const key of ['candidateDigest', 'sourceInputDigest']) {
      if (source.kind === 'content-package' && source[key] === undefined) continue
      if (typeof source[key] !== 'string' || !DIGEST.test(source[key] as string)) invalid(`${path}.source.${key}`, 'expected SHA-256')
    }
  } else invalid(`${path}.source.kind`, 'unsupported')
  if (typeof value.contentDigest !== 'string' || !DIGEST.test(value.contentDigest)) invalid(`${path}.contentDigest`, 'expected SHA-256')
  for (const key of ['contentRevision', 'contentSchemaVersion', 'adapterId', 'adapterVersion']) text(value[key], `${path}.${key}`)
}
export function assertSceneNode(input: unknown, path = 'gameObject'): asserts input is SceneNode { const value = record(input, path); for (const legacy of ['kind', 'visible', 'material', 'light', 'volume', 'assetId', 'unknown']) if (legacy in value) invalid(`${path}.${legacy}`, 'legacy scene field is forbidden'); text(value.id, `${path}.id`); text(value.name, `${path}.name`); if (value.parentId !== null) text(value.parentId, `${path}.parentId`); if (!Array.isArray(value.children) || new Set(value.children).size !== value.children.length) invalid(`${path}.children`, 'expected unique IDs'); value.children.forEach((id, index) => text(id, `${path}.children[${index}]`)); bool(value.active, `${path}.active`); bool(value.locked, `${path}.locked`); assertTransform(value.transform, `${path}.transform`); if (!Array.isArray(value.tags) || new Set(value.tags).size !== value.tags.length) invalid(`${path}.tags`, 'expected unique tags'); value.tags.forEach((tag, index) => text(tag, `${path}.tags[${index}]`)); if (!Array.isArray(value.components)) invalid(`${path}.components`, 'expected array'); const ids = new Set<string>(); value.components.forEach((component, index) => assertComponent(component, `${path}.components[${index}]`, ids)); if (value.metadata !== undefined) json(value.metadata, `${path}.metadata`) }
function assertAsset(input: unknown, path: string): asserts input is SceneAsset { const value = record(input, path); for (const key of ['id', 'name', 'mimeType', 'path']) text(value[key], `${path}.${key}`); const assetPath = value.path as string; if (assetPath.startsWith('/') || assetPath.includes('\\') || assetPath.split('/').includes('..')) invalid(`${path}.path`, 'unsafe path') }
export function assertSceneSettings(input: unknown): asserts input is SceneSettings {
  const value = record(input, 'settings'); const hex = /^#[0-9a-f]{6}$/i
  for (const key of ['background', 'ambientColor', 'fogColor']) { const color = text(value[key], `settings.${key}`); if (!hex.test(color)) invalid(`settings.${key}`, 'expected #RRGGBB color') }
  if (value.selectionColor !== undefined) { const color = text(value.selectionColor, 'settings.selectionColor'); if (!hex.test(color)) invalid('settings.selectionColor', 'expected #RRGGBB color') }
  bool(value.showGrid, 'settings.showGrid'); bool(value.fogEnabled, 'settings.fogEnabled')
  const ambientIntensity = number(value.ambientIntensity, 'settings.ambientIntensity'); if (ambientIntensity < 0 || ambientIntensity > 20) invalid('settings.ambientIntensity', 'must be between 0 and 20')
  const exposure = number(value.exposure, 'settings.exposure'); if (exposure < .1 || exposure > 5) invalid('settings.exposure', 'must be between 0.1 and 5')
  const fogNear = number(value.fogNear, 'settings.fogNear'); if (fogNear < 0) invalid('settings.fogNear', 'must not be negative')
  const fogFar = number(value.fogFar, 'settings.fogFar'); if (fogFar <= fogNear) invalid('settings.fogFar', 'must be greater than fogNear')
  if (value.selectionWidth !== undefined) { const width = number(value.selectionWidth, 'settings.selectionWidth'); if (width < 1 || width > 8) invalid('settings.selectionWidth', 'must be between 1 and 8') }
}

export function assertSceneDocument(input: unknown): asserts input is SceneDocument {
  json(input, 'document'); const value = record(input, 'document'); if (value.schemaVersion !== 'scene-game-object.v2') invalid('document.schemaVersion', 'unsupported schema'); if (!['2d', '3d'].includes(String(value.dimension))) invalid('document.dimension', 'expected 2d or 3d'); text(value.id, 'document.id'); text(value.name, 'document.name'); if (!Number.isInteger(number(value.revision, 'document.revision')) || (value.revision as number) < 0) invalid('document.revision', 'invalid'); assertSource(value.source, 'document.source'); if (value.settings !== undefined) assertSceneSettings(value.settings)
  if (!Array.isArray(value.rootIds) || new Set(value.rootIds).size !== value.rootIds.length) invalid('document.rootIds', 'expected unique roots'); const nodes = record(value.nodes, 'document.nodes'); const assets = record(value.assets, 'document.assets'); for (const [id, node] of Object.entries(nodes)) { assertSceneNode(node, `document.nodes.${id}`); if ((node as SceneNode).id !== id) invalid(`document.nodes.${id}`, 'map key mismatch') } for (const [id, asset] of Object.entries(assets)) { assertAsset(asset, `document.assets.${id}`); if ((asset as SceneAsset).id !== id) invalid(`document.assets.${id}`, 'map key mismatch') }
  const roots = new Set(value.rootIds as string[]); for (const root of roots) if (!nodes[root]) invalid('document.rootIds', `missing ${root}`); for (const node of Object.values(nodes) as SceneNode[]) { if ((node.parentId === null) !== roots.has(node.id)) invalid(`document.nodes.${node.id}.parentId`, 'root mismatch'); for (const childId of node.children) { const child = nodes[childId] as SceneNode | undefined; if (!child || child.parentId !== node.id) invalid(`document.nodes.${node.id}.children`, `invalid child ${childId}`) } const types = new Set(node.components.map(component => component.type)); if ((types.has('image') || types.has('text')) && !types.has('rect-transform')) invalid(`document.nodes.${node.id}.components`, 'Image and Text require RectTransform'); if (types.has('rigidbody') && types.has('rigidbody-2d')) invalid(`document.nodes.${node.id}.components`, 'cannot mix Rigidbody and Rigidbody2D'); if (types.has('mesh-renderer') && !types.has('mesh-filter')) invalid(`document.nodes.${node.id}.components`, 'MeshRenderer requires MeshFilter'); if (types.has('tilemap-renderer') && !types.has('tilemap')) invalid(`document.nodes.${node.id}.components`, 'TilemapRenderer requires Tilemap'); if (types.has('particle-system-renderer') && !types.has('particle-system')) invalid(`document.nodes.${node.id}.components`, 'ParticleSystemRenderer requires ParticleSystem'); for (const component of node.components) { const references: Array<string | undefined> = []; if ('assetId' in component) references.push(component.assetId); if (component.type === 'text') references.push(component.fontAssetId); if (component.type === 'particle-system-renderer') references.push(component.textureAssetId); for (const id of references.filter((entry): entry is string => Boolean(entry))) if (!assets[id]) invalid(`document.nodes.${node.id}.components`, `missing asset ${id}`) } }
  const dataNodes = (Object.values(nodes) as SceneNode[]).map(node => ({ ...node, components: node.components.map(c => ({ type: c.type, data: 'properties' in c ? c.properties : {} })) }))
  for (const node of Object.values(nodes) as SceneNode[]) for (const component of node.components) if (component.type === 'tilemap') {
    if (value.dimension !== '2d') invalid(node.id, 'Tilemap requires a 2D scene')
    if (!node.components.some(c => c.type === 'tilemap-renderer')) invalid(node.id, 'Tilemap requires TilemapRenderer')
    const map = parseTilemapData(component.properties)
    validateTilemapGrid(dataNodes, dataNodes.find(n => n.id === node.id)!, map)
    const set = parseTileSet((assets[component.assetId] as SceneAsset).tileSet)
    for (const cell of map.cells) if (!Object.hasOwn(set.tiles, cell.tileId)) invalid(node.id, `missing tile ${cell.tileId}`)
  }
  const visited = new Set<string>(), visiting = new Set<string>(); const walk = (id: string) => { if (visiting.has(id)) invalid(`document.nodes.${id}`, 'hierarchy cycle'); if (visited.has(id)) return; visiting.add(id); (nodes[id] as SceneNode).children.forEach(walk); visiting.delete(id); visited.add(id) }; roots.forEach(walk); if (visited.size !== Object.keys(nodes).length) invalid('document.nodes', 'unreachable GameObjects'); if (!Array.isArray(value.diagnostics)) invalid('document.diagnostics', 'expected array')
}
