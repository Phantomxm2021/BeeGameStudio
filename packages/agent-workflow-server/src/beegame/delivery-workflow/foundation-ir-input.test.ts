import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import type { ReviewerReviewResult } from '../stage-modules/foundation-reviewer/public'
import { reviewFixtureDocuments } from '../stage-modules/foundation-reviewer/private/test-fixtures/review-documents'
import { buildSingleReviewResult, singleReviewInputDigest } from '../stage-modules/foundation-reviewer/private/single-agent-publication'
import { captureFoundationIrInput } from './foundation-ir-input'
import { foundationPublicDigest } from './foundation-public-handoff'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

function acceptedReview(): ReviewerReviewResult {
  const brief = 'Confirmed requirements for the IR capture fixture.'
  const documents = reviewFixtureDocuments().map((document, index) => index === 0
    ? { path: document.path, content: '前缀\r\n# 重复标题 🌊\r\n正文\r\n## 重复标题\r\n### 日本語見出し\r\n#### 한국 제목\r\n```md\r\n# 代码中的标题\r\n```abc\r\n# 仍在围栏内\r\n```\r\n## 重复标题\r\n尾部' }
    : index === 1
      ? { path: document.path, content: '无标题正文前缀\r\n这是完整的自然语言正文，没有任何 Markdown 标题。' }
    : document)
  const input = { subject: { kind: 'initial' as const, sourceResultId: 'author-result',
    sourceDocumentRevision: digest('published author revision'), confirmedBriefDigest: digest(brief) },
    requirements: { status: 'available' as const, content: brief, digest: digest(brief) }, documents }
  const start = { protocolVersion: 1 as const, ownerId: 'owner', projectId: 'project', requestId: 'review-request', input,
    inputDigest: singleReviewInputDigest({ ownerId: 'owner', projectId: 'project', input }) }
  return buildSingleReviewResult(start, { summary: 'Accepted fixture' }) as ReviewerReviewResult
}

test('captures accepted bytes and indexes every structural range without semantic IDs', () => {
  const review = acceptedReview()
  const captured = captureFoundationIrInput({ ownerId: 'owner', projectId: 'project', acceptedReview: review,
    publishedDocumentRevision: review.documentSetDigest })
  expect(captured.documents.map(document => document.path)).toEqual([...CANONICAL_FOUNDATION_DOCUMENTS])
  const document = captured.documents[0]!
  expect(document.content).toContain('代码中的标题')
  expect(document.content).toContain('仍在围栏内')
  expect(document.sections.map(section => section.kind)).toEqual(['preamble', 'heading', 'heading', 'heading', 'heading', 'heading'])
  expect(document.sections.filter(section => section.headingText === '重复标题')).toHaveLength(2)
  expect(document.sections.some(section => section.headingText === '仍在围栏内')).toBe(false)
  expect(document.sections.map(section => section.headingText)).toContain('日本語見出し')
  expect(document.sections.map(section => section.headingText)).toContain('한국 제목')
  expect(new Set(document.sections.map(section => section.ordinal)).size).toBe(document.sections.length)
  expect(document.sections[1]!.headingText).toBe('重复标题 🌊')
  const bytes = Buffer.from(document.content, 'utf8')
  expect(Buffer.concat(document.sections.map(section => bytes.subarray(section.startByte, section.endByte))).equals(bytes)).toBe(true)
  for (const [index, section] of document.sections.entries()) {
    expect(section.ordinal).toBe(index)
    expect(section.startByte).toBe(index === 0 ? 0 : document.sections[index - 1]!.endByte)
    expect(section.endByte).toBeGreaterThan(section.startByte)
  }
  expect(captured.sourceIndexDigest).toMatch(/^[a-f0-9]{64}$/)
  expect(Object.isFrozen(captured)).toBe(true)
  const sourceIndexDigest = captured.sourceIndexDigest
  expect(Object.isFrozen(document.sections)).toBe(true)
  expect(Object.isFrozen(document.sections[0])).toBe(true)
  expect(() => { (document.sections[0] as any).headingText = '污染' }).toThrow()
  expect(captured.sourceIndexDigest).toBe(sourceIndexDigest)
  const plain = captured.documents[1]!
  expect(plain.sections).toHaveLength(1)
  expect(plain.sections[0]!.kind).toBe('preamble')
  expect(plain.sections[0]!.startByte).toBe(0)
  expect(plain.sections[0]!.endByte).toBe(plain.byteLength)
})

function resign(review: ReviewerReviewResult): void {
  const { resultId: _resultId, ...body } = review
  review.resultId = foundationPublicDigest(body)
}

test('binds result, project, document revision, requirements and document bytes before capture', () => {
  const review = acceptedReview()
  const base = { ownerId: 'owner', projectId: 'project', acceptedReview: review, publishedDocumentRevision: review.documentSetDigest }
  expect(() => captureFoundationIrInput({ ...base, ownerId: 'other' })).toThrow(/owner or project mismatch/)
  expect(() => captureFoundationIrInput({ ...base, publishedDocumentRevision: digest('different revision') })).toThrow(/revision/)
  const changed = structuredClone(review)
  changed.documents[0]!.content += 'tampered'
  expect(() => captureFoundationIrInput({ ...base, acceptedReview: changed })).toThrow(/result digest mismatch/)
})

test('keeps document and requirements validation active after a self-consistent result re-sign', () => {
  const cases: readonly { mutate: (review: ReviewerReviewResult) => void; expected: RegExp }[] = [
    { mutate: review => { review.documents[0]!.byteLength += 1 }, expected: /self-consistent/ },
    { mutate: review => { review.documents[0]!.digest = '0'.repeat(64) }, expected: /self-consistent/ },
    { mutate: review => { review.documents.pop() }, expected: /canonical eight/ },
    { mutate: review => { review.requirements = { status: 'available', content: 'changed summary', digest: digest('changed summary') } }, expected: /requirements summary/ },
  ]
  for (const { mutate, expected } of cases) {
    const review = acceptedReview()
    mutate(review)
    resign(review)
    expect(() => captureFoundationIrInput({ ownerId: 'owner', projectId: 'project', acceptedReview: review,
      publishedDocumentRevision: review.documentSetDigest })).toThrow(expected as RegExp)
  }
})

test('rejects an accepted result without a confirmed requirements summary', () => {
  const review = acceptedReview()
  const changed = structuredClone(review)
  changed.requirements = { status: 'unavailable', reason: 'not supplied' }
  const { resultId: _resultId, ...body } = changed
  changed.resultId = foundationPublicDigest(body)
  expect(() => captureFoundationIrInput({ ownerId: 'owner', projectId: 'project', acceptedReview: changed,
    publishedDocumentRevision: review.documentSetDigest })).toThrow(/requirements summary/)
})
