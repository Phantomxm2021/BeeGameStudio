import { expect, test } from 'bun:test'
import { AUTHOR_BATCHES, authorBatchInstruction, authorBatchReviewInstruction, authorDocumentResponsibility } from './project-author'
import { DESIGN_HANDOFF_INSTRUCTION, type DesignFinding } from './design-handoff'
import { projectDeliveryPhaseInstruction } from './project-delivery'

test('joint inspect covers all eight documents even when given only the final writing group', () => {
  const prompt = authorBatchReviewInstruction(4, 'inspect', [], undefined, AUTHOR_BATCHES[4])
  const scope = prompt.split('\n')[0]!
  const documents = [...new Set(AUTHOR_BATCHES.flat())]
  expect(documents).toHaveLength(8)
  for (const document of documents) expect(scope).toContain(document)
  expect(prompt).toContain('Read the eight complete saved prose drafts')
  expect(prompt).toContain('Host structural failures already belong to the revision scope')
})

test('revise and verify retain only the recorded affected assignment', () => {
  const finding: DesignFinding = { id: 'rule', severity: 'blocker', action: 'correct', owner: 'GDD.md',
    documents: ['GDD.md', 'BALANCE_DESIGN.md'], sources: [{ document: 'GDD.md', section: 'Rules' }],
    impact: 'The consumer would select a different outcome', closeWhen: 'Rules and formula agree', neededBefore: 'implementation' }
  for (const step of ['revise', 'verify'] as const) {
    const scope = authorBatchReviewInstruction(4, step, [finding]).split('\n')[0]!
    expect(scope).toContain('Assigned scope: GDD.md, BALANCE_DESIGN.md.')
    expect(scope).not.toContain('ART_DIRECTION.md')
    expect(authorBatchReviewInstruction(4, step, [finding])).toContain(JSON.stringify([finding]))
  }
  expect(authorBatchReviewInstruction(4, 'revise', [finding], undefined, ['GDD.md']).split('\n')[0])
    .toContain('Assigned scope: GDD.md.')
})

test.each(['inspect', 'revise', 'verify'] as const)('%s receives the actual handoff contract and host metadata responsibility', step => {
  const prompt = authorBatchReviewInstruction(4, step)
  expect(prompt.split(DESIGN_HANDOFF_INSTRUCTION)).toHaveLength(2)
  expect(prompt).toContain('The host records saved versions and evidence hashes')
  expect(prompt).toContain('at most inspect → revise → verify')
  expect(authorBatchInstruction(1, 'AUDIO_DESIGN.md')).toContain(DESIGN_HANDOFF_INSTRUCTION)
})

test('gameplay ownership remains distinct from tuning and specialist preferences', () => {
  const gdd = authorDocumentResponsibility(0, 'GDD.md')
  const balance = authorDocumentResponsibility(2, 'BALANCE_DESIGN.md')
  expect(gdd).toContain('which gameplay states and transitions exist')
  expect(gdd).toContain('gameplay-progress persistence')
  expect(gdd).toContain('specialist preference settings and their lifetime stay with their owners')
  expect(balance).toContain('within the established gameplay rules')
  expect(balance).toContain('do not add or remove a gameplay state or transition under the name of tuning')
  expect(balance).toContain('identify the required GDD decision')
})

test('each writing assignment carries only its owned responsibilities and leaves review until all documents are saved', () => {
  AUTHOR_BATCHES.forEach((documents, batch) => {
    for (const document of documents) {
      const prompt = authorBatchInstruction(batch, document)
      expect(prompt).toContain(authorDocumentResponsibility(batch, document))
      for (const sibling of documents.filter(name => name !== document))
        expect(prompt).not.toContain(authorDocumentResponsibility(batch, sibling))
      expect(prompt).toContain('one independent joint Review follows completion of all eight documents')
      expect(prompt).toContain('no fixed review occurs between writing groups')
      expect(prompt).toContain('the host maintains its version')
      expect(prompt).not.toContain('Include version, author and date')
      expect(prompt).not.toContain('reviewed GDD')
    }
  })
  expect(authorDocumentResponsibility(1, 'TECHNICAL_DESIGN.md')).toContain('without specifying transitions whose design inputs are not yet available')
  expect(authorDocumentResponsibility(1, 'TECHNICAL_DESIGN.md')).toContain('must not exclude pending professional behavior')
  expect(authorDocumentResponsibility(4, 'TECHNICAL_DESIGN.md')).toContain('including initialization, important transitions, restart and cleanup')
})

test('phase instructions select design review only at the joint review milestone', () => {
  expect(projectDeliveryPhaseInstruction('review')).toContain('game-design-check')
  for (const phase of ['resources', 'content', 'implementation', 'acceptance'] as const)
    expect(projectDeliveryPhaseInstruction(phase)).not.toContain('game-design-check')
})

test('UI retains computable constraints and only affected Review steps require geometry recalculation', () => {
  const ui = authorBatchInstruction(3, 'UI_UX_SPEC.md')
  expect(ui).toContain('content/ui/*.json')
  expect(ui).toContain('geometry-changing expanded/modal state with active nodes')
  expect(ui).toContain('not a throwaway test layout')
  expect(ui).toContain('actual UI files continued in Content')
  expect(ui).toContain('partial HTML sample as a substitute or an additional mandatory deliverable')
  for (const step of ['inspect', 'revise', 'verify'] as const) {
    const prompt = authorBatchReviewInstruction(4, step, [], undefined, ['UI_UX_SPEC.md'])
    expect(prompt).toContain('--review-layouts')
    expect(prompt).toContain('host independently recomputes saved inputs')
    expect(prompt).toContain('do not lower agreed control minima')
  }
  expect(authorBatchReviewInstruction(4, 'verify', [], undefined, ['GDD.md'])).not.toContain('--review-layouts')
  expect(projectDeliveryPhaseInstruction('content')).toContain('Read the UI-linked content/ui files and complete them in place')
})
