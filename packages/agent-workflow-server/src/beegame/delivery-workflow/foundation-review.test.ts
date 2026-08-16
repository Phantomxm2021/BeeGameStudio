import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  acceptFoundationReview,
  foundationReviewAffectedPaths,
  foundationReviewPath,
  foundationReviewSchema,
  foundationReviewStagingPath,
} from './foundation-review'

const revision = 'a'.repeat(64)

function conflict(id = 'B1') {
  return {
    id,
    title: 'Undefined unfinished state',
    problem: 'GDD and Audio do not define the same terminal state.',
    evidence: [
      {
        path: 'docs/GDD.md',
        location: 'State register',
        observed: 'UNFINISHED is absent.',
      },
    ],
    requiredOutcome: 'Both documents use one complete terminal state.',
    changes: [
      {
        path: 'docs/GDD.md',
        action: 'Define the state and its entry and exit conditions.',
      },
      {
        path: 'docs/AUDIO_DESIGN.md',
        action: 'Define the matching music and ambience behavior.',
      },
    ],
    acceptance: [
      'The state register and audio coverage table use the same identifier.',
    ],
  }
}

function review(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    scope: 'foundation',
    revision,
    verdict: 'NEEDS_REVISION',
    priorConflictStatus: [],
    conflicts: [conflict()],
    ...overrides,
  }
}

describe('foundation review contract', () => {
  test('derives a canonical unique remediation path set from conflict changes', () => {
    const parsed = foundationReviewSchema.parse(
      review({
        conflicts: [
          conflict(),
          {
            ...conflict('B2'),
            changes: [
              {
                path: 'docs/GDD.md',
                action: 'Remove the duplicated authority value.',
              },
              {
                path: 'docs/TECHNICAL_DESIGN.md',
                action: 'Reference the GDD authority.',
              },
            ],
          },
        ],
      }),
    )

    expect(foundationReviewAffectedPaths(parsed)).toEqual([
      'docs/GDD.md',
      'docs/TECHNICAL_DESIGN.md',
      'docs/AUDIO_DESIGN.md',
    ])
  })

  test('rejects verdict, conflict, identity and actionability mismatches', () => {
    expect(() =>
      foundationReviewSchema.parse(
        review({ verdict: 'READY', conflicts: [conflict()] }),
      ),
    ).toThrow()
    expect(() =>
      foundationReviewSchema.parse(
        review({ verdict: 'NEEDS_REVISION', conflicts: [] }),
      ),
    ).toThrow()
    expect(() =>
      foundationReviewSchema.parse(
        review({ conflicts: [conflict('B1'), conflict('B1')] }),
      ),
    ).toThrow()
    expect(() =>
      foundationReviewSchema.parse(
        review({ conflicts: [{ ...conflict(), evidence: [] }] }),
      ),
    ).toThrow()
    expect(() =>
      foundationReviewSchema.parse(
        review({ conflicts: [{ ...conflict(), acceptance: [] }] }),
      ),
    ).toThrow()
    expect(() =>
      foundationReviewSchema.parse(
        review({
          conflicts: [
            {
              ...conflict(),
              changes: [{ path: 'docs/UNKNOWN.md', action: 'Change it.' }],
            },
          ],
        }),
      ),
    ).toThrow()
  })

  test('accounts for every byte-bound prior conflict without silent loss', () => {
    const priorDigest = 'b'.repeat(64)
    expect(() =>
      foundationReviewSchema.parse(
        review({
          priorReviewDigest: priorDigest,
          priorConflictStatus: [{ id: 'B1', status: 'closed' }],
          conflicts: [conflict('B1')],
        }),
      ),
    ).toThrow()
    expect(() =>
      foundationReviewSchema.parse(
        review({
          priorReviewDigest: priorDigest,
          priorConflictStatus: [{ id: 'B1', status: 'open' }],
          conflicts: [conflict('B2')],
        }),
      ),
    ).toThrow()
    expect(() =>
      foundationReviewSchema.parse(
        review({
          priorConflictStatus: [{ id: 'B1', status: 'open' }],
          conflicts: [conflict('B1')],
        }),
      ),
    ).toThrow()

    expect(
      foundationReviewSchema.parse(
        review({
          priorReviewDigest: priorDigest,
          priorConflictStatus: [
            { id: 'B1', status: 'closed' },
            { id: 'B3', status: 'open' },
          ],
          conflicts: [conflict('B2'), conflict('B3')],
        }),
      ).conflicts.map(item => item.id),
    ).toEqual(['B2', 'B3'])
  })

  test('preserves bounded verification evidence for each prior conflict status', () => {
    const parsed = foundationReviewSchema.parse(
      review({
        verdict: 'READY',
        priorReviewDigest: 'b'.repeat(64),
        priorConflictStatus: [
          {
            id: 'B1',
            status: 'closed',
            note: 'The cited authority and every named consumer now agree.',
          },
        ],
        conflicts: [],
      }),
    )

    expect(parsed.priorConflictStatus).toEqual([
      {
        id: 'B1',
        status: 'closed',
        note: 'The cited authority and every named consumer now agree.',
      },
    ])
  })

  test('atomically accepts one immutable review json bound to current bytes', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-review-'))
    const dispatchId = 'dispatch-1'
    const stagedPath = foundationReviewStagingPath(
      workspacePath,
      revision,
      dispatchId,
    )
    await mkdir(dirname(stagedPath), { recursive: true })
    await writeFile(stagedPath, JSON.stringify(review()), 'utf8')

    const accepted = await acceptFoundationReview({
      workspacePath,
      revision,
      currentRevision: revision,
      dispatchId,
    })

    const committedPath = foundationReviewPath(workspacePath, revision)
    const committedBytes = await readFile(committedPath)
    expect(accepted.path).toBe(
      `.beegame/reviews/foundation/${revision}/review.json`,
    )
    expect(accepted.digest).toBe(
      createHash('sha256').update(committedBytes).digest('hex'),
    )
    expect(accepted.affectedPaths).toEqual([
      'docs/GDD.md',
      'docs/AUDIO_DESIGN.md',
    ])
    await expect(
      acceptFoundationReview({
        workspacePath,
        revision,
        currentRevision: revision,
        dispatchId,
      }),
    ).rejects.toThrow('foundation review is already committed')
  })

  test('rejects a verification review that does not account for every prior conflict', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-review-'))
    const stagedPath = foundationReviewStagingPath(
      workspacePath,
      revision,
      'dispatch-2',
    )
    const prior = foundationReviewSchema.parse(
      review({ conflicts: [conflict('B1'), conflict('B2')] }),
    )
    await mkdir(dirname(stagedPath), { recursive: true })
    await writeFile(
      stagedPath,
      JSON.stringify(
        review({
          priorReviewDigest: 'c'.repeat(64),
          priorConflictStatus: [{ id: 'B1', status: 'closed' }],
          conflicts: [conflict('B2')],
        }),
      ),
      'utf8',
    )

    await expect(
      acceptFoundationReview({
        workspacePath,
        revision,
        currentRevision: revision,
        dispatchId: 'dispatch-2',
        priorReview: { review: prior, digest: 'c'.repeat(64) },
      }),
    ).rejects.toThrow('foundation review does not account for every prior conflict')
  })
})
