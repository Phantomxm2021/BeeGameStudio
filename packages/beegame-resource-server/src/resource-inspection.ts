import type { ResourceContentProfile, ResourceEmbeddedComponent } from '@bee-game-studio/beegame-resource-core'
import type { ResourceModelProcessor } from './model-processing'
import { normalizeResourceReference } from './resource-dependency-bindings'

type JsonRecord = Record<string, unknown>

/** Extracts deterministic technical facts from formats we can safely inspect in-process. */
export async function inspectUploadedResource(file: File, options: { modelProcessor?: ResourceModelProcessor } = {}): Promise<Record<string, string | number | boolean>> {
  const extension = extensionOf(file.name)
  const bytes = new Uint8Array(await file.arrayBuffer())
  let facts: Record<string, string | number | boolean> = {}
  if (extension === 'png') facts = inspectPng(bytes)
  else if (extension === 'glb') facts = inspectGlb(bytes)
  else if (extension === 'gltf') facts = inspectGltfText(new TextDecoder().decode(bytes))
  else if (extension === 'obj') facts = inspectObjText(new TextDecoder().decode(bytes))
  else if (extension === 'fbx') facts = inspectFbx(bytes)
  if (facts.inspectionStatus === 'binary_fbx_requires_processor' && options.modelProcessor) {
    facts = { ...facts, ...await options.modelProcessor(file) }
  }
  return { ...facts, contentHash: await sha256(bytes) }
}

export function contentProfileFromInspection(
  facts: Record<string, string | number | boolean>,
): ResourceContentProfile {
  const components: ResourceEmbeddedComponent[] = []
  appendCountedComponents(components, 'mesh', Number(facts.meshCount ?? 0))
  appendCountedComponents(components, 'skeleton', Number(facts.skinCount ?? 0))
  appendCountedComponents(components, 'animation-clip', Number(facts.animationCount ?? 0))
  appendCountedComponents(components, 'material', Number(facts.materialCount ?? 0))
  appendCountedComponents(components, 'texture', Number(facts.embeddedTextureCount ?? 0))
  appendCountedComponents(components, 'morph-target', Number(facts.morphTargetCount ?? 0))
  appendCountedComponents(components, 'scene-node', Number(facts.sceneNodeCount ?? 0))
  const externalReferences = typeof facts.externalReferences === 'string' && facts.externalReferences !== '[]'
  const unavailable = facts.inspectionStatus === 'binary_fbx_requires_processor'
  return {
    packaging: externalReferences ? 'external-dependencies' : unavailable ? 'unknown' : 'self-contained',
    components,
    inspection: {
      status: unavailable ? 'unavailable' : 'complete',
      source: 'server',
      inspectedAt: new Date().toISOString(),
      inspectorVersion: 'resource-inspection-v1',
    },
  }
}

function appendCountedComponents(
  target: ResourceEmbeddedComponent[],
  kind: ResourceEmbeddedComponent['kind'],
  count: number,
): void {
  for (let index = 0; index < count; index += 1) target.push({ id: `${kind}:${index}`, kind })
}

