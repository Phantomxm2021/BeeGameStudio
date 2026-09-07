import type { FoundationDocumentPath } from './types'

export const INITIAL_FOUNDATION_UPSTREAM_PATHS: Record<
  FoundationDocumentPath,
  readonly FoundationDocumentPath[]
> = {
  'docs/GDD.md': [],
  'docs/LEVEL_SCENE_DESIGN.md': ['docs/GDD.md'],
  'docs/BALANCE_DESIGN.md': ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
  'docs/TECHNICAL_DESIGN.md': [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
  ],
  'docs/ART_DIRECTION.md': ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
  'docs/UI_UX_SPEC.md': ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
  'docs/AUDIO_DESIGN.md': [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/UI_UX_SPEC.md',
  ],
  'docs/ASSET_PLAN.md': [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/TECHNICAL_DESIGN.md',
    'docs/ART_DIRECTION.md',
    'docs/UI_UX_SPEC.md',
    'docs/AUDIO_DESIGN.md',
  ],
}
