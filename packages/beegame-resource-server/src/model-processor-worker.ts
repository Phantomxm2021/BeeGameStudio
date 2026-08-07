import createAssimp from 'assimpjs'
import type { ResourceInspectionFacts } from './model-processing'
import type { ResourceModelPreviewGeometry, ResourceModelPreviewMesh } from './model-preview'
import { normalizeResourceReference } from './resource-dependency-bindings'

type JsonRecord = Record<string, unknown>
const MAX_PREVIEW_MESHES = 64
const MAX_PREVIEW_VERTICES = 4096
const MAX_PREVIEW_FACES = 4096

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
  const sourceBounds = emptyBounds()
  const meshBounds: Bounds[] = []
  let hasNormals = false
  let hasTextureCoordinates = false
  for (const mesh of meshes) {
    const positions = Array.isArray(mesh.vertices) ? mesh.vertices : []
    vertices += countPositions(positions)
    const bounds = emptyBounds()
    includePositions(bounds, positions)
    meshBounds.push(bounds)
    includeBounds(sourceBounds, bounds)
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
  const transformedBounds = collectSceneBounds(root.rootnode, meshBounds)
  appendBoundsFacts(facts, transformedBounds.seen ? transformedBounds : sourceBounds)
  if (externalReferences.size) {
    const references = [...externalReferences]
    facts.textureReferences = references.join(' · ')
    facts.externalReferences = JSON.stringify(references)
  }
  return facts
}

export function extractAssimpPreviewGeometry(document: unknown): ResourceModelPreviewGeometry {
  const root = asRecord(document)
  const meshes = asRecords(root?.meshes)
  const output: ResourceModelPreviewMesh[] = []
  let totalFaces = 0

  const appendMesh = (meshIndex: number, transform: Matrix4): void => {
    if (output.length >= MAX_PREVIEW_MESHES || totalFaces >= MAX_PREVIEW_FACES) return
    const mesh = meshes[meshIndex]
    if (!mesh) return
    const sourceVertices = asPreviewPoints(mesh.vertices).slice(0, MAX_PREVIEW_VERTICES)
    const vertices = sourceVertices.map(point => transformPoint(transform, point) as [number, number, number])
    const faces: [number, number, number][] = []
    for (const face of asNumericArrays(mesh.faces)) {
      for (let index = 1; index + 1 < face.length && faces.length < MAX_PREVIEW_FACES - totalFaces; index += 1) {
        const triangle = [face[0]!, face[index]!, face[index + 1]!] as [number, number, number]
        if (triangle.every(value => Number.isInteger(value) && value >= 0 && value < vertices.length)) faces.push(triangle)
      }
      if (faces.length >= MAX_PREVIEW_FACES - totalFaces) break
    }
    if (vertices.length && faces.length) {
      output.push({ vertices, faces })
      totalFaces += faces.length
    }
  }

  const visit = (value: unknown, parent: Matrix4): void => {
    const node = asRecord(value)
    if (!node) return
    const transform = multiplyMatrices(parent, readMatrix(node.transformation))
    for (const meshIndex of Array.isArray(node.meshes) ? node.meshes : []) {
      if (typeof meshIndex === 'number' && Number.isInteger(meshIndex)) appendMesh(meshIndex, transform)
    }
    for (const child of asRecords(node.children)) visit(child, transform)
  }

  if (root?.rootnode) visit(root.rootnode, IDENTITY_MATRIX)
  if (!output.length) meshes.forEach((_mesh, index) => appendMesh(index, IDENTITY_MATRIX))
  return { meshes: output }
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
  if (positions.length && asPosition(positions[0])) {
    for (const position of positions) {
      const point = asPosition(position)
      if (point) includePoint(bounds, point)
    }
    return
  }
  for (let index = 0; index + 2 < positions.length; index += 3) includePoint(bounds, positions.slice(index, index + 3))
}

function countPositions(positions: unknown[]): number {
  if (!positions.length) return 0
  return Array.isArray(positions[0]) || asPosition(positions[0])
    ? positions.length
    : Math.floor(positions.length / 3)
}

function asPosition(value: unknown): unknown[] | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  const point = [record.x ?? record[0], record.y ?? record[1], record.z ?? record[2]]
  return point.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate)) ? point : undefined
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

function includeBounds(target: Bounds, source: Bounds): void {
  if (!source.seen) return
  includePoint(target, source.min)
  includePoint(target, source.max)
}

type Matrix4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
]

const IDENTITY_MATRIX: Matrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]

