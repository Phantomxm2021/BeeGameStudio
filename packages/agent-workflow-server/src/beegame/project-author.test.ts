import { expect, test } from 'bun:test'
import { AUTHOR_BATCHES, DESIGN_CONTENT_POLICY, authorBatchInstruction, authorBatchReviewInstruction, authorDocumentResponsibility } from './project-author'
import { DESIGN_HANDOFF_INSTRUCTION, DESIGN_INDEX_INSTRUCTION, type DesignFinding } from './design-handoff'
import { projectDeliveryPhaseInstruction } from './project-delivery'

test('GDD retains gameplay ownership and index acceptance without downstream task-writing instructions', () => {
  const prompt = authorBatchInstruction(0, 'GDD.md')
  expect(prompt).toContain(authorDocumentResponsibility(0, 'GDD.md'))
  expect(prompt).toContain(DESIGN_INDEX_INSTRUCTION)
  expect(prompt).not.toContain('adds implementationItems:')
  expect(prompt).toContain('independent native Write calls may be issued together')
  expect(prompt).toContain('not a separate receipt file')
  expect(prompt).toContain('Headings need not be numbered')
  expect(prompt).not.toContain('write the supplied completion receipt')
  expect(prompt).toContain('Do not claim completion after a failed save')
  expect(prompt).toContain('native completion check and host validate saved index structure and explicit references')
  expect(prompt).not.toContain('--design-handoff')
  expect(prompt).toContain('native runtime preloads game-systems-designer-expert')
  expect(prompt).toContain('User-requested professional features remain required')
  expect(prompt).toContain('Record the requirement and its owner rather than inventing the specialist answer')
  expect(authorBatchReviewInstruction(4, 'inspect')).toContain('Record the requirement and its owner rather than inventing the specialist answer')
})

test('authors and reviewers share one content policy without repeating author registration tasks in review', () => {
  for (const [batch, documents] of AUTHOR_BATCHES.entries()) for (const document of documents)
    expect(authorBatchInstruction(batch, document).split(DESIGN_CONTENT_POLICY)).toHaveLength(2)
  for (const step of ['inspect', 'revise', 'verify'] as const) {
    const prompt = authorBatchReviewInstruction(4, step, [], undefined, ['TECHNICAL_DESIGN.md'])
    expect(prompt.split(DESIGN_CONTENT_POLICY)).toHaveLength(2)
    expect(prompt).not.toContain('Register necessary owned outcomes in the existing outputs index')
    expect(prompt).not.toContain('Add implementationItems to the existing TECHNICAL_DESIGN index')
  }
})

test('joint inspect defaults to all eight documents; affected inspect honors the host scope', () => {
  const prompt = authorBatchReviewInstruction(4, 'inspect')
  const scope = prompt.split('\n')[0]!
  const documents = [...new Set(AUTHOR_BATCHES.flat())]
  expect(documents).toHaveLength(8)
  for (const document of documents) expect(scope).toContain(document)
  expect(prompt).toContain('Read the assigned saved prose drafts and relevant sources')
  expect(prompt).toContain('Host structural failures are real inspection inputs and already belong to revision scope')
  const affected = authorBatchReviewInstruction(4, 'inspect', [], undefined, ['UI_UX_SPEC.md']).split('\n')[0]!
  expect(affected).toContain('Assigned scope: UI_UX_SPEC.md.')
  expect(affected).not.toContain('GDD.md')
})
test('professional choices belong to Revision; changes to user commitments ask a real question', () => {
  const revision = authorBatchReviewInstruction(4, 'revise', [], undefined, ['LEVEL_SCENE_DESIGN.md'])
  expect(revision).toContain('assigned Revision owner')
  expect(revision).toContain('within original user requirements and established core rules')
  expect(revision).toContain('AskUserQuestion before edits')
  expect(revision).toContain('never supply answers')
  expect(revision).toContain('do not certify their closure')
  expect(authorBatchReviewInstruction(4, 'inspect')).toContain('finished inspect with identified decide findings is complete')
  expect(authorDocumentResponsibility(2, 'LEVEL_SCENE_DESIGN.md')).toContain('instead of maintaining a second ASCII map')
})

