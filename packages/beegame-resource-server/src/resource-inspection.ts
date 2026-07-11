type JsonRecord = Record<string, unknown>

/** Extracts deterministic technical facts from formats we can safely inspect in-process. */
export async function inspectUploadedResource(file: File): Promise<Record<string, string | number | boolean>> {
  const extension = extensionOf(file.name)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (extension === 'png') return inspectPng(bytes)
  if (extension === 'glb') return inspectGlb(bytes)
  if (extension === 'gltf') return inspectGltfText(new TextDecoder().decode(bytes))
  return {}
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

function asRecord(value: unknown): JsonRecord | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined }
function asRecords(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.map(asRecord).filter((item): item is JsonRecord => Boolean(item)) : [] }
function numberAt(items: JsonRecord[], index: number, key: string): number { const value = items[index]?.[key]; return typeof value === 'number' && Number.isFinite(value) ? value : 0 }
function extensionOf(name: string): string { const dot = name.lastIndexOf('.'); return dot > 0 ? name.slice(dot + 1).toLowerCase() : '' }
