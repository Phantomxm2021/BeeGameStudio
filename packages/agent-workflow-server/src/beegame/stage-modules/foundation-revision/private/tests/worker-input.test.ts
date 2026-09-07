import { expect, test } from 'bun:test'
import { prepareRevisionWorkerInputs } from '../worker-input'
import { buildRevisionWorkerPrompt, projectRevisionPacketForModel } from '../worker-prompt'
import { prepareRevisionRequest } from '../request-preparation'
import { revisionDigest } from '../json-digest'
import { buildFoundationSectionIndex } from '../domain/foundation-section-index'
import { buildReviewerPublishedResult } from '../../../foundation-reviewer/private/review-publication'
import { initialReviewerFactState } from '../../../foundation-reviewer/private/fact-state'
import { completedReviewFixture, reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'

function fixture(format: boolean) {
  const documents = reviewFixtureDocuments(true)
  if (format) for (const doc of documents) doc.content = '# incomplete'
  else documents[0]!.content = documents[0]!.content.replace('game.mechanics: ["move","attack","dash"]', 'game.mechanics: ["move","attack","dash","parry"]')
  const sourceResult = buildReviewerPublishedResult({
    ...(format ? { documents, state: initialReviewerFactState(documents) } : completedReviewFixture({ documents })),
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) } })
  return { kind: 'initial', ownerId: 'owner', projectId: 'project', requestId: 'repair', sourceResult,
    sourceBinding: { ownerId: 'owner', projectId: 'project', resultId: sourceResult.resultId, resultDigest: revisionDigest(sourceResult) } }
}

function fixtureWithSupportingEvidence() {
  const request = fixture(false)
  const source = structuredClone(request.sourceResult)
  const index = buildFoundationSectionIndex({ documents: new Map(source.documents.map(doc => [doc.path, doc.content])) })
  const indexed = index.find(section => section.documentPath === 'docs/GDD.md' && section.sectionId === 'vision')!
  const document = source.documents.find(doc => doc.path === indexed.documentPath)!
  const ref = { documentPath: indexed.documentPath, sectionId: indexed.sectionId, heading: indexed.heading,
    startLine: indexed.startLine, endLine: indexed.endLine, digest: indexed.digest }
  const content = document.content.split('\n').slice(indexed.startLine - 1, indexed.endLine).join('\n')
  const entry = source.issues[0]!
  ;(entry.issue as Record<string, unknown>).supportingSections = [ref]
  entry.sections.push({ path: ref.documentPath, sectionId: ref.sectionId, content, digest: ref.digest })
  source.issueRegistryDigest = revisionDigest(source.issues.map(entry => entry.issue))
  const { resultId: _ignored, ...body } = source
  source.resultId = revisionDigest(body)
  return { ...request, sourceResult: source,
    sourceBinding: { ...request.sourceBinding, resultId: source.resultId, resultDigest: revisionDigest(source) } }
}

for (const format of [false, true]) test(`${format ? 'eight whole-document' : 'cross-document section'} worker packets retain bounded authority`, () => {
  const request = fixture(format)
  const prepared = prepareRevisionRequest(request)
  const inputs = prepareRevisionWorkerInputs(request)
  expect(inputs.length).toBe(format ? 8 : 1)
  expect(prepareRevisionWorkerInputs(request)).toEqual(inputs)
  for (const { packet, packetDigest } of inputs) {
    expect(packetDigest).toBe(revisionDigest(packet))
    expect(packet.requestDigest).toBe(prepared.requestDigest)
    expect(packet.sourceReviewResultId).toBe(prepared.source.resultId)
    expect(packet.issueIds).toEqual([...packet.issueIds].sort())
    for (const priorFailureReason of [undefined, 'authorized section missing']) {
      const prompt = buildRevisionWorkerPrompt({ scope: packet.scope, packet, ...(priorFailureReason ? { priorFailureReason } : {}) })
      expect(prompt).toContain('Revision evidence:')
      expect(prompt).not.toContain(packet.requestDigest)
      expect(prompt).not.toContain(packet.baseDocumentDigest)
      if (priorFailureReason) expect(prompt).toContain(priorFailureReason)
    }
    const projected = projectRevisionPacketForModel(packet)
    expect(projected).not.toHaveProperty('requestDigest')
    expect(projected).not.toHaveProperty('baseDocumentDigest')
    if (packet.scope === 'document') {
      expect(packet.documentContract).toBeDefined()
      expect(projected).not.toHaveProperty('document')
    } else {
      expect(packet.sections.some(section => section.documentPath !== packet.documentPath)).toBe(true)
      expect(packet.factConstraints.every(constraint => constraint.owner.documentPath === packet.documentPath && packet.sectionIds.includes(constraint.owner.sectionId))).toBe(true)
    }
  }
})

