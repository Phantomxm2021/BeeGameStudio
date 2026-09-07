import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../domain/types'
import { canonicalFoundationBlockIds } from '../domain/foundation-section-index'
import { FOUNDATION_SEMANTIC_CHECKS, buildFoundationSemanticPacket, semanticResultToFoundationIssueDrafts } from '../domain/foundation-semantic-audit'
import { createSemanticWorkerTask } from '../worker-task'
import { prepareFoundationReview } from '../prepare-review'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../test-fixtures/complete-game-document-fixture'

// Reduced reproduction of the Chrome acceptance failure: valid Markdown, a
// repaired catching-game section, but unrelated game content remains elsewhere.
function contaminatedLevelInput(checkId = 'SEM.gameplay_level_viability') {
  const documents = CANONICAL_FOUNDATION_DOCUMENTS.map(path => {
    const submission = completeTestSubmission(path)
    if (path === 'docs/GDD.md') {
      for (const section of submission.sections) {
        if (section.sectionId === 'vision') section.body = 'A desktop 2D star-catching game. One fixed screen, a 60-second session, three lives. No biomes or persistent save system.'
        if (section.sectionId === 'player_actions') section.body = 'The basket moves left and right only. No flight, climbing, stamina or traversal unlocks.'
      }
    }
    if (path === 'docs/LEVEL_SCENE_DESIGN.md') {
      submission.executiveSummary = 'A continuous world with a hub and radiating biome branches.'
      for (const section of submission.sections) {
        if (section.sectionId === 'world_structure') section.body = 'Hive_Hub owns the save system. Biome scenes take eight to twelve minutes of first-pass traversal.'
        if (section.sectionId === 'level_sequence') section.body = 'Tutorial Descent teaches the flight-stamina meter; Pollen Fields teaches sustained flight.'
        if (section.sectionId === 'objectives_routes') section.body = 'Catch stars for sixty seconds. There are no biomes, no gated content and no persistent progression.'
      }
    }
    return { path, content: renderTestCompleteGameDocument(path, submission) }
  })
  const prepared = prepareFoundationReview(documents)
  if (prepared.kind !== 'facts_pending') throw new Error('reproduction must be format-valid')
  const byPath = new Map(documents.map(doc => [doc.path, doc.content]))
  return {
    revision: prepared.snapshot.digest, checkId,
    sectionIndex: prepared.sectionIndex,
    sectionBytes: new Map(prepared.sectionIndex.map(ref => [
      `${ref.documentPath}#${ref.sectionId}`,
      byPath.get(ref.documentPath)!.split('\n').slice(ref.startLine - 1, ref.endLine).join('\n'),
    ])),
    factStore: prepared.extraction.facts, deterministicIssuePrefix: [],
    deterministicReviewDigest: createHash('sha256').update('[]').digest('hex'),
  }
}

test('source and confirmation see the audit objective, game authority and every Level block', () => {
  const input = contaminatedLevelInput()
  const declaration = FOUNDATION_SEMANTIC_CHECKS.find(check => check.checkId === input.checkId)!
  for (const kind of ['source', 'confirmation'] as const) {
    const task = createSemanticWorkerTask(input, kind)
    const { packet } = JSON.parse(task.prompt.split('Model packet contract: ')[1]!)
    expect(packet.objective).toBe(declaration.objective)
    expect(task.prompt).toContain('packet.objective')
    expect(task.prompt).toContain('A desktop 2D star-catching game')
    expect(task.prompt).toContain('No flight, climbing, stamina')
    expect(task.prompt).toContain('radiating biome branches')
    expect(task.prompt).toContain('Hive_Hub owns the save system')
    expect(task.prompt).toContain('Tutorial Descent teaches the flight-stamina meter')
    expect(task.prompt).toContain('There are no biomes')
    expect(packet.sections.filter((section: { documentPath: string }) => section.documentPath === 'docs/LEVEL_SCENE_DESIGN.md')
      .map((section: { sectionId: string }) => section.sectionId).sort())
      .toEqual([...canonicalFoundationBlockIds('docs/LEVEL_SCENE_DESIGN.md')].sort())
  }
})

test('every remaining semantic check carries its objective into source and confirmation prompts', () => {
  for (const declaration of FOUNDATION_SEMANTIC_CHECKS) {
    if (declaration.checkId === 'SEM.gameplay_level_viability') continue
    const input = contaminatedLevelInput(declaration.checkId)
    for (const kind of ['source', 'confirmation'] as const) {
      const task = createSemanticWorkerTask(input, kind)
      const { packet } = JSON.parse(task.prompt.split('Model packet contract: ')[1]!)
      expect(packet.objective).toBe(declaration.objective)
      expect(task.prompt).toContain(declaration.objective)
    }
  }
})

test('residual summary, world and sequence conflicts can become actionable downstream Issues', () => {
  const input = contaminatedLevelInput()
  const task = createSemanticWorkerTask(input)
  const packet = buildFoundationSemanticPacket(input)
  const sections = ['executive_summary', 'world_structure', 'level_sequence']
  const admitted = task.admit({ status: 'completed', outcome: 'ISSUES', issues: sections.map(sectionId => ({
    problem: `Unrelated gameplay remains in ${sectionId}`,
    expected: 'The Level document must describe the one-screen star-catching game and its allowed actions.',
    actual: `The ${sectionId} block still requires biome traversal, persistent saves or flight.`,
    sourceSectionKey: 'GDD#vision',
    supportingSectionKeys: ['GDD#player_actions'],
    remediation: { kind: 'patch', sectionKeys: [`LEVEL#${sectionId}`] },
  })) })
  const issues = semanticResultToFoundationIssueDrafts(packet, admitted)
  expect(issues.map(issue => issue.remediation)).toEqual(sections.map(sectionId => ({
    kind: 'patch', scope: 'section', documentPath: 'docs/LEVEL_SCENE_DESIGN.md', sectionIds: [sectionId],
  })))
  expect(issues.every(issue => issue.source.documentPath === 'docs/GDD.md')).toBe(true)
  expect(issues.every(issue => issue.supportingSections?.length === 1 &&
    issue.supportingSections[0]?.documentPath === 'docs/GDD.md' &&
    issue.supportingSections[0]?.sectionId === 'player_actions')).toBe(true)
})
