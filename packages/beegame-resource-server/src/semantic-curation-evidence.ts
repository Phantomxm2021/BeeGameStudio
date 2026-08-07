import {
  normalizeResourceTechnicalFacts,
  type ResourceElement,
  type ResourceSemanticContentProjection,
  type ResourceSemanticVisualInput,
} from '@bee-game-studio/beegame-resource-core'
import { sharp } from 'image-processor-napi'

const PREVIEW_TILE_SIZE = 128
const ATLAS_COLUMNS = 4
const MAX_VISUAL_ITEMS = 8
const JPEG_QUALITY = 65
const ATLAS_MAX_BYTES = 512 * 1024

export function buildResourceSemanticContentProjection(
  element: ResourceElement,
): ResourceSemanticContentProjection {
  const sourceContentHash = element.specs.contentHash
  if (typeof sourceContentHash !== 'string' || !sourceContentHash.trim()) {
    throw new Error('Resource semantic curation requires an inspected content hash')
  }
  return {
    elementId: element.id,
    sourceContentHash: sourceContentHash.trim(),
    category: element.category,
    ...(element.assetKind ? { assetKind: element.assetKind } : {}),
    technicalFacts: normalizeResourceTechnicalFacts(element.specs),
    ...(element.contentProfile ? { contentProfile: element.contentProfile } : {}),
    dependencySummary: buildDependencySummary(element),
  }
}

export async function buildResourceSemanticVisualInput(
  inputs: readonly { elementId: string; file: File }[],
): Promise<ResourceSemanticVisualInput> {
  if (inputs.length === 0 || inputs.length > MAX_VISUAL_ITEMS) {
    throw new Error(`Resource semantic visual input supports one to ${MAX_VISUAL_ITEMS} items`)
  }
  const ids = inputs.map(input => input.elementId)
  if (ids.some(id => !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error('Resource semantic visual input element identities must be unique')
  }
  if (inputs.some(input => !input.file.type.trim().toLowerCase().startsWith('image/'))) {
    throw new Error('Resource semantic visual input must contain rendered images')
  }

  const previews = await Promise.all(inputs.map(async input => ({
    elementId: input.elementId,
    data: await normalizePreview(input.file),
  })))

  if (previews.length <= 2) {
    return {
      mode: 'individual',
      images: previews.map(preview => ({
        elementId: preview.elementId,
        mediaType: 'image/jpeg' as const,
        dataBase64: preview.data.toString('base64'),
      })),
    }
  }

  const columns = Math.min(ATLAS_COLUMNS, previews.length)
  const rows = Math.ceil(previews.length / columns)
  const width = columns * PREVIEW_TILE_SIZE
  const height = rows * PREVIEW_TILE_SIZE
  let atlas = await sharp({
    create: { width, height, channels: 3, background: { r: 24, g: 27, b: 31 } },
  })
    .composite(previews.map((preview, index) => ({
      input: preview.data,
      left: (index % columns) * PREVIEW_TILE_SIZE,
      top: Math.floor(index / columns) * PREVIEW_TILE_SIZE,
    })))
    .jpeg({ quality: JPEG_QUALITY, progressive: false })
    .toBuffer()

  if (atlas.byteLength > ATLAS_MAX_BYTES) {
    atlas = await sharp(atlas)
      .resize({ width: 768, withoutEnlargement: true })
      .jpeg({ quality: 50, progressive: false })
      .toBuffer()
  }

  return {
    mode: 'atlas',
    image: { mediaType: 'image/jpeg', dataBase64: atlas.toString('base64') },
    cells: previews.map((preview, ordinal) => ({ ordinal, elementId: preview.elementId })),
  }
}

function buildDependencySummary(element: ResourceElement) {
  return {
    declaredCount: element.dependencies.length,
    boundCount: element.dependencyBindings?.length ?? 0,
    relationKinds: [...new Set((element.relations ?? []).map(relation => relation.kind))].sort((left, right) => left.localeCompare(right)),
  }
}

async function normalizePreview(file: File): Promise<Buffer> {
  return sharp(Buffer.from(await file.arrayBuffer()))
    .resize(PREVIEW_TILE_SIZE, PREVIEW_TILE_SIZE, {
      fit: 'contain',
      background: { r: 24, g: 27, b: 31, alpha: 1 },
    })
    .jpeg({ quality: JPEG_QUALITY, progressive: false })
    .toBuffer()
}
