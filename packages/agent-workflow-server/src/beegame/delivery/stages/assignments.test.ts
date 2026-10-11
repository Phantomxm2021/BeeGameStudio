import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeDesignDocumentsFixture, designBaselineFixture } from '../../fixtures/layout-fixture'
import { prepareReview, prepareReviewAssignment } from './review'
import { preparePlanningAssignment } from './planning'
import { prepareImplementation } from './implementation'
import { prepareAcceptance } from './acceptance'
import type { DesignStageState } from '../design-state'
import { PROJECT_DOCUMENTS } from '../../project-content-authority'

test('planning exposes the actual batch, not a replacement document/task list', () => {
  const state: DesignStageState = { objective: 'Synthetic game', status: 'active', phase: 'author', authorBatch: 2 }
  const input = preparePlanningAssignment(state)
  expect(input.needsSpatial).toBe(true)
  expect(input.authors?.map(author => String(author.document))).toEqual(input.documents.map(String))
  expect(() => preparePlanningAssignment({ ...state, authorBatch: 99 })).toThrow('Unknown')
})

test('review assignment retains one initial full scope and a bounded read/write scope for verify', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-stage-assignments-'))
  try {
    await writeDesignDocumentsFixture(workspace)
    const state = (await prepareReview(workspace, { objective: 'Synthetic game', status: 'active', phase: 'review', authorBatch: 4 }))!
    const initial = prepareReviewAssignment(workspace, state)!
    expect(initial.documents).toEqual([...PROJECT_DOCUMENTS])
    expect(initial.readScope).toBeUndefined()
    expect(initial.writableFiles).toContain('.beegame/design-handoffs/UI_UX_SPEC.json')
    const scoped: DesignStageState = { ...state, designReview: { ...state.designReview!, step: 'verify',
      affectedDocuments: ['UI_UX_SPEC.md'], writableDocuments: ['UI_UX_SPEC.md'],
      changedSections: { 'UI_UX_SPEC.md': ['Design'] } } }
    const verification = prepareReviewAssignment(workspace, scoped)!
    expect(verification.writableFiles).toEqual([])
    expect(verification.readScope?.['UI_UX_SPEC.md']).toContain('Design')
    expect(verification.inputDocuments).not.toContain('AUDIO_DESIGN.md')
    expect(verification.receiptContext.step).toBe('verify')
    const baseline = designBaselineFixture(workspace)
    const execution = { ...state, phase: 'implementation' as const, designReview: undefined, designBaseline: baseline }
    expect(prepareImplementation(workspace, execution)).toEqual(prepareAcceptance(workspace, { ...execution, phase: 'acceptance' }))
    expect(prepareImplementation(workspace, execution).designRevision).toBe(baseline.revision)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})
