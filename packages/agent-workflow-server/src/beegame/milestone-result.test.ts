import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMilestoneResult } from './milestone-result'

test('milestone signal is explicit, not extracted from natural language', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-milestone-result-'))
  const path = join(root, 'result.txt')
  try {
    expect(await readMilestoneResult(path, 'review')).toBeUndefined()
    for (const text of ['PASS', 'Review complete, but blocked', 'blocked']) {
      await writeFile(path, text)
      expect(await readMilestoneResult(path, 'review')).toBeUndefined()
    }
    await writeFile(path, 'blocked\n需求存在矛盾')
    expect(await readMilestoneResult(path, 'review')).toMatchObject({ status: 'blocked', summary: '需求存在矛盾' })
    await writeFile(path, 'complete\n')
    expect(await readMilestoneResult(path, 'implementation')).toMatchObject({ phase: 'implementation', status: 'complete' })
    expect(await readMilestoneResult(path, 'author')).toMatchObject({ phase: 'author', status: 'complete' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a malformed source document names the failing receipt field instead of disappearing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-review-result-error-')), path = join(root, 'result.txt')
  try {
    await writeFile(path, 'complete\n' + JSON.stringify({ step: 'inspect', findings: [{ id: 'F3', severity: 'follow-up',
      action: 'evidence', owner: 'GDD.md', documents: ['GDD.md'], sources: [{ document: 'context.md', section: 'Task' }],
      impact: 'Checker unavailable', closeWhen: 'Restore checker', neededBefore: null }], resolved: [] }))
    const result = await readMilestoneResult(path, 'review')
    expect(result?.review).toBeUndefined()
    expect(result?.validationIssues?.join(' ')).toContain('findings.0.sources.0.document')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('review parses a bounded JSON step, never malformed findings as a successful review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-review-result-')), path = join(root, 'result.txt')
  try {
    const review = { step: 'inspect' as const, findings: [], resolved: [] }
    await writeFile(path, 'complete\n' + JSON.stringify(review))
    expect((await readMilestoneResult(path, 'review'))?.review).toEqual(review)
    for (const invalid of ['{', '{"step":"inspect"}', '{"step":"inspect","findings":[],"resolved":[],"PASS":true}']) {
      await writeFile(path, 'complete\n' + invalid)
      const result = await readMilestoneResult(path, 'review')
      expect(result?.review).toBeUndefined()
      expect(result?.validationIssues?.length).toBeGreaterThan(0)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
