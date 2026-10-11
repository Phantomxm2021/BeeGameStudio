import { createHash } from 'node:crypto'
import { checkDesignHandoffDraft, snapshotDesignDocuments } from './design-handoff'
import { checkDesignDocumentReferences } from './design-document-references'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'
import type { NativeDirectionDocument, NativeWritingBatch } from '@bee-game-studio/agent-workflow/native-direction-authors'

/** BGS checks saved transport/links, not semantics. Native Stop hooks do not
 * know document owners or decide whether a business assignment is complete. */
export function checkAuthorDraft(workspace: string, document: NativeDirectionDocument, batch: NativeWritingBatch) {
  const finalTechnical = document === 'TECHNICAL_DESIGN.md' && batch === 4
  const draft = checkDesignHandoffDraft(workspace, document, { finalTechnical })
  const references = checkDesignDocumentReferences(workspace, batch, document)
  const issues = [...draft.issues, ...references.issues]
  const saved = snapshotDesignDocuments(workspace, finalTechnical ? PROJECT_DOCUMENTS : [document])
  // Includes owned linked files/evidence as well as prose and index. A genuine
  // correction changes the key; rewriting a chat conclusion alone does not.
  const revision = createHash('sha256').update(JSON.stringify([saved.documents, references.inputRevision])).digest('hex')
  return { issues, availableRequirements: draft.availableRequirements, revision,
    key: JSON.stringify([issues, revision]) }
}
