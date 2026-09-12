import { expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyPatch } from 'diff'
import { buildReviewComparison, materializeReviewComparison } from '../review-comparison'
import { captureSingleReviewInput, reviewDocumentSetDigest, reviewHash, REVIEW_DOCUMENT_PATHS,
  type SingleReviewInput } from '../single-agent-contract'
import { singleReviewInputDigest } from '../single-agent-publication'
import { admitSingleReviewReport } from '../single-agent-contract'
import { buildSingleReviewResult } from '../single-agent-publication'
import { parseSingleRevisionSource } from '../../../foundation-revision/private/single-review-source'
import { reviewDigest } from '../single-agent-contract'

function fixture(): SingleReviewInput {
  const baseDocuments = REVIEW_DOCUMENT_PATHS.map((path, index) => ({ path,
    content: `# Document ${index}\nFirst line\nUnchanged context\nLast line\n` }))
  return { subject: { kind: 'candidate', candidateId: 'candidate', candidateResultId: reviewHash('candidate'),
    sourceReviewResultId: reviewHash('review'), sourceReviewResultDigest: reviewHash('review-envelope'),
    baseDocumentSetDigest: reviewDocumentSetDigest(baseDocuments), round: 1 },
    requirements: { status: 'unavailable', reason: 'Synthetic transport fixture' },
    documents: structuredClone(baseDocuments), comparison: { baseDocuments } }
}

test('prior review evidence is immutable, digest-bound and rejects duplicate or orphan references', async () => {
  const input = fixture()
  input.comparison!.reviewEvidence = { issues: [{ id: 'old', title: 'Prior finding', actual: 'Actual', expected: 'Expected', documentPath: 'docs/GDD.md' }],
    revisionSummary: 'Agent rationale, not a verdict' }
  const root = await mkdtemp(join(tmpdir(), 'review-prior-'))
  await materializeReviewComparison(root, input)
  const manifest = JSON.parse(await readFile(join(root, 'review-context/manifest.json'), 'utf8'))
  expect(JSON.parse(await readFile(join(root, manifest.priorReviewPath), 'utf8'))).toEqual(input.comparison!.reviewEvidence)
  expect((await stat(join(root, manifest.priorReviewPath))).mode & 0o222).toBe(0)
  input.comparison!.reviewEvidence!.issues.push(structuredClone(input.comparison!.reviewEvidence!.issues[0]!))
  expect(() => captureSingleReviewInput(input)).toThrow('unknown issue IDs')
})

test('minimal candidate findings and revision summary survive the next Revision admission', () => {
  const input = fixture()
  input.comparison!.reviewEvidence = { issues: [{ id: 'old', title: 'Old defect', actual: 'Actual', expected: 'Expected', documentPath: 'docs/GDD.md' }], revisionSummary: 'Changed rules' }
  input.comparison!.reviewEvidence!.revisionSummary! = 'Changed the rules; check their consistency.'
  const report = { status: 'completed', summary: 'Still blocked',
    findings: [{ severity: 'HIGH', title: 'Still defective', actual: 'Actual', expected: 'Expected', documentPath: 'docs/GDD.md' }] }
  const admitted = admitSingleReviewReport(input, report)
  const identity = { ownerId: 'owner', projectId: 'project' }, tokenBudget = 1000
  const result = buildSingleReviewResult({ protocolVersion: 1, ...identity, requestId: 'candidate-review', input, tokenBudget,
    inputDigest: singleReviewInputDigest({ ...identity, input, tokenBudget }) }, admitted)
  const source = parseSingleRevisionSource(result, { ...identity, resultId: result.resultId, resultDigest: reviewDigest(result) })
  expect(source.issues).toHaveLength(1)
  expect(source.audit).not.toHaveProperty('convergence')
  expect(source.issues[0]!.issue).not.toHaveProperty('evidence')
  expect(buildReviewComparison(input)!.files[0]!.content).toContain(input.comparison!.reviewEvidence!.revisionSummary!)
})

test('comparison binds all baseline bytes to the previous version and participates in the request digest', () => {
  const input = fixture()
  const canonical = captureSingleReviewInput(input)
  const shuffled = structuredClone(input)
  shuffled.comparison!.baseDocuments.reverse(); shuffled.documents.reverse()
  expect(captureSingleReviewInput(shuffled)).toEqual(canonical)
  const identity = { ownerId: 'owner', projectId: 'project' }
  const old = { ...input }; delete old.comparison
  expect(singleReviewInputDigest({ ...identity, input })).not.toBe(singleReviewInputDigest({ ...identity, input: old }))
  expect(captureSingleReviewInput(old)).not.toHaveProperty('comparison')
  input.comparison!.baseDocuments[0]!.content += 'changed after acceptance'
  expect(() => captureSingleReviewInput(input)).toThrow('Comparison baseline')
})

