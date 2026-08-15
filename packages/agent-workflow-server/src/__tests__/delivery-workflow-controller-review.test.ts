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
import type { WorkerDispatchRequest } from '../beegame/delivery-workflow/types'
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
  test('accepts a parallel Reviewer terminal and fills the freed dispatch slot', async () => {
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
      started.map(request => request.contract.reviewRole).sort(),
    ).toEqual(['experience', 'gameplay', 'technical'])
    const gameplay = started.find(
      request => request.contract.reviewRole === 'gameplay',
    )!
    const reportPath = review.reports.find(report => report.role === 'gameplay')!
      .path
    await mkdir(dirname(join(workspacePath, reportPath)), { recursive: true })
    await writeFile(join(workspacePath, reportPath), '# Gameplay review\n', 'utf8')

    await controller.dispatcher.completeDispatch(gameplay.dispatchId!, {
      workerType: 'document-reviewer',
      status: 'completed',
      revision,
      scope: 'foundation',
      role: 'gameplay',
      reportPaths: [reportPath],
    })

    const progressed = await store.load()
    expect(
      progressed?.documentReviewState.activeRun?.reports.find(
        report => report.role === 'gameplay',
      ),
    ).toMatchObject({ status: 'completed' })
    expect(
      started.map(request => request.contract.reviewRole).sort(),
    ).toEqual(['experience', 'gameplay', 'presentation', 'technical'])
  })
})
