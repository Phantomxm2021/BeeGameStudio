import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import {
  acceptDocumentReviewTerminal,
  buildDocumentReviewDispatches,
  createDocumentReviewRun,
  recoverDocumentReviewRun,
} from './document-review-stage'

const revision = 'a'.repeat(64)
const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })),
  )
})

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'beegame-review-stage-'))
  workspaces.push(path)
  return path
}

describe('document review run', () => {
  test('dispatches at most three pending specialist roles concurrently', async () => {
    const workspacePath = await workspace()
    const run = createDocumentReviewRun({ scope: 'foundation', revision })

    const dispatches = buildDocumentReviewDispatches({ run, workspacePath })

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

    const dispatches = buildDocumentReviewDispatches({ run, workspacePath })

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

    expect(recovered.reports.find(value => value.role === 'gameplay')?.status).toBe(
      'completed',
    )
    expect(recovered.reports.find(value => value.role === 'technical')?.status).toBe(
      'pending',
    )
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
    expect(recovered.reports.every(value => value.status === 'pending')).toBe(true)
    expect(recovered.attempt).toBe(run.attempt)
  })
})
