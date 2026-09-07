/** Revision's private copy of the canonical document authority. */
export const CANONICAL_FOUNDATION_DOCUMENTS = [
  'docs/GDD.md',
  'docs/LEVEL_SCENE_DESIGN.md',
  'docs/BALANCE_DESIGN.md',
  'docs/TECHNICAL_DESIGN.md',
  'docs/ART_DIRECTION.md',
  'docs/UI_UX_SPEC.md',
  'docs/AUDIO_DESIGN.md',
  'docs/ASSET_PLAN.md',
] as const

export type FoundationDocumentPath =
  (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]
