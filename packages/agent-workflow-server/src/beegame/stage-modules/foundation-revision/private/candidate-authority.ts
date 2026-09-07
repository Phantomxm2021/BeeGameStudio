import { parseRevisionCandidateResult, type RevisionCandidateBinding, type RevisionCandidateResult } from './candidate-result'
import { deriveRevisionCandidateChanges } from './candidate-changes'
import { parseRevisionInitialSource, type RevisionInitialSource, type RevisionSourceBinding } from './initial-source'
import { revisionCanonicalJson, revisionDigest } from './json-digest'
import { parseRevisionRecheckSource, type RevisionRecheckSource } from './recheck-source'

export type RevisionRepairSource = RevisionInitialSource | RevisionRecheckSource

export type RevisionRetryAuthorityInput = Readonly<{
  sourceResult: unknown
  sourceBinding: RevisionSourceBinding
  previousCandidateResult: unknown
  previousCandidateBinding: RevisionCandidateBinding
  previousRecheckResult: unknown
  previousRecheckBinding: RevisionSourceBinding
}>

const same = (left: unknown, right: unknown) => revisionCanonicalJson(left) === revisionCanonicalJson(right)
const sortedCanonical = (values: readonly unknown[]) => values.map(revisionCanonicalJson).sort()
const sortedIds = (values: readonly string[]) => [...values].sort()
const sectionIdentity = (value: { documentPath: string; sectionId: string }) => `${value.documentPath}\u0000${value.sectionId}`

function issueEvidenceIdentity(issue: RevisionRepairSource['issues'][number]['issue']): unknown {
  const source = 'sectionId' in issue.source ? sectionIdentity(issue.source) : `${issue.source.documentPath}\u0000document`
  const target = 'target' in issue && issue.target ? sectionIdentity(issue.target) : null
  const supporting = 'supportingSections' in issue
    ? (issue.supportingSections ?? []).map(sectionIdentity)
    : []
  return { id: issue.id, source, target, supporting }
}

/**
 * Admits a public source as a new Revision repair base. The source is copied
 * through the local phase parser; it is never treated as authority merely
 * because its payload can be rehashed by this consumer.
 */
export function parseRevisionRepairSource(value: unknown, expected: RevisionSourceBinding): RevisionRepairSource {
  const captured = JSON.parse(revisionCanonicalJson(value)) as { kind?: unknown; subject?: { kind?: unknown } }
  if (!captured || captured.kind !== 'issues_found') throw new Error('Revision repair source must contain issues')
  if (captured.subject?.kind === 'initial') return parseRevisionInitialSource(captured, expected)
  if (captured.subject?.kind === 'candidate') {
    const source = parseRevisionRecheckSource(captured, expected)
    revisionRepairRound(source)
    return source
  }
  throw new Error('Revision repair source subject is unsupported')
}

/** Derives the next candidate round from admitted public source evidence. */
export function revisionRepairRound(source: RevisionRepairSource): number {
  if (source.kind !== 'issues_found') throw new Error('Revision repair source must contain issues')
  if (!('recheck' in source)) return 1
  if (source.recheck.kind === 'full_format') return 1
  if (source.recheck.decision !== 'round_complete')
    throw new Error('Revision retry recheck cannot be used as a new repair base')
  const nextRound = source.recheck.round + 1
  if (!Number.isSafeInteger(nextRound) || nextRound <= 0)
    throw new Error('Revision repair round is not safe')
  return nextRound
}

/**
 * Verifies that candidate bytes and declared operations are derived solely
 * from the admitted source issues. This is a mechanical authority check, not
 * a document audit or a Reviewer verdict.
 */
export function verifyRevisionCandidateAuthority(source: RevisionRepairSource, candidate: RevisionCandidateResult) {
  const round = revisionRepairRound(source)
  if (candidate.ownerId !== source.ownerId || candidate.projectId !== source.projectId ||
    candidate.baseDocumentSetDigest !== source.documentSetDigest ||
    candidate.sourceReviewResultId !== source.resultId ||
    candidate.sourceReviewResultDigest !== revisionDigest(source) || candidate.round !== round)
    throw new Error('Revision candidate source authority mismatch')

  const sourceIds = source.issues.map(entry => entry.issue.id)
  const claimedIds = candidate.repairClaims.map(claim => claim.issueId)
  const unresolvedIds = candidate.unresolvedIssues.map(issue => issue.issueId)
  const accountedIds = [...claimedIds, ...unresolvedIds]
  if (accountedIds.length !== sourceIds.length || !same(sortedIds(accountedIds), sortedIds(sourceIds)))
    throw new Error('Revision candidate must account for the exact source issues')

  const repaired = new Set(claimedIds)
  const issues = source.issues.filter(entry => repaired.has(entry.issue.id)).map(entry => entry.issue)
  const baseDocuments = source.documents.map(({ path, content }) => ({ path, content }))
  const candidateDocuments = candidate.documents.map(({ path, content }) => ({ path, content }))
  const operations = deriveRevisionCandidateChanges({ baseDocuments, candidateDocuments, issues })
  if (!same(sortedCanonical(operations), sortedCanonical(candidate.changes)))
    throw new Error('Revision candidate declared changes disagree with verified bytes')

  return {
    source: structuredClone(source),
    candidate: structuredClone(candidate),
    baseDocuments,
    candidateDocuments,
    operations: structuredClone(operations),
    issues: structuredClone(issues),
    repairIssueIds: sortedIds(claimedIds),
    unresolvedIssueIds: sortedIds(unresolvedIds),
  }
}

