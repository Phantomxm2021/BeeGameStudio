import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { canonicalFoundationBlockIds, type SectionRef } from '../domain/foundation-section-index'
import {
  admitFoundationSemanticResult,
  buildFoundationSemanticPacket,
  digestFoundationSemanticResult,
  semanticResultToFoundationIssueDrafts,
} from '../domain/foundation-semantic-audit'
import { mergeExactFoundationReviewIssues } from '../domain/foundation-final-issue-merge'
import { compileFoundationIssueRegistry } from '../domain/foundation-audit-check-definitions'
import type { AuditIssue } from '../domain/foundation-issue-registry'
import { buildReviewerPublishedResult, type ReviewerPublishedResult } from '../review-publication'
import { parseReviewerSourceResult } from '../review-handoff'
import { reviewerDigest } from '../review-summary'
import { admitFoundationSemanticRecheckWorkerResult } from '../domain/foundation-patch-validation'
import { prepareReviewerTargetedAudit, validateReviewerTargetedFacts } from '../targeted-preparation'
import { candidateFixtureFromReview } from '../test-fixtures/candidate-fixture'
import { completedReviewFixture } from '../test-fixtures/review-fixture'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const key = (ref: SectionRef) => `${ref.documentPath}#${ref.sectionId}`

function packetFixture() {
  const levelPath = 'docs/LEVEL_SCENE_DESIGN.md' as const
  const ids = [
    ...['vision', 'core_loop', 'player_actions', 'rules_systems', 'states_flow', 'progression', 'content_narrative', 'scope_risks'].map(sectionId => ['docs/GDD.md' as const, sectionId] as const),
    ...canonicalFoundationBlockIds(levelPath).map(sectionId => [levelPath, sectionId] as const),
  ]
  const refs = ids.map(([documentPath, sectionId], index) => ({ documentPath, sectionId, heading: sectionId, startLine: index + 1, endLine: index + 2, digest: hash(`${documentPath}#${sectionId}`) }))
  const sectionBytes = new Map(refs.map(ref => [key(ref), `${ref.documentPath}#${ref.sectionId}`]))
  return buildFoundationSemanticPacket({ revision: 'rev-multisource', checkId: 'SEM.gameplay_level_viability', sectionIndex: refs, sectionBytes, factStore: [], deterministicIssuePrefix: [], deterministicReviewDigest: 'd'.repeat(64) })
}

function semanticDraft(supportingSectionKeys: readonly string[] = []) {
  return { problem: 'cross-source contradiction', expected: 'the downstream block follows the owner', actual: 'the downstream block contradicts the owner', sourceSectionKey: 'GDD#vision', supportingSectionKeys, remediation: { kind: 'patch' as const, sectionKeys: ['LEVEL#content_matrix'] } }
}

test('semantic admission requires bounded, packet-local, additional supporting refs', () => {
  const packet = packetFixture()
  const base = { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'ISSUES' as const }
  expect(() => admitFoundationSemanticResult(packet, { ...base, issues: [{ ...semanticDraft(), supportingSectionKeys: undefined }] })).toThrow(/supporting|unknown/i)
  expect(() => admitFoundationSemanticResult(packet, { ...base, issues: [semanticDraft(['GDD#core_loop', 'GDD#core_loop'])] })).toThrow(/supporting/i)
  expect(() => admitFoundationSemanticResult(packet, { ...base, issues: [semanticDraft(['GDD#not-in-packet'])] })).toThrow(/supporting/i)
  expect(() => admitFoundationSemanticResult(packet, { ...base, issues: [semanticDraft(['GDD#vision'])] })).toThrow(/supporting/i)
  const tooMany = packet.sections.filter(item => item.sectionKey !== 'GDD#vision').map(item => item.sectionKey).slice(0, 17)
  expect(() => admitFoundationSemanticResult(packet, { ...base, issues: [semanticDraft(tooMany)] })).toThrow(/supporting/i)
})