async function sha256(bytes: Uint8Array): Promise<string> {
  // Copy into an ArrayBuffer so TypeScript does not treat a shared backing
  // buffer as a WebCrypto input (the File bytes are always immutable here).
  const input = new Uint8Array(bytes).buffer
  const digest = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

function inspectPng(bytes: Uint8Array): Record<string, number> {
  if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return {}
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function inspectGlb(bytes: Uint8Array): Record<string, string | number | boolean> {
  if (bytes.length < 20) return {}
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(16, true) !== 0x4e4f534a) return {}
  const length = view.getUint32(8, true)
  const jsonLength = view.getUint32(12, true)
  if (length > bytes.length || jsonLength > bytes.length - 20) return {}
  return inspectGltfText(new TextDecoder().decode(bytes.slice(20, 20 + jsonLength)))
}

function inspectGltfText(text: string): Record<string, string | number | boolean> {
  let document: JsonRecord
  try { document = JSON.parse(text) as JsonRecord } catch { return {} }
  const accessors = asRecords(document.accessors)
  const meshes = asRecords(document.meshes)
  const materials = asRecords(document.materials)
  const images = asRecords(document.images)
  const skins = asRecords(document.skins)
  const animations = asRecords(document.animations)
  let triangles = 0
  let vertices = 0
  const bounds = emptyBounds()
  let hasNormals = false
  let hasTextureCoordinates = false
  for (const mesh of meshes) for (const primitive of asRecords(mesh.primitives)) {
    const attributes = asRecord(primitive.attributes)
    const positionIndex = typeof attributes?.POSITION === 'number' ? attributes.POSITION : undefined
    if (positionIndex !== undefined) {
      vertices += numberAt(accessors, positionIndex, 'count')
      includeAccessorBounds(bounds, accessors[positionIndex])
    }
    hasNormals ||= typeof attributes?.NORMAL === 'number'
    hasTextureCoordinates ||= typeof attributes?.TEXCOORD_0 === 'number'
    const indexAccessor = typeof primitive.indices === 'number' ? primitive.indices : undefined
    triangles += indexAccessor === undefined ? 0 : Math.floor(numberAt(accessors, indexAccessor, 'count') / 3)
  }
  const morphTargetCount = meshes.reduce((total, mesh) => total + asRecords(mesh.primitives).reduce((primitiveTotal, primitive) => primitiveTotal + (Array.isArray(primitive.targets) ? primitive.targets.length : 0), 0), 0)
  const result: Record<string, string | number | boolean> = {
    vertices,
    triangles,
    meshCount: meshes.length,
    skinCount: skins.length,
    animationCount: animations.length,
    morphTargetCount,
    materialCount: materials.length,
    embeddedTextureCount: images.filter(image => typeof image.uri !== 'string' || !isExternalResourceUri(image.uri)).length,
    hasNormals,
    hasTextureCoordinates,
  }
  appendBoundsFacts(result, bounds)
  const externalTextures = images.map((image) => typeof image.uri === 'string' && isExternalResourceUri(image.uri) ? image.uri : '').filter(Boolean)
  const externalBuffers = asRecords(document.buffers).map((buffer) => typeof buffer.uri === 'string' && isExternalResourceUri(buffer.uri) ? buffer.uri : '').filter(Boolean)
  if (externalTextures.length) result.textureReferences = externalTextures.join(' · ')
  addExternalReferences(result, [...externalTextures, ...externalBuffers])
  return result
}

function isExternalResourceUri(value: string): boolean {
  return Boolean(value.trim()) && !value.trim().toLowerCase().startsWith('data:')
}

function inspectObjText(text: string): Record<string, string | number | boolean> {
  let vertices = 0
  let triangles = 0
  const materials = new Set<string>()
  const materialLibraries = new Set<string>()
  const bounds = emptyBounds()
  let hasNormals = false
  let hasTextureCoordinates = false
  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.trim()
    if (line.startsWith('v ')) {
      vertices += 1
      includePoint(bounds, line.slice(2).trim().split(/\s+/).slice(0, 3).map(Number))
    }
    else if (line.startsWith('vn ')) hasNormals = true
    else if (line.startsWith('vt ')) hasTextureCoordinates = true
    else if (line.startsWith('f ')) {
      const points = line.slice(2).trim().split(/\s+/).filter(Boolean).length
      if (points >= 3) triangles += points - 2
    } else if (line.startsWith('usemtl ')) {
      const material = line.slice(7).trim()
      if (material) materials.add(material)
    } else if (line.startsWith('mtllib ')) {
      const library = line.slice(7).trim()
      if (library) materialLibraries.add(library)
    }
  }
  const result: Record<string, string | number | boolean> = { vertices, triangles, materialCount: materials.size, hasNormals, hasTextureCoordinates }
  appendBoundsFacts(result, bounds)
  if (materialLibraries.size) result.materialReferences = [...materialLibraries].join(' · ')
  addExternalReferences(result, [...materialLibraries])
  return result
}

