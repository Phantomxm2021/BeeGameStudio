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
  source = restoreReviewScheduling(source)
  if (!source.includes(adapter)) throw new Error('Reviewer routing adapter changed without equivalence review')
  return source.replace("import { enterFoundationReview } from './stages/foundation-review/public'\n", '').replace(adapter, originalEntry)
}
export function reviewEntrySource(): string {
  return readFileSync(resolve(root, directory, 'stages/foundation-review/public.ts'), 'utf8')
}

// Restore only this migration's exact adapter and helper relocation. The older
// entry and author oracles still validate every other shared-controller byte.
export const originalReviewSchedulingBlock = approvedController.slice(
  approvedController.indexOf("      if (run.foundationAuditState?.status === 'derived_committed')", approvedController.indexOf('  async function resumeUnlocked')),
  approvedController.indexOf("      if (run.documentStep === 'CHECKLIST_DRAFTING')", approvedController.indexOf('  async function resumeUnlocked')),
)
export const reviewSchedulingAdapter = "      const reviewSchedule = await resumeFoundationReview(\n        projectFoundationReviewScheduling(run, input.workspacePath),\n        {\n          isTerminalAdmissionInFlight: dispatchId => terminalAdmissionInFlight.has(dispatchId),\n          replayTerminal: async dispatchId => {\n            const dispatch = run.foundationAuditState && foundationRuntimeTasks(run.foundationAuditState).find(task => task.dispatch?.dispatchId === dispatchId)?.dispatch\n            if (!dispatch) throw new Error('review replay dispatch is unavailable')\n            await dispatcher.replayTerminal(dispatch, handleTerminalUnlocked)\n          },\n          dispatch: dispatchFoundationAuditTask,\n        },\n      )\n      if (reviewSchedule === 'complete-deterministic' || reviewSchedule === 'finalize-facts') {\n        try {\n          if (reviewSchedule === 'complete-deterministic') await completeDeterministicFoundationAudit(run)\n          else await finalizeFoundationFacts(run)\n        } catch (error) {\n          await failFoundationContinuation(run, error)\n        }\n        return\n      }\n      if (reviewSchedule === 'finalize-semantic') {\n        await finalizeFoundationSemanticReview(run)\n        return\n      }\n      if (reviewSchedule === 'handled') return\n"
const originalIssueHelper = approvedController.slice(approvedController.indexOf('function requireSectionAuditIssues('), approvedController.indexOf('\nclass FoundationFactAttemptError')).trimEnd()
const originalPacketHelpers = approvedController.slice(approvedController.indexOf('function sectionBytes('), approvedController.indexOf('\nexport function createDeliveryWorkflowController')).trimEnd()

export function restoreReviewScheduling(source: string): string {
  if (!source.includes(reviewSchedulingAdapter) || !source.includes(reviewDispatchAdapter)) throw new Error('Reviewer scheduler adapter changed without equivalence review')
  return source
    .replace("import { enterFoundationReview, buildSemanticPacketFor, requireSectionAuditIssues, resumeFoundationReview, mayIgnoreDuplicateFoundationReviewDispatch } from './stages/foundation-review/public'\nimport { projectFoundationReviewScheduling } from './foundation-review-boundary'\n", '')
    .replace(reviewSchedulingAdapter, originalReviewSchedulingBlock)
    .replace(reviewDispatchAdapter, originalReviewDispatch)
    .replace('\n\nclass FoundationFactAttemptError', '\n\n' + originalIssueHelper + '\n\nclass FoundationFactAttemptError')
    .replace('\nexport function createDeliveryWorkflowController', '\n\n' + originalPacketHelpers + '\n\nexport function createDeliveryWorkflowController') + "import { enterFoundationReview } from './stages/foundation-review/public'\n"
}


export const originalReviewDispatch = approvedController.slice(approvedController.indexOf('  async function dispatchFoundationAuditTask('), approvedController.indexOf('\n  async function resumeUnlocked')).trimEnd()
export const reviewDispatchAdapter = "  async function dispatchFoundationAuditTask(request: WorkerDispatchRequest): Promise<void> {\n    try {\n      await dispatcher.dispatch(request)\n    } catch (error) {\n      if (!(error instanceof DispatchError) || error.code !== 'duplicate' || !request.taskId)\n        throw error\n      const current = await store.load()\n      const task = current?.foundationAuditState && foundationRuntimeTasks(current.foundationAuditState).find(candidate => candidate.taskId === request.taskId)\n      if (mayIgnoreDuplicateFoundationReviewDispatch({\n        request: {\n          revision: request.revision,\n          workerType: request.workerType,\n          packetDigest: request.contract.packetDigest,\n        },\n        task: task ? {\n          revision: task.revision,\n          kind: task.kind,\n          packetDigest: task.packetDigest,\n          status: task.status,\n          dispatch: task.dispatch ? {\n            status: task.dispatch.status,\n            workerType: task.dispatch.workerType,\n          } : undefined,\n        } : undefined,\n        runningTaskCount: current?.foundationAuditState\n          ? foundationRuntimeTasks(current.foundationAuditState).filter(candidate => candidate.status === 'running').length\n          : 0,\n      })) return\n      throw error\n    }\n  }"
