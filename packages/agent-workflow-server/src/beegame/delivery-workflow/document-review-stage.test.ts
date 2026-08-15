import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import {
  acceptDocumentReviewTerminal,
  buildDocumentReviewDispatches,
  createDocumentReviewRun,
  computeCurrentDocumentReviewRevision,
  recoverDocumentReviewRun,
  routeCompletedDocumentReview,
} from './document-review-stage'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { transitionDeliveryRun } from './transition'

const revision = 'a'.repeat(64)
const revisionVerification = {
  kind: 'document' as const,
  confirmedBriefDigest: 'b'.repeat(64),
  prerequisiteReports: [],
}
const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true })),
  )
})

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'beegame-review-stage-'))
  workspaces.push(path)
  return path
}

describe('document review run', () => {
  test('recomputes the document revision from current source bytes', async () => {
    const workspacePath = await workspace()
    const before = await computeCurrentDocumentReviewRevision({
      workspacePath,
      verification: revisionVerification,
    })
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await writeFile(join(workspacePath, 'docs/GDD.md'), '# changed\n', 'utf8')

    expect(
      await computeCurrentDocumentReviewRevision({
        workspacePath,
        verification: revisionVerification,
      }),
    ).not.toBe(before)
  })

  test('rejects a changed prerequisite review report', async () => {
    const workspacePath = await workspace()
    const reportPath = '.beegame/reviews/foundation/revision/review.md'
    const absolutePath = join(workspacePath, reportPath)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, '# accepted\n', 'utf8')
    const digest = createHash('sha256').update('# accepted\n').digest('hex')
    await writeFile(absolutePath, '# tampered\n', 'utf8')

    await expect(
      computeCurrentDocumentReviewRevision({
        workspacePath,
        verification: {
          ...revisionVerification,
          prerequisiteReports: [{ path: reportPath, digest }],
        },
      }),
    ).rejects.toThrow('document review prerequisite report changed')
  })

  test('recomputes document bytes before the complete resource revision', async () => {
    const workspacePath = await workspace()
    const verification = {
      kind: 'resource' as const,
      confirmedBriefDigest: 'b'.repeat(64),
      prerequisiteReports: [],
    }
    const before = await computeCurrentDocumentReviewRevision({
      workspacePath,
      verification,
    })
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await writeFile(join(workspacePath, 'docs/GDD.md'), '# changed\n', 'utf8')

    expect(
      await computeCurrentDocumentReviewRevision({
        workspacePath,
        verification,
      }),
    ).not.toBe(before)
  })

  test('retry resets only failed Reviewer roles to pending', () => {
    const activeRun = createDocumentReviewRun({ scope: 'foundation', revision })
    activeRun.status = 'failed'
    activeRun.failureReason = 'technical reviewer failed'
    activeRun.reports[0].status = 'completed'
    activeRun.reports[0].digest = 'c'.repeat(64)
    activeRun.reports[1].status = 'failed'
    activeRun.reports[1].failureReason = 'provider disconnected'
    const run = createTestDeliveryRun({
      runId: 'review-retry-run',
      projectId: 'review-retry-project',
      ownerId: 'review-retry-owner',
      foundationDraftComplete: true,
    })
    const retried = transitionDeliveryRun(
      {
        ...run,
        phase: 'DOCUMENT_REVIEW',
        documentStep: 'FOUNDATION_REVIEW',
        status: 'needs_action',
        documentReviewState: {
          approvals: {},
          attempts: { foundation: 1, checklist: 0, complete: 0 },
          activeRun,
        },
      },
      { type: 'retry' },
    )

    expect(retried.documentReviewState.activeRun?.status).toBe('running')
    expect(retried.documentReviewState.activeRun?.reports[0].status).toBe(
      'completed',
    )
    expect(retried.documentReviewState.activeRun?.reports[1]).toMatchObject({
      status: 'pending',
      failureReason: undefined,
    })
  })

  test('dispatches at most three pending specialist roles concurrently', async () => {
    const workspacePath = await workspace()
    const run = createDocumentReviewRun({ scope: 'foundation', revision })

    const dispatches = buildDocumentReviewDispatches({
      run,
      workspacePath,
      revisionVerification,
    })

    expect(dispatches).toHaveLength(3)
    expect(dispatches.map(value => value.contract.reviewRole)).toEqual([
      'gameplay',
      'technical',
      'experience',
    ])
  })

  test('dispatches the final Reviewer only after every specialist report commits', async () => {
    const workspacePath = await workspace()
    let run = createDocumentReviewRun({ scope: 'foundation', revision })
    for (const report of run.reports.filter(value => value.role !== 'final')) {
      const path = join(workspacePath, report.path)
      const text = `# ${report.role} review\n\nNo blocking findings.\n`
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, text, 'utf8')
      run = await acceptDocumentReviewTerminal({
        run,
        workspacePath,
        terminal: {
          workerType: 'document-reviewer',
          status: 'completed',
          revision,
          scope: 'foundation',
          role: report.role,
          reportPaths: [relative(workspacePath, path)],
        },
      })
    }

    const dispatches = buildDocumentReviewDispatches({
      run,
      workspacePath,
      revisionVerification,
    })

    expect(dispatches).toHaveLength(1)
    expect(dispatches[0].contract.reviewRole).toBe('final')
    expect(Object.keys(dispatches[0].contract.partDigests)).toHaveLength(5)
  })

  test('preserves only committed siblings whose bytes still match on recovery', async () => {
    const workspacePath = await workspace()
    const run = createDocumentReviewRun({ scope: 'foundation', revision })
    const [gameplay, technical] = run.reports
    for (const report of [gameplay, technical]) {
      const path = join(workspacePath, report.path)
      const text = `# ${report.role} review\n\nNo blocking findings.\n`
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, text, 'utf8')
      report.status = 'completed'
      report.digest = createHash('sha256').update(text).digest('hex')
    }
    await writeFile(join(workspacePath, technical.path), 'tampered', 'utf8')

    const recovered = await recoverDocumentReviewRun({
      run,
      workspacePath,
      currentRevision: revision,
    })

    expect(
      recovered.reports.find(value => value.role === 'gameplay')?.status,
    ).toBe('completed')
    expect(
      recovered.reports.find(value => value.role === 'technical')?.status,
    ).toBe('pending')
  })

  test('invalidates the whole run when the canonical revision changes', async () => {
    const workspacePath = await workspace()
    const run = createDocumentReviewRun({ scope: 'foundation', revision })
    run.reports[0].status = 'completed'
    run.reports[0].digest = 'c'.repeat(64)

    const recovered = await recoverDocumentReviewRun({
      run,
      workspacePath,
      currentRevision: 'b'.repeat(64),
    })

    expect(recovered.revision).toBe('b'.repeat(64))
    expect(recovered.reports.every(value => value.status === 'pending')).toBe(
      true,
    )
    expect(recovered.attempt).toBe(run.attempt)
  })

  test.each([
    ['foundation', 'DOCUMENT_REVIEW', 'CHECKLIST_DRAFTING'],
    ['checklist', 'RESOURCE_PREPARATION', undefined],
    ['complete', 'ATOMIC_TASK_PLANNING', undefined],
  ] as const)('routes a READY %s report to the next workflow stage', (scope, phase, documentStep) => {
    const run = createTestDeliveryRun({
      runId: 'review-route-run',
      projectId: 'review-route-project',
      ownerId: 'review-route-owner',
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
      finalReportDigest: 'd'.repeat(64),
      verdict: 'READY' as const,
      affectedPaths: [],
    }

    const routed = routeCompletedDocumentReview({
      run,
      review,
      now: '2026-08-16T00:00:00.000Z',
    })

    expect(routed.phase).toBe(phase)
    expect(routed.documentStep).toBe(documentStep)
    expect(routed.documentReviewState.activeRun).toEqual(review)
    expect(routed.documentReviewState.approvals?.[scope]).toEqual({
      scope,
      revision,
      reportPath: review.finalReportPath,
      reportDigest: review.finalReportDigest,
      approvedAt: '2026-08-16T00:00:00.000Z',
    })
  })

  test.each([
    ['foundation', ['docs/GDD.md'], 'DOCUMENT_DRAFTING', undefined],
    [
      'checklist',
      ['docs/acceptance/gameplay-checklist.md'],
      'DOCUMENT_REVIEW',
      'CHECKLIST_DRAFTING',
    ],
    ['complete', ['docs/GDD.md'], 'DOCUMENT_DRAFTING', undefined],
    [
      'complete',
      ['docs/acceptance/gameplay-checklist.md'],
      'DOCUMENT_REVIEW',
      'CHECKLIST_DRAFTING',
    ],
    [
      'complete',
      ['assets/asset-manifest.json'],
      'RESOURCE_PREPARATION',
      undefined,
    ],
    [
      'complete',
      ['assets/content/resource-registry.json'],
      'RESOURCE_PREPARATION',
      undefined,
    ],
  ] as const)('routes %s NEEDS_REVISION by affected-path ownership', (scope, affectedPaths, phase, documentStep) => {
    const run = createTestDeliveryRun({
      runId: 'review-revision-run',
      projectId: 'review-revision-project',
      ownerId: 'review-revision-owner',
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
      finalReportDigest: 'e'.repeat(64),
      verdict: 'NEEDS_REVISION' as const,
      affectedPaths: [...affectedPaths],
    }

    const routed = routeCompletedDocumentReview({ run, review })

    expect(routed.phase).toBe(phase)
    expect(routed.documentStep).toBe(documentStep)
    expect(routed.status).toBe('running')
    expect(routed.documentReviewState.activeRun).toEqual({
      ...review,
      remediatedPaths: [],
    })
    expect(routed.blockedReason).toBeUndefined()
  })

  test('stops after the third consecutive NEEDS_REVISION report', () => {
    const run = createTestDeliveryRun({
      runId: 'review-limit-run',
      projectId: 'review-limit-project',
      ownerId: 'review-limit-owner',
      foundationDraftComplete: true,
    })
    const review = {
      ...createDocumentReviewRun({ scope: 'foundation', revision, attempt: 3 }),
      status: 'completed' as const,
      finalReportPath: `.beegame/reviews/foundation/${revision}/review.md`,
      finalReportDigest: 'f'.repeat(64),
      verdict: 'NEEDS_REVISION' as const,
      affectedPaths: ['docs/GDD.md'],
    }

    const routed = routeCompletedDocumentReview({ run, review })

    expect(routed.status).toBe('needs_action')
    expect(routed.phase).toBe('DOCUMENT_REVIEW')
    expect(routed.documentReviewState.activeRun).toEqual(review)
    expect(routed.blockedReason).toContain('three consecutive reviews')
  })
})
