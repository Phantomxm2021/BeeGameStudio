import { createHash } from 'node:crypto'
import { createInitialDeliveryRun } from '../beegame/delivery-workflow/run-store'

type InitialRunInput = Omit<
  Parameters<typeof createInitialDeliveryRun>[0],
  'confirmedBriefContext' | 'confirmedBriefDigest'
> & {
  confirmedBriefContext?: string
  confirmedBriefDigest?: string
}

/** Builds the same digest-bound authority required by production run creation. */
export function createTestDeliveryRun(input: InitialRunInput) {
  const confirmedBriefContext =
    input.confirmedBriefContext ?? `Confirmed delivery brief for ${input.projectId}`
  const rest = { ...input }
  delete rest.confirmedBriefDigest
  return createInitialDeliveryRun({
    ...rest,
    confirmedBriefContext,
    confirmedBriefDigest: createHash('sha256')
      .update(confirmedBriefContext)
      .digest('hex'),
  })
}