test('all eight owners register specific outcomes and only final technical completion organizes tasks', () => {
  for (const [batch, documents] of AUTHOR_BATCHES.entries()) for (const document of documents) {
    const role = authorDocumentResponsibility(batch, document)
    expect(role).toContain('Register necessary owned outcomes in the existing outputs index')
    expect(role).toContain('source-backed acceptance')
    expect(role).toContain('one generic whole-document completion item')
    expect(role.includes('Add implementationItems to the existing TECHNICAL_DESIGN index'))
      .toBe(document === 'TECHNICAL_DESIGN.md' && batch === 4)
  }
  expect(authorBatchReviewInstruction(4)).toContain('compare all release commitments with owner outputs and the final implementationItems')
  expect(authorBatchReviewInstruction(4)).toContain('These check structure/references, not semantic quality')
  const implementation = projectDeliveryPhaseInstruction('implementation')
  expect(implementation).toContain('do not replace the reviewed tasks with a shorter self-invented Todo')
  expect(implementation).toContain('results by original task ID')
  expect(implementation).not.toContain('Choose the plan, tools, task split')
})

test('technical completion replaces the initial design assignment rather than appending another report request', () => {
  const completion = authorBatchInstruction(4, 'TECHNICAL_DESIGN.md')
  expect(completion).toContain('Read docs/TECHNICAL_DESIGN.md and its existing index first')
  expect(completion).toContain('Expand source reads when a dependency is unclear')
  expect(completion).toContain('preserve valid existing output IDs and pointers')
  expect(completion).toContain('report changed sections')
  expect(completion).not.toContain('Explain how the agreed release runs')
  expect(completion).not.toContain('Read the relevant source clauses in the saved prior drafts:')
  expect(completion).not.toContain('Save your complete assigned draft')
  expect(completion).toContain('complete player journey')
  expect(completion).toContain('semantic omissions and conflicts')
  expect(authorBatchInstruction(1, 'TECHNICAL_DESIGN.md')).toContain('Establish the technical baseline')
  expect(authorBatchInstruction(4, 'ASSET_PLAN.md')).toContain('Save your complete assigned draft')
})

test('revise and verify retain only the recorded affected assignment', () => {
  const finding: DesignFinding = { id: 'rule', severity: 'blocker', action: 'correct', owner: 'GDD.md',
    documents: ['GDD.md', 'BALANCE_DESIGN.md'], sources: [{ document: 'GDD.md', section: 'Rules' }],
    impact: 'The consumer would select a different outcome', closeWhen: 'Rules and formula agree', neededBefore: 'implementation' }
  for (const step of ['revise', 'verify'] as const) {
    const scope = authorBatchReviewInstruction(4, step, [finding]).split('\n')[0]!
    expect(scope).toContain('Assigned scope: GDD.md, BALANCE_DESIGN.md.')
    expect(scope).not.toContain('ART_DIRECTION.md')
    const recorded = authorBatchReviewInstruction(4, step, [finding]).split('Recorded findings:\n')[1]!.split('\n\n')[0]!
    expect(JSON.parse(recorded)).toEqual([finding])
  }
  expect(authorBatchReviewInstruction(4, 'revise', [finding], undefined, ['GDD.md']).split('\n')[0])
    .toContain('Assigned scope: GDD.md.')
})

