import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'
import {
  createDocumentReviewRun,
  routeCompletedDocumentReview,
} from '../beegame/delivery-workflow/document-review-stage'
import {
  completeDocumentDraft,
  startDocumentStage,
} from '../beegame/delivery-workflow/document-stage'
import type { WorkerDispatchRequest } from '../beegame/delivery-workflow/types'

const revision = 'a'.repeat(64)

function reviewedRun(scope: 'foundation' | 'checklist' | 'complete') {
  const run = createTestDeliveryRun({
    runId: `review-${scope}`,
    projectId: 'project',
    ownerId: 'owner',
    foundationDraftComplete: true,
  })
  const review = {
    ...createDocumentReviewRun({
      scope,
      revision,
      ...(scope === 'checklist'
        ? { approvedFoundationRevision: revision }
        : {}),
    }),
    status: 'completed' as const,
    finalReportPath: `.beegame/reviews/${scope}/${revision}/review.md`,
    finalReportDigest: 'b'.repeat(64),
    verdict: 'READY' as const,
    affectedPaths: [],
  }
  return { run, review }
}

describe('report-based document review order', () => {
  test.each([
    ['foundation', 'DOCUMENT_REVIEW'],
    ['checklist', 'RESOURCE_PREPARATION'],
    ['complete', 'ATOMIC_TASK_PLANNING'],
  ] as const)('routes READY %s reports without packet state', (scope, phase) => {
    const { run, review } = reviewedRun(scope)
    const routed = routeCompletedDocumentReview({ run, review })

    expect(routed.phase).toBe(phase)
    expect(routed.documentReviewState.approvals?.[scope]?.reportPath).toBe(
      review.finalReportPath,
    )
    expect(routed.documentReviewState).not.toHaveProperty('activeCycle')
  })

  test('gives remediation the persisted report and affected owned paths', async () => {
    const { run, review } = reviewedRun('foundation')
    const blocked = routeCompletedDocumentReview({
      run,
      review: {
        ...review,
        verdict: 'NEEDS_REVISION',
        affectedPaths: ['docs/GDD.md', 'docs/BALANCE_DESIGN.md'],
      },
    })
    let dispatched: WorkerDispatchRequest | undefined

    await startDocumentStage({
      run: { ...blocked, status: 'running' },
      workspacePath: '/project',
      dispatcher: {
        async dispatch(request) {
          dispatched = request
          return request
        },
      },
    })

    expect(dispatched?.allowedPaths).toEqual(['docs/GDD.md'])
    expect(dispatched?.contract.remediation).toEqual({
      reviewReportPath: review.finalReportPath,
      affectedPaths: ['docs/GDD.md', 'docs/BALANCE_DESIGN.md'],
      sourceRevision: revision,
    })
    expect(dispatched?.contract.remediation).not.toHaveProperty('findings')
  })

  test('continues a complete-review repair with the next affected owner', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'review-owner-route-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(join(workspacePath, 'docs/GDD.md'), '# Updated GDD\n')
      const { run, review } = reviewedRun('complete')
      const blocked = routeCompletedDocumentReview({
        run,
        review: {
          ...review,
          verdict: 'NEEDS_REVISION',
          affectedPaths: [
            'docs/GDD.md',
            'docs/acceptance/gameplay-checklist.md',
          ],
        },
      })

      const completed = await completeDocumentDraft({
        run: blocked,
        workspacePath,
        audit: () => ({ valid: true, issues: [] }),
        terminal: {
          workerType: 'document-author',
          status: 'completed',
          writtenPaths: ['docs/GDD.md'],
          resolvedFindingIds: [],
        },
      })

      expect(completed.phase).toBe('DOCUMENT_REVIEW')
      expect(completed.documentStep).toBe('CHECKLIST_DRAFTING')
      expect(completed.documentReviewState.activeRun?.remediatedPaths).toEqual([
        'docs/GDD.md',
      ])
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
