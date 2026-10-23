import { array, enum as enumeration, object, string } from 'zod'
import type { z } from 'zod'

// Document identities used by validation and persisted baseline hashing.
// Preserve this serialization order; writing order comes from DESIGN_METHODS below.
export const PROJECT_DOCUMENTS = [
  'GDD.md', 'LEVEL_SCENE_DESIGN.md', 'BALANCE_DESIGN.md', 'TECHNICAL_DESIGN.md',
  'ART_DIRECTION.md', 'UI_UX_SPEC.md', 'AUDIO_DESIGN.md', 'ASSET_PLAN.md',
] as const
// Default writing order and responsibilities. Procedure bodies stay in Skills;
// navigation and initial dispatch share this map, not another execution scheduler.
export const DESIGN_METHODS = {
  'GDD.md': { responsibility: 'direction/gameplay', skills: ['game-creative-director-expert', 'game-systems-designer-expert'] },
  'LEVEL_SCENE_DESIGN.md': { responsibility: 'levels/scenes', skills: ['game-level-designer-expert'] },
  'BALANCE_DESIGN.md': { responsibility: 'balance', skills: ['game-balance-designer-expert'] },
  'ART_DIRECTION.md': { responsibility: 'art', skills: ['game-art-director-expert'] },
  'UI_UX_SPEC.md': { responsibility: 'UI/UX', skills: ['game-ui-ux-designer'] },
  'AUDIO_DESIGN.md': { responsibility: 'audio', skills: ['game-audio-designer'] },
  'ASSET_PLAN.md': { responsibility: 'resources', skills: ['game-content-pipeline-engineer'] },
  'TECHNICAL_DESIGN.md': { responsibility: 'technology/tasks', skills: ['gameplay-programmer', 'game-implementation-planning'] },
} as const satisfies Record<typeof PROJECT_DOCUMENTS[number], { responsibility: string; skills: readonly string[] }>
export const DESIGN_WRITING_ORDER = Object.keys(DESIGN_METHODS) as Array<keyof typeof DESIGN_METHODS>

const text = string().trim().min(1)
const document = enumeration(PROJECT_DOCUMENTS)
export const designReviewResultSchema = object({ step: enumeration(['inspect', 'revise', 'verify']),
  findings: array(object({ id: text, severity: enumeration(['blocker', 'follow-up']), action: enumeration(['correct', 'decide', 'evidence']),
    owner: enumeration([...PROJECT_DOCUMENTS, 'user']), documents: array(document).min(1),
    sources: array(object({ document, section: text }).strict()).min(1), impact: text, closeWhen: text,
    neededBefore: enumeration([...PROJECT_DOCUMENTS, 'resources', 'content', 'implementation', 'acceptance']).nullable() }).strict()),
  resolved: array(object({ id: text, evidence: text,
    disposition: enumeration(['fixed', 'not-applicable']).optional() }).strict()),
  // Affected review names the earliest actually invalidated downstream work.
  resumeFrom: enumeration(['resources', 'content', 'implementation', 'acceptance']).optional(),
  resumeReason: text.optional(),
  // Execution failure is not itself a design finding or a missing user choice.
  blockedReason: text.optional(),
}).strict()
export type DesignReviewResult = z.infer<typeof designReviewResultSchema>
export type DesignReviewStep = DesignReviewResult['step']
export type DesignFinding = DesignReviewResult['findings'][number]
