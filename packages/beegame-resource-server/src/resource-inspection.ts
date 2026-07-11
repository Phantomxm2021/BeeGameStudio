type JsonRecord = Record<string, unknown>

/** Extracts deterministic technical facts from formats we can safely inspect in-process. */
export async function inspectUploadedResource(file: File): Promise<Record<string, string | number | boolean>> {
  const extension = extensionOf(file.name)
  const bytes = new Uint8Array(await file.arrayBuffer())
  let facts: Record<string, string | number | boolean> = {}
  if (extension === 'png') facts = inspectPng(bytes)
  else if (extension === 'glb') facts = inspectGlb(bytes)
  else if (extension === 'gltf') facts = inspectGltfText(new TextDecoder().decode(bytes))
  else if (extension === 'obj') facts = inspectObjText(new TextDecoder().decode(bytes))
  else if (extension === 'fbx') facts = inspectFbx(bytes)
  return { ...facts, contentHash: await sha256(bytes) }
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
  let triangles = 0
  let vertices = 0
  for (const mesh of meshes) for (const primitive of asRecords(mesh.primitives)) {
    const attributes = asRecord(primitive.attributes)
    const positionIndex = typeof attributes?.POSITION === 'number' ? attributes.POSITION : undefined
    if (positionIndex !== undefined) vertices += numberAt(accessors, positionIndex, 'count')
    const indexAccessor = typeof primitive.indices === 'number' ? primitive.indices : undefined
    triangles += indexAccessor === undefined ? 0 : Math.floor(numberAt(accessors, indexAccessor, 'count') / 3)
  }
  const result: Record<string, string | number | boolean> = { vertices, triangles, materialCount: materials.length, embeddedTextureCount: images.length }
  const externalTextures = images.map((image) => typeof image.uri === 'string' ? image.uri : '').filter(Boolean)
  if (externalTextures.length) result.textureReferences = externalTextures.join(' · ')
  return result
}

function inspectObjText(text: string): Record<string, string | number | boolean> {
  let vertices = 0
  let triangles = 0
  const materials = new Set<string>()
  const materialLibraries = new Set<string>()
  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.trim()
    if (line.startsWith('v ')) vertices += 1
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
  const result: Record<string, string | number | boolean> = { vertices, triangles, materialCount: materials.size }
  if (materialLibraries.size) result.materialReferences = [...materialLibraries].join(' · ')
  return result
}

function inspectFbx(bytes: Uint8Array): Record<string, string | number | boolean> {
  const text = new TextDecoder().decode(bytes)
  if (text.startsWith('Kaydara FBX Binary')) {
    return { inspectionStatus: 'binary_fbx_requires_processor' }
  }
  const vertices = numberListAfter(text, 'Vertices:').length / 3
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
  }
  if (texturePaths.size) result.textureReferences = [...texturePaths].join(' · ')
  return result
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
