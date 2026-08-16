import type { FoundationDocumentPath } from './types'

export type FoundationDocumentLaneId =
  | 'core-design'
  | 'technical-assets'
  | 'presentation'

export type FoundationDocumentLane = Readonly<{
  id: FoundationDocumentLaneId
  ownedPaths: readonly FoundationDocumentPath[]
}>

export const FOUNDATION_DOCUMENT_LANES: readonly FoundationDocumentLane[] = Object.freeze([
  Object.freeze({
    id: 'core-design' as const,
    ownedPaths: Object.freeze([
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/BALANCE_DESIGN.md',
    ] satisfies FoundationDocumentPath[]),
  }),
  Object.freeze({
    id: 'technical-assets' as const,
    ownedPaths: Object.freeze([
      'docs/TECHNICAL_DESIGN.md',
      'docs/ASSET_PLAN.md',
    ] satisfies FoundationDocumentPath[]),
  }),
  Object.freeze({
    id: 'presentation' as const,
    ownedPaths: Object.freeze([
      'docs/ART_DIRECTION.md',
      'docs/UI_UX_SPEC.md',
      'docs/AUDIO_DESIGN.md',
    ] satisfies FoundationDocumentPath[]),
  }),
])

export function foundationDocumentLane(
  path: FoundationDocumentPath,
): FoundationDocumentLane {
  const lane = FOUNDATION_DOCUMENT_LANES.find(candidate =>
    candidate.ownedPaths.includes(path),
  )
  if (!lane) throw new Error(`foundation document lane is missing: ${path}`)
  return lane
}

export function foundationDocumentLaneById(
  laneId: FoundationDocumentLaneId,
): FoundationDocumentLane {
  const lane = FOUNDATION_DOCUMENT_LANES.find(candidate => candidate.id === laneId)
  if (!lane) throw new Error(`foundation document lane is missing: ${laneId}`)
  return lane
}
