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
  test('keeps an accepted final report complete when remediation startup fails', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-review-route-'))
    workspaces.push(workspacePath)
    const confirmedBriefContext = 'Confirmed review routing brief'
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
    await writeFile(join(workspacePath, finalReport.path), '# Final review\n')
    await writeFile(
      join(workspacePath, finalReport.path.replace(/review\.md$/u, 'decision.json')),
      '{}\n',
    )

    await controller.dispatcher.completeDispatch(finalRequest.dispatchId!, {
      workerType: 'document-reviewer',
      status: 'completed',
      revision,
      scope: 'foundation',
      role: 'final',
      reportPaths: [
        finalReport.path,
        finalReport.path.replace(/review\.md$/u, 'decision.json'),
      ],
      verdict: 'NEEDS_REVISION',
      affectedPaths: ['docs/GDD.md'],
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

    const beforeRestart = (await store.load())!
    const technical = beforeRestart.documentReviewState.activeRun!.reports.find(
      report => report.role === 'technical',
    )!
    await mkdir(dirname(join(workspacePath, technical.path)), {
      recursive: true,
    })
    await writeFile(
      join(workspacePath, technical.path),
      '# Technical review\n',
      'utf8',
    )
    await store.save({
      ...beforeRestart,
      documentReviewState: {
        ...beforeRestart.documentReviewState,
        activeRun: {
          ...beforeRestart.documentReviewState.activeRun!,
          reports: beforeRestart.documentReviewState.activeRun!.reports.map(
            report =>
              report.role === 'technical'
                ? {
                    ...report,
                    dispatch: {
                      ...report.dispatch!,
                      status: 'completed' as const,
                      terminalResult: {
                        workerType: 'document-reviewer',
                        status: 'completed',
                        revision,
                        scope: 'foundation',
                        role: 'technical',
                        reportPaths: [technical.path],
                      },
                      finishedAt: new Date().toISOString(),
                    },
                  }
                : report,
          ),
        },
      },
    })
    const restarted: WorkerDispatchRequest[] = []
    const restartedController = createDeliveryWorkflowController({
      workspacePath,
      ownerId: run.ownerId,
      workerPort: {
        async start(request) {
          restarted.push(request)
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

    await restartedController.resume((await store.load())!)

    expect(
      (await store.load())?.documentReviewState.activeRun?.reports.find(
        report => report.role === 'technical',
      ),
    ).toMatchObject({ status: 'completed' })
    expect(restarted.map(request => request.contract.reviewRole)).toEqual([
      'production',
    ])
  })
})
