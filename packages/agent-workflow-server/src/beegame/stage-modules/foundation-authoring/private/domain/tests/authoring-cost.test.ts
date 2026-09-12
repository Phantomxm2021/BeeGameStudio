import { describe, expect, test } from 'bun:test'
import {
  FOUNDATION_AUTHORING_INSTRUCTION,
  foundationAuthoringDocumentContract,
  foundationAuthoringSources,
} from '../foundation-authoring-contract'
import { buildFoundationAuthorPrompt as buildWorkerPrompt } from '../foundation-authoring-prompt'
import { getGameDocumentContract } from '../game-document-contracts'
import {
  canonicalFoundationAuthorityProjectionBytes,
  projectFoundationAuthority,
} from '../foundation-authority-projection'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'

function foundationAuthorPrompt(path: FoundationDocumentPath) {
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
      confirmedBriefDigest: 'a'.repeat(64),
      documentSet: 'foundation',
      authoringMode: 'initial',
      foundationDocumentPath: path,
      completeDocumentContract: getGameDocumentContract(path),
    },
  })
  return prompt
}

test('all eight authors receive one decision-focused instruction without dropping required design', () => {
  expect(FOUNDATION_AUTHORING_INSTRUCTION).toContain('Keep rationale to the minimum needed for a production decision')
  expect(FOUNDATION_AUTHORING_INSTRUCTION).toContain('Do not narrate tables or diagrams')
  expect(FOUNDATION_AUTHORING_INSTRUCTION).toContain('repeated derivations')
  expect(FOUNDATION_AUTHORING_INSTRUCTION).toContain('Preserve required parameters, formulas, geometry, interfaces')
  expect(FOUNDATION_AUTHORING_INSTRUCTION).toContain('Do not impose fixed token, word, time or example caps')
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const prompt = foundationAuthorPrompt(path)
    expect(prompt.split(FOUNDATION_AUTHORING_INSTRUCTION)).toHaveLength(2)
    expect(prompt).not.toContain('The dedicated Reviewer owns format, content and quality audit')
    const contract = foundationAuthorPromptContract(path).mechanicalMarkdownProtocol
    expect(contract.sections.map(section => section.sectionId)).toEqual(
      getGameDocumentContract(path).sections.map(section => section.sectionId),
    )
    expect(contract.productionMaterials.entries.map(material => material.materialId)).toEqual(
      getGameDocumentContract(path).productionMaterials.map(material => material.materialId),
    )
  }
})

