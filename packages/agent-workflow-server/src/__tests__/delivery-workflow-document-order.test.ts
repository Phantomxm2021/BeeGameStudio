import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
    finalReportPath: `.beegame/reviews/${scope}/${revision}/${scope === 'foundation' ? 'review.json' : 'review.md'}`,
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

  test('gives one coordinated remediation task only the accepted conflict paths', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'review-coordinated-repair-'))
    try {
      const { run, review } = reviewedRun('foundation')
      const affectedPaths = [
        'docs/GDD.md',
        'docs/LEVEL_SCENE_DESIGN.md',
        'docs/BALANCE_DESIGN.md',
        'docs/TECHNICAL_DESIGN.md',
        'docs/UI_UX_SPEC.md',
      ]
      const reviewBytes = `${JSON.stringify({
        version: 2,
        scope: 'foundation',
        revision,
        verdict: 'NEEDS_REVISION',
        priorConflictStatus: [],
        conflicts: [
          {
            id: 'B1',
            title: 'Shared production contract is inconsistent',
            problem: 'Five owned documents disagree on one required outcome.',
            evidence: [
              {
                path: 'docs/GDD.md',
                location: 'Core loop',
                observed: 'The outcome is named differently.',
              },
            ],
            requiredOutcome: 'All owners express one implementable outcome.',
            changes: affectedPaths.map(path => ({
              path,
              action: `Align ${path} to the shared outcome.`,
            })),
            acceptance: ['All five paths encode the same outcome.'],
          },
        ],
      })}\n`
      const reviewDigest = createHash('sha256').update(reviewBytes).digest('hex')
      await mkdir(dirname(join(workspacePath, review.finalReportPath)), {
        recursive: true,
      })
      await writeFile(join(workspacePath, review.finalReportPath), reviewBytes)
      const blocked = routeCompletedDocumentReview({
        run,
        review: {
          ...review,
          finalReportDigest: reviewDigest,
          verdict: 'NEEDS_REVISION',
          affectedPaths,
        },
      })
      let dispatched: WorkerDispatchRequest | undefined

      await startDocumentStage({
        run: { ...blocked, status: 'running' },
        workspacePath,
        dispatcher: {
          async dispatch(request) {
            dispatched = request
            return request
          },
        },
      })

      expect(dispatched?.taskId).toBe('foundation-remediation')
      expect(dispatched?.allowedPaths).toEqual(affectedPaths)
      expect(dispatched?.contract.remediation).toEqual({
        reviewPath: review.finalReportPath,
        reviewDigest,
        affectedPaths,
        sourceRevision: revision,
      })
      expect(dispatched?.contract).not.toHaveProperty('foundationDocumentPath')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
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

  test('rejects a coordinated Foundation repair that omits an accepted path', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'review-incomplete-repair-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(join(workspacePath, 'docs/GDD.md'), '# Updated GDD\n')
      const { run, review } = reviewedRun('foundation')
      const blocked = routeCompletedDocumentReview({
        run,
        review: {
          ...review,
          verdict: 'NEEDS_REVISION',
          affectedPaths: ['docs/GDD.md', 'docs/TECHNICAL_DESIGN.md'],
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

      expect(completed.status).toBe('needs_action')
      expect(completed.blockedReason).toContain(
        'coordinated foundation remediation must commit exactly',
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
