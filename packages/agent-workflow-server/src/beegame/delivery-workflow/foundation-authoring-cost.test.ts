import { describe, expect, test } from 'bun:test'
import {
  foundationAuthoringDocumentContract,
  foundationAuthoringSources,
} from './foundation-authoring-contract'
import { buildWorkerPrompt } from './worker-prompts'
import { getGameDocumentContract } from './game-document-contracts'
import {
  canonicalFoundationAuthorityProjectionBytes,
  projectFoundationAuthority,
} from '../foundation-authority-projection'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'

function foundationAuthorPromptContract(path: FoundationDocumentPath) {
  const prompt = buildWorkerPrompt({
    runId: 'run',
    ownerId: 'owner',
    projectId: 'project',
    workspacePath: '/workspace',
    workerType: 'document-author',
    phase: 'DOCUMENT_DRAFTING',
    revision: 'revision',
    allowedPaths: [path],
    contract: {
      documentSet: 'foundation',
      authoringMode: 'initial',
      foundationDocumentPath: path,
      completeDocumentContract: getGameDocumentContract(path),
    },
  })
  const serialized = prompt.split('\n').find(line => line.startsWith('{'))
  if (!serialized) throw new Error('foundation author prompt omitted its contract')
  return JSON.parse(serialized).completeDocumentContract as {
    mechanicalMarkdownProtocol: {
      sections: Array<{ sectionId: string; title: string; purpose: string }>
      productionMaterials: {
        entries: Array<{
          materialId: string
          title: string
          serialization: string
        }>
      }
    }
    outputPolicy: Record<string, string>
    mergeReferenceRule: string
  }
}

function sourceDocument(path: FoundationDocumentPath): string {
  const contract = getGameDocumentContract(path)
  return [
    `# ${contract.discipline}`,
    '',
    ...contract.sections.flatMap(section => [
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      `SECTION_SENTINEL:${path}:${section.sectionId}`,
      '',
    ]),
    '<!-- beegame-production-materials -->',
    '## Production Materials',
    ...contract.productionMaterials.flatMap(material => [
      `<!-- beegame-material:${material.materialId} -->`,
      `### ${material.title}`,
      `MATERIAL_SENTINEL:${path}:${material.materialId}`,
      '',
    ]),
  ].join('\n')
}

