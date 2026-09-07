import { mkdtemp, mkdir, open, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { revisionCanonicalJson } from './json-digest'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { prepareRevisionWorkerInputs } from './worker-input'
import { buildRevisionWorkerPrompt } from './worker-prompt'

const assignmentSchema = z.object({
  request: z.unknown(),
  documentPath: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
  attemptId: z.uuid(),
  priorFailureReason: z.string().optional(),
}).strict()

/** Ephemeral native read authority, never a durable worker receipt/checkpoint.
 * The private lifecycle supplies an owned attempt ID and disposes this only
 * after its process observation. No caller-provided project path is writable.
 */
export async function createRevisionNativeAssignment(value: unknown) {
  const input = assignmentSchema.parse(JSON.parse(revisionCanonicalJson(value)))
  const work = prepareRevisionWorkerInputs(input.request).find(entry => entry.packet.documentPath === input.documentPath)
  if (!work) throw new Error('Revision document has no dispatch authority')
  const { packet } = work
  const prompt = buildRevisionWorkerPrompt({ scope: packet.scope, packet,
    ...(input.priorFailureReason === undefined ? {} : { priorFailureReason: input.priorFailureReason }) })
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beegame-revision-attempt-')))
  try {
    const cwd = join(root, 'sandbox')
    const authority = join(root, 'authority')
    await mkdir(cwd, { mode: 0o700 })
    const bridgeEnvironment: Record<string, string> = { BEEGAME_WORKFLOW_WORKER_TYPE: 'foundation-document-reviser' }
    if (packet.scope === 'document') {
      await mkdir(authority, { mode: 0o700 })
      const assignedPath = join(authority, 'assigned.md')
      const file = await open(assignedPath, 'wx', 0o600)
      try { await file.writeFile(packet.document.text, 'utf8'); await file.sync() } finally { await file.close() }
      Object.assign(bridgeEnvironment, {
        BEEGAME_WORKSPACE_PATH: authority,
        BEEGAME_REVISION_STAGED_PATH: assignedPath,
        // Legacy field names belong to the unchanged external native bridge.
        // Their values are this module's request/attempt identities, not old state.
        BEEGAME_REVISION_CONTRACT: JSON.stringify({ taskId: input.attemptId, revision: packet.requestDigest,
          round: packet.round, scope: packet.scope, documentPath: packet.documentPath, issueIds: packet.issueIds,
          sectionIds: packet.sectionIds, stagedPath: 'assigned.md', baseDocumentDigest: packet.baseDocumentDigest }),
      })
    }
    let disposed = false
    return {
      cwd, scope: packet.scope, prompt, packetDigest: work.packetDigest,
      bridgeEnvironment,
      async dispose() {
        if (disposed) return
        await rm(root, { recursive: true, force: true })
        disposed = true
      },
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
