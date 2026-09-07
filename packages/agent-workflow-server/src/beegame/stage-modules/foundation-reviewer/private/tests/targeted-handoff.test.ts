import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { buildReviewerPublishedResult } from '../review-publication'
import { parseReviewerSourceResult } from '../review-handoff'
import { reviewerDigest } from '../review-summary'
import { completedReviewFixture } from '../test-fixtures/review-fixture'
import { prepareReviewerSemanticInput } from '../semantic-input'
import { buildFoundationSectionIndex } from '../domain/foundation-section-index'
import { analyzeFoundationImpact } from '../domain/foundation-impact-analysis'
import { rebuildFoundationImpactedFacts, validateFoundationPatch, buildFoundationSemanticRecheckPacket,
  admitFoundationSemanticRecheckWorkerResult } from '../domain/foundation-patch-validation'
import type { PatchOperation } from '../domain/patch-operations'
import type { AuditIssue } from '../domain/foundation-issue-registry'

test('public evidence alone supports targeted rebuild/recheck with the same findings as the original complete fact store', () => {
  const fixture = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{
      problem: 'action feedback missing', expected: 'every action has readable feedback', actual: 'no readable feedback',
      sourceSectionKey: 'GDD#player_actions', remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] },
    }] } : { status: 'completed', outcome: 'PASS' } })
  const result = buildReviewerPublishedResult({ identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) }, ...fixture })
  const source = parseReviewerSourceResult(JSON.parse(JSON.stringify(result)), {
    ownerId: result.ownerId, projectId: result.projectId, resultId: result.resultId, resultDigest: reviewerDigest(result),
  })
  const documents = new Map(source.documents.map(doc => [doc.path, doc.path === 'docs/GDD.md'
    ? doc.content.replace('game.mechanics: ["move","attack","dash"]', 'game.mechanics: ["move","attack","dash","parry"]')
    : doc.content]))
  const sectionIndex = buildFoundationSectionIndex({ documents })
  const issue = source.issues[0]!.issue as AuditIssue
  const current = sectionIndex.find(ref => ref.documentPath === issue.source.documentPath && ref.sectionId === issue.source.sectionId)!
  const operations: PatchOperation[] = [{ scope: 'section', kind: 'REPLACE', documentPath: 'docs/GDD.md', sectionId: 'player_actions',
    issueIds: [issue.id], beforeDigest: issue.source.digest, afterDigest: current.digest }]
  const impact = analyzeFoundationImpact(operations)
  expect(impact.factKeys).toEqual(['game.mechanics'])
  const sharedInput = { phase: 'admit' as const, documents, sectionIndex, impact, revision: source.documentSetDigest, results: [] }
  const sliced = rebuildFoundationImpactedFacts({ ...sharedInput, committedFactStore: source.issues.flatMap(entry => entry.facts) })
  // The complete store exists only on the test oracle side, not in the handoff.
  const full = rebuildFoundationImpactedFacts({ ...sharedInput, committedFactStore: prepareReviewerSemanticInput(fixture.documents, fixture.state).factStore })
  expect(sliced.packets).toEqual([])
  expect(sliced.factStore).toHaveLength(2)
  expect(full.factStore.length).toBeGreaterThan(sliced.factStore.length)
  const validation = { validatorTaskId: 'validator', round: 1, documentPath: 'docs/GDD.md' as const,
    baseDocumentDigest: source.documents[0]!.digest, postPatchDocumentDigest: createHash('sha256').update(documents.get('docs/GDD.md')!).digest('hex'),
    patchOperations: operations, impact, admittedIssues: [{ ...issue, source: current }], sectionIndex }
  const checked = validateFoundationPatch({ ...validation, factStore: sliced.factStore })
  expect(checked).toEqual(validateFoundationPatch({ ...validation, factStore: full.factStore }))
  expect(checked.semanticRecheckIssueIds).toEqual([issue.id])
  expect(checked.newImpactedIssues).toHaveLength(1)
  expect(checked.newImpactedIssues[0]!.remediation.documentPath).toBe('docs/TECHNICAL_DESIGN.md')
  const packet = buildFoundationSemanticRecheckPacket({ issue: { ...issue, source: current }, documents, sectionIndex,
    factStore: sliced.factStore, patchOperation: operations[0]!, impact })
  expect(packet.facts.map(fact => fact.key)).toEqual(['game.mechanics'])
  expect(packet.sections.map(section => section.ref.sectionId)).toEqual(['player_actions'])
  expect(admitFoundationSemanticRecheckWorkerResult(packet, { status: 'PASS' },
    { taskId: 'recheck', issue: { ...issue, source: current } }).status).toBe('PASS')
})