test('initial reviews, missing files, duplicate files, and substituted baseline versions are rejected', () => {
  const input = fixture()
  const initial = { ...input, subject: { kind: 'initial', sourceResultId: 'author',
    sourceDocumentRevision: reviewHash('version'), confirmedBriefDigest: reviewHash('brief') } }
  expect(() => captureSingleReviewInput(initial)).toThrow('Only candidate reviews')
  const missing = structuredClone(input); missing.comparison!.baseDocuments.pop()
  expect(() => captureSingleReviewInput(missing)).toThrow()
  const duplicate = structuredClone(input)
  duplicate.comparison!.baseDocuments[0] = duplicate.comparison!.baseDocuments[1]!
  expect(() => captureSingleReviewInput(duplicate)).toThrow()
  const foreign = structuredClone(input)
  if (foreign.subject.kind === 'candidate') foreign.subject.baseDocumentSetDigest = reviewHash('another version')
  expect(() => captureSingleReviewInput(foreign)).toThrow('Comparison baseline')
})

test('diffs describe exact bytes across replacements, insertions, deletions, Unicode, and line endings', () => {
  const variants = [
    ['first\nsecond\nthird\n', 'first\nreplaced\nthird\n'],
    ['first\nlast\n', 'first\ninserted\nlast\n'],
    ['first\ndeleted\nlast\n', 'first\nlast\n'],
    ['标题\n原始内容\n', '标题\n修订内容🙂\n'],
    ['a\r\nb\r\n', 'a\r\nc\r\n'],
    ['a\nb', 'a\nb\n'],
  ]
  for (const [before, after] of variants) {
    const input = fixture()
    input.comparison!.baseDocuments[0]!.content = before!
    input.documents[0]!.content = after!
    if (input.subject.kind === 'candidate') input.subject.baseDocumentSetDigest = reviewDocumentSetDigest(input.comparison!.baseDocuments)
    const original = JSON.stringify(input)
    const comparison = buildReviewComparison(input)!
    expect(comparison.manifest.changedDocumentCount).toBe(1)
    expect(comparison.manifest.candidateDocumentSetDigest).toBe(reviewDocumentSetDigest(input.documents))
    const changed = comparison.manifest.documents[0]!
    expect(changed.diffStatus).toBe('available')
    if (changed.diffStatus !== 'available') throw new Error('Expected exact diff')
    const patch = comparison.files.find(file => file.path === changed.diffPath)!.content
    expect(applyPatch(before!, patch)).toBe(after!)
    expect(changed.baseDigest).toBe(reviewHash(before!))
    expect(changed.candidateDigest).toBe(reviewHash(after!))
    expect(comparison.manifest.documents.slice(1).every(doc => doc.diffStatus === 'unchanged')).toBe(true)
    expect(JSON.stringify(input)).toBe(original)
  }
})

test('bounded diff generation explicitly falls back to full versions, never a truncated diff', () => {
  const input = fixture()
  input.documents[0]!.content = '# Replaced document\nDifferent content\n'
  for (const limits of [
    { timeoutMs: 250, maxEditLength: 0, maxPatchBytes: 2048 },
    { timeoutMs: 250, maxEditLength: 20_000, maxPatchBytes: 1 },
  ]) {
    const comparison = buildReviewComparison(input, limits)!
    expect(comparison.manifest.documents[0]).toMatchObject({ changed: true, diffStatus: 'full_files_required' })
    expect(comparison.files.some(file => file.path.endsWith('.diff'))).toBe(false)
    expect(comparison.files[0]!.content).toBe(input.comparison!.baseDocuments[0]!.content)
    expect(input.documents[0]!.content).toBe('# Replaced document\nDifferent content\n')
  }
})

test('materialized context is read-only and empty changes never become a pass verdict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-comparison-'))
  const input = fixture()
  expect(await materializeReviewComparison(root, input)).toBe(true)
  const manifestPath = join(root, 'review-context/manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  expect(manifest.changedDocumentCount).toBe(0)
  expect(manifest).not.toHaveProperty('passed')
  expect(manifest).not.toHaveProperty('assessments')
  expect((await stat(manifestPath)).mode & 0o222).toBe(0)
  for (const document of input.comparison!.baseDocuments)
    expect(await readFile(join(root, 'review-context/baseline', document.path), 'utf8')).toBe(document.content)
  const legacyRoot = await mkdtemp(join(tmpdir(), 'review-no-comparison-'))
  delete input.comparison
  expect(await materializeReviewComparison(legacyRoot, input)).toBe(false)
  expect(await readdir(legacyRoot)).toEqual([])
})
