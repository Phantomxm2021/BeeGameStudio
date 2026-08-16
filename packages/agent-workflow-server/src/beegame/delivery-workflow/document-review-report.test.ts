import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import {
  acceptFinalReport,
  acceptReviewDecision,
  acceptSpecialistReport,
  reviewDecisionPath,
  reviewPartPath,
  reviewReportPath,
  reviewRevisionDirectory,
  reviewStagingPath,
} from './document-review-report'
import {
  documentReviewAssignments,
  finalReviewAssignment,
} from './document-review-topology'

const workspaces: string[] = []
const revision = 'a'.repeat(64)

afterEach(async () => {
  await Promise.all(
    workspaces
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true })),
  )
})

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'beegame-review-report-'))
  workspaces.push(path)
  return path
}

async function writeDecisionFixture(input: {
  workspacePath: string
  decision?: Record<string, unknown>
}): Promise<{ reportText: string }> {
  const reportPath = reviewReportPath(
    input.workspacePath,
    'checklist',
    revision,
  )
  const decisionPath = reviewDecisionPath(
    input.workspacePath,
    'checklist',
    revision,
  )
  const reportText = '# Checklist review\n\n## Blocking findings\n\nNone.\n'
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, reportText, 'utf8')
  await writeFile(
    decisionPath,
    `${JSON.stringify(
      input.decision ?? {
        version: 1,
        scope: 'checklist',
        revision,
        verdict: 'READY',
        affectedPaths: [],
        reportPath: `.beegame/reviews/checklist/${revision}/review.md`,
      },
    )}\n`,
    'utf8',
  )
  return { reportText }
}

