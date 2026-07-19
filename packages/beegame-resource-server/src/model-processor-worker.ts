import createAssimp from 'assimpjs'
import type { ResourceInspectionFacts } from './model-processing'
import { normalizeResourceReference } from './resource-dependency-bindings'

type JsonRecord = Record<string, unknown>

export function inspectAssimpDocument(document: unknown): ResourceInspectionFacts {
  const root = asRecord(document)
  if (!root) throw new Error('Assimp returned an invalid document')
  const meshes = asRecords(root.meshes)
  const animations = asRecords(root.animations)
  const materials = asRecords(root.materials)
  const textures = asRecords(root.textures)
  let vertices = 0
  let triangles = 0
  let skinnedMeshes = 0
  let morphTargets = 0
  const bounds = emptyBounds()
  let hasNormals = false
  let hasTextureCoordinates = false
  for (const mesh of meshes) {
    const positions = Array.isArray(mesh.vertices) ? mesh.vertices : []
    vertices += positions.length && Array.isArray(positions[0]) ? positions.length : Math.floor(positions.length / 3)
    includePositions(bounds, positions)
    hasNormals ||= Array.isArray(mesh.normals) && mesh.normals.length > 0
    hasTextureCoordinates ||= Array.isArray(mesh.texturecoords) && mesh.texturecoords.some(channel => Array.isArray(channel) && channel.length > 0)
    const faces = Array.isArray(mesh.faces) ? mesh.faces : []
    for (const face of faces) if (Array.isArray(face) && face.length >= 3) triangles += face.length - 2
    if (asRecords(mesh.bones).length) skinnedMeshes += 1
    morphTargets += asRecords(mesh.animmeshes).length
  }
  const externalReferences = new Set<string>()
  for (const material of materials) for (const property of asRecords(material.properties)) {
    if (property.key !== '$tex.file' || typeof property.value !== 'string') continue
    const reference = normalizeResourceReference(property.value)
    if (reference) externalReferences.add(reference)
  }
  const facts: ResourceInspectionFacts = {
    vertices,
    triangles,
    meshCount: meshes.length,
    skinCount: skinnedMeshes ? 1 : 0,
    skinnedMeshCount: skinnedMeshes,
    animationCount: animations.length,
    materialCount: materials.length,
    embeddedTextureCount: textures.length,
    morphTargetCount: morphTargets,
    sceneNodeCount: countSceneNodes(root.rootnode),
    inspectionStatus: 'complete',
    processor: 'assimpjs',
    processorVersion: '0.0.10',
    hasNormals,
    hasTextureCoordinates,
  }
  appendBoundsFacts(facts, bounds)
  if (externalReferences.size) {
    const references = [...externalReferences]
    facts.textureReferences = references.join(' · ')
    facts.externalReferences = JSON.stringify(references)
  }
  return facts
}

type Bounds = { min: [number, number, number]; max: [number, number, number]; seen: boolean }

function emptyBounds(): Bounds {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], seen: false }
}

function includePositions(bounds: Bounds, positions: unknown[]): void {
  if (positions.length && Array.isArray(positions[0])) {
    for (const position of positions) if (Array.isArray(position)) includePoint(bounds, position)
    return
  }
  for (let index = 0; index + 2 < positions.length; index += 3) includePoint(bounds, positions.slice(index, index + 3))
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

function appendBoundsFacts(facts: ResourceInspectionFacts, bounds: Bounds): void {
  if (!bounds.seen) return
  const axes = ['X', 'Y', 'Z'] as const
  for (let axis = 0; axis < 3; axis += 1) {
    facts[`boundsMin${axes[axis]}`] = bounds.min[axis]
    facts[`boundsMax${axes[axis]}`] = bounds.max[axis]
    facts[`boundsSize${axes[axis]}`] = bounds.max[axis] - bounds.min[axis]
  }
}

async function main(): Promise<void> {
  const filename = process.argv[2]?.trim()
  if (!filename) throw new Error('Model processor filename is required')
  const bytes = new Uint8Array(await Bun.stdin.arrayBuffer())
  if (!bytes.length) throw new Error('Model processor input is empty')
  const assimp = await createAssimp()
  const files = new assimp.FileList()
  files.AddFile(filename, bytes)
  const converted = assimp.ConvertFileList(files, 'assjson')
  if (!converted.IsSuccess() || converted.FileCount() < 1) throw new Error(`Assimp conversion failed (${converted.GetErrorCode()})`)
  const document = JSON.parse(new TextDecoder().decode(converted.GetFile(0).GetContent())) as unknown
  process.stdout.write(JSON.stringify(inspectAssimpDocument(document)))
}

function countSceneNodes(value: unknown): number {
  const node = asRecord(value)
  if (!node) return 0
  return 1 + asRecords(node.children).reduce((total, child) => total + countSceneNodes(child), 0)
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is JsonRecord => Boolean(item)) : []
}

if (import.meta.main) {
  await main().catch(error => {
    process.stderr.write(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
