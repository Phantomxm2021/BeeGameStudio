import type { RevisionDocumentInput } from './document-snapshot'
import { parseRevisionInitialSource, type RevisionSourceBinding } from './initial-source'
import type { PatchOperation } from './markdown'
import { revisionCanonicalJson } from './json-digest'
import { constructRevisionCandidate } from './candidate-construction'

export type RevisionUnresolvedIssue = Readonly<{ issueId: string; reason: string }>

export type RevisionInitialCandidateInput = Readonly<{
  sourceResult: unknown
  sourceBinding: RevisionSourceBinding
  requestId: string
  candidateDocuments: readonly RevisionDocumentInput[]
  unresolvedIssues: readonly RevisionUnresolvedIssue[]
}>

export type RevisionInitialCandidate = Readonly<{
  protocolVersion: 1
  producer: 'foundation-revision'
  kind: 'candidate_ready'
  resultId: string
  ownerId: string
  projectId: string
  requestId: string
  candidateId: string
  round: 1
  baseDocumentSetDigest: string
  sourceReviewResultId: string
  sourceReviewResultDigest: string
  documentSetDigest: string
  documents: readonly (RevisionDocumentInput & { digest: string; byteLength: number })[]
  changes: readonly PatchOperation[]
  repairClaims: readonly { issueId: string; status: 'APPLIED' }[]
  unresolvedIssues: readonly RevisionUnresolvedIssue[]
}>

const sourceKeys = ['candidateDocuments', 'requestId', 'sourceBinding', 'sourceResult', 'unresolvedIssues']
const unresolvedKeys = ['issueId', 'reason']

function assertStrictObject(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  revisionCanonicalJson(value)
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length || Object.getOwnPropertyNames(value).sort().join('\0') !== [...keys].sort().join('\0') ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !('value' in descriptor) || !descriptor.enumerable))
    throw new Error(`${label} has invalid shape`)
}

function validateInput(value: RevisionInitialCandidateInput): void {
  assertStrictObject(value, sourceKeys, 'Revision initial candidate input')
  if (typeof value.requestId !== 'string' || value.requestId.length === 0 || value.requestId.length > 200)
    throw new Error('Revision initial candidate request ID is invalid')
  if (!Array.isArray(value.candidateDocuments)) throw new Error('Revision initial candidate documents are invalid')
  if (!Array.isArray(value.unresolvedIssues)) throw new Error('Revision initial candidate unresolved issues are invalid')
  for (const issue of value.unresolvedIssues) {
    assertStrictObject(issue, unresolvedKeys, 'Revision unresolved issue')
    if (typeof issue.issueId !== 'string' || issue.issueId.length === 0 || issue.issueId.length > 200 ||
      typeof issue.reason !== 'string' || issue.reason.length === 0)
      throw new Error('Revision unresolved issue is invalid')
  }
}

/** Build the first immutable Revision candidate from an accepted initial review. */
export function buildRevisionInitialCandidate(input: RevisionInitialCandidateInput): RevisionInitialCandidate {
  validateInput(input)
  const source = parseRevisionInitialSource(input.sourceResult, input.sourceBinding)
  return constructRevisionCandidate({ source, requestId: input.requestId, candidateDocuments: input.candidateDocuments,
    unresolvedIssues: input.unresolvedIssues, round: 1 }) as RevisionInitialCandidate
}
