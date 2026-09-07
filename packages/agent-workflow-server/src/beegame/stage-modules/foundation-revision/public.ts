import { isAbsolute } from 'node:path'
import { z } from 'zod/v4'
import {
  createRevisionLifecycle,
  type RevisionInfrastructure,
  type RevisionOperations,
} from './private/lifecycle'
import { captureRevisionPublicInput } from './private/lifecycle-contract'

export { foundationRevisionInputDigest } from './private/lifecycle-contract'
export type {
  RevisionStartInput,
  RevisionHandle,
  RevisionResumeInput,
  RevisionStopInput,
  RevisionResult,
} from './private/lifecycle-contract'
export type { RevisionInfrastructure } from './private/lifecycle'

/** Public stage boundary. Real app cutover remains gated on independent P3 acceptance. */
export function createFoundationRevision(
  configuration: Readonly<{ workspacePath: string }>,
  infrastructure: RevisionInfrastructure,
): RevisionOperations {
  const config = z
    .object({ workspacePath: z.string().min(1) })
    .strict()
    .parse(captureRevisionPublicInput(configuration))
  if (!isAbsolute(config.workspacePath))
    throw new Error('Revision workspace must be absolute')
  const operations = createRevisionLifecycle(
    config.workspacePath,
    infrastructure,
  )
  async function invoke<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch {
      throw new Error(
        'Revision operation could not be accepted or safely completed',
      )
    }
  }
  return Object.freeze({
    start: input => invoke(() => operations.start(input)),
    getResult: handle => invoke(() => operations.getResult(handle)),
    resume: input => invoke(() => operations.resume(input)),
    stop: input => invoke(() => operations.stop(input)),
  })
}