function collectSceneBounds(rootNode: unknown, meshBounds: Bounds[]): Bounds {
  const collected = emptyBounds()
  visitSceneNode(rootNode, IDENTITY_MATRIX, meshBounds, collected)
  return collected
}

function visitSceneNode(
  value: unknown,
  parentTransform: Matrix4,
  meshBounds: Bounds[],
  collected: Bounds,
): void {
  const node = asRecord(value)
  if (!node) return
  const worldTransform = multiplyMatrices(parentTransform, readMatrix(node.transformation))
  const meshIndexes = Array.isArray(node.meshes) ? node.meshes.map(Number) : []
  for (const meshIndex of meshIndexes) {
    if (!Number.isInteger(meshIndex) || meshIndex < 0) continue
    const bounds = meshBounds[meshIndex]
    if (bounds?.seen) includeTransformedBounds(collected, bounds, worldTransform)
  }
  for (const child of asRecords(node.children)) {
    visitSceneNode(child, worldTransform, meshBounds, collected)
  }
}

function readMatrix(value: unknown): Matrix4 {
  const flattened = Array.isArray(value)
    ? value.flatMap(entry => Array.isArray(entry) ? entry : [entry]).map(Number)
    : []
  if (flattened.length !== 16 || flattened.some(entry => !Number.isFinite(entry))) return IDENTITY_MATRIX
  return flattened as Matrix4
}

function multiplyMatrices(left: Matrix4, right: Matrix4): Matrix4 {
  const output = Array<number>(16).fill(0)
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      for (let index = 0; index < 4; index += 1) {
        const outputIndex = row * 4 + column
        output[outputIndex] = output[outputIndex]! + left[row * 4 + index]! * right[index * 4 + column]!
      }
    }
  }
  return output as Matrix4
}

function includeTransformedBounds(target: Bounds, source: Bounds, transform: Matrix4): void {
  for (const x of [source.min[0], source.max[0]]) {
    for (const y of [source.min[1], source.max[1]]) {
      for (const z of [source.min[2], source.max[2]]) {
        includePoint(target, transformPoint(transform, [x, y, z]))
      }
    }
  }
}

function transformPoint(matrix: Matrix4, point: [number, number, number]): number[] {
  const [x, y, z] = point
  const w = matrix[12] * x + matrix[13] * y + matrix[14] * z + matrix[15]
  const divisor = w && w !== 1 ? w : 1
  return [
    (matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3]) / divisor,
    (matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7]) / divisor,
    (matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11]) / divisor,
  ]
}

function appendBoundsFacts(facts: ResourceInspectionFacts, bounds: Bounds): void {
  if (!bounds.seen) return
  const axes = ['X', 'Y', 'Z'] as const
  for (let axis = 0; axis < 3; axis += 1) {
    facts[`boundsMin${axes[axis]}`] = bounds.min[axis]
    facts[`boundsMax${axes[axis]}`] = bounds.max[axis]
    facts[`boundsSize${axes[axis]}`] = bounds.max[axis] - bounds.min[axis]
    facts[`boundsCenter${axes[axis]}`] = (bounds.min[axis] + bounds.max[axis]) / 2
  }
  facts.groundOffsetY = -bounds.min[1]
  facts.centeringOffsetX = -(bounds.min[0] + bounds.max[0]) / 2
  facts.centeringOffsetZ = -(bounds.min[2] + bounds.max[2]) / 2
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
  if (process.argv.includes('--preview')) process.stdout.write(JSON.stringify({ geometry: extractAssimpPreviewGeometry(document) }))
  else process.stdout.write(JSON.stringify(inspectAssimpDocument(document)))
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

function asNumericArrays(value: unknown): number[][] {
  return Array.isArray(value)
    ? value
      .filter((item): item is unknown[] => Array.isArray(item))
      .map(item => item.filter((entry): entry is number => typeof entry === 'number' && Number.isInteger(entry)))
    : []
}

function asPreviewPoints(value: unknown): [number, number, number][] {
  if (!Array.isArray(value)) return []
  if (value.length && isPreviewPoint(value[0])) return value.filter(isPreviewPoint)
  const points: [number, number, number][] = []
  for (let index = 0; index + 2 < value.length; index += 3) {
    const point = value.slice(index, index + 3)
    if (isPreviewPoint(point)) points.push(point)
  }
  return points
}

function isPreviewPoint(value: unknown): value is [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return false
  return value.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate))
}

if (import.meta.main) {
  await main().catch(error => {
    process.stderr.write(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
