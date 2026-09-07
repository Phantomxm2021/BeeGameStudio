import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { FOUNDATION_FACT_CATALOG } from '../domain/foundation-fact-definitions'
import { completeTestSubmission, renderTestCompleteGameDocument } from './complete-game-document-fixture'
import { prepareFoundationReview } from '../prepare-review'
import { initialReviewerFactState } from '../fact-state'
import { applyReviewerJournalEvent, type ReviewerJournalState, type ReviewerJournalEvent } from '../review-state'

const values: Record<string, unknown> = {
  'game.players.max': 4, 'game.mechanics': ['move', 'attack', 'dash'], 'game.resources': ['hp', 'energy'],
  'game.states': ['menu', 'playing', 'won', 'lost'], 'game.win_conditions': ['boss_defeated'], 'game.loss_conditions': ['player_defeated'], 'game.platform': 'quest',
  'level.required_entities': ['Player', 'Boss_A'], 'level.required_assets': ['player_model', 'boss_model'], 'level.complexity_budget': 100,
  'balance.entity_ids': ['Player', 'Boss_A'], 'balance.variable_ids': ['player_hp', 'boss_hp'],
  'technical.supported_actions': ['move', 'attack', 'dash'], 'technical.target_fps': 72, 'technical.content_kinds': ['model', 'texture', 'audio'],
  'art.style_constraints': ['low_poly', 'readable_silhouette'], 'ui.supported_actions': ['move', 'attack', 'dash'], 'ui.displayed_resources': ['hp', 'energy'],
  'audio.event_ids': ['boss_spawn', 'boss_defeated'], 'asset.inventory_ids': ['player_model', 'boss_model'], 'asset.covered_level_requirements': ['player_model', 'boss_model'],
  'asset.art_constraint_refs': ['low_poly', 'readable_silhouette'], 'asset.formats': ['glb', 'png', 'wav'],
}
export function reviewFixtureDocuments(normalizedFacts = false) {
  return CANONICAL_FOUNDATION_DOCUMENTS.map(path => {
    const submission = completeTestSubmission(path)
    if (normalizedFacts) for (const definition of FOUNDATION_FACT_CATALOG.filter(item => item.owner.documentPath === path)) {
      const value = values[definition.key]
      const line = `\n\n${definition.key}: ${typeof value === 'string' ? value : JSON.stringify(value)}\n`
      const section = submission.sections.find(item => item.sectionId === definition.owner.sectionId)
      if (section) section.body += line
      else {
        const material = submission.productionMaterials.find(item => `material.${item.materialId}` === definition.owner.sectionId)
        if (!material || !('body' in material)) throw new Error('fixture fact owner is not rendered')
        material.body += line
      }
    }
    return { path, content: renderTestCompleteGameDocument(path, submission) }
  })
}
export const fixtureUsage = { input_tokens: 7, completion_tokens: 3, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 10 }
export function completedReviewFixture(options: { normalizedFacts?: boolean; documents?: ReturnType<typeof reviewFixtureDocuments>; output?: (taskId: string) => {} } = {}) {
  const documents = structuredClone(options.documents ?? reviewFixtureDocuments(options.normalizedFacts))
  const prepared = prepareFoundationReview(documents)
  if (prepared.kind !== 'facts_pending') throw new Error('review fixture format is invalid')
  let state: ReviewerJournalState = initialReviewerFactState(documents)
  let sequence = 0
  const apply = (event: ReviewerJournalEvent) => {
    state = applyReviewerJournalEvent(state, documents, event, new Date(1_700_000_000_000 + sequence++ * 100).toISOString(),
      { path: `.beegame/workflow/foundation-reviewer/state/fixture/events/${sequence}.json`, digest: 'a'.repeat(64), runId: 'fixture' })
  }
  for (const [index, packet] of prepared.factPackets.entries()) {
    const taskId = `fact-${index}`, dispatchId = `fact-${index}`
    apply({ kind: 'claim', taskId, dispatchId })
    apply({ kind: 'accept', taskId, dispatchId, usage: fixtureUsage, output: { status: 'completed', results: packet.keys.map(key => ({ key, status: 'absent' })) } })
  }
  apply({ kind: 'begin_semantic' })
  while (state.semantic!.collection.tasks.some(task => task.status === 'pending')) {
    const task = state.semantic!.collection.tasks.find(item => item.status === 'pending')!
    apply({ kind: 'semantic', command: { kind: 'claim', taskId: task.taskId, dispatchId: task.taskId } })
    const output = options.output?.(task.taskId) ?? { status: 'completed', outcome: 'PASS' }
    // Keep historical fixtures readable while exercising the current explicit
    // evidence contract; real worker admission never supplies this default.
    const fixtureOutput = output && typeof output === 'object' && 'issues' in output && Array.isArray(output.issues)
      ? { ...output, issues: output.issues.map(issue => issue && typeof issue === 'object' && !Array.isArray(issue) && !('supportingSectionKeys' in issue)
        ? { ...issue, supportingSectionKeys: [] } : issue) }
      : output
    apply({ kind: 'semantic', command: { kind: 'accept', taskId: task.taskId, dispatchId: task.taskId, usage: fixtureUsage, output: fixtureOutput } })
    if (state.semantic!.phase === 'needs_action') break
  }
  return { documents, state }
}
