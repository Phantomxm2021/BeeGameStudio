import { z } from 'zod/v4'
import { relativeFoundationAuditArtifactPaths, type FoundationAuditManifest } from './foundation-audit-artifacts'
import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath } from './types'

export type FoundationAuditState = {
  status: 'index_staged'
  revision: string
  documentDigests: Record<FoundationDocumentPath, string>
  sectionIndexDigest: string
  sectionIndexPath: string
  manifestPath: string
  needsAction: 'foundation fact extraction is not part of Task 4A'
}
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const relativeArtifactPath = z.string().refine(value => value.startsWith('.beegame/audit/foundation/') && !value.startsWith('/') && !value.includes('..'), 'foundation audit artifact paths must remain project-local')
export const foundationAuditStateSchema: z.ZodType<FoundationAuditState> = z.object({
  status: z.literal('index_staged'), revision: z.string().min(1), documentDigests: z.record(z.string(), digestSchema), sectionIndexDigest: digestSchema, sectionIndexPath: relativeArtifactPath, manifestPath: relativeArtifactPath, needsAction: z.literal('foundation fact extraction is not part of Task 4A'),
}).strict().superRefine((state, context) => {
  const expected = [...CANONICAL_FOUNDATION_DOCUMENTS]
  const paths = Object.keys(state.documentDigests)
  if (paths.length !== expected.length || expected.some(path => !paths.includes(path))) context.addIssue({ code: 'custom', path: ['documentDigests'], message: 'foundation audit state must bind all eight canonical document digests' })
  const expectedPaths = relativeFoundationAuditArtifactPaths(state.revision)
  if (state.sectionIndexPath !== expectedPaths.sectionIndex || state.manifestPath !== expectedPaths.manifest) context.addIssue({ code: 'custom', path: ['sectionIndexPath'], message: 'foundation audit artifact paths are not bound to the state revision' })
})
export function parseFoundationAuditState(value: unknown): FoundationAuditState { return foundationAuditStateSchema.parse(value) }
export function createFoundationAuditState(input: { revision: string; documentDigests: readonly { path: FoundationDocumentPath; digest: string }[]; manifest: FoundationAuditManifest }): FoundationAuditState {
  const documentDigests = Object.fromEntries(input.documentDigests.map(item => [item.path, item.digest])) as Record<FoundationDocumentPath, string>
  const paths = relativeFoundationAuditArtifactPaths(input.revision)
  return parseFoundationAuditState({ status: 'index_staged', revision: input.revision, documentDigests, sectionIndexDigest: input.manifest.sectionIndexDigest, sectionIndexPath: paths.sectionIndex, manifestPath: paths.manifest, needsAction: 'foundation fact extraction is not part of Task 4A' })
}
