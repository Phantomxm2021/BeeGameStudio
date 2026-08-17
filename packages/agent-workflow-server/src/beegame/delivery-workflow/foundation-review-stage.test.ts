import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { FOUNDATION_DOCUMENT_LANES } from './foundation-document-lanes'
import { foundationReviewLanePacketStagingPath } from './foundation-review-lane-packet'
import { foundationReviewStagingPath } from './foundation-review'
import { createFoundationReviewState } from './foundation-review-state'
import { FOUNDATION_REMEDIATION_LANES } from './foundation-remediation'
import type { FoundationRemediationState } from './types'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import {
  acceptFoundationReviewWorkerTerminal,
  buildFoundationReviewDispatches,
} from './foundation-review-stage'
import { getGameDocumentContract } from './game-document-contracts'

const revision = 'a'.repeat(64)
const workspaces: string[] = []

function sourceDocument(
  path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number],
): string {
  const contract = getGameDocumentContract(path)
  return [
    `# ${contract.discipline}`,
    '',
    ...contract.sections.flatMap(section => [
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      `Exact ${path} content for ${section.sectionId}.`,
      '',
    ]),
    '<!-- beegame-production-materials -->',
    '## Production Materials',
    'Not projected.',
  ].join('\n')
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'foundation-review-stage-'))
  workspaces.push(root)
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const absolute = resolve(root, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, sourceDocument(path), 'utf8')
  }
  return root
}

function completedRemediationState(input: {
  reviewPath: string
  reviewDigest: string
}): FoundationRemediationState {
  const ownedPaths = ['docs/GDD.md'] as const
  return {
    reviewPath: input.reviewPath,
    reviewDigest: input.reviewDigest,
    sourceRevision: 'f'.repeat(64),
    resultingRevision: revision,
    lanes: FOUNDATION_REMEDIATION_LANES.map(lane =>
      lane.id === 'gdd'
        ? {
            id: lane.id,
            ownedPaths: [...ownedPaths],
            affectedPaths: ['docs/GDD.md'],
            status: 'completed' as const,
            receipt: {
              reviewDigest: input.reviewDigest,
              sourceRevision: 'f'.repeat(64),
              ownedPaths: [...ownedPaths],
              beforeDigests: { 'docs/GDD.md': '1'.repeat(64) },
              afterDigests: { 'docs/GDD.md': '2'.repeat(64) },
              committedAt: '2026-08-17T00:00:00.000Z',
            },
          }
        : {
            id: lane.id,
            ownedPaths: [...lane.ownedPaths],
            affectedPaths: [],
            status: 'not_required' as const,
          },
    ),
  }
}

function completedLanes() {
  const state = createFoundationReviewState({ mode: 'initial', revision })
  return {
    ...state,
    status: 'running' as const,
    reports: state.reports.map((report, index) =>
      report.role === 'synthesis'
        ? report
        : {
            ...report,
            status: 'completed' as const,
            digest: String(index + 1).repeat(64),
          },
    ),
  }
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(path => rm(path, { recursive: true })),
  )
})

