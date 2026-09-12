import { z } from 'zod/v4'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { revisionCanonicalJson } from './json-digest'
import { bindRevisionDocuments } from './document-snapshot'

export const revisionSnapshotSchema = z.object({
  summary: z.string().trim().min(1).max(8000),
  documents: z.array(z.object({ path: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
    content: z.string().refine(value => value.trim().length > 0 && Buffer.byteLength(value) <= 2 * 1024 * 1024,
      'Revision document is empty or oversized') }).strict()).length(8),
}).strict()
export type RevisionSnapshot = z.infer<typeof revisionSnapshotSchema>
export function captureRevisionSnapshot(value: unknown): RevisionSnapshot {
  const snapshot = revisionSnapshotSchema.parse(JSON.parse(revisionCanonicalJson(value)))
  const bound = bindRevisionDocuments(snapshot.documents)
  return { summary: snapshot.summary, documents: bound.documents.map(({ path, content }) => ({ path, content })) }
}
