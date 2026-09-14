import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { REVIEW_DOCUMENT_PATHS, captureSingleReviewInput, reviewHash, admitSingleReviewReport } from '../single-agent-contract'
import { buildSingleReviewResult, singleReviewInputDigest, parseSingleReviewStart } from '../single-agent-publication'

function sample() {
  const content = randomUUID()
  const input = captureSingleReviewInput({ subject: { kind: 'initial', sourceResultId: randomUUID(), sourceDocumentRevision: reviewHash('source'), confirmedBriefDigest: reviewHash(content) },
    requirements: { status: 'available', content, digest: reviewHash(content) },
    documents: REVIEW_DOCUMENT_PATHS.map(path => ({ path, content: randomUUID() })) })
  const report: { summary: string } = { summary: randomUUID() }
  const start = { protocolVersion: 1 as const, ownerId: 'owner', projectId: 'project', requestId: randomUUID(), input,
    inputDigest: singleReviewInputDigest({ ownerId: 'owner', projectId: 'project', input }) }
  return { input, report, start }
}
test('minimal facts publish with exact source bytes and immutable identity', () => {
  for (let i = 0; i < 16; i++) {
    const { input, report, start } = sample()
    const result = buildSingleReviewResult(start, report)
    expect(result.documents.map(({ path, content }) => ({ path, content }))).toEqual(input.documents)
    expect(result.protocolVersion).toBe(6)
    expect(result.audit).toEqual({ policy: 'native-file-audit-and-correct.v5', summary: report.summary })
    expect(result).not.toHaveProperty('kind')
    expect(result).not.toHaveProperty('issues')
    expect(result).not.toHaveProperty('issueRegistryDigest')
    report.summary = 'caller mutation'
    expect(result.audit.summary).not.toBe('caller mutation')
  }
})
test('completion output contains only the bounded summary', () => {
  const { input, report } = sample()
  expect(admitSingleReviewReport(input, report)).toEqual(report)
  expect(() => admitSingleReviewReport(input, { ...report, findings: [] })).toThrow()
  expect(() => admitSingleReviewReport(input, { ...report, status: 'blocked' })).toThrow()
})
test('legacy policies, proof ledgers and repair instructions are rejected, not adapted', () => {
  const { input, report, start } = sample()
  for (const field of ['repair', 'evidence', 'reasoning', 'impact', 'citations', 'findings',
    'reviewedDocuments', 'requirementsAssessment', 'omissionCheck', 'limitations'])
    expect(() => admitSingleReviewReport(input, { ...report, [field]: [] })).toThrow()
  expect(() => parseSingleReviewStart({ ...start, validationPolicy: 'single-agent-full-document-audit.v1' })).toThrow()
})
test('input set, requirements and stored request digests remain strict', () => {
  const { input, start } = sample()
  expect(() => captureSingleReviewInput({ ...input, documents: input.documents.slice(1) })).toThrow()
  expect(() => captureSingleReviewInput({ ...input, documents: input.documents.map(() => input.documents[0]) })).toThrow()
  expect(() => captureSingleReviewInput({ ...input, requirements: { ...input.requirements, content: 'tampered' } })).toThrow()
  expect(() => parseSingleReviewStart({ ...start, inputDigest: '0'.repeat(64) })).toThrow()
})
