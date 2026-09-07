import type { FoundationFactKey } from './foundation-fact-definitions'
import type { FoundationDocumentPath } from './types'

/** Read-only audit selection; no Revision operations or planning state. */
export type FoundationImpactAnalysis = Readonly<{
  changedSections: readonly Readonly<{ documentPath: FoundationDocumentPath; sectionId: string }>[]
  factKeys: readonly FoundationFactKey[]
  contractIds: readonly string[]
  checkIds: readonly string[]
  issueIds: readonly string[]
}>