test('reversed support order has identical admitted result and issue identity', () => {
  const packet = packetFixture()
  const base = { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'ISSUES' as const }
  const left = admitFoundationSemanticResult(packet, { ...base, issues: [semanticDraft(['LEVEL#content_matrix', 'GDD#core_loop'])] })
  const right = admitFoundationSemanticResult(packet, { ...base, issues: [semanticDraft(['GDD#core_loop', 'LEVEL#content_matrix'])] })
  expect(digestFoundationSemanticResult(left)).toBe(digestFoundationSemanticResult(right))
  const leftDrafts = semanticResultToFoundationIssueDrafts(packet, left)
  const rightDrafts = semanticResultToFoundationIssueDrafts(packet, right)
  expect(leftDrafts[0]!.conflictIdentity).toEqual(rightDrafts[0]!.conflictIdentity)
  const compilerSections = [...packet.sections.map(section => section.ref), ...CANONICAL_FOUNDATION_DOCUMENTS.filter(path => !packet.sections.some(section => section.ref.documentPath === path)).map((documentPath, index) => ({ documentPath, sectionId: `placeholder-${index}`, heading: 'placeholder', startLine: 1, endLine: 1, digest: 'e'.repeat(64) }))]
  const compile = (drafts: typeof leftDrafts) => compileFoundationIssueRegistry({ sectionIndex: compilerSections, factStore: [], drafts })
  expect(compile(leftDrafts)[0]!.id).toBe(compile(rightDrafts)[0]!.id)
})

function publicFixture(): ReviewerPublishedResult {
  const review = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback conflict', expected: 'readable feedback', actual: 'missing feedback', sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: ['UI#input'], remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } }] }
    : { status: 'completed', outcome: 'PASS' } })
  return buildReviewerPublishedResult({ identity: { ownerId: 'owner', projectId: 'project', requestId: 'multisource' }, subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) }, ...review })
}

const binding = (result: ReviewerPublishedResult) => ({ ownerId: result.ownerId, projectId: result.projectId, resultId: result.resultId, resultDigest: reviewerDigest(result) })
function rebind(result: ReviewerPublishedResult) {
  result.issueRegistryDigest = reviewerDigest(result.issues.map(entry => entry.issue))
  const { resultId: _, ...body } = result
  result.resultId = reviewerDigest(body)
}

test('public handoff binds support slices and rejects altered, missing, or omitted semantic support', () => {
  let result = publicFixture()
  expect(result.issues[0]!.issue).toHaveProperty('supportingSections')
  const support = result.issues[0]!.sections.find(section => section.sectionId === 'input')!
  support.content += '\ntampered'
  rebind(result)
  expect(() => parseReviewerSourceResult(result, binding(result))).toThrow(/slices/i)
  result = publicFixture()
  result.issues[0]!.sections = result.issues[0]!.sections.filter(section => section.sectionId !== 'input')
  rebind(result)
  expect(() => parseReviewerSourceResult(result, binding(result))).toThrow(/slices/i)
  result = publicFixture()
  delete (result.issues[0]!.issue as Record<string, unknown>).supportingSections
  rebind(result)
  expect(() => parseReviewerSourceResult(result, binding(result))).toThrow(/supporting/i)
})

test('targeted recheck rejects support refs with stale digest, line, or heading', () => {
  const review = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback conflict', expected: 'readable feedback', actual: 'missing feedback', sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: ['UI#input'], remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } }] }
    : { status: 'completed', outcome: 'PASS' } })
  const documents = review.documents.map(doc => ({ ...doc, content: doc.path === 'docs/GDD.md' ? doc.content.replace('game.mechanics: ["move","attack","dash"]', 'game.mechanics: ["move","attack","dash","parry"]') : doc.content }))
  const { prepared } = candidateFixtureFromReview(review, documents)
  const validation = prepareReviewerTargetedAudit(prepared)
  const { issue, packet } = validateReviewerTargetedFacts(prepared, []).semantic[0]!
  expect(admitFoundationSemanticRecheckWorkerResult(packet, { status: 'PASS' }, { taskId: 'support-ref-valid', issue }).status).toBe('PASS')
  for (const mutation of [{ digest: 'f'.repeat(64) }, { startLine: issue.supportingSections![0]!.startLine + 1 }, { heading: `${issue.supportingSections![0]!.heading}-tampered` }]) {
    const tampered = structuredClone(issue)
    tampered.supportingSections![0] = { ...tampered.supportingSections![0]!, ...mutation }
    expect(() => admitFoundationSemanticRecheckWorkerResult(packet, { status: 'PASS' }, { taskId: 'support-ref-tampered', issue: tampered })).toThrow(/supporting/i)
  }
  expect(validation.issues).toHaveLength(1)
})

