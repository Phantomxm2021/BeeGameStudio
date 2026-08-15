import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  acceptReviewDecision,
  reviewDecisionPath,
  reviewPartPath,
  reviewReportPath,
  reviewRevisionDirectory,
  reviewStagingPath,
} from './document-review-report'

const workspaces: string[] = []
const revision = 'a'.repeat(64)

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(path =>
      rm(path, { recursive: true, force: true }),
    ),
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
    'foundation',
    revision,
  )
  const decisionPath = reviewDecisionPath(
    input.workspacePath,
    'foundation',
    revision,
  )
  const reportText = '# Foundation review\n\n## Blocking findings\n\nNone.\n'
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, reportText, 'utf8')
  await writeFile(
    decisionPath,
    `${JSON.stringify(
      input.decision ?? {
        version: 1,
        scope: 'foundation',
        revision,
        verdict: 'READY',
        affectedPaths: [],
        reportPath: `.beegame/reviews/foundation/${revision}/review.md`,
      },
    )}\n`,
    'utf8',
  )
  return { reportText }
}

describe('project-local document review reports', () => {
  test('places committed and staged reports under the active project revision', async () => {
    const workspacePath = await workspace()

    expect(
      reviewRevisionDirectory(workspacePath, 'foundation', revision),
    ).toBe(
      join(workspacePath, '.beegame', 'reviews', 'foundation', revision),
    )
    expect(reviewPartPath(workspacePath, 'foundation', revision, 'gameplay')).toBe(
      join(
        workspacePath,
        '.beegame',
        'reviews',
        'foundation',
        revision,
        'parts',
        'gameplay.md',
      ),
    )
    expect(
      reviewStagingPath(
        workspacePath,
        'foundation',
        revision,
        'dispatch-1',
        'gameplay.md',
      ),
    ).toBe(
      join(
        workspacePath,
        '.beegame',
        'reviews',
        'foundation',
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
      scope: 'foundation',
      revision,
      allowedAffectedPaths: ['docs/GDD.md'],
    })

    expect(accepted.decision).toEqual({
      version: 1,
      scope: 'foundation',
      revision,
      verdict: 'READY',
      affectedPaths: [],
      reportPath: `.beegame/reviews/foundation/${revision}/review.md`,
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
        scope: 'foundation',
        revision: 'b'.repeat(64),
        verdict: 'READY',
        affectedPaths: [],
        reportPath: `.beegame/reviews/foundation/${revision}/review.md`,
      },
    })

    await expect(
      acceptReviewDecision({
        workspacePath,
        scope: 'foundation',
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
        scope: 'foundation',
        revision,
        verdict: 'NEEDS_REVISION',
        affectedPaths: ['../outside.md'],
        reportPath: `.beegame/reviews/foundation/${revision}/review.md`,
      },
    })

    await expect(
      acceptReviewDecision({
        workspacePath,
        scope: 'foundation',
        revision,
        allowedAffectedPaths: ['docs/GDD.md'],
      }),
    ).rejects.toThrow('document review decision affected path is not allowed')
  })
})