test('review instructions include due follow-ups, preserve their labels and exclude later optional scope', () => {
  const due: DesignFinding = { id: 'due-ui', severity: 'follow-up', action: 'correct', owner: 'UI_UX_SPEC.md',
    documents: ['UI_UX_SPEC.md'], sources: [{ document: 'UI_UX_SPEC.md', section: 'Design' }],
    impact: 'Resource consumer would guess the compatible size', closeWhen: 'An explicit compatible size', neededBefore: 'resources' }
  const later: DesignFinding = { ...due, id: 'later-art', action: 'evidence', owner: 'ART_DIRECTION.md', documents: ['ART_DIRECTION.md'], neededBefore: 'implementation' }
  const prompt = authorBatchReviewInstruction(4, 'revise', [due, later])
  expect(prompt.split('\n')[0]).toContain('Assigned scope: UI_UX_SPEC.md.')
  expect(prompt.split('\n')[0]).not.toContain('ART_DIRECTION.md')
  expect(prompt).toContain('Required correction IDs for this boundary: due-ui.')
  expect(JSON.parse(prompt.split('Recorded findings:\n')[1]!.split('\n\n')[0]!)).toEqual([due, later])
  for (const step of ['revise', 'verify'] as const) {
    const combined = authorBatchReviewInstruction(4, step, [due, later], undefined, undefined, ['resources'], true)
    expect(combined).toContain('Follow-ups with a deadline are required corrections')
    expect(combined).not.toContain('Follow-ups are optional and have no deadline')
    expect(combined).toContain('An alternative to an already satisfying selected design is not a missing requirement')
  }
})

test('font constraints belong upstream of layout, not a new grid imposed by resource sourcing', () => {
  expect(authorDocumentResponsibility(1, 'ART_DIRECTION.md')).toContain('A pixel-art style alone does not establish')
  expect(authorDocumentResponsibility(3, 'UI_UX_SPEC.md')).toContain("Consume Art's actual typography constraints")
  expect(authorDocumentResponsibility(4, 'ASSET_PLAN.md')).toContain('Do not infer bitmap size divisibility')
})

test.each(['inspect', 'revise', 'verify'] as const)('%s receives existing index semantics without replaying the author registration contract', step => {
  const prompt = authorBatchReviewInstruction(4, step)
  expect(prompt).not.toContain(DESIGN_HANDOFF_INSTRUCTION)
  expect(prompt).toContain('Existing indexes contain outputs {id,section,acceptance:{section,method}}')
  expect(prompt).toContain('does not regenerate indexes or calculate host versions/hashes')
    expect(prompt).toContain('only with independently confirmed progress')
    expect(prompt).not.toContain('at most inspect → revise → verify')
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
  expect(ui).toContain('Do not create standalone HTML/SVG mockups')
  for (const step of ['inspect', 'revise', 'verify'] as const) {
    const prompt = authorBatchReviewInstruction(4, step, [], undefined, ['UI_UX_SPEC.md'])
    expect(prompt).toContain('--review-layouts')
    expect(prompt).toContain('host independently recomputes saved inputs')
    expect(prompt).toContain('consume the supplied current host layout report')
    expect(prompt).toContain('do not lower control minima')
  }
  expect(authorBatchReviewInstruction(4, 'verify', [], undefined, ['GDD.md'])).not.toContain('--review-layouts')
  expect(projectDeliveryPhaseInstruction('content')).toContain('owner-linked content/scenes and content/ui files and complete them in place')
})

test('Scene author starts the same production source with pending resources, not a temporary game or early asset batch', () => {
  const scene = authorBatchInstruction(2, 'LEVEL_SCENE_DESIGN.md')
  expect(scene).toContain('content/scenes/*.json')
  expect(scene).toContain('Content completes these same Scene files after resource delivery')
  expect(scene).toContain('no full asset batch is required')
  expect(scene).toContain('Do not create content/index.json')
  expect(authorBatchReviewInstruction(4, 'verify', [], undefined, ['LEVEL_SCENE_DESIGN.md'])).toContain('--review-layouts')
  expect(projectDeliveryPhaseInstruction('resources')).toContain('font family/weights/glyph range')
  expect(projectDeliveryPhaseInstruction('content')).toContain('Unknown Scene fields remain protected')
})
