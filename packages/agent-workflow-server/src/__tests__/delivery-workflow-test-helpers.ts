import { createHash } from 'node:crypto'
import { createInitialDeliveryRun } from '../beegame/delivery-workflow/run-store'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../beegame/delivery-workflow/types'

type InitialRunInput = Omit<
  Parameters<typeof createInitialDeliveryRun>[0],
  'confirmedBriefContext' | 'confirmedBriefDigest'
> & {
  confirmedBriefContext?: string
  confirmedBriefDigest?: string
  /** Downstream fixtures default to an already completed Foundation pass. */
  foundationDraftComplete?: boolean
}

/** Builds the same digest-bound authority required by production run creation. */
export function createTestDeliveryRun(input: InitialRunInput) {
  const confirmedBriefContext =
    input.confirmedBriefContext ??
    `Confirmed delivery brief for ${input.projectId}`
  const rest = { ...input }
  delete rest.confirmedBriefDigest
  delete rest.foundationDraftComplete
  const run = createInitialDeliveryRun({
    ...rest,
    confirmedBriefContext,
    confirmedBriefDigest: createHash('sha256')
      .update(confirmedBriefContext)
      .digest('hex'),
  })
  return {
    ...run,
    foundationDraftState: {
      completedPaths:
        input.foundationDraftComplete === false
          ? []
          : [...CANONICAL_FOUNDATION_DOCUMENTS],
    },
  }
}