function inspectFbx(bytes: Uint8Array): Record<string, string | number | boolean> {
  const text = new TextDecoder().decode(bytes)
  if (text.startsWith('Kaydara FBX Binary')) {
    return { inspectionStatus: 'binary_fbx_requires_processor' }
  }
  const positionValues = numberListAfter(text, 'Vertices:')
  const vertices = positionValues.length / 3
  const polygonIndices = numberListAfter(text, 'PolygonVertexIndex:')
  let triangles = 0
  let polygonVertices = 0
  for (const index of polygonIndices) {
    polygonVertices += 1
    if (index < 0) {
      if (polygonVertices >= 3) triangles += polygonVertices - 2
      polygonVertices = 0
    }
  }
  const materials = matchedNames(text, /Material::([^",\r\n]+)/g)
  const texturePaths = matchedNames(text, /(?:RelativeFilename|FileName):\s*"([^"]+)"/g)
  const embeddedTextureCount = (text.match(/Content:\s*"/g) || []).length
  const result: Record<string, string | number | boolean> = {
    vertices: Number.isFinite(vertices) ? vertices : 0,
    triangles,
    materialCount: materials.size,
    embeddedTextureCount,
    hasNormals: text.includes('Normals:'),
    hasTextureCoordinates: text.includes('UV:'),
  }
  const bounds = emptyBounds()
  for (let index = 0; index + 2 < positionValues.length; index += 3) includePoint(bounds, positionValues.slice(index, index + 3))
  appendBoundsFacts(result, bounds)
  if (texturePaths.size) result.textureReferences = [...texturePaths].join(' · ')
  addExternalReferences(result, [...texturePaths])
  return result
}

function addExternalReferences(result: Record<string, string | number | boolean>, references: readonly string[]): void {
  const unique = [...new Set(references.map(normalizeResourceReference).filter((reference): reference is string => Boolean(reference)))]
  if (unique.length) result.externalReferences = JSON.stringify(unique)
}

type Bounds = { min: [number, number, number]; max: [number, number, number]; seen: boolean }

function emptyBounds(): Bounds {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], seen: false }
}

function includePoint(bounds: Bounds, value: unknown[]): void {
  const point = value.slice(0, 3).map(Number)
  if (point.length !== 3 || point.some(coordinate => !Number.isFinite(coordinate))) return
  bounds.seen = true
  for (let axis = 0; axis < 3; axis += 1) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]!)
    bounds.max[axis] = Math.max(bounds.max[axis], point[axis]!)
  }
}

function includeAccessorBounds(bounds: Bounds, accessor: JsonRecord | undefined): void {
  if (!accessor || !Array.isArray(accessor.min) || !Array.isArray(accessor.max)) return
  includePoint(bounds, accessor.min)
  includePoint(bounds, accessor.max)
}

function appendBoundsFacts(result: Record<string, string | number | boolean>, bounds: Bounds): void {
  if (!bounds.seen) return
  const axes = ['X', 'Y', 'Z'] as const
  for (let axis = 0; axis < 3; axis += 1) {
    result[`boundsMin${axes[axis]}`] = bounds.min[axis]
    result[`boundsMax${axes[axis]}`] = bounds.max[axis]
    result[`boundsSize${axes[axis]}`] = bounds.max[axis] - bounds.min[axis]
  }
}

function numberListAfter(text: string, label: string): number[] {
  const start = text.indexOf(label)
  if (start < 0) return []
  const opened = text.indexOf('a:', start)
  if (opened < 0) return []
  const end = text.indexOf('}', opened)
  const values = text.slice(opened + 2, end < 0 ? undefined : end).match(/-?\d+(?:\.\d+)?/g) || []
  return values.map(Number).filter(Number.isFinite)
}

function matchedNames(text: string, pattern: RegExp): Set<string> {
  const names = new Set<string>()
  for (const match of text.matchAll(pattern)) {
    const name = match[1]?.trim()
    if (name) names.add(name)
  }
  return names
}

function asRecord(value: unknown): JsonRecord | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined }
function asRecords(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.map(asRecord).filter((item): item is JsonRecord => Boolean(item)) : [] }
function numberAt(items: JsonRecord[], index: number, key: string): number { const value = items[index]?.[key]; return typeof value === 'number' && Number.isFinite(value) ? value : 0 }
function extensionOf(name: string): string { const dot = name.lastIndexOf('.'); return dot > 0 ? name.slice(dot + 1).toLowerCase() : '' }
