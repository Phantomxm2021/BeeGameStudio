import { randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve, dirname } from 'node:path'
import { z } from 'zod/v4'
import { reviewerImmutableFiles, ReviewJournalConflictError } from './fact-journal'
import { reviewerHandleSchema, type ReviewerHandle } from './initial-contract'
import { reviewerCanonicalJson, reviewerDigest } from './review-summary'

const registration = z.object({ version: z.literal(1), handle: reviewerHandleSchema, start: z.unknown() }).strict()
type Identity = { ownerId: string; projectId: string; requestId: string }
export type ReviewerRequestRegistration<Start> = { version: 1; handle: ReviewerHandle; start: Start }

/** Both Reviewer modes share one immutable request/handle namespace. */
export function createReviewerRegistrationStore<Start extends Identity>(workspacePath: string, ownerId: string, parseStart: (value: unknown) => Start) {
  if (!isAbsolute(workspacePath)) throw new Error('review workspace must be absolute')
  const workspace = resolve(workspacePath)
  const root = join(workspace, '.beegame/workflow/foundation-reviewer')
  const requestPath = (start: Identity) => join(root, 'requests', `${reviewerDigest({ ownerId: start.ownerId, projectId: start.projectId, requestId: start.requestId })}.json`)
  const handlePath = (handle: ReviewerHandle) => join(root, 'handles', `${handle.id}.json`)
  async function read(path: string): Promise<ReviewerRequestRegistration<Start>> {
    await reviewerImmutableFiles.assertDirectories(dirname(path))
    const record = registration.parse(await reviewerImmutableFiles.readJson(path))
    return { ...record, start: parseStart(record.start) }
  }
  return Object.freeze({
    async register(value: unknown): Promise<ReviewerRequestRegistration<Start>> {
      const start = parseStart(value)
      if (start.ownerId !== ownerId) throw new Error('review request owner mismatch')
      await reviewerImmutableFiles.assertDirectories(workspace)
      await reviewerImmutableFiles.ensureDirectories(join(root, 'requests'))
      await reviewerImmutableFiles.ensureDirectories(join(root, 'handles'))
      const proposed: ReviewerRequestRegistration<Start> = { version: 1, handle: { protocolVersion: 1, producer: 'foundation-reviewer', id: randomUUID() }, start }
      let result = proposed
      try { await reviewerImmutableFiles.publishJson(requestPath(start), proposed) }
      catch (error) {
        if (!(error instanceof ReviewJournalConflictError)) throw error
        result = await read(requestPath(start))
        if (reviewerCanonicalJson(result.start) !== reviewerCanonicalJson(start)) throw new Error('review request identity conflicts with immutable input')
      }
      await reviewerImmutableFiles.publishJson(handlePath(result.handle), result)
      return structuredClone(result)
    },
    async load(value: unknown): Promise<ReviewerRequestRegistration<Start>> {
      const handle = reviewerHandleSchema.parse(value)
      const record = await read(handlePath(handle))
      if (record.handle.id !== handle.id || record.start.ownerId !== ownerId) throw new Error('review handle owner binding mismatch')
      if (reviewerCanonicalJson(await read(requestPath(record.start))) !== reviewerCanonicalJson(record)) throw new Error('review handle request binding mismatch')
      return structuredClone(record)
    },
  })
}