function assertRetryRecheckAuthority(source: RevisionRepairSource, previousCandidate: RevisionCandidateResult,
  recheck: RevisionRecheckSource): void {
  if (recheck.ownerId !== source.ownerId || recheck.projectId !== source.projectId || recheck.kind !== 'issues_found' ||
    recheck.subject.kind !== 'candidate')
    throw new Error('Revision retry predecessor authority mismatch')
  const subject = recheck.subject
  const expectedPreviousCandidateId = previousCandidate.previous?.candidateId
  if (subject.candidateId !== previousCandidate.candidateId || subject.candidateResultId !== previousCandidate.resultId ||
    subject.baseDocumentSetDigest !== source.documentSetDigest || subject.sourceReviewResultId !== source.resultId ||
    subject.sourceReviewResultDigest !== revisionDigest(source) ||
    (subject.previousCandidateId ?? null) !== (expectedPreviousCandidateId ?? null))
    throw new Error('Revision retry recheck subject authority mismatch')
  if (recheck.recheck.kind !== 'targeted' || recheck.recheck.decision !== 'retry_same_round' ||
    recheck.recheck.round !== previousCandidate.round ||
    recheck.recheck.candidateResultDigest !== revisionDigest(previousCandidate) ||
    recheck.documentSetDigest !== previousCandidate.documentSetDigest ||
    !same(recheck.documents, previousCandidate.documents))
    throw new Error('Revision retry predecessor authority mismatch')
  // A same-round recheck may rebind line ranges/digests to the candidate bytes,
  // but it must not change the read-only evidence identities or introduce a
  // different support closure for the predecessor issue registry.
  const sourceIssues = new Map(source.issues.map(entry => [entry.issue.id, entry.issue]))
  const recheckIssues = new Map(recheck.issues.map(entry => [entry.issue.id, entry.issue]))
  if ([...recheckIssues].some(([id, rebound]) => {
    const issue = sourceIssues.get(id)
    return !issue || !same(issueEvidenceIdentity(issue), issueEvidenceIdentity(rebound))
  }))
    throw new Error('Revision retry predecessor supporting evidence authority mismatch')
}

/**
 * Captures the exact predecessor authority needed to build a same-round
 * retry. The returned values are copies and contain no Reviewer-private state.
 */
export function prepareRevisionRetryAuthority(input: RevisionRetryAuthorityInput) {
  const captured = JSON.parse(revisionCanonicalJson(input)) as RevisionRetryAuthorityInput
  const expectedKeys = ['previousCandidateBinding', 'previousCandidateResult', 'previousRecheckBinding', 'previousRecheckResult', 'sourceBinding', 'sourceResult']
  if (!captured || typeof captured !== 'object' || Array.isArray(captured) || !same(Object.keys(captured).sort(), expectedKeys))
    throw new Error('Revision retry authority input has invalid shape')
  const source = parseRevisionRepairSource(captured.sourceResult, captured.sourceBinding)
  const previousCandidate = parseRevisionCandidateResult(captured.previousCandidateResult, captured.previousCandidateBinding)
  const recheck = parseRevisionRecheckSource(captured.previousRecheckResult, captured.previousRecheckBinding)
  verifyRevisionCandidateAuthority(source, previousCandidate)
  assertRetryRecheckAuthority(source, previousCandidate, recheck)

  const previousClaimIds = previousCandidate.repairClaims.map(claim => claim.issueId)
  const verdictIds = recheck.recheck.kind === 'targeted'
    ? recheck.recheck.issueVerdicts.map(verdict => verdict.issueId) : []
  if (!same(sortedIds(previousClaimIds), sortedIds(verdictIds)))
    throw new Error('Revision retry predecessor coverage mismatch')

  const sourceIssues = new Map(source.issues.map(entry => [entry.issue.id, entry.issue]))
  if (recheck.recheck.kind !== 'targeted') throw new Error('Revision retry requires targeted recheck evidence')
  for (const verdict of recheck.recheck.issueVerdicts) {
    const issue = sourceIssues.get(verdict.issueId)
    if (!issue) throw new Error('Revision retry recheck issue authority mismatch')
    const expectedKind = issue.type === 'semantic' ? 'semantic' : 'deterministic'
    if (verdict.kind !== expectedKind) throw new Error('Revision retry recheck issue kind mismatch')
  }

  const repairIssueIds: string[] = []
  const retainedDocumentPaths: string[] = []
  for (const document of recheck.recheck.documentVerdicts) {
    for (const issueId of document.issueIds) {
      const issue = sourceIssues.get(issueId)
      if (!issue || issue.remediation.documentPath !== document.documentPath)
        throw new Error('Revision retry recheck document authority mismatch')
    }
    if (document.status === 'FAIL') repairIssueIds.push(...document.retryIssueIds)
    else {
      repairIssueIds.push(...document.issueIds)
      retainedDocumentPaths.push(document.documentPath)
    }
  }

  const previous = {
    candidateId: previousCandidate.candidateId,
    candidateResultId: previousCandidate.resultId,
    candidateResultDigest: revisionDigest(previousCandidate),
    recheckResultId: recheck.resultId,
    recheckResultDigest: revisionDigest(recheck),
  } as const
  return structuredClone({ source, previousCandidate, recheck, round: previousCandidate.round, previous,
    repairIssueIds: sortedIds(repairIssueIds), retainedDocumentPaths })
}
