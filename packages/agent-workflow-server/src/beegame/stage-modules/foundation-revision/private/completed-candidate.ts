import { openRevisionAttemptStore } from './attempt-store'
import { publishRevisionDerivedCandidate } from './candidate-publication'

/** The journal binds one completed snapshot before any publication IO.
 * Replay retries persistence, never the agent or a second candidate build. */
export async function publishRevisionCompletedCandidate(workspacePath: string, request: unknown) {
  const store = await openRevisionAttemptStore(workspacePath, request)
  const authorization = await store.preparePublication()
  const published = await publishRevisionDerivedCandidate(workspacePath, authorization.candidate)
  await store.markPublished(authorization.authorizationDigest)
  return published
}
