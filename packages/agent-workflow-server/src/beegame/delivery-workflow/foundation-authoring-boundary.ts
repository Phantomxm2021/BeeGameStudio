import type { DeliveryRun } from './types'
import {
  startDocumentStage as startAuthor,
  completeFoundationDocumentDraft as completeAuthor,
} from './foundation-authoring-stage'
import {
  projectAuthoringContext,
  applyAuthoringContext,
} from './foundation-authoring-context'

export async function startDocumentStage(
  input: Omit<Parameters<typeof startAuthor>[0], 'run'> & { run: DeliveryRun },
): Promise<unknown> {
  return startAuthor({ ...input, run: projectAuthoringContext(input.run) })
}

export async function completeFoundationDocumentDraft(
  input: Omit<Parameters<typeof completeAuthor>[0], 'run'> & {
    run: DeliveryRun
  },
): Promise<DeliveryRun> {
  const result = await completeAuthor({
    ...input,
    run: projectAuthoringContext(input.run),
  })
  return applyAuthoringContext(input.run, result)
}
