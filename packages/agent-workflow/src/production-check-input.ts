import { string, object, record, union, literal } from 'zod'
import type { z } from 'zod'
import { PROJECT_DOCUMENTS, designReviewResultSchema } from './design-review-result'

const hash = string().regex(/^[a-f0-9]{64}$/)
const relativePath = string().refine(path => !!path && !path.startsWith('/') && !path.includes('\\') &&
  !path.split('/').some(part => !part || part === '.' || part === '..'))

/** A copy of the existing confirmed inputs, never a second editable authority. */
export const productionDesignBaselineSchema = object({
  digestVersion: union([literal(1), literal(2)]),
  snapshots: record(string().refine(name => PROJECT_DOCUMENTS.some(document => document === name)), hash)
    .refine(value => Object.keys(value).length > 0),
  evidenceHashes: record(relativePath, hash),
  followUps: designReviewResultSchema.shape.findings.optional(),
})
export const productionCheckInputSchema = object({
  objective: string(),
  baseline: productionDesignBaselineSchema,
})
export type ProductionDesignBaseline = z.infer<typeof productionDesignBaselineSchema>
export type ProductionCheckInput = z.infer<typeof productionCheckInputSchema>