test('worker prompt refuses extra authority, mismatched scope and untrusted accessors', () => {
  const { packet } = prepareRevisionWorkerInputs(fixture(true))[0]!
  if (packet.scope !== 'document') throw new Error('document fixture required')
  const { documentContract: _contract, ...missingContract } = packet
  expect(() => buildRevisionWorkerPrompt({ scope: 'document', packet: missingContract })).toThrow()
  expect(() => buildRevisionWorkerPrompt({ scope: 'section', packet })).toThrow()
  expect(() => buildRevisionWorkerPrompt({ scope: 'document', packet, taskId: 'external' } as never)).toThrow()
  let reads = 0
  expect(() => buildRevisionWorkerPrompt({ scope: 'document', get packet() { reads++; return packet } })).toThrow()
  expect(reads).toBe(0)
})

test('worker prompt projects supporting sections as read-only evidence without widening the fix', () => {
  const packet = {
    scope: 'section',
    issues: [{ id: 'issue-1', type: 'semantic', source: { documentPath: 'docs/GDD.md', sectionId: 'player_actions', heading: 'Player Actions' },
      target: { documentPath: 'docs/UI_UX_SPEC.md', sectionId: 'input', heading: 'Input' },
      supportingSections: [{ documentPath: 'docs/GDD.md', sectionId: 'core_loop', heading: 'Core Loop' },
        { documentPath: 'docs/TECHNICAL_DESIGN.md', sectionId: 'runtime_state', heading: 'Runtime State' }],
      expected: 'one fix', actual: 'two sources', remediation: { kind: 'patch', scope: 'section', documentPath: 'docs/GDD.md', sectionIds: ['player_actions'] } }],
    sections: [],
  }
  const projected = projectRevisionPacketForModel(packet)
  expect(projected.issues).toEqual([expect.objectContaining({
    source: expect.objectContaining({ documentPath: 'docs/GDD.md', sectionId: 'player_actions' }),
    target: expect.objectContaining({ documentPath: 'docs/UI_UX_SPEC.md', sectionId: 'input' }),
    supportingSections: [
      expect.objectContaining({ documentPath: 'docs/GDD.md', sectionId: 'core_loop' }),
      expect.objectContaining({ documentPath: 'docs/TECHNICAL_DESIGN.md', sectionId: 'runtime_state' }),
    ],
    remediation: { kind: 'patch', scope: 'section', documentPath: 'docs/GDD.md', sectionIds: ['player_actions'] },
  })])
})

test('admitted supporting sections are packet evidence only and never become writable sectionIds', () => {
  const request = fixtureWithSupportingEvidence()
  const { packet } = prepareRevisionWorkerInputs(request)[0]!
  expect(packet.scope).toBe('section')
  expect(packet.sectionIds).not.toContain('vision')
  expect(packet.sections.some(section => section.documentPath === 'docs/GDD.md' && section.sectionId === 'vision')).toBe(true)
  expect((packet.issues[0] as Record<string, unknown>).supportingSections).toEqual([expect.objectContaining({ documentPath: 'docs/GDD.md', sectionId: 'vision' })])
  const projected = projectRevisionPacketForModel(packet)
  const projectedIssues = projected.issues as Record<string, unknown>[]
  expect((projectedIssues[0] as Record<string, unknown>).remediation).toBeDefined()
  expect(((projectedIssues[0] as Record<string, unknown>).remediation as Record<string, unknown>).sectionIds).toEqual(packet.sectionIds)
  expect(buildRevisionWorkerPrompt({ scope: 'section', packet })).toContain('only sectionIds may change')
})
