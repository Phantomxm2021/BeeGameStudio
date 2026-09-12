import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { REVIEW_DOCUMENT_PATHS, captureSingleReviewInput, reviewHash, admitSingleReviewReport } from '../single-agent-contract'
import { buildSingleReviewResult, singleReviewInputDigest, parseSingleReviewStart } from '../single-agent-publication'

function sample() {
  const content = randomUUID()
  const input = captureSingleReviewInput({ subject: { kind: 'initial', sourceResultId: randomUUID(), sourceDocumentRevision: reviewHash('source'), confirmedBriefDigest: reviewHash(content) },
    requirements: { status: 'available', content, digest: reviewHash(content) },
    documents: REVIEW_DOCUMENT_PATHS.map(path => ({ path, content: randomUUID() })) })
  const finding = { documentPath: REVIEW_DOCUMENT_PATHS[0], severity: 'HIGH' as const, title: randomUUID(), actual: String(randomUUID()), expected: String(randomUUID()) }
  const report = { status: 'completed' as const, summary: randomUUID(), findings: [finding] }
  const start = { protocolVersion: 1 as const, ownerId: 'owner', projectId: 'project', requestId: randomUUID(), input,
    inputDigest: singleReviewInputDigest({ ownerId: 'owner', projectId: 'project', input }) }
  return { input, report, start }
}
test('minimal facts publish with exact source bytes and immutable identity', () => {
  for (let i = 0; i < 16; i++) {
    const { input, report, start } = sample()
    const result = buildSingleReviewResult(start, report)
    expect(result.documents.map(({ path, content }) => ({ path, content }))).toEqual(input.documents)
    expect(result.audit).toEqual({ policy: 'native-file-audit.v1', summary: report.summary })
    expect(result.issues[0]!.issue.source.documentPath).toBe(report.findings[0]!.documentPath)
    expect(result.issues[0]!.issue).not.toHaveProperty('remediation')
    expect(result.issues[0]!.issue).not.toHaveProperty('evidence')
    report.findings[0]!.actual = 'caller mutation'
    expect(result.issues[0]!.issue.actual).not.toBe('caller mutation')
  }
})
test('duplicate findings collapse; distinct facts remain and blocked output cannot publish', () => {
  const { input, report } = sample()
  report.findings.push(structuredClone(report.findings[0]!))
  expect(admitSingleReviewReport(input, report).findings).toHaveLength(1)
  report.findings.push({ ...report.findings[0]!, actual: 'Distinct fact' })
  expect(admitSingleReviewReport(input, report).findings).toHaveLength(2)
  expect(() => admitSingleReviewReport(input, { ...report, status: 'blocked' })).toThrow()
})
test('legacy policies, proof ledgers and repair instructions are rejected, not adapted', () => {
  const { input, report, start } = sample()
  for (const field of ['repair', 'evidence', 'reasoning', 'impact', 'citations'])
    expect(() => admitSingleReviewReport(input, { ...report, findings: [{ ...report.findings[0], [field]: {} }] })).toThrow()
  for (const field of ['reviewedDocuments', 'requirementsAssessment', 'omissionCheck', 'limitations'])
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