describe('project-local document review reports', () => {
  test('places committed and staged reports under the active project revision', async () => {
    const workspacePath = await workspace()

    expect(reviewRevisionDirectory(workspacePath, 'checklist', revision)).toBe(
      join(workspacePath, '.beegame', 'reviews', 'checklist', revision),
    )
    expect(
      reviewPartPath(workspacePath, 'checklist', revision, 'gameplay'),
    ).toBe(
      join(
        workspacePath,
        '.beegame',
        'reviews',
        'checklist',
        revision,
        'parts',
        'gameplay.md',
      ),
    )
    expect(
      reviewStagingPath(
        workspacePath,
        'checklist',
        revision,
        'dispatch-1',
        'gameplay.md',
      ),
    ).toBe(
      join(
        workspacePath,
        '.beegame',
        'reviews',
        'checklist',
        revision,
        '.staging',
        'dispatch-1',
        'gameplay.md',
      ),
    )
  })

  test('accepts the exact decision and binds its report digest to persisted bytes', async () => {
    const workspacePath = await workspace()
    const { reportText } = await writeDecisionFixture({ workspacePath })

    const accepted = await acceptReviewDecision({
      workspacePath,
      scope: 'checklist',
      revision,
      allowedAffectedPaths: ['docs/GDD.md'],
    })

    expect(accepted.decision).toEqual({
      version: 1,
      scope: 'checklist',
      revision,
      verdict: 'READY',
      affectedPaths: [],
      reportPath: `.beegame/reviews/checklist/${revision}/review.md`,
    })
    expect(accepted.reportDigest).toBe(
      createHash('sha256').update(reportText).digest('hex'),
    )
  })

  test('rejects a decision bound to another revision', async () => {
    const workspacePath = await workspace()
    await writeDecisionFixture({
      workspacePath,
      decision: {
        version: 1,
        scope: 'checklist',
        revision: 'b'.repeat(64),
        verdict: 'READY',
        affectedPaths: [],
        reportPath: `.beegame/reviews/checklist/${revision}/review.md`,
      },
    })

    await expect(
      acceptReviewDecision({
        workspacePath,
        scope: 'checklist',
        revision,
        allowedAffectedPaths: ['docs/GDD.md'],
      }),
    ).rejects.toThrow('document review decision revision does not match')
  })

  test('rejects affected paths outside the active review ownership', async () => {
    const workspacePath = await workspace()
    await writeDecisionFixture({
      workspacePath,
      decision: {
        version: 1,
        scope: 'checklist',
        revision,
        verdict: 'NEEDS_REVISION',
        affectedPaths: ['../outside.md'],
        reportPath: `.beegame/reviews/checklist/${revision}/review.md`,
      },
    })

    await expect(
      acceptReviewDecision({
        workspacePath,
        scope: 'checklist',
        revision,
        allowedAffectedPaths: ['docs/GDD.md'],
      }),
    ).rejects.toThrow('document review decision affected path is not allowed')
  })

  test('accepts only the assigned nonempty Markdown specialist report', async () => {
    const workspacePath = await workspace()
    const [assignment] = documentReviewAssignments({
      scope: 'complete',
      workspacePath,
      revision,
    })
    await mkdir(dirname(assignment.stagingOutputPaths[0]), { recursive: true })
    await writeFile(
      assignment.stagingOutputPaths[0],
      '# Complete gameplay review\n\nNo blocking findings.\n',
      'utf8',
    )

    const accepted = await acceptSpecialistReport({
      assignment,
      workspacePath,
      revision,
      currentRevision: revision,
    })

    expect(accepted).toEqual({
      role: 'complete-gameplay',
      path: relative(workspacePath, assignment.committedOutputPaths[0]),
      digest: createHash('sha256')
        .update('# Complete gameplay review\n\nNo blocking findings.\n')
        .digest('hex'),
    })
  })

  test('rejects success when canonical artifacts changed during review', async () => {
    const workspacePath = await workspace()
    const [assignment] = documentReviewAssignments({
      scope: 'complete',
      workspacePath,
      revision,
    })
    await mkdir(dirname(assignment.stagingOutputPaths[0]), { recursive: true })
    await writeFile(
      assignment.stagingOutputPaths[0],
      '# Gameplay review\n\nNo blocking findings.\n',
      'utf8',
    )

    await expect(
      acceptSpecialistReport({
        assignment,
        workspacePath,
        revision,
        currentRevision: 'b'.repeat(64),
      }),
    ).rejects.toThrow('canonical artifacts changed during document review')
  })

  test('accepts the final report only against the contracted part digests', async () => {
    const workspacePath = await workspace()
    const specialists = documentReviewAssignments({
      scope: 'complete',
      workspacePath,
      revision,
    })
    const final = finalReviewAssignment({
      scope: 'complete',
      workspacePath,
      revision,
      specialists,
    })
    const partDigests: Record<string, string> = {}
    for (const assignment of specialists) {
      const text = `# ${assignment.role} review\n\nNo blocking findings.\n`
      const path = assignment.committedOutputPaths[0]
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, text, 'utf8')
      partDigests[relative(workspacePath, path)] = createHash('sha256')
        .update(text)
        .digest('hex')
    }
    await mkdir(dirname(final.stagingOutputPaths[0]), { recursive: true })
    await writeFile(
      final.stagingOutputPaths[0],
      '# Complete review\n\nNo blocking findings.\n',
      'utf8',
    )
    await writeFile(
      final.stagingOutputPaths[1],
      `${JSON.stringify({
        version: 1,
        scope: 'complete',
        revision,
        verdict: 'READY',
        affectedPaths: [],
        reportPath: `.beegame/reviews/complete/${revision}/review.md`,
      })}\n`,
      'utf8',
    )

    const accepted = await acceptFinalReport({
      assignment: final,
      workspacePath,
      revision,
      currentRevision: revision,
      allowedAffectedPaths: ['docs/GDD.md'],
      partDigests,
    })

    expect(accepted.decision.verdict).toBe('READY')
    expect(accepted.reportDigest).toMatch(/^[a-f0-9]{64}$/u)
  })
})