describe('Stage 2 authoring cost contract', () => {
  test('preserves all heading/material identities and forwards shared output policy and merge rules', () => {
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      const shared = getGameDocumentContract(path)
      const view = foundationAuthorPromptContract(path)

      expect(view.mechanicalMarkdownProtocol.sections.map(section => [section.sectionId, section.title])).toEqual(
        shared.sections.map(section => [section.sectionId, section.title]),
      )
      expect(view.mechanicalMarkdownProtocol.productionMaterials.entries.map(material => [
        material.materialId,
        material.title,
        material.serialization,
      ])).toEqual(shared.productionMaterials.map(material => [
        material.materialId,
        material.title,
        material.serialization,
      ]))
      expect(view.outputPolicy).toEqual(shared.outputPolicy)
      expect(view.mergeReferenceRule).toBe(shared.mergeReferenceRule)
    }
  })

  test('uses owner-material references for repeated Asset section facts', () => {
    const view = foundationAuthoringDocumentContract('docs/ASSET_PLAN.md')
    const purpose = (sectionId: string) =>
      view.sections.find(section => section.sectionId === sectionId)!.purpose

    expect(purpose('inventory')).toContain('asset-inventory-table')
    expect(purpose('inventory')).not.toContain('complete bill of materials')
    expect(purpose('ownership')).toContain('responsibility-matrix')
    expect(purpose('ownership')).not.toContain('status authority keyed by inventory IDs')
    expect(purpose('ownership')).toContain('rule for who is authorized to update status')
    expect(purpose('ownership')).toContain('milestone-maturity-table')
    expect(purpose('ownership')).toContain('maturity and status facts')
    expect(purpose('dependencies')).toContain('dependency-integration-diagram')
    expect(purpose('source_license')).toContain('license-register')
    expect(purpose('source_license')).toContain('creation/source strategy')
    expect(purpose('source_license')).toContain('replacement rights')
    expect(purpose('source_license')).toContain('per-resource source')
    expect(purpose('source_license')).toContain('license evidence details')
    expect(purpose('milestones')).toContain('milestone-maturity-table')
    expect(purpose('milestones')).toContain('necessary estimates and capacity assumptions')
    expect(purpose('milestones')).toContain('without inventing staffing or headcount')
    for (const sectionId of ['inventory', 'ownership', 'dependencies', 'source_license', 'milestones'])
      expect(purpose(sectionId)).toContain('do not reproduce')

    expect(purpose('formats_budgets')).toContain('format capabilities')
    expect(purpose('formats_budgets')).toContain('file-budget rules')
    expect(purpose('formats_budgets')).toContain('per-resource')
    expect(purpose('formats_budgets')).toContain('asset-inventory-table')
    expect(purpose('validation')).toContain('validation methods')
    expect(purpose('validation')).toContain('status lifecycle')
    expect(purpose('validation')).toContain('Do not output a separate derived-totals table')

    const guidance = view.documentAuthorityRule
    expect(guidance).toContain('not a restatement of upstream design')
    expect(guidance).toContain('do not automatically reduce cues, layers or file variants')
    expect(guidance).toContain('explicit inventory IDs')
    expect(guidance).toContain('do not require a repeated all-resource workflow')
  })

  test('projects core_loop, metrics and pacing_beats sections even when owner diagrams are present', () => {
    const gdd = sourceDocument('docs/GDD.md')
    const level = sourceDocument('docs/LEVEL_SCENE_DESIGN.md')

    const levelProjection = projectFoundationAuthority({
      targetPath: 'docs/LEVEL_SCENE_DESIGN.md',
      availableUpstreamPaths: ['docs/GDD.md'],
      documents: new Map([['docs/GDD.md', gdd]]),
    })
    const levelSerialized = canonicalFoundationAuthorityProjectionBytes(levelProjection)
    expect(levelSerialized).toContain('SECTION_SENTINEL:docs/GDD.md:core_loop')
    expect(levelSerialized).toContain('SECTION_SENTINEL:docs/GDD.md:metrics')
    expect(levelSerialized).toContain('MATERIAL_SENTINEL:docs/GDD.md:core-loop-diagram')
    expect(levelSerialized).toContain('MATERIAL_SENTINEL:docs/GDD.md:game-state-flow')

    const balanceProjection = projectFoundationAuthority({
      targetPath: 'docs/BALANCE_DESIGN.md',
      availableUpstreamPaths: ['docs/LEVEL_SCENE_DESIGN.md'],
      documents: new Map([['docs/LEVEL_SCENE_DESIGN.md', level]]),
    })
    const balanceSerialized = canonicalFoundationAuthorityProjectionBytes(balanceProjection)
    expect(balanceSerialized).toContain('SECTION_SENTINEL:docs/LEVEL_SCENE_DESIGN.md:pacing_beats')
    expect(balanceSerialized).toContain('MATERIAL_SENTINEL:docs/LEVEL_SCENE_DESIGN.md:pacing-beat-table')
  })

  test('keeps Stage 2 input additions limited to the requested paths and IDs', () => {
    expect(foundationAuthoringSources('docs/LEVEL_SCENE_DESIGN.md')).toEqual([
      expect.objectContaining({
        path: 'docs/GDD.md',
        sectionIds: [
          'experience_pillars',
          'core_loop',
          'player_actions',
          'rules_systems',
          'progression',
          'challenge_recovery',
          'accessibility_localization',
          'metrics',
          'material.core-loop-diagram',
          'material.game-state-flow',
        ],
      }),
    ])
    expect(foundationAuthoringSources('docs/BALANCE_DESIGN.md')).toEqual([
      expect.objectContaining({
        path: 'docs/GDD.md',
        sectionIds: ['rules_systems', 'progression', 'challenge_recovery', 'metrics', 'material.core-loop-diagram', 'material.game-state-flow'],
      }),
      expect.objectContaining({
        path: 'docs/LEVEL_SCENE_DESIGN.md',
        sectionIds: [
          'encounters',
          'spawn_checkpoint',
          'pacing_beats',
          'material.world-structure-diagram',
          'material.route-choice-diagram',
          'material.pacing-beat-table',
        ],
      }),
    ])
  })
})
