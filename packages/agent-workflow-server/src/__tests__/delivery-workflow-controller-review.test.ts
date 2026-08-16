import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createDeliveryWorkflowController } from '../beegame/delivery-workflow/controller'
import {
  computeCurrentDocumentReviewRevision,
  createDocumentReviewRun,
} from '../beegame/delivery-workflow/document-review-stage'
import { createRunStore } from '../beegame/delivery-workflow/run-store'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type WorkerDispatchRequest,
} from '../beegame/delivery-workflow/types'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'

const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true })),
  )
})

describe('document review controller terminal reconciliation', () => {
  test('recovers a committed Foundation JSON before redispatching Reviewer', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-review-commit-recovery-'))
    workspaces.push(workspacePath)
    const confirmedBriefContext = 'Confirmed review recovery brief'
    const confirmedBriefDigest = createHash('sha256')
      .update(confirmedBriefContext)
      .digest('hex')
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await Promise.all(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path =>
        writeFile(join(workspacePath, path), `# ${path}\n`),
      ),
    )
    const revision = await computeCurrentDocumentReviewRevision({
      workspacePath,
      verification: {
        kind: 'document',
        confirmedBriefDigest,
        prerequisiteReports: [],
      },
    })
    const review = createDocumentReviewRun({
      scope: 'foundation',
      revision,
      attempt: 1,
    })
    const reportPath = review.reports[0]!.path
    await mkdir(dirname(join(workspacePath, reportPath)), { recursive: true })
    await writeFile(
      join(workspacePath, reportPath),
      `${JSON.stringify({
        version: 2,
        scope: 'foundation',
        revision,
        verdict: 'READY',
        priorConflictStatus: [],
        conflicts: [],
      })}\n`,
    )
    const run = {
      ...createTestDeliveryRun({
        runId: 'review-commit-recovery-run',
        projectId: 'review-commit-recovery-project',
        ownerId: 'review-commit-recovery-owner',
        confirmedBriefContext,
        confirmedBriefDigest,
      }),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'FOUNDATION_REVIEW' as const,
      revision: { document: revision, workspace: 'uncomputed' },
      documentReviewState: {
        approvals: {},
        attempts: { foundation: 1, checklist: 0, complete: 0 },
        activeRun: review,
      },
    }
    const store = createRunStore(workspacePath, run.ownerId)
    await store.save(run)
    const started: WorkerDispatchRequest[] = []
    const controller = createDeliveryWorkflowController({
      workspacePath,
      ownerId: run.ownerId,
      workerPort: {
        async start(request) {
          started.push(request)
          return { sessionId: request.dispatchId!, dispatchId: request.dispatchId! }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })

    await controller.resume(run)

    expect(
      started.filter(request => request.workerType === 'document-reviewer'),
    ).toEqual([])
    expect(await store.load()).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_DRAFTING',
      documentReviewState: {
        approvals: { foundation: { revision } },
      },
    })
  })

  test('keeps an accepted final report complete when remediation startup fails', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-review-route-'))
    workspaces.push(workspacePath)
    const confirmedBriefContext = 'Confirmed review routing brief'
    const confirmedBriefDigest = createHash('sha256')
      .update(confirmedBriefContext)
      .digest('hex')
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await Promise.all(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path =>
        writeFile(join(workspacePath, path), `# ${path}\n`),
      ),
    )
    const revision = await computeCurrentDocumentReviewRevision({
      workspacePath,
      verification: {
        kind: 'document',
        confirmedBriefDigest,
        prerequisiteReports: [],
      },
    })
    const review = createDocumentReviewRun({
      scope: 'foundation',
      revision,
      attempt: 1,
    })
    for (const report of review.reports.filter(value => value.role !== 'final')) {
      const bytes = `# ${report.role} review\n`
      await mkdir(dirname(join(workspacePath, report.path)), { recursive: true })
      await writeFile(join(workspacePath, report.path), bytes, 'utf8')
      report.status = 'completed'
      report.digest = createHash('sha256').update(bytes).digest('hex')
    }
    const run = {
      ...createTestDeliveryRun({
        runId: 'review-route-run',
        projectId: 'review-route-project',
        ownerId: 'review-route-owner',
        confirmedBriefContext,
        confirmedBriefDigest,
      }),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'FOUNDATION_REVIEW' as const,
      status: 'running' as const,
      revision: { document: revision, workspace: 'uncomputed' },
      documentReviewState: {
        approvals: {},
        attempts: { foundation: 1, checklist: 0, complete: 0 },
        activeRun: review,
      },
    }
    const store = createRunStore(workspacePath, run.ownerId)
    await store.save(run)
    const started: WorkerDispatchRequest[] = []
    const controller = createDeliveryWorkflowController({
      workspacePath,
      ownerId: run.ownerId,
      workerPort: {
        async start(request) {
          started.push(request)
          if (request.workerType === 'document-author')
            throw new Error('repair worker unavailable')
          return {
            sessionId: request.dispatchId!,
            dispatchId: request.dispatchId!,
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })

    await controller.resume(run)
    const finalRequest = started.find(
      request => request.contract.reviewRole === 'final',
    )!
    const finalReport = review.reports.find(report => report.role === 'final')!
    await mkdir(dirname(join(workspacePath, finalReport.path)), {
      recursive: true,
    })
    await writeFile(
      join(workspacePath, finalReport.path),
      foundationNeedsRevisionJson(revision),
    )

    await controller.dispatcher.completeDispatch(finalRequest.dispatchId!, {
      workerType: 'document-reviewer',
      status: 'completed',
      revision,
      scope: 'foundation',
      role: 'final',
      reportPaths: [finalReport.path],
    })

    const persisted = await store.load()
    expect(persisted?.documentReviewState.activeRun).toMatchObject({
      status: 'completed',
      verdict: 'NEEDS_REVISION',
    })
    expect(
      persisted?.documentReviewState.activeRun?.reports.find(
        report => report.role === 'final',
      ),
    ).toMatchObject({ status: 'completed' })
    expect(persisted).toMatchObject({
      status: 'needs_action',
      blockedReason: 'repair worker unavailable',
    })
  })

  test('persists usage for the direct Foundation Reviewer terminal', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-review-controller-'))
    workspaces.push(workspacePath)
    const confirmedBriefContext = 'Confirmed review controller brief'
    const confirmedBriefDigest = createHash('sha256')
      .update(confirmedBriefContext)
      .digest('hex')
    const revision = await computeCurrentDocumentReviewRevision({
      workspacePath,
      verification: {
        kind: 'document',
        confirmedBriefDigest,
        prerequisiteReports: [],
      },
    })
    const review = createDocumentReviewRun({
      scope: 'foundation',
      revision,
      attempt: 1,
    })
    const run = {
      ...createTestDeliveryRun({
        runId: 'review-controller-run',
        projectId: 'review-controller-project',
        ownerId: 'review-controller-owner',
        confirmedBriefContext,
        confirmedBriefDigest,
      }),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'FOUNDATION_REVIEW' as const,
      status: 'running' as const,
      revision: {
        document: revision,
        workspace: 'uncomputed',
      },
      documentReviewState: {
        approvals: {},
        attempts: { foundation: 1, checklist: 0, complete: 0 },
        activeRun: review,
      },
    }
    const store = createRunStore(workspacePath, run.ownerId)
    await store.save(run)
    const started: WorkerDispatchRequest[] = []
    const controller = createDeliveryWorkflowController({
      workspacePath,
      ownerId: run.ownerId,
      workerPort: {
        async start(request) {
          started.push(request)
          return {
            sessionId: request.dispatchId!,
            dispatchId: request.dispatchId!,
          }
        },
        async submit() {},
        async stop() {},
        async status() {
          throw new Error('not used')
        },
      },
    })

    await controller.resume(run)
    expect(
      started.filter(request => request.workerType === 'document-reviewer').map(request => request.contract.reviewRole),
    ).toEqual(['final'])
    const directReview = started.find(
      request => request.contract.reviewRole === 'final',
    )!
    const reportPath = review.reports.find(
      report => report.role === 'final',
    )!
      .path
    await mkdir(dirname(join(workspacePath, reportPath)), { recursive: true })
    await writeFile(
      join(workspacePath, reportPath),
      foundationNeedsRevisionJson(revision),
      'utf8',
    )
    await store.addWorkflowUsage(
      run.runId,
      {
        input_tokens: 120,
        cache_read_tokens: 340,
        cache_creation_tokens: 0,
        completion_tokens: 56,
        total_tokens: 516,
      },
      directReview.dispatchId!,
    )

    await controller.dispatcher.completeDispatch(directReview.dispatchId!, {
      workerType: 'document-reviewer',
      status: 'completed',
      revision,
      scope: 'foundation',
      role: 'final',
      reportPaths: [reportPath],
    })

    const progressed = await store.load()
    expect(
      progressed?.documentReviewState.activeRun?.reports.find(
        report => report.role === 'final',
      ),
    ).toMatchObject({
      status: 'completed',
      usage: {
        input_tokens: 120,
        cache_read_tokens: 340,
        cache_creation_tokens: 0,
        completion_tokens: 56,
        total_tokens: 516,
      },
    })
    expect(
      progressed?.documentReviewState.activeRun?.reports.find(
        report => report.role === 'final',
      )?.durationMs,
    ).toBeGreaterThanOrEqual(0)
  })
})

function foundationNeedsRevisionJson(revision: string): string {
  return `${JSON.stringify({
    version: 2,
    scope: 'foundation',
    revision,
    verdict: 'NEEDS_REVISION',
    priorConflictStatus: [],
    conflicts: [
      {
        id: 'B1',
        title: 'Gameplay authority is incomplete',
        problem: 'The gameplay outcome cannot be verified.',
        evidence: [
          {
            path: 'docs/GDD.md',
            location: 'Core loop',
            observed: 'No observable completion outcome is defined.',
          },
        ],
        requiredOutcome: 'Define one observable completion outcome.',
        changes: [
          {
            path: 'docs/GDD.md',
            action: 'Define the observable completion outcome.',
          },
        ],
        acceptance: ['The completion outcome is observable and testable.'],
      },
    ],
  })}\n`
}
