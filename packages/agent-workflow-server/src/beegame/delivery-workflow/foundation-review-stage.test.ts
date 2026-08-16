import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { foundationReviewEvidenceStagingPath } from './foundation-review-evidence'
import { foundationReviewStagingPath } from './foundation-review'
import { createFoundationReviewState } from './foundation-review-state'
import {
  acceptFoundationReviewWorkerTerminal,
  buildFoundationReviewDispatches,
} from './foundation-review-stage'

const revision = 'a'.repeat(64)

function completedSpecialists() {
  const state = createFoundationReviewState({ mode: 'initial', revision })
  return {
    ...state,
    status: 'running' as const,
    reports: state.reports.map(report =>
      report.role === 'final'
        ? report
        : {
            ...report,
            status: 'completed' as const,
            digest:
              report.role === 'contract-specialist'
                ? 'b'.repeat(64)
                : 'c'.repeat(64),
          },
    ),
  }
}

describe('foundation review dispatch barrier', () => {
  test('dispatches both independent specialists before one final reviewer', () => {
    const initial = createFoundationReviewState({ mode: 'initial', revision })
    const specialistDispatches = buildFoundationReviewDispatches({
      state: initial,
      workspacePath: '/workspace',
      confirmedBriefDigest: 'd'.repeat(64),
    })
    expect(specialistDispatches.map(dispatch => dispatch.role)).toEqual([
      'contract-specialist',
      'integration-specialist',
    ])
    expect(
      specialistDispatches.every(
        dispatch =>
          dispatch.assignment.stagingOutputPaths.length === 1 &&
          dispatch.assignment.committedOutputPaths.length === 1 &&
          dispatch.assignment.sourcePaths.length === 8,
      ),
    ).toBe(true)

    const oneCompleted = {
      ...initial,
      status: 'running' as const,
      reports: initial.reports.map(report =>
        report.role === 'contract-specialist'
          ? { ...report, status: 'completed' as const, digest: 'b'.repeat(64) }
          : report.role === 'integration-specialist'
            ? { ...report, status: 'running' as const }
            : report,
      ),
    }
    expect(
      buildFoundationReviewDispatches({
        state: oneCompleted,
        workspacePath: '/workspace',
        confirmedBriefDigest: 'd'.repeat(64),
      }),
    ).toEqual([])

    const finalDispatches = buildFoundationReviewDispatches({
      state: completedSpecialists(),
      workspacePath: '/workspace',
      confirmedBriefDigest: 'd'.repeat(64),
    })
    expect(finalDispatches.map(dispatch => dispatch.role)).toEqual(['final'])
    expect(finalDispatches[0].contract.packetDigests).toEqual({
      'contract-specialist': 'b'.repeat(64),
      'integration-specialist': 'c'.repeat(64),
    })
  })

  test('dispatches verification as one standalone final reviewer', () => {
    const state = createFoundationReviewState({
      mode: 'verification',
      revision,
      attempt: 2,
      priorReviewPath: '.beegame/reviews/foundation/prior/review.json',
      priorReviewDigest: 'e'.repeat(64),
    })
    const dispatches = buildFoundationReviewDispatches({
      state,
      workspacePath: '/workspace',
      confirmedBriefDigest: 'd'.repeat(64),
    })
    expect(dispatches.map(dispatch => dispatch.role)).toEqual(['final'])
    expect(dispatches[0].contract.reviewMode).toBe('verification')
    expect(dispatches[0].contract.priorReview).toEqual({
      path: '.beegame/reviews/foundation/prior/review.json',
      digest: 'e'.repeat(64),
    })
  })

  test('accepts specialist and final bytes only for the assigned current revision', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-stage-'))
    const initial = createFoundationReviewState({ mode: 'initial', revision })
    const specialistPath = foundationReviewEvidenceStagingPath(
      workspacePath,
      revision,
      'contract-specialist',
    )
    await mkdir(dirname(specialistPath), { recursive: true })
    await writeFile(
      specialistPath,
      JSON.stringify({
        version: 1,
        scope: 'foundation',
        revision,
        role: 'contract-specialist',
        candidates: [],
      }),
      'utf8',
    )
    const afterContract = await acceptFoundationReviewWorkerTerminal({
      state: initial,
      workspacePath,
      currentRevision: revision,
      terminal: {
        workerType: 'document-reviewer',
        status: 'completed',
        revision,
        mode: 'initial',
        role: 'contract-specialist',
        reportPath: `.beegame/reviews/foundation/${revision}/parts/contract.json`,
      },
    })
    expect(afterContract.reports[0]).toMatchObject({
      role: 'contract-specialist',
      status: 'completed',
    })
    expect(afterContract.reports[0].digest).toMatch(/^[a-f0-9]{64}$/u)

    const integrationPath = foundationReviewEvidenceStagingPath(
      workspacePath,
      revision,
      'integration-specialist',
    )
    await mkdir(dirname(integrationPath), { recursive: true })
    await writeFile(
      integrationPath,
      JSON.stringify({
        version: 1,
        scope: 'foundation',
        revision,
        role: 'integration-specialist',
        candidates: [],
      }),
      'utf8',
    )
    const readyForFinal = await acceptFoundationReviewWorkerTerminal({
      state: afterContract,
      workspacePath,
      currentRevision: revision,
      terminal: {
        workerType: 'document-reviewer',
        status: 'completed',
        revision,
        mode: 'initial',
        role: 'integration-specialist',
        reportPath: `.beegame/reviews/foundation/${revision}/parts/integration.json`,
      },
    })
    const finalStagingPath = foundationReviewStagingPath(
      workspacePath,
      revision,
      'foundation-initial-1-final',
    )
    await mkdir(dirname(finalStagingPath), { recursive: true })
    await writeFile(
      finalStagingPath,
      JSON.stringify({
        version: 2,
        scope: 'foundation',
        revision,
        verdict: 'READY',
        priorConflictStatus: [],
        conflicts: [],
      }),
      'utf8',
    )
    const completed = await acceptFoundationReviewWorkerTerminal({
      state: readyForFinal,
      workspacePath,
      currentRevision: revision,
      terminal: {
        workerType: 'document-reviewer',
        status: 'completed',
        revision,
        mode: 'initial',
        role: 'final',
        reportPath: `.beegame/reviews/foundation/${revision}/review.json`,
      },
    })
    expect(completed).toMatchObject({
      status: 'completed',
      verdict: 'READY',
      finalReportPath: `.beegame/reviews/foundation/${revision}/review.json`,
    })

    await expect(
      acceptFoundationReviewWorkerTerminal({
        state: initial,
        workspacePath,
        currentRevision: 'f'.repeat(64),
        terminal: {
          workerType: 'document-reviewer',
          status: 'completed',
          revision,
          mode: 'initial',
          role: 'integration-specialist',
          reportPath: `.beegame/reviews/foundation/${revision}/parts/integration.json`,
        },
      }),
    ).rejects.toThrow('canonical artifacts changed during foundation review')
  })
})
