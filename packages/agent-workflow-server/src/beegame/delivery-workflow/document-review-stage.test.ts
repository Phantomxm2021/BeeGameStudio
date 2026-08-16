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
import {
  acceptFoundationReview,
  foundationReviewPath,
  foundationReviewStagingPath,
} from './foundation-review'

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
    const reportPath = '.beegame/reviews/foundation/revision/review.json'
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

  test('retry resets the failed direct Foundation Reviewer to pending', () => {
    const activeRun = createDocumentReviewRun({ scope: 'foundation', revision })
    activeRun.status = 'failed'
    activeRun.failureReason = 'reviewer failed'
    activeRun.reports[0].status = 'failed'
    activeRun.reports[0].failureReason = 'provider disconnected'
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
    expect(retried.documentReviewState.activeRun?.reports[0]).toMatchObject({
      status: 'pending',
      failureReason: undefined,
    })
  })

  test('retry clears a failed dispatch recorded before its Reviewer role failed', () => {
    const activeRun = createDocumentReviewRun({ scope: 'foundation', revision })
    activeRun.status = 'failed'
    activeRun.failureReason = 'delivery run is no longer running'
    activeRun.reports[0].status = 'pending'
    activeRun.reports[0].dispatch = {
      dispatchId: 'failed-dispatch',
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      taskId: 'review:foundation:final:5',
      revision,
      status: 'failed',
      failureReason: 'delivery run is no longer running',
      startedAt: '2026-08-16T00:00:00.000Z',
    } as never
    const run = createTestDeliveryRun({
      runId: 'review-interrupted-run',
      projectId: 'review-interrupted-project',
      ownerId: 'review-interrupted-owner',
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
          attempts: { foundation: 5, checklist: 0, complete: 0 },
          activeRun,
        },
      },
      { type: 'retry' },
    )

    expect(retried.documentReviewState.activeRun?.reports[0]).toMatchObject({
      status: 'pending',
      dispatch: undefined,
      failureReason: undefined,
    })
  })

  test('dispatches one direct Foundation Reviewer over all canonical documents', async () => {
    const workspacePath = await workspace()
    const run = createDocumentReviewRun({ scope: 'foundation', revision })

    const dispatches = buildDocumentReviewDispatches({
      run,
      workspacePath,
      revisionVerification,
    })

    expect(dispatches).toHaveLength(1)
    expect(dispatches[0].contract.reviewRole).toBe('final')
    expect(dispatches[0].contract.partDigests).toEqual({})
    expect(dispatches[0].assignment.sourcePaths).toEqual([])
    expect(dispatches[0].assignment.verificationSourcePaths).toHaveLength(8)
    expect(dispatches[0].assignment.stagingOutputPaths).toHaveLength(1)
    expect(dispatches[0].assignment.stagingOutputPaths[0]).toEndWith(
      '/review.json',
    )
  })

  test('carries the byte-bound previous report into a repeated Foundation review', async () => {
    const workspacePath = await workspace()
    const previousReport = {
      path: `.beegame/reviews/foundation/${'c'.repeat(64)}/review.json`,
      digest: 'd'.repeat(64),
    }
    const run = createDocumentReviewRun({
      scope: 'foundation',
      revision,
      attempt: 2,
    })

    const dispatches = buildDocumentReviewDispatches({
      run,
      workspacePath,
      previousReport,
      revisionVerification: {
        ...revisionVerification,
        prerequisiteReports: [previousReport],
      },
    })

    expect(dispatches[0].assignment.sourcePaths).toEqual([
      join(workspacePath, previousReport.path),
    ])
    expect(dispatches[0].contract.revisionVerification.prerequisiteReports).toEqual([
      previousReport,
    ])
  })

  test('derives a completed Foundation decision from committed review json', async () => {
    const workspacePath = await workspace()
    const run = createDocumentReviewRun({ scope: 'foundation', revision })
    const stagedPath = foundationReviewStagingPath(
      workspacePath,
      revision,
      'review-final',
    )
    await mkdir(dirname(stagedPath), { recursive: true })
    await writeFile(
      stagedPath,
      JSON.stringify({
        version: 2,
        scope: 'foundation',
        revision,
        verdict: 'NEEDS_REVISION',
        priorConflictStatus: [],
        conflicts: [
          {
            id: 'B1',
            title: 'State mismatch',
            problem: 'The terminal state is not defined consistently.',
            evidence: [
              {
                path: 'docs/GDD.md',
                location: 'State register',
                observed: 'UNFINISHED is absent.',
              },
            ],
            requiredOutcome: 'Use one complete terminal state.',
            changes: [
              {
                path: 'docs/GDD.md',
                action: 'Define UNFINISHED and its transitions.',
              },
            ],
            acceptance: ['The state register contains UNFINISHED.'],
          },
        ],
      }),
      'utf8',
    )
    const accepted = await acceptFoundationReview({
      workspacePath,
      revision,
      currentRevision: revision,
      dispatchId: 'review-final',
    })

    const completed = await acceptDocumentReviewTerminal({
      run,
      workspacePath,
      terminal: {
        workerType: 'document-reviewer',
        status: 'completed',
        revision,
        scope: 'foundation',
        role: 'final',
        reportPaths: [accepted.path],
      },
    })

    expect(completed).toMatchObject({
      status: 'completed',
      verdict: 'NEEDS_REVISION',
      affectedPaths: ['docs/GDD.md'],
      finalReportPath: accepted.path,
      finalReportDigest: accepted.digest,
    })
  })

  test('dispatches the complete final Reviewer only after specialists commit', async () => {
    const workspacePath = await workspace()
    let run = createDocumentReviewRun({ scope: 'complete', revision })
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
          scope: 'complete',
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
    expect(Object.keys(dispatches[0].contract.partDigests)).toHaveLength(4)
  })

  test('fails closed on an incomplete persisted legacy Foundation topology', async () => {
    const workspacePath = await workspace()
    const current = createDocumentReviewRun({ scope: 'foundation', revision })
    const stale = {
      ...current,
      status: 'running' as const,
      reports: [
        { role: 'gameplay', path: 'old/gameplay.md', status: 'completed' as const, digest: 'c'.repeat(64) },
        { role: 'technical', path: 'old/technical.md', status: 'pending' as const },
        { role: 'experience', path: 'old/experience.md', status: 'pending' as const },
        { role: 'presentation', path: 'old/presentation.md', status: 'pending' as const },
        { role: 'production', path: 'old/production.md', status: 'pending' as const },
        { role: 'final', path: 'old/review.md', status: 'pending' as const },
      ],
    }

    const recovered = await recoverDocumentReviewRun({
      run: stale,
      workspacePath,
      currentRevision: revision,
    })

    expect(recovered.status).toBe('failed')
    expect(recovered.failureReason).toContain('legacy Foundation review protocol')
  })

  test('preserves only committed siblings whose bytes still match on recovery', async () => {
    const workspacePath = await workspace()
    const run = createDocumentReviewRun({ scope: 'complete', revision })
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
      recovered.reports.find(value => value.role === 'complete-gameplay')?.status,
    ).toBe('completed')
    expect(
      recovered.reports.find(value => value.role === 'complete-technical')
        ?.status,
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

  test('recovers a committed Foundation JSON after state persistence crashes', async () => {
    const workspacePath = await workspace()
    const run = createDocumentReviewRun({ scope: 'foundation', revision })
    const path = foundationReviewPath(workspacePath, revision)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(
      path,
      `${JSON.stringify({
        version: 2,
        scope: 'foundation',
        revision,
        verdict: 'READY',
        priorConflictStatus: [],
        conflicts: [],
      })}\n`,
    )

    const recovered = await recoverDocumentReviewRun({
      run,
      workspacePath,
      currentRevision: revision,
    })

    expect(recovered).toMatchObject({
      status: 'completed',
      verdict: 'READY',
      affectedPaths: [],
      finalReportPath: `.beegame/reviews/foundation/${revision}/review.json`,
    })
  })

  test('fails closed on stale digest, duplicate legacy artifact, or legacy topology', async () => {
    const workspacePath = await workspace()
    const path = foundationReviewPath(workspacePath, revision)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(
      path,
      `${JSON.stringify({
        version: 2,
        scope: 'foundation',
        revision,
        verdict: 'READY',
        priorConflictStatus: [],
        conflicts: [],
      })}\n`,
    )
    const completed = createDocumentReviewRun({ scope: 'foundation', revision })
    completed.status = 'completed'
    completed.finalReportPath = relative(workspacePath, path)
    completed.finalReportDigest = 'f'.repeat(64)
    completed.verdict = 'READY'
    completed.affectedPaths = []
    completed.reports[0].status = 'completed'
    completed.reports[0].digest = 'f'.repeat(64)

    const stale = await recoverDocumentReviewRun({
      run: completed,
      workspacePath,
      currentRevision: revision,
    })
    expect(stale.status).toBe('failed')
    expect(stale.failureReason).toContain('digest')

    await writeFile(join(dirname(path), 'review.md'), '# legacy\n')
    const duplicate = await recoverDocumentReviewRun({
      run: createDocumentReviewRun({ scope: 'foundation', revision }),
      workspacePath,
      currentRevision: revision,
    })
    expect(duplicate.status).toBe('failed')
    expect(duplicate.failureReason).toContain('legacy')

    const legacy = createDocumentReviewRun({ scope: 'foundation', revision })
    legacy.reports = [
      {
        role: 'final',
        path: `.beegame/reviews/foundation/${revision}/review.md`,
        status: 'pending',
      },
    ]
    const legacyResult = await recoverDocumentReviewRun({
      run: legacy,
      workspacePath,
      currentRevision: revision,
    })
    expect(legacyResult.status).toBe('failed')
    expect(legacyResult.failureReason).toContain('legacy')
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

  test('stops after one verification review still requires revision', () => {
    const run = createTestDeliveryRun({
      runId: 'review-limit-run',
      projectId: 'review-limit-project',
      ownerId: 'review-limit-owner',
      foundationDraftComplete: true,
    })
    const review = {
      ...createDocumentReviewRun({ scope: 'foundation', revision, attempt: 2 }),
      status: 'completed' as const,
      finalReportPath: `.beegame/reviews/foundation/${revision}/review.json`,
      finalReportDigest: 'f'.repeat(64),
      priorReviewDigest: 'e'.repeat(64),
      verdict: 'NEEDS_REVISION' as const,
      affectedPaths: ['docs/GDD.md'],
    }

    const routed = routeCompletedDocumentReview({ run, review })

    expect(routed.status).toBe('needs_action')
    expect(routed.phase).toBe('DOCUMENT_REVIEW')
    expect(routed.documentReviewState.activeRun).toEqual(review)
    expect(routed.blockedReason).toContain('verification still requires revision')
  })

  test('does not treat dispatch retries as additional semantic review cycles', () => {
    const run = createTestDeliveryRun({
      runId: 'review-verification-retry-run',
      projectId: 'review-verification-retry-project',
      ownerId: 'review-verification-retry-owner',
      foundationDraftComplete: true,
    })
    const review = {
      ...createDocumentReviewRun({ scope: 'foundation', revision, attempt: 7 }),
      status: 'completed' as const,
      finalReportPath: `.beegame/reviews/foundation/${revision}/review.json`,
      finalReportDigest: 'f'.repeat(64),
      priorReviewDigest: 'e'.repeat(64),
      verdict: 'NEEDS_REVISION' as const,
      affectedPaths: ['docs/GDD.md'],
    }

    expect(() =>
      transitionDeliveryRun(
        {
          ...run,
          phase: 'DOCUMENT_REVIEW',
          documentStep: 'FOUNDATION_REVIEW',
          status: 'needs_action',
          documentReviewState: {
            ...run.documentReviewState,
            activeRun: review,
          },
        },
        { type: 'retry' },
      ),
    ).toThrow('Foundation verification is final')
  })
})
