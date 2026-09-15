import { createHash } from 'node:crypto'
import { createInitialDeliveryRun } from '../beegame/delivery-workflow/run-store'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  type DeliveryRun,
  type FoundationDocumentPath,
} from '../beegame/delivery-workflow/types'

export function withTestDocumentMetadata(
  path: FoundationDocumentPath,
  body: string,
): string {
  return [
    '---',
    `document_id: ${CANONICAL_PROJECT_DOCUMENT_IDS[path]}`,
    'version: 1.0.0',
    'updated_at: 2026-08-12T00:00:00.000Z',
    '---',
    body,
  ].join('\n')
}

type InitialRunInput = Omit<
  Parameters<typeof createInitialDeliveryRun>[0],
  'confirmedBriefContext' | 'confirmedBriefDigest'
> & {
  confirmedBriefContext?: string
  confirmedBriefDigest?: string
  /** Downstream fixtures default to an already completed Foundation pass. */
  foundationDraftComplete?: boolean
  /** Retained in fixtures; checklist completion is now a deterministic gate. */
  checklistApproved?: boolean
}

/** Builds the same digest-bound authority required by production run creation. */
export function createTestDeliveryRun(input: InitialRunInput): DeliveryRun {
  const confirmedBriefContext =
    input.confirmedBriefContext ??
    `Confirmed delivery brief for ${input.projectId}`
  const rest = { ...input }
  delete rest.confirmedBriefDigest
  delete rest.foundationDraftComplete
  delete rest.checklistApproved
  const run = createInitialDeliveryRun({
    ...rest,
    confirmedBriefContext,
    confirmedBriefDigest: createHash('sha256')
      .update(confirmedBriefContext)
      .digest('hex'),
  })
  return {
    ...run,
    ...(input.checklistApproved &&
    !/^[a-f0-9]{64}$/u.test(run.revision.document)
      ? { revision: { ...run.revision, document: 'a'.repeat(64) } }
      : {}),
    foundationDraftState: {
      completedPaths:
        input.foundationDraftComplete === false
          ? []
          : [...CANONICAL_FOUNDATION_DOCUMENTS],
    },
    resourceProductionState: { currentTask: 'RESOURCE_DELIVERY' },
  }
}
