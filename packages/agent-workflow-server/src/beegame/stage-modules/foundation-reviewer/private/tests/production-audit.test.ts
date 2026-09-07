import { expect, test } from 'bun:test'
import { prepareFoundationReview } from '../prepare-review'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { runProductionDeterministicFoundationAudit } from '../domain/foundation-audit-production-manifest'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../test-fixtures/complete-game-document-fixture'

test('production manifest evaluates owned rules and rejects caller-supplied audit policy', () => {
  const documents = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
    path, content: renderTestCompleteGameDocument(path, completeTestSubmission(path)),
  }))
  const prepared = prepareFoundationReview(documents)
  if (prepared.kind !== 'facts_pending') throw new Error('invalid fixture')
  const input = {
    documents: new Map(documents.map(({ path, content }) => [path, content])),
    sectionIndex: prepared.sectionIndex,
    factStore: prepared.extraction.facts,
  }
  const issues = runProductionDeterministicFoundationAudit(input)
  expect(issues.length).toBeGreaterThan(0)
  expect(runProductionDeterministicFoundationAudit(input)).toEqual(issues)
  expect(() => runProductionDeterministicFoundationAudit({ ...input, schema: [] } as never)).toThrow()
})
