import type { FoundationAuthoringContext } from '../domain/types'

/** Small deterministic context fixture for private Author-domain tests. */
export function authoringRun(): FoundationAuthoringContext {
  return {
    runId: 'authoring-test-run',
    ownerId: 'authoring-test-owner',
    projectId: 'authoring-test-project',
    confirmedBriefDigest: 'a'.repeat(64),
    confirmedBriefContext: 'fixed authoring test brief',
    phase: 'DOCUMENT_DRAFTING',
    documentStep: 'FOUNDATION_DRAFTING',
    status: 'running',
    foundationDraftState: { completedPaths: [] },
    updatedAt: '2026-09-05T00:00:00.000Z',
    revision: {
      document: 'authoring-document-revision',
      workspace: 'authoring-workspace-revision',
    },
  }
}
