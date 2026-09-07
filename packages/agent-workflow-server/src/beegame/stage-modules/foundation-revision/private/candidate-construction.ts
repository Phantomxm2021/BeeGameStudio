import { randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import { bindRevisionDocuments, type RevisionDocumentInput } from './document-snapshot'
import { deriveRevisionCandidateChanges } from './candidate-changes'
import { parseRevisionCandidateResult, type RevisionCandidateResult } from './candidate-result'
import { revisionCanonicalJson, revisionDigest } from './json-digest'
import type { RevisionInitialSource } from './initial-source'
import type { RevisionRecheckSource } from './recheck-source'
import { advanceRevisionDocumentMetadata } from './document-metadata'

const id = z.string().min(1).max(200)
const unresolvedSchema = z.array(z.object({ issueId: id, reason: z.string().min(1) }).strict())

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/**
 * Internal materialization only: its caller has parsed source authority and
 * selected round/predecessor from accepted public evidence. Public callers
 * never select these fields. A durable owner must save the allocated identity.
 */
export function constructRevisionCandidate(input: {
  source: RevisionInitialSource | RevisionRecheckSource
  requestId: string
  candidateDocuments: readonly RevisionDocumentInput[]
  unresolvedIssues: readonly { issueId: string; reason: string }[]
  round: number
  candidateId?: string
  previous?: RevisionCandidateResult['previous']
  previousCandidateDocuments?: readonly RevisionDocumentInput[]
  updatedAt?: string
  updatedAtByPath?: Readonly<Record<string, string>>
  allowAlreadyAdvanced?: boolean
}): RevisionCandidateResult {
  const captured = JSON.parse(revisionCanonicalJson(input)) as typeof input
  const { source } = captured
  if (source.kind !== 'issues_found') throw new Error('Revision candidate requires source issues')
  id.parse(captured.requestId)
  z.number().int().positive().safe().parse(captured.round)
  if (captured.candidateId !== undefined) z.uuid().parse(captured.candidateId)
  const unresolved = unresolvedSchema.parse(captured.unresolvedIssues)
  const byId = new Map(unresolved.map(issue => [issue.issueId, issue]))
  if (byId.size !== unresolved.length || unresolved.some(issue => !source.issues.some(entry => entry.issue.id === issue.issueId)))
    throw new Error('Revision unresolved issue is duplicate or outside source registry')
  const baseByPath = new Map(source.documents.map(document => [document.path, document.content]))
  const previousByPath = captured.previousCandidateDocuments
    ? new Map(captured.previousCandidateDocuments.map(document => [document.path, document.content]))
    : undefined
  const candidateDocuments = captured.candidateDocuments.map(document => ({
    path: document.path,
    content: advanceRevisionDocumentMetadata({
      baseMarkdown: baseByPath.get(document.path)!,
      candidateMarkdown: document.content,
      ...(previousByPath?.has(document.path)
        ? { previousCandidateMarkdown: previousByPath.get(document.path) }
        : {}),
      ...(captured.updatedAtByPath?.[document.path]
        ? { updatedAt: captured.updatedAtByPath[document.path] }
        : captured.updatedAt ? { updatedAt: captured.updatedAt } : {}),
      ...(captured.allowAlreadyAdvanced ? { allowAlreadyAdvanced: true } : {}),
    }),
  }))
  const snapshot = bindRevisionDocuments(candidateDocuments)
  const repairedIssues = source.issues.filter(entry => !byId.has(entry.issue.id)).map(entry => entry.issue)
  const changes = deriveRevisionCandidateChanges({ baseDocuments: source.documents.map(({ path, content }) => ({ path, content })),
    candidateDocuments, issues: repairedIssues })
  const body = {
    protocolVersion: 1 as const, producer: 'foundation-revision' as const, kind: 'candidate_ready' as const,
    ownerId: source.ownerId, projectId: source.projectId, requestId: captured.requestId,
    candidateId: captured.candidateId ?? randomUUID(), round: captured.round,
    baseDocumentSetDigest: source.documentSetDigest, sourceReviewResultId: source.resultId,
    sourceReviewResultDigest: revisionDigest(source),
    ...(captured.previous ? { previous: captured.previous } : {}),
    documentSetDigest: snapshot.documentSetDigest, documents: snapshot.documents.map(doc => ({ ...doc })), changes,
    repairClaims: repairedIssues.map(issue => ({ issueId: issue.id, status: 'APPLIED' as const })),
    unresolvedIssues: source.issues.filter(entry => byId.has(entry.issue.id)).map(entry => byId.get(entry.issue.id)!),
  }
  const result = { ...body, resultId: revisionDigest(body) }
  return deepFreeze(parseRevisionCandidateResult(result, { ownerId: result.ownerId, projectId: result.projectId,
    resultId: result.resultId, resultDigest: revisionDigest(result) }))
}