function foundationAuthorPromptContract(path: FoundationDocumentPath) {
  const serialized = foundationAuthorPrompt(path).split('\n').find(line => line.startsWith('{'))
  if (!serialized) throw new Error('foundation author prompt omitted its contract')
  return JSON.parse(serialized).completeDocumentContract as {
    mechanicalMarkdownProtocol: {
      sections: Array<{ sectionId: string; title: string; purpose: string }>
      productionMaterials: {
        entries: Array<{
          materialId: string
          title: string
          format: string
          purpose: string
          authorityRule: string
          serialization: string
          heading?: string
          serializationRule?: string
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

function sourceDocumentWithFacts(
  path: FoundationDocumentPath,
  facts: Readonly<Record<string, string>>,
): string {
  return Object.entries(facts).reduce(
    (markdown, [blockId, fact]) =>
      markdown.replace(
        blockId.startsWith('material.')
          ? `MATERIAL_SENTINEL:${path}:${blockId.slice('material.'.length)}`
          : `SECTION_SENTINEL:${path}:${blockId}`,
        fact,
      ),
    sourceDocument(path),
  )
}

function occurrenceCount(value: string, needle: string): number {
  return value.split(needle).length - 1
}

// These are offline contract/fixture checks only. They do not validate model
// quality, generated-document correctness, token savings or runtime gates.
describe('Stage 2 authoring cost contract (offline only)', () => {
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
    expect(purpose('validation')).not.toContain('recompute any totals')
    expect(purpose('formats_budgets')).toContain('Different upper bounds alone are not a conflict')
    expect(purpose('formats_budgets')).toContain('Do not design runtime adapters')
    const inventory = view.productionMaterials.find(material => material.materialId === 'asset-inventory-table')!
    expect(inventory.purpose).toContain('delivery-specific exceptions')
    expect(inventory.purpose).toContain('retain concrete delivery specifications and every required variant')
    expect(inventory.purpose).toContain('Reference upstream owner IDs or sections')
    const shared = getGameDocumentContract('docs/ASSET_PLAN.md')
    for (const material of view.productionMaterials) {
      const { checklistMode: _mode, ...original } = shared.productionMaterials.find(item => item.materialId === material.materialId)!
      expect(material).toEqual(material.materialId === 'asset-inventory-table'
        ? { ...original, purpose: inventory.purpose }
        : original)
    }

    const guidance = view.documentAuthorityRule
    expect(guidance).toContain('not a restatement of upstream design')
    expect(guidance).toContain('do not automatically reduce cues, layers or file variants')
    expect(guidance).toContain('explicit inventory IDs')
    expect(guidance).toContain('do not require a repeated all-resource workflow')
  })

  test('narrows only repeated Level layout purpose while preserving owners and materials', () => {
    const path = 'docs/LEVEL_SCENE_DESIGN.md' as const
    const shared = getGameDocumentContract(path)
    const view = foundationAuthorPromptContract(path)
    const purpose = (sectionId: string) =>
      view.mechanicalMarkdownProtocol.sections.find(section => section.sectionId === sectionId)!.purpose

    expect(purpose('world_structure')).toContain('world-structure-diagram')
    expect(purpose('world_structure')).toContain('complete coordinate, path, grid, trigger and off-screen literals')
    expect(purpose('world_structure')).toContain('do not reproduce geometry')
    expect(purpose('objectives_routes')).toContain('route-choice-diagram')
    expect(purpose('objectives_routes')).toContain('slot, trigger')
    expect(purpose('objectives_routes')).toContain('mutual-exclusion')
    expect(purpose('objectives_routes')).toContain('do not derive another geometry')
    expect(purpose('objectives_routes')).not.toContain('computable layout evidence')
    expect(purpose('production_acceptance')).not.toContain('computable layout evidence')
    expect(purpose('production_acceptance')).toContain('production ownership, dependencies')
    expect(purpose('production_acceptance')).toContain('concrete finite non-negative complexity budget')
    expect(purpose('production_acceptance')).toContain('without repeating geometry or coverage calculations')

    const privateLevelSections = ['world_structure', 'objectives_routes', 'production_acceptance', 'encounters', 'pacing_beats', 'camera_readability', 'content_matrix']
    for (const sectionId of privateLevelSections) {
      expect(purpose(sectionId)).not.toBe(shared.sections.find(section => section.sectionId === sectionId)!.purpose)
    }
    for (const section of shared.sections) {
      if (privateLevelSections.includes(section.sectionId)) continue
      expect(purpose(section.sectionId)).toBe(section.purpose)
    }

    expect(view.mechanicalMarkdownProtocol.productionMaterials.entries.map(
      ({ heading: _heading, serializationRule: _serializationRule, ...material }) => material,
    )).toEqual(
      shared.productionMaterials.map(({ checklistMode: _mode, ...material }) => material),
    )

  })

  test('narrows repeated owner obligations in the other private author views', () => {
    const cases: Array<{
      path: FoundationDocumentPath
      sectionId: string
      includes: string[]
      excludes: string[]
    }> = [
      {
        path: 'docs/GDD.md',
        sectionId: 'core_loop',
        includes: ['core-loop-diagram', 'entry, exit and reward transitions'],
        excludes: ['Define moment-to-moment, session and long-term loops'],
      },
      {
        path: 'docs/GDD.md',
        sectionId: 'states_flow',
        includes: ['game-state-flow', 'state ownership, invariants and recovery'],
        excludes: ['Define menus, play states, transitions, pause, completion, failure and recovery.'],
      },
      {
        path: 'docs/BALANCE_DESIGN.md',
        sectionId: 'units_variables',
        includes: ['variable-parameter-table', 'precision and comparison conventions'],
        excludes: ['numeric `var.*` and `param.*` entries are stored only'],
      },
      {
        path: 'docs/BALANCE_DESIGN.md',
        sectionId: 'tuning_validation',
        includes: ['validation methods', 'sensitivity scenarios'],
        excludes: ['auditable validation chain from inputs through results to acceptance'],
      },
      {
        path: 'docs/TECHNICAL_DESIGN.md',
        sectionId: 'architecture',
        includes: ['architecture-diagram', 'interface fields'],
        excludes: ['Define components, responsibilities, data flow and dependency direction'],
      },
      {
        path: 'docs/TECHNICAL_DESIGN.md',
        sectionId: 'save_load',
        includes: ['save-recovery-table', 'migration behavior'],
        excludes: ['Define persistence scope, checkpoints, migration, corruption handling and recovery.'],
      },
      {
        path: 'docs/ART_DIRECTION.md',
        sectionId: 'animation',
        includes: ['animation-vfx-state-table', 'motion principles'],
        excludes: ['Define motion principles, state coverage, timing intent, transitions and technical constraints.'],
      },
      {
        path: 'docs/ART_DIRECTION.md',
        sectionId: 'color_lighting',
        includes: ['palette systems', 'contrast and accessibility constraints'],
        excludes: ['visual-language-board for compact visual acceptance evidence'],
      },
      {
        path: 'docs/UI_UX_SPEC.md',
        sectionId: 'experience_architecture',
        includes: ['information-architecture-diagram', 'responsive geometry belongs to wireframe-board'],
        excludes: ['across the minimum viewport, safe-area, breakpoints'],
      },
      {
        path: 'docs/UI_UX_SPEC.md',
        sectionId: 'input',
        includes: ['focus-accessibility-matrix', 'action conflicts'],
        excludes: ['Define actions, navigation, focus, remapping'],
      },
      {
        path: 'docs/AUDIO_DESIGN.md',
        sectionId: 'music',
        includes: ['music-state-diagram', 'pause, focus loss and restoration'],
        excludes: ['Define music structure, transitions and intensity with explicit state mappings'],
      },
      {
        path: 'docs/AUDIO_DESIGN.md',
        sectionId: 'implementation',
        includes: ['audio integration fields', 'loudness-delivery-table'],
        excludes: ['Define formats, memory/streaming budgets, naming, event integration and diagnostics.'],
      },
    ]

    for (const { path, sectionId, includes, excludes } of cases) {
      const view = foundationAuthoringDocumentContract(path)
      const purpose = view.sections.find(section => section.sectionId === sectionId)!.purpose
      for (const phrase of includes) expect(purpose).toContain(phrase)
      for (const phrase of excludes) expect(purpose).not.toContain(phrase)
    }
  })

  test('applies every private purpose override to an existing section', () => {
    const overrides: Partial<Record<FoundationDocumentPath, readonly string[]>> = {
      'docs/GDD.md': ['core_loop', 'states_flow', 'rules_systems', 'challenge_recovery', 'metrics'],
      'docs/BALANCE_DESIGN.md': ['units_variables', 'entity_parameters', 'formulas', 'economy', 'progression_curves', 'challenge_model', 'rewards_value', 'tuning_validation', 'risks_dependencies'],
      'docs/TECHNICAL_DESIGN.md': ['architecture', 'runtime_state', 'data_content', 'save_load', 'input_interaction', 'performance', 'diagnostics', 'testing'],
      'docs/ART_DIRECTION.md': ['visual_pillars', 'composition_readability', 'animation', 'vfx', 'camera_presentation', 'asset_specifications', 'pipeline_risks'],
      'docs/UI_UX_SPEC.md': ['experience_architecture', 'player_journeys', 'screen_inventory', 'hud', 'input', 'feedback_errors', 'accessibility', 'localization', 'prototype_acceptance'],
      'docs/AUDIO_DESIGN.md': ['event_taxonomy', 'sfx', 'music', 'ambience', 'ui_feedback', 'mix', 'implementation', 'production'],
    }
    for (const [path, sectionIds] of Object.entries(overrides) as Array<[FoundationDocumentPath, readonly string[]]>) {
      const shared = getGameDocumentContract(path)
      const view = foundationAuthoringDocumentContract(path)
      for (const sectionId of sectionIds) {
        const original = shared.sections.find(section => section.sectionId === sectionId)
        const privateSection = view.sections.find(section => section.sectionId === sectionId)
        expect(original).toBeDefined()
        expect(privateSection).toBeDefined()
        expect(privateSection!.purpose).not.toBe(original!.purpose)
      }
    }
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

  test('projects real Level facts through every declared downstream owner block', () => {
    const level = sourceDocumentWithFacts('docs/LEVEL_SCENE_DESIGN.md', {
      encounters: 'required_entities: [entity.runner] unique-fact-encounters',
      spawn_checkpoint: 'spawn_checkpoint: checkpoint.start -> spawn.entry unique-fact-spawn',
      pacing_beats: 'pacing_beats: beat.one cadence=10s unique-fact-pacing',
      camera_readability: 'camera_readability: camera.main offscreen=explicit unique-fact-camera',
      scene_states: 'scene_states: scene.play -> scene.complete unique-fact-scene',
      'material.world-structure-diagram': 'world_structure: coordinate=(12,34) path=main grid=8x6 trigger=goal offscreen=explicit unique-fact-world-material',
      'material.route-choice-diagram': 'objectives_routes: route=alt slot=build-2 trigger=choice exclusion=main unique-fact-route-material',
      'material.pacing-beat-table': 'pacing_beats: beat.one cadence=10s recovery=5s unique-fact-pacing-material',
    })
    const projections = new Map([
      ['balance', projectFoundationAuthority({
        targetPath: 'docs/BALANCE_DESIGN.md',
        availableUpstreamPaths: ['docs/LEVEL_SCENE_DESIGN.md'],
        documents: new Map([['docs/LEVEL_SCENE_DESIGN.md', level]]),
      })],
      ['ui', projectFoundationAuthority({
        targetPath: 'docs/UI_UX_SPEC.md',
        availableUpstreamPaths: ['docs/LEVEL_SCENE_DESIGN.md'],
        documents: new Map([['docs/LEVEL_SCENE_DESIGN.md', level]]),
      })],
      ['technical', projectFoundationAuthority({
        targetPath: 'docs/TECHNICAL_DESIGN.md',
        availableUpstreamPaths: ['docs/LEVEL_SCENE_DESIGN.md'],
        documents: new Map([['docs/LEVEL_SCENE_DESIGN.md', level]]),
      })],
      ['art', projectFoundationAuthority({
        targetPath: 'docs/ART_DIRECTION.md',
        availableUpstreamPaths: ['docs/LEVEL_SCENE_DESIGN.md'],
        documents: new Map([['docs/LEVEL_SCENE_DESIGN.md', level]]),
      })],
      ['audio', projectFoundationAuthority({
        targetPath: 'docs/AUDIO_DESIGN.md',
        availableUpstreamPaths: ['docs/LEVEL_SCENE_DESIGN.md'],
        documents: new Map([['docs/LEVEL_SCENE_DESIGN.md', level]]),
      })],
      ['asset', projectFoundationAuthority({
        targetPath: 'docs/ASSET_PLAN.md',
        availableUpstreamPaths: ['docs/LEVEL_SCENE_DESIGN.md'],
        documents: new Map([['docs/LEVEL_SCENE_DESIGN.md', level]]),
      })],
    ])
    const serialized = new Map([...projections].map(([name, projection]) => [
      name,
      canonicalFoundationAuthorityProjectionBytes(projection),
    ]))

    expect(serialized.get('balance')).toContain('unique-fact-encounters')
    expect(serialized.get('balance')).toContain('unique-fact-spawn')
    expect(serialized.get('balance')).toContain('unique-fact-pacing')
    expect(serialized.get('balance')).toContain('unique-fact-world-material')
    expect(serialized.get('balance')).toContain('unique-fact-route-material')
    expect(serialized.get('balance')).toContain('unique-fact-pacing-material')
    expect(serialized.get('ui')).toContain('unique-fact-camera')
    expect(serialized.get('ui')).toContain('unique-fact-scene')
    expect(serialized.get('technical')).toContain('unique-fact-spawn')
    expect(serialized.get('technical')).toContain('unique-fact-scene')
    expect(serialized.get('art')).toContain('unique-fact-camera')
    expect(serialized.get('audio')).toContain('unique-fact-scene')
    expect(serialized.get('audio')).toContain('unique-fact-pacing-material')
    expect(serialized.get('asset')).toContain('unique-fact-world-material')
    expect(serialized.get('asset')).toContain('unique-fact-route-material')
    expect(serialized.get('asset')).toContain('unique-fact-pacing-material')
  })

  test('projects required owner inputs exactly once in section mode without unselected blocks', () => {
    const cases: Array<{
      targetPath: FoundationDocumentPath
      sourcePath: FoundationDocumentPath
      facts: Record<string, string>
      unselected: string
    }> = [
      {
        targetPath: 'docs/UI_UX_SPEC.md' as const,
        sourcePath: 'docs/GDD.md' as const,
        facts: { metrics: 'required-owner-ui-gdd-metrics' },
        unselected: 'vision',
      },
      {
        targetPath: 'docs/ART_DIRECTION.md' as const,
        sourcePath: 'docs/GDD.md' as const,
        facts: { metrics: 'required-owner-art-gdd-metrics' },
        unselected: 'vision',
      },
      {
        targetPath: 'docs/AUDIO_DESIGN.md' as const,
        sourcePath: 'docs/GDD.md' as const,
        facts: { metrics: 'required-owner-audio-gdd-metrics' },
        unselected: 'vision',
      },
      {
        targetPath: 'docs/ASSET_PLAN.md' as const,
        sourcePath: 'docs/ART_DIRECTION.md' as const,
        facts: {
          character_style: 'required-owner-asset-art-character-style',
          environment_style: 'required-owner-asset-art-environment-style',
          color_lighting: 'required-owner-asset-art-color-lighting',
        },
        unselected: 'visual_pillars',
      },
      {
        targetPath: 'docs/ASSET_PLAN.md' as const,
        sourcePath: 'docs/AUDIO_DESIGN.md' as const,
        facts: { sfx: 'required-owner-asset-audio-sfx' },
        unselected: 'audio_pillars',
      },
      {
        targetPath: 'docs/AUDIO_DESIGN.md' as const,
        sourcePath: 'docs/UI_UX_SPEC.md' as const,
        facts: {
          input: 'required-owner-audio-ui-input',
          'material.focus-accessibility-matrix': 'required-owner-audio-ui-focus-matrix',
        },
        unselected: 'experience_architecture',
      },
    ]

    for (const { targetPath, sourcePath, facts, unselected } of cases) {
      const unselectedFact = `unselected-${targetPath}-${sourcePath}`
      const projection = projectFoundationAuthority({
        targetPath,
        availableUpstreamPaths: [sourcePath],
        documents: new Map([[sourcePath, sourceDocumentWithFacts(sourcePath, {
          ...facts,
          [unselected]: unselectedFact,
        })]]),
      })
      const serialized = canonicalFoundationAuthorityProjectionBytes(projection)

      expect(projection.sources).toHaveLength(1)
      expect(projection.sources[0]!.selectionScope).toBe('sections')
      for (const fact of Object.values(facts)) expect(occurrenceCount(serialized, fact)).toBe(1)
      expect(serialized).not.toContain(unselectedFact)

      const shared = getGameDocumentContract(targetPath)
      const view = foundationAuthoringDocumentContract(targetPath)
      expect(view.sections.map(section => [section.sectionId, section.title])).toEqual(
        shared.sections.map(section => [section.sectionId, section.title]),
      )
      expect(view.productionMaterials.map(material => [material.materialId, material.title, material.serialization])).toEqual(
        shared.productionMaterials.map(material => [material.materialId, material.title, material.serialization]),
      )
    }
  })

  test('keeps one annotated input declaration per source and derives its selector', () => {
    for (const targetPath of CANONICAL_FOUNDATION_DOCUMENTS) {
      const sources = foundationAuthoringSources(targetPath)
      expect(new Set(sources.map(source => source.path)).size).toBe(sources.length)

      for (const source of sources) {
        const upstream = getGameDocumentContract(source.path)
        const validBlocks = new Set([
          ...upstream.sections.map(section => section.sectionId),
          ...upstream.productionMaterials.map(material => `material.${material.materialId}`),
        ])
        const declaredBlocks = source.blocks.map(block => block.ownerBlock)
        expect(declaredBlocks).toEqual([...source.sectionIds])
        expect(new Set(declaredBlocks).size).toBe(declaredBlocks.length)
        for (const declared of source.blocks) {
          expect(validBlocks.has(declared.ownerBlock)).toBe(true)
          expect(declared.purpose.trim().length).toBeGreaterThan(0)
        }
      }
    }
    // Audio consumes the committed Technical delivery-mode decision.
    expect(foundationAuthoringSources('docs/AUDIO_DESIGN.md').map(source => source.path))
      .toContain('docs/TECHNICAL_DESIGN.md')
  })

  test('offline arithmetic and duplicate fixtures retain realistic boundary distinctions', () => {
    // This fixture mirrors the kind of Level evidence that was confused in a
    // generated document: coordinate span is not a path-distance label.
    const levelSnippet = 'S1 endpoints x=-96..800; authored path distance=896'
    const endpointMatch = /x=(-?\d+)\.\.(-?\d+)/.exec(levelSnippet)
    const distanceMatch = /path distance=(\d+)/.exec(levelSnippet)
    expect(endpointMatch).not.toBeNull()
    expect(distanceMatch).not.toBeNull()
    const coordinateSpan = Number(endpointMatch![2]) - Number(endpointMatch![1])
    expect(coordinateSpan).toBe(Number(distanceMatch![1]))

    // A wave timing result must retain the final-spawn offset and travel time
    // as separate terms; this is a fixture calculation, not a document gate.
    const waveSnippet = 'W5 last spawn=12.8s; path=1860u; speed=34u/s'
    const wave = /last spawn=(\d+(?:\.\d+)?)s; path=(\d+)u; speed=(\d+)u\/s/.exec(waveSnippet)
    expect(wave).not.toBeNull()
    expect(Number(wave![1]) + Number(wave![2]) / Number(wave![3])).toBeCloseTo(67.505882, 5)

    // Duplicate IDs are a declaration pitfall worth detecting offline. The
    // production projector remains unchanged and does not reject this here.
    const duplicateFixture = ['B04', 'B06', 'B04']
    expect(new Set(duplicateFixture).size).not.toBe(duplicateFixture.length)
    const declaredIds = foundationAuthoringSources('docs/LEVEL_SCENE_DESIGN.md')
      .flatMap(source => source.sectionIds)
    expect(new Set(declaredIds).size).toBe(declaredIds.length)
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
          'material.pacing-beat-table',
          'pacing_beats',
          'material.world-structure-diagram',
          'material.route-choice-diagram',
        ],
      }),
    ])
  })
})
