import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMilestoneResult, parseMilestoneResult, productionHandoffSchema, PRODUCTION_HANDOFF_INSTRUCTION } from './milestone-result'

test('production handoff canonicalizes explicit docs prefixes and reports exact invalid fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-production-fields-')), path = join(root, 'result.txt')
  const finding = { id: 'texture', severity: 'follow-up', action: 'correct', owner: 'docs.ART_DIRECTION.md',
    documents: ['content/scenes/sample.json'], sources: [{ document: 'docs/ART_DIRECTION.md', section: 'Visual language' }],
    impact: 'Mismatch in source', closeWhen: 'Match the owned decision', neededBefore: 'acceptance' }
  try {
    await writeFile(path, 'complete\n' + JSON.stringify({ summary: 'Saved', designIssues: [finding] }))
    const invalid = await readMilestoneResult(path, 'resources')
    expect(invalid?.validationIssues?.join(' ')).toContain('designIssues.0.owner')
    expect(invalid?.validationIssues?.join(' ')).toContain('designIssues.0.documents.0')
    expect(invalid?.reportedIssueIds).toEqual(['texture'])
    const fixed = productionHandoffSchema.parse({ summary: 'Saved', designIssues: [{ ...finding,
      owner: 'docs/ART_DIRECTION.md', documents: ['ART_DIRECTION.md'] }] })
    expect(fixed.designIssues[0]!.owner).toBe('ART_DIRECTION.md')
    expect(fixed.designIssues[0]!.sources[0]!.document).toBe('ART_DIRECTION.md')
    expect(PRODUCTION_HANDOFF_INSTRUCTION).toContain('ART_DIRECTION.md')
    expect(PRODUCTION_HANDOFF_INSTRUCTION).toContain('resolved')
    expect(productionHandoffSchema.safeParse({ summary: 'Saved', designIssues: [], handoff: {} }).success).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('milestone signal is explicit, not extracted from natural language', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-milestone-result-'))
  const path = join(root, 'result.txt')
  try {
    expect(await readMilestoneResult(path, 'review')).toBeUndefined()
    for (const text of ['PASS', 'Review complete, but blocked', 'blocked']) {
      await writeFile(path, text)
      expect(await readMilestoneResult(path, 'review')).toMatchObject({ status: 'invalid' })
    }
    await writeFile(path, 'blocked\n需求存在矛盾')
    expect(await readMilestoneResult(path, 'review')).toMatchObject({ status: 'blocked', summary: '需求存在矛盾' })
    await writeFile(path, 'complete\n')
    expect(await readMilestoneResult(path, 'implementation')).toMatchObject({ phase: 'implementation', status: 'complete' })
    expect(await readMilestoneResult(path, 'author')).toMatchObject({ phase: 'author', status: 'complete' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('native final replies use the same explicit status parsing without a file contract', () => {
  expect(parseMilestoneResult('COMPLETE\nSaved docs/GDD.md.', 'author', 'Author final response'))
    .toEqual({ phase: 'author', status: 'complete', summary: 'Saved docs/GDD.md.' })
  expect(parseMilestoneResult('blocked\nNeed a confirmed scope decision.', 'author', 'Author final response'))
    .toEqual({ phase: 'author', status: 'blocked', summary: 'Need a confirmed scope decision.' })
  for (const text of ['', 'Done', 'I am complete', 'blocked']) {
    const result = parseMilestoneResult(text, 'author', 'Author final response')
    expect(result.status).toBe('invalid')
    expect(result.validationIssues?.length).toBeGreaterThan(0)
    expect(result.validationIssues?.join(' ')).not.toContain('receipt')
  }
})

test.each(['author', 'review', 'implementation'] as const)('%s status ignores case and surrounding whitespace without changing its body', async phase => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-milestone-case-')), path = join(root, 'result.txt')
  try {
    const review = { step: 'inspect' as const, findings: [], resolved: [] }
    for (const token of ['complete', 'COMPLETE', 'CoMpLeTe']) {
      const summary = phase === 'review' ? JSON.stringify(review) : 'GDD.md: Keep This Case'
      await writeFile(path, `\uFEFF  ${token} \t\r\n${summary}\r\n`)
      expect(await readMilestoneResult(path, phase)).toEqual({ phase, status: 'complete', summary,
        ...(phase === 'review' ? { review } : {}) })
    }
    await writeFile(path, ' BLOCKED \r\nNeeds GDD.md Decision')
    expect(await readMilestoneResult(path, phase)).toMatchObject({ status: 'blocked', summary: 'Needs GDD.md Decision' })
    for (const token of ['', 'PASS', 'completed', 'complete because it is done', 'BLOCKED']) {
      await writeFile(path, token)
      const result = await readMilestoneResult(path, phase)
      expect(result?.status).toBe('invalid')
      expect(result?.validationIssues?.length).toBeGreaterThan(0)
    }
    await writeFile(path, 'COMPLETE\n{"step":"INSPECT","findings":[],"resolved":[]}')
    const malformedReview = await readMilestoneResult(path, 'review')
    expect(malformedReview?.review).toBeUndefined()
    expect(malformedReview?.validationIssues?.length).toBeGreaterThan(0)
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
