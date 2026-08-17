import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  FOUNDATION_REVIEW_VERSION,
  acceptFoundationReview,
  foundationReviewAffectedPaths,
  foundationReviewOutputContractInstruction,
  foundationReviewPath,
  foundationReviewSchema,
  foundationReviewStagingPath,
  type FoundationReview,
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
    version: 3,
    scope: 'foundation',
    revision,
    verdict: 'NEEDS_REVISION',
    conflicts: [conflict()],
    ...overrides,
  }
}

describe('foundation review contract', () => {
  test('publishes one strict v3 schema without verification-era fields', () => {
    const jsonSchema = z.toJSONSchema(foundationReviewSchema, {
      target: 'draft-7',
    }) as { properties?: Record<string, unknown> }
    const schemaText = JSON.stringify(jsonSchema)

    expect(FOUNDATION_REVIEW_VERSION).toBe(3)
    expect(Object.keys(jsonSchema.properties ?? {})).toEqual([
      'version',
      'scope',
      'revision',
      'verdict',
      'conflicts',
    ])
    expect(schemaText).not.toContain('priorConflictStatus')
    expect(schemaText).not.toContain('priorReviewDigest')
    expect(schemaText).not.toContain('"not"')
  })

  test('states one exact root shape with acceptance only inside conflicts', () => {
    const instruction = foundationReviewOutputContractInstruction()
    expect(instruction).toContain('The root object has exactly')
    expect(instruction).toContain('There is no root-level acceptance field')
  })
  test('derives a canonical unique affected path set from conflict changes', () => {
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

  test('accepts distinct change actions targeting the same document', () => {
    const changes: FoundationReview['conflicts'][number]['changes'] = [
      {
        path: 'docs/GDD.md',
        action: 'Define the terminal-state authority.',
      },
      {
        path: 'docs/GDD.md',
        action: 'Remove the conflicting terminal-state condition.',
      },
    ]

    const parsed = foundationReviewSchema.parse(
      review({ conflicts: [{ ...conflict(), changes }] }),
    )

    expect(parsed.conflicts[0]?.changes).toEqual(changes)
    expect(foundationReviewAffectedPaths(parsed)).toEqual([
      'docs/GDD.md',
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

  test('accepts v3 and rejects v2 or verification-era fields', () => {
    expect(foundationReviewSchema.parse(review()).version).toBe(3)
    expect(() =>
      foundationReviewSchema.parse(
        review({
          version: 2,
        }),
      ),
    ).toThrow()
    expect(() =>
      foundationReviewSchema.parse(
        review({
          priorReviewDigest: 'b'.repeat(64),
        }),
      ),
    ).toThrow()
    expect(() =>
      foundationReviewSchema.parse(
        review({
          priorConflictStatus: [],
        }),
      ),
    ).toThrow()
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

})
