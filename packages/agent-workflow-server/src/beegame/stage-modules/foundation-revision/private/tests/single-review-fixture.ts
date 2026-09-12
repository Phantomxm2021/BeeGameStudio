import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { bindRevisionDocuments } from '../document-snapshot'
import { revisionDigest } from '../json-digest'
import type { SingleRevisionSource, SingleRevisionIssue } from '../single-review-source'
import { completeTestSubmission, renderTestCompleteGameDocument } from './complete-game-document-fixture'

export function reviewFixtureDocuments() {
  return CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, content: renderTestCompleteGameDocument(path, completeTestSubmission(path)) }))
}

/** Consumer-owned public protocol fixture: no Reviewer implementation dependency. */
export function buildSingleReviewFixture(value: {
  documents: ReturnType<typeof reviewFixtureDocuments>
  identity: { ownerId: string; projectId: string; requestId: string }
  subject: SingleRevisionSource['subject']
}): SingleRevisionSource {
  const snapshot = bindRevisionDocuments(value.documents)
  const requirements = { status: 'unavailable' as const, reason: 'Offline protocol fixture' }
  const inputPolicy = 'native-file-audit.v1' as const
  const auditPolicy = inputPolicy
  const targets = snapshot.documents.filter(document => document.content.includes('# incomplete'))
  const issues = (targets.length ? targets : [snapshot.documents[0]!]).map(document => {
    const body: Omit<SingleRevisionIssue, 'id'> = {
      type: 'semantic', reasonCode: 'SINGLE_AGENT_FINDING', severity: 'HIGH', title: 'Complete the assigned document',
      actual: 'Fixture document requires a repair', expected: 'Complete production document',
      source: { scope: 'document', documentPath: document.path, digest: document.digest },
    }
    return { issue: { id: revisionDigest(body), ...body } }
  }).sort((a, b) => a.issue.id.localeCompare(b.issue.id))
  const audit = { policy: auditPolicy, summary: 'Offline full-review fixture' }
  const body = { protocolVersion: 3 as const, producer: 'foundation-reviewer' as const, ...value.identity,
    subject: value.subject, requirements, kind: 'issues_found' as const, documentSetDigest: snapshot.documentSetDigest,
    documents: snapshot.documents.map(document => ({ ...document })),
    inputDigest: revisionDigest({ ownerId: value.identity.ownerId, projectId: value.identity.projectId,
      input: { subject: value.subject, requirements, documents: value.documents }, policy: inputPolicy }),
    policyDigest: revisionDigest(auditPolicy), issueRegistryDigest: revisionDigest(issues.map(entry => entry.issue)),
    evidenceDigest: revisionDigest({ audit, issues }), issues, audit }
  return structuredClone({ ...body, resultId: revisionDigest(body) })
}
