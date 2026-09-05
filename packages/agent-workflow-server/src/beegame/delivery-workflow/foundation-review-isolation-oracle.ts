import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../../..')
const directory = 'packages/agent-workflow-server/src/beegame/delivery-workflow/'
export const approvedController = execFileSync('git', ['show', 'fe7a851fa:' + directory + 'controller.ts'], { cwd: root, encoding: 'utf8' })
export const originalEntry = approvedController.slice(approvedController.indexOf('async function deriveFoundationAudit('), approvedController.indexOf('\nfunction sectionBytes(')).trimEnd()
const adapter = "async function deriveFoundationAudit(\n  run: DeliveryRun,\n  workspacePath: string,\n): Promise<DeliveryRun> {\n  if (run.foundationAuditState && run.foundationAuditState.status !== 'index_staged') return run\n  const result = await enterFoundationReview({\n    workspacePath,\n    revision: run.revision.document,\n    checkpoints: authorHandoffCheckpoints(run.foundationDraftState),\n  })\n  const revisionRequired = result.kind === 'revision-required'\n  return {\n    ...run,\n    foundationAuditState: result.kind === 'failed' ? undefined : result.state,\n    phase: revisionRequired ? 'FOUNDATION_REVISION' : 'DOCUMENT_REVIEW',\n    documentStep: revisionRequired ? 'FOUNDATION_REVISION' : 'FOUNDATION_REVIEW',\n    status: result.kind === 'failed' ? 'needs_action' : 'running',\n    activeDispatch: undefined,\n    blockedReason: result.kind === 'failed' ? result.reason : undefined,\n    thinking: 'idle',\n  }\n}"

// Restore only the explicitly approved delegation; unrelated controller code
// continues to be checked against the previous source oracle.
export function restoreReviewEntry(source: string): string {
  if (!source.includes(adapter)) throw new Error('Reviewer routing adapter changed without equivalence review')
  return source.replace("import { enterFoundationReview } from './stages/foundation-review/public'\n", '').replace(adapter, originalEntry)
}
export function reviewEntrySource(): string {
  return readFileSync(resolve(root, directory, 'stages/foundation-review/public.ts'), 'utf8')
}

