import { sharp } from 'image-processor-napi'

export type ResourceModelPreviewMesh = {
  vertices: readonly (readonly [number, number, number])[]
  faces: readonly (readonly [number, number, number])[]
}

export type ResourceModelPreviewGeometry = {
  meshes: readonly ResourceModelPreviewMesh[]
}

const PREVIEW_SIZE = 128
const PREVIEW_PADDING = 12

/**
 * Renders only a temporary visual projection for semantic model input. It is
 * deliberately geometry-only and engine-neutral; the source model and its
 * Resource Library record are never changed.
 */
export async function renderResourceModelPreview(
  geometry: ResourceModelPreviewGeometry,
): Promise<File | undefined> {
  const polygons = collectProjectedPolygons(geometry)
  const body = polygons.length > 0
    ? polygons
      .sort((left, right) => left.depth - right.depth)
      .map(polygon => `<polygon points="${polygon.points}" fill="${polygon.color}" stroke="#cbd5e1" stroke-width="0.6" stroke-linejoin="round"/>`)
      .join('')
    : fallbackBounds(geometry)
  if (!body) return undefined

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_SIZE}" height="${PREVIEW_SIZE}" viewBox="0 0 ${PREVIEW_SIZE} ${PREVIEW_SIZE}"><rect width="100%" height="100%" fill="#181b1f"/><g>${body}</g></svg>`
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  const stableBytes = new Uint8Array(png.byteLength)
  stableBytes.set(png)
  return new File([stableBytes.buffer], 'model-preview.png', { type: 'image/png' })
}

type ProjectedPolygon = {
  points: string
  depth: number
  color: string
}

function collectProjectedPolygons(geometry: ResourceModelPreviewGeometry): ProjectedPolygon[] {
  const points: Array<[number, number, number]> = []
  const triangles: Array<{ vertices: [[number, number, number], [number, number, number], [number, number, number]]; depth: number; index: number }> = []
  for (const mesh of geometry.meshes) {
    const projected = mesh.vertices.map(projectPoint)
    const vertices = mesh.vertices
    for (const face of mesh.faces) {
      const indices = face.map(value => Math.trunc(value))
      if (indices.some(index => index < 0 || index >= vertices.length)) continue
      const triangle = [projected[indices[0]!]!, projected[indices[1]!]!, projected[indices[2]!]!] as [[number, number, number], [number, number, number], [number, number, number]]
      triangles.push({ vertices: triangle, depth: (triangle[0][2] + triangle[1][2] + triangle[2][2]) / 3, index: triangles.length })
      points.push(...triangle)
    }
  }
  if (!points.length) return []
  const bounds = projectedBounds(points)
  return triangles.map(triangle => ({
    points: triangle.vertices.map(([x, y]) => `${toCanvasX(x, bounds)},${toCanvasY(y, bounds)}`).join(' '),
    depth: triangle.depth,
    color: faceColor(triangle.index),
  }))
}

function projectPoint([x, y, z]: readonly [number, number, number]): [number, number, number] {
  return [(x + z) * 0.70710678, y + (x - z) * 0.22, x - z]
}

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

function projectedBounds(points: readonly [number, number, number][]): Bounds {
  return points.reduce<Bounds>((bounds, [x, y]) => ({
    minX: Math.min(bounds.minX, x), maxX: Math.max(bounds.maxX, x),
    minY: Math.min(bounds.minY, y), maxY: Math.max(bounds.maxY, y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity })
}

function fallbackBounds(geometry: ResourceModelPreviewGeometry): string | undefined {
  const points = geometry.meshes.flatMap(mesh => mesh.vertices.map(projectPoint))
  if (!points.length) return undefined
  const bounds = projectedBounds(points)
  const corners: Array<[number, number]> = [
    [bounds.minX, bounds.minY], [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY],
  ]
  return `<polygon points="${corners.map(([x, y]) => `${toCanvasX(x, bounds)},${toCanvasY(y, bounds)}`).join(' ')}" fill="#64748b" stroke="#cbd5e1" stroke-width="0.8"/>`
}

function toCanvasX(value: number, bounds: Bounds): number {
  return scale(value, bounds.minX, bounds.maxX)
}

function toCanvasY(value: number, bounds: Bounds): number {
  return PREVIEW_SIZE - scale(value, bounds.minY, bounds.maxY)
}

function scale(value: number, min: number, max: number): number {
  const span = Math.max(max - min, Number.EPSILON)
  return PREVIEW_PADDING + ((value - min) / span) * (PREVIEW_SIZE - PREVIEW_PADDING * 2)
}

function faceColor(index: number): string {
  const colors = ['#7dd3fc', '#a7f3d0', '#fcd34d', '#c4b5fd', '#fda4af', '#fdba74']
  return colors[index % colors.length]!
}