describe('foundation review lane dispatch barrier', () => {
  test('dispatches three disjoint document lanes before packet-only synthesis', async () => {
    const root = await workspace()
    const initial = createFoundationReviewState({ mode: 'initial', revision })
    const laneDispatches = await buildFoundationReviewDispatches({
      state: initial,
      workspacePath: root,
      confirmedBriefDigest: 'd'.repeat(64),
    })

    expect(laneDispatches.map(dispatch => dispatch.role)).toEqual([
      'core-design',
      'technical-assets',
      'presentation',
    ])
    expect(
      laneDispatches.flatMap(dispatch => dispatch.assignment.sourcePaths),
    ).toEqual(
      FOUNDATION_DOCUMENT_LANES.flatMap(lane =>
        lane.ownedPaths.map(path => resolve(root, path)),
      ),
    )
    expect(
      new Set(laneDispatches.flatMap(item => item.assignment.sourcePaths)).size,
    ).toBe(8)
    expect(
      laneDispatches.every(
        item =>
          item.assignment.sourcePaths.length < 8 &&
          item.assignment.verificationSourcePaths.length === 1 &&
          item.contract.projection?.digest.match(/^[a-f0-9]{64}$/u),
      ),
    ).toBe(true)

    const synthesis = await buildFoundationReviewDispatches({
      state: completedLanes(),
      workspacePath: root,
      confirmedBriefDigest: 'd'.repeat(64),
    })
    expect(synthesis.map(dispatch => dispatch.role)).toEqual(['synthesis'])
    expect(synthesis[0].assignment.sourcePaths).toEqual(
      FOUNDATION_DOCUMENT_LANES.map(lane =>
        resolve(
          root,
          `.beegame/reviews/foundation/${revision}/parts/${lane.id}.json`,
        ),
      ),
    )
    expect(synthesis[0].assignment.verificationSourcePaths).toEqual([])
    expect(synthesis[0].contract.packetDigests).toEqual({
      'core-design': '1'.repeat(64),
      'technical-assets': '2'.repeat(64),
      presentation: '3'.repeat(64),
    })
  })

  test('resumes only a pending lane while preserving completed siblings', async () => {
    const root = await workspace()
    const initial = createFoundationReviewState({ mode: 'initial', revision })
    const resumed = {
      ...initial,
      status: 'running' as const,
      reports: initial.reports.map(report =>
        report.role === 'core-design'
          ? {
              ...report,
              status: 'completed' as const,
              digest: 'b'.repeat(64),
            }
          : report.role === 'technical-assets'
            ? { ...report, status: 'running' as const }
            : report,
      ),
    }

    const dispatches = await buildFoundationReviewDispatches({
      state: resumed,
      workspacePath: root,
      confirmedBriefDigest: 'd'.repeat(64),
    })
    expect(dispatches.map(dispatch => dispatch.role)).toEqual(['presentation'])
  })

  test('removes an uncommitted lane draft before redispatch', async () => {
    const root = await workspace()
    const stagingPath = foundationReviewLanePacketStagingPath(
      root,
      revision,
      'presentation',
    )
    await mkdir(dirname(stagingPath), { recursive: true })
    await writeFile(stagingPath, '{"stale":true}', 'utf8')

    const initial = createFoundationReviewState({ mode: 'initial', revision })
    const resumed = {
      ...initial,
      status: 'running' as const,
      reports: initial.reports.map(report =>
        report.role === 'core-design' || report.role === 'technical-assets'
          ? {
              ...report,
              status: 'completed' as const,
              digest:
                report.role === 'core-design' ? 'b'.repeat(64) : 'c'.repeat(64),
            }
          : report,
      ),
    }

    const dispatches = await buildFoundationReviewDispatches({
      state: resumed,
      workspacePath: root,
      confirmedBriefDigest: 'd'.repeat(64),
    })

    expect(dispatches.map(dispatch => dispatch.role)).toEqual(['presentation'])
    await expect(readFile(stagingPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test('dispatches verification as three bounded lanes behind remediation receipts', async () => {
    const root = await workspace()
    const priorRevision = 'c'.repeat(64)
    const priorReviewPath = `.beegame/reviews/foundation/${priorRevision}/review.json`
    const priorBytes = Buffer.from(
      `${JSON.stringify(
        {
          version: 2,
          scope: 'foundation',
          revision: priorRevision,
          verdict: 'NEEDS_REVISION',
          priorConflictStatus: [],
          conflicts: [
            {
              id: 'B1',
              title: 'Core rule mismatch',
              problem: 'The GDD cannot be implemented consistently.',
              evidence: [
                {
                  path: 'docs/GDD.md',
                  location: 'Rules',
                  observed: 'Mismatch.',
                },
              ],
              requiredOutcome: 'Use one rule.',
              changes: [{ path: 'docs/GDD.md', action: 'Align the rule.' }],
              acceptance: ['The rule is unique.'],
            },
          ],
        },
        null,
        2,
      )}\n`,
    )
    await mkdir(dirname(resolve(root, priorReviewPath)), { recursive: true })
    await writeFile(resolve(root, priorReviewPath), priorBytes)
    const priorReviewDigest = createHash('sha256')
      .update(priorBytes)
      .digest('hex')
    const state = createFoundationReviewState({
      mode: 'verification',
      revision,
      attempt: 2,
      priorReviewPath,
      priorReviewDigest,
    })
    const dispatches = await buildFoundationReviewDispatches({
      state,
      workspacePath: root,
      confirmedBriefDigest: 'd'.repeat(64),
      remediationState: completedRemediationState({
        reviewPath: priorReviewPath,
        reviewDigest: priorReviewDigest,
      }),
    })
    expect(dispatches.map(dispatch => dispatch.role)).toEqual([
      'core-design',
      'technical-assets',
      'presentation',
    ])
    expect(dispatches[0].contract.priorReview).toEqual({
      path: priorReviewPath,
      digest: priorReviewDigest,
    })
    expect(dispatches[0].contract.remediationReceipts).toHaveLength(1)
    expect(
      dispatches.map(dispatch => dispatch.contract.priorConflictIds),
    ).toEqual([['B1'], [], []])
    expect(dispatches[0].assignment.sourcePaths).toEqual([
      resolve(root, 'docs/GDD.md'),
      resolve(root, 'docs/LEVEL_SCENE_DESIGN.md'),
      resolve(root, 'docs/BALANCE_DESIGN.md'),
    ])
    expect(dispatches[0].assignment.verificationSourcePaths).toEqual([
      resolve(root, priorReviewPath),
      resolve(
        root,
        `.beegame/reviews/foundation/${revision}/projections/core-design.json`,
      ),
    ])
    expect(dispatches[0].assignment.verificationSourcePaths).not.toContain(
      resolve(root, 'docs/AUDIO_DESIGN.md'),
    )
  })

  test('accepts three lane packets and one synthesis only for the current revision', async () => {
    const root = await workspace()
    let state = createFoundationReviewState({ mode: 'initial', revision })
    await buildFoundationReviewDispatches({
      state,
      workspacePath: root,
      confirmedBriefDigest: 'd'.repeat(64),
    })

    for (const lane of FOUNDATION_DOCUMENT_LANES) {
      const stagingPath = foundationReviewLanePacketStagingPath(
        root,
        revision,
        lane.id,
      )
      await mkdir(dirname(stagingPath), { recursive: true })
      await writeFile(
        stagingPath,
        JSON.stringify({
          version: 1,
          scope: 'foundation',
          revision,
          lane: lane.id,
          mode: 'initial',
          candidates: [],
        }),
        'utf8',
      )
      state = await acceptFoundationReviewWorkerTerminal({
        state,
        workspacePath: root,
        currentRevision: revision,
        terminal: {
          workerType: 'document-reviewer',
          status: 'completed',
          revision,
          mode: 'initial',
          role: lane.id,
          reportPath: `.beegame/reviews/foundation/${revision}/parts/${lane.id}.json`,
        },
      })
    }

    const finalStagingPath = foundationReviewStagingPath(
      root,
      revision,
      'foundation-initial-1-synthesis',
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
      state,
      workspacePath: root,
      currentRevision: revision,
      terminal: {
        workerType: 'document-reviewer',
        status: 'completed',
        revision,
        mode: 'initial',
        role: 'synthesis',
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
        state: createFoundationReviewState({ mode: 'initial', revision }),
        workspacePath: root,
        currentRevision: 'f'.repeat(64),
        terminal: {
          workerType: 'document-reviewer',
          status: 'completed',
          revision,
          mode: 'initial',
          role: 'core-design',
          reportPath: `.beegame/reviews/foundation/${revision}/parts/core-design.json`,
        },
      }),
    ).rejects.toThrow('canonical artifacts changed during foundation review')
  })
})