test('authorized same-batch support changes rebind, while an unauthorized document edit is rejected', () => {
  const review = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [
      { problem: 'feedback conflict', expected: 'readable feedback', actual: 'missing feedback', sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: ['UI#input'], remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } },
      { problem: 'input conflict', expected: 'input is documented', actual: 'input is missing', sourceSectionKey: 'UI#input', supportingSectionKeys: ['GDD#player_actions'], remediation: { kind: 'patch', sectionKeys: ['UI#input'] } },
    ] } : { status: 'completed', outcome: 'PASS' } })
  const changed = review.documents.map(doc => ({ ...doc, content: doc.path === 'docs/GDD.md' ? doc.content.replace('game.mechanics: ["move","attack","dash"]', 'game.mechanics: ["move","attack","dash","parry"]') : doc.path === 'docs/UI_UX_SPEC.md' ? doc.content.replace('ui.supported_actions: ["move","attack","dash"]', 'ui.supported_actions: ["move","attack","dash"]\nUI update') : doc.content }))
  const { prepared } = candidateFixtureFromReview(review, changed)
  const plan = prepareReviewerTargetedAudit(prepared)
  expect(plan.issues).toHaveLength(2)
  expect(plan.issues[0]!.supportingSections?.map(key)).toEqual(['docs/UI_UX_SPEC.md#input'])
  expect(plan.issues[1]!.supportingSections?.map(key)).toEqual(['docs/GDD.md#player_actions'])
  const originalIssue = plan.input.source.issues[0]!.issue
  if (!('supportingSections' in originalIssue) || !originalIssue.supportingSections?.[0])
    throw new Error('fixture must retain its original supporting evidence')
  const originalSupportDigest = originalIssue.supportingSections[0].digest
  const reboundSupport = plan.issues[0]!.supportingSections![0]!
  expect(reboundSupport.digest).not.toBe(originalSupportDigest)
  expect(plan.sectionIndex.find(ref => key(ref) === key(reboundSupport))?.digest).toBe(reboundSupport.digest)
  const singleIssueReview = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback conflict', expected: 'readable feedback', actual: 'missing feedback', sourceSectionKey: 'GDD#player_actions', supportingSectionKeys: ['UI#input'], remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } }] }
    : { status: 'completed', outcome: 'PASS' } })
  expect(() => candidateFixtureFromReview(singleIssueReview, changed)).toThrow(/authorized|scope|outside/i)
})

test('final merge keeps issues distinct when supporting evidence sets differ', () => {
  const source = { documentPath: 'docs/GDD.md' as const, sectionId: 'vision', heading: 'vision', startLine: 1, endLine: 2, digest: 'a'.repeat(64) }
  const supportA = { ...source, sectionId: 'core_loop' }
  const supportB = { ...source, sectionId: 'player_actions' }
  const issue = (id: string, supportingSections: SectionRef[]): AuditIssue => ({ id, severity: 'HIGH', type: 'semantic', source, supportingSections, expected: 'expected', actual: 'actual', remediation: { kind: 'patch', scope: 'section', documentPath: 'docs/GDD.md', sectionIds: ['vision'] } })
  expect(mergeExactFoundationReviewIssues([issue('a', [supportA]), issue('b', [supportB])])).toHaveLength(2)
})
