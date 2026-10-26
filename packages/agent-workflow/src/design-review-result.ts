import { array, enum as enumeration, object, string } from 'zod'
import type { z } from 'zod'

// One design source; professional ownership is expressed by its actual sections.
// Select professional Skills for the current task and actual dependencies.
export const PROJECT_DOCUMENTS = ['GDD.md'] as const

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
