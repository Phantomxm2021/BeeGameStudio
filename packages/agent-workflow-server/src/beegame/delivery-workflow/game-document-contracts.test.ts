import { describe, expect, test } from 'bun:test'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'
import {
  GAME_DOCUMENT_CONTRACTS,
  GAME_DOCUMENT_RESPONSIBILITIES,
  getGameDocumentContract,
} from './game-document-contracts'

describe('complete game document contracts', () => {
  test('composes project documents from the Foundation namespace plus checklist', () => {
    expect(CANONICAL_PROJECT_DOCUMENTS).toEqual([
      ...CANONICAL_FOUNDATION_DOCUMENTS,
      'docs/acceptance/gameplay-checklist.md',
    ])
  })

  test('defines an ordered production contract for every Foundation document', () => {
    expect(Object.keys(GAME_DOCUMENT_CONTRACTS)).toEqual([
      ...CANONICAL_FOUNDATION_DOCUMENTS,
    ])
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      const contract = getGameDocumentContract(path)
      expect(contract.path).toBe(path)
      expect(contract.outputPolicy).not.toHaveProperty('targetMaximumUtf8Bytes')
      expect(contract.sections.length).toBeGreaterThanOrEqual(8)
      expect(
        new Set(contract.sections.map(section => section.sectionId)).size,
      ).toBe(contract.sections.length)
      expect(
        contract.sections.every(
          section =>
            section.title.trim().length > 0 &&
            section.purpose.trim().length > 0 &&
            section.responsibilityIds.length > 0,
        ),
      ).toBe(true)
      expect(
        contract.sections.every(section =>
          ['scenario', 'gate_reference', 'exclude'].includes(section.checklistMode),
        ),
      ).toBe(true)
      expect(
        contract.productionMaterials.every(material =>
          ['scenario', 'gate_reference', 'exclude'].includes(material.checklistMode),
        ),
      ).toBe(true)
    }
  })

  test('covers every human game-development responsibility', () => {
    const covered = new Set(
      Object.values(GAME_DOCUMENT_CONTRACTS).flatMap(contract =>
        contract.sections.flatMap(section => section.responsibilityIds),
      ),
    )
    expect([...covered].sort()).toEqual(
      [...GAME_DOCUMENT_RESPONSIBILITIES].sort(),
    )
  })

  test('keeps upstream authority inside the canonical dependency prefix', () => {
    for (const [index, path] of CANONICAL_FOUNDATION_DOCUMENTS.entries()) {
      const allowed = new Set(CANONICAL_FOUNDATION_DOCUMENTS.slice(0, index))
      expect(
        getGameDocumentContract(path).allowedUpstreamPaths.every(upstream =>
          allowed.has(upstream),
        ),
      ).toBe(true)
    }
  })

  test('binds every document to exact production materials and upstream sections', () => {
    for (const contract of Object.values(GAME_DOCUMENT_CONTRACTS)) {
      expect(contract.productionMaterials.length).toBeGreaterThan(0)
      expect(
        new Set(contract.productionMaterials.map(item => item.materialId)).size,
      ).toBe(contract.productionMaterials.length)
      expect(
        contract.productionMaterials.every(item =>
          [
            'markdown_table',
            'mermaid',
            'inline_svg',
            'evidence_register',
          ].includes(item.format),
        ),
      ).toBe(true)
      expect(contract.upstreamSections.map(item => item.path)).toEqual([
        ...contract.allowedUpstreamPaths,
      ])
      for (const projection of contract.upstreamSections) {
        const upstream = getGameDocumentContract(projection.path)
        expect(projection.sectionIds.length).toBeGreaterThan(0)
        expect(new Set(projection.sectionIds).size).toBe(
          projection.sectionIds.length,
        )
        expect(
          projection.sectionIds.every(id =>
            upstream.sections.some(section => section.sectionId === id),
          ),
        ).toBe(true)
      }
    }
    expect(
      getGameDocumentContract('docs/ASSET_PLAN.md').productionMaterials.find(
        item => item.materialId === 'license-register',
      )?.format,
    ).toBe('evidence_register')
    expect(
      getGameDocumentContract('docs/ASSET_PLAN.md').productionMaterials.find(
        item => item.materialId === 'license-register',
      )?.serialization,
    ).toBe('markdown_table')
  })

  test('projects only the upstream owner sections each downstream discipline consumes', () => {
    const expected: Record<
      FoundationDocumentPath,
      Array<[FoundationDocumentPath, string[]]>
    > = {
      'docs/GDD.md': [],
      'docs/LEVEL_SCENE_DESIGN.md': [
        ['docs/GDD.md', ['experience_pillars', 'core_loop', 'player_actions', 'rules_systems', 'states_flow', 'progression', 'content_narrative', 'challenge_recovery', 'accessibility_localization', 'scope_risks']],
      ],
      'docs/BALANCE_DESIGN.md': [
        ['docs/GDD.md', ['core_loop', 'rules_systems', 'states_flow', 'progression', 'challenge_recovery', 'metrics']],
        ['docs/LEVEL_SCENE_DESIGN.md', ['world_structure', 'level_sequence', 'objectives_routes', 'pacing_beats', 'encounters', 'spawn_checkpoint', 'content_matrix']],
      ],
      'docs/TECHNICAL_DESIGN.md': [
        ['docs/GDD.md', ['player_actions', 'rules_systems', 'states_flow', 'accessibility_localization', 'metrics', 'scope_risks']],
        ['docs/LEVEL_SCENE_DESIGN.md', ['world_structure', 'spawn_checkpoint', 'camera_readability', 'scene_states', 'content_matrix']],
        ['docs/BALANCE_DESIGN.md', ['units_variables', 'formulas', 'bounds_exploits']],
      ],
      'docs/ART_DIRECTION.md': [
        ['docs/GDD.md', ['experience_pillars', 'rules_systems', 'content_narrative', 'accessibility_localization']],
        ['docs/LEVEL_SCENE_DESIGN.md', ['world_structure', 'camera_readability', 'content_matrix']],
      ],
      'docs/UI_UX_SPEC.md': [
        ['docs/GDD.md', ['core_loop', 'player_actions', 'rules_systems', 'states_flow', 'challenge_recovery', 'accessibility_localization', 'content_narrative']],
        ['docs/LEVEL_SCENE_DESIGN.md', ['objectives_routes', 'pacing_beats', 'spawn_checkpoint', 'camera_readability', 'scene_states']],
      ],
      'docs/AUDIO_DESIGN.md': [
        ['docs/GDD.md', ['experience_pillars', 'core_loop', 'rules_systems', 'states_flow', 'content_narrative', 'accessibility_localization']],
        ['docs/LEVEL_SCENE_DESIGN.md', ['world_structure', 'pacing_beats', 'encounters', 'scene_states']],
        ['docs/UI_UX_SPEC.md', ['feedback_errors', 'accessibility']],
      ],
      'docs/ASSET_PLAN.md': [
        ['docs/GDD.md', ['scope_risks']],
        ['docs/LEVEL_SCENE_DESIGN.md', ['content_matrix']],
        ['docs/TECHNICAL_DESIGN.md', ['data_content', 'performance', 'build_release']],
        ['docs/ART_DIRECTION.md', ['asset_specifications']],
        ['docs/UI_UX_SPEC.md', ['screen_inventory', 'localization']],
        ['docs/AUDIO_DESIGN.md', ['implementation']],
      ],
    }

    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      expect(
        getGameDocumentContract(path).upstreamSections.map(source => [
          source.path,
          [...source.sectionIds],
        ]),
      ).toEqual(expected[path])
    }
  })

  test('exposes the closed owner-only material catalog in canonical order', () => {
    const expected = {
      'docs/GDD.md': {
        'core-loop-diagram': 'owner',
        'game-state-flow': 'owner',
      },
      'docs/LEVEL_SCENE_DESIGN.md': {
        'world-structure-diagram': 'owner',
        'route-choice-diagram': 'owner',
        'pacing-beat-table': 'owner',
      },
      'docs/BALANCE_DESIGN.md': {
        'variable-parameter-table': 'owner',
      },
      'docs/TECHNICAL_DESIGN.md': {
        'architecture-diagram': 'owner',
        'data-flow-diagram': 'owner',
        'runtime-lifecycle-diagram': 'owner',
        'save-recovery-table': 'owner',
      },
      'docs/ART_DIRECTION.md': {
        'visual-language-board': 'owner',
        'animation-vfx-state-table': 'owner',
      },
      'docs/UI_UX_SPEC.md': {
        'information-architecture-diagram': 'owner',
        'player-flow-diagram': 'owner',
        'screen-state-table': 'owner',
        'wireframe-board': 'owner',
        'focus-accessibility-matrix': 'owner',
      },
      'docs/AUDIO_DESIGN.md': {
        'event-cue-matrix': 'owner',
        'music-state-diagram': 'owner',
        'bus-ducking-diagram': 'owner',
        'loudness-delivery-table': 'owner',
      },
      'docs/ASSET_PLAN.md': {
        'asset-inventory-table': 'owner',
        'responsibility-matrix': 'owner',
        'dependency-integration-diagram': 'owner',
        'license-register': 'owner',
        'milestone-maturity-table': 'owner',
      },
    } as const

    for (const [path, materialAuthority] of Object.entries(expected)) {
      const materials = getGameDocumentContract(path as keyof typeof expected).productionMaterials
      expect(Object.fromEntries(materials.map(material => [material.materialId, 'owner']))).toEqual(materialAuthority)
      expect(materials.map(material => material.materialId)).toEqual(Object.keys(materialAuthority))
      expect(materials.every(material => material.authorityRule.trim().length > 0)).toBe(true)
      expect(materials.every(material => material.authorityRule.startsWith('Own '))).toBe(true)
      expect(materials.every(material => !Object.hasOwn(material, 'authorityMode'))).toBe(true)
      expect(JSON.stringify(materials)).not.toContain('reference_only')
    }
    expect(getGameDocumentContract('docs/ART_DIRECTION.md').productionMaterials.map(material => material.materialId)).toEqual([
      'visual-language-board',
      'animation-vfx-state-table',
    ])
  })

  test('keeps Balance production materials to the sole variable-parameter owner without reference projections', () => {
    const materials = getGameDocumentContract('docs/BALANCE_DESIGN.md').productionMaterials

    expect(materials.map(material => material.materialId)).toEqual([
      'variable-parameter-table',
    ])
    expect(materials.every(material =>
      !Object.hasOwn(material, 'referenceOwnerIds') &&
      !Object.hasOwn(material, 'referenceSources'),
    )).toBe(true)
  })

  test('removes the obsolete global derived-view output policy fields', () => {
    for (const contract of Object.values(GAME_DOCUMENT_CONTRACTS)) {
      expect(contract.outputPolicy).not.toHaveProperty('productionMaterialStyle')
      expect(contract.outputPolicy).not.toHaveProperty('derivedViewAuthority')
      expect(JSON.stringify(contract)).not.toContain('reference_only')
      expect(JSON.stringify(contract)).not.toContain('derivedViewAuthority')
      expect(JSON.stringify(contract)).not.toContain('derived views')
      expect(JSON.stringify(contract)).not.toContain('derived view')
    }
  })

  test('keeps the GDD production material set focused on unique authorities', () => {
    const gdd = getGameDocumentContract('docs/GDD.md')
    expect(gdd.productionMaterials.map(item => item.materialId)).toEqual([
      'core-loop-diagram',
      'game-state-flow',
    ])
    expect(gdd.productionMaterials.map(item => item.purpose)).toEqual([
      'Compact, inspectable loop evidence owning core_loop decisions and their entry, exit and reward conditions.',
      'Compact, inspectable state-transition evidence owning states_flow decisions and recovery paths.',
    ])
  })

  test('declares one executable merge/reference rule for every foundation document', () => {
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      const contract = getGameDocumentContract(path)
      const rule = contract.mergeReferenceRule
      expect(rule.trim()).toContain('Merge')
      expect(rule.trim().length).toBeGreaterThan(40)
      expect(rule.trim()).not.toContain('reference-only')
    }
  })

  test('keeps merge rules document-level instead of duplicating material authority', () => {
    for (const contract of Object.values(GAME_DOCUMENT_CONTRACTS)) {
      for (const material of contract.productionMaterials)
        expect(contract.mergeReferenceRule).not.toContain(material.materialId)
    }
  })

  test('assigns production resource facts only to Asset Plan', () => {
    const art = getGameDocumentContract('docs/ART_DIRECTION.md')
    const audio = getGameDocumentContract('docs/AUDIO_DESIGN.md')
    expect(art.sections.find(section => section.sectionId === 'pipeline_risks')?.purpose).toContain('reference Asset Plan')
    expect(audio.sections.find(section => section.sectionId === 'production')?.purpose).toContain('Asset Plan owns')
    expect(art.sections.find(section => section.sectionId === 'asset_specifications')?.purpose).toContain('Asset Plan')
    expect(audio.sections.find(section => section.sectionId === 'production')?.purpose).toContain('Asset Plan')
  })

  test('separates Balance global variables from entity and action parameters', () => {
    const balance = getGameDocumentContract('docs/BALANCE_DESIGN.md')
    const variables = balance.sections.find(section => section.sectionId === 'units_variables')!
    const entities = balance.sections.find(section => section.sectionId === 'entity_parameters')!
    const variableMaterial = balance.productionMaterials.find(material => material.materialId === 'variable-parameter-table')!

    expect(variables.purpose).toContain('unit')
    expect(variables.purpose).toContain('variable semantics')
    expect(variables.purpose).not.toContain('values')
    expect(variables.purpose).not.toContain('ranges')
    expect(entities.purpose).toContain('parameter semantics')
    expect(entities.purpose).toContain('relationships')
    expect(entities.purpose).not.toContain('numeric values')
    expect(entities.purpose).not.toContain('ranges')
    expect(entities.purpose).toContain('param.*')
    expect(entities.purpose).toContain('entity and action')
    expect(variableMaterial.purpose).toContain('var.*')
    expect(variableMaterial.purpose).toContain('param.*')
    expect(variableMaterial.purpose).toContain('values and ranges')
    expect(variableMaterial.authorityRule).toContain('all numeric')
  })

  test('declares one concise authority rule for each foundation document', () => {
    const expected = {
      'docs/GDD.md': 'Behavior, state and gameplay rules are authoritative here; numeric values only declare Balance ownership and do not create a duplicate parameter table.',
      'docs/LEVEL_SCENE_DESIGN.md': 'One canonical coordinate/layout source owns coordinate, path, slot and trigger literals; other tables and diagrams reference it without duplicating them.',
      'docs/BALANCE_DESIGN.md': 'The variable-parameter-table uniquely owns all numeric `var.*` and `param.*` IDs, units, values and ranges; Units/Variables and Entity/Ability Parameters sections retain only semantic context and relationships, while formulas, economy, progression and tuning facts remain in their owning sections.',
      'docs/TECHNICAL_DESIGN.md': 'Cover runtime and data boundaries only; do not repeat gameplay, write tutorials or include large pseudocode blocks.',
      'docs/ART_DIRECTION.md': 'Own visual language and visual acceptance conditions; Asset Plan owns resource IDs, production responsibility, sourcing, licensing and schedule facts.',
      'docs/UI_UX_SPEC.md': 'One canonical responsive geometry/layout source owns layout; wireframes and flows reference it without repeating the screen-state catalog.',
      'docs/AUDIO_DESIGN.md': 'Audio owns event-to-cue behavior and technical acceptance; Asset Plan owns resource IDs, production responsibility, sourcing, licensing and schedule facts.',
      'docs/ASSET_PLAN.md': 'Asset materials share inventory IDs as their common key while each owns a distinct fact domain: inventory identity and semantic requirement mappings, responsibility, dependency/integration, source/licensing evidence, or milestone/maturity status.',
    } as const

    for (const [path, rule] of Object.entries(expected)) {
      expect((getGameDocumentContract(path as keyof typeof expected) as unknown as Record<string, unknown>).documentAuthorityRule).toBe(rule)
    }
  })

  test('makes every section and production material decision-dense by contract', () => {
    for (const contract of Object.values(GAME_DOCUMENT_CONTRACTS)) {
      expect(contract.outputPolicy).toEqual({
        sectionStyle: 'final_owned_decisions',
        executiveSummaryStyle: 'authority_index',
        mutableFactPolicy: 'single_owner_no_copied_totals',
        workedExamples: 'one_per_distinct_boundary',
        acceptanceScenarios: 'materially_distinct_only',
        nonApplicableDecisions: 'owner_block_once',
        acceptanceEvidence: 'declared_acceptance_owners_only',
        productionMaterialRows: 'distinct_owner_records_only',
      })
    }
  })

  test('requires reproducible balance, spatial, and interface evidence', () => {
    const balance = getGameDocumentContract('docs/BALANCE_DESIGN.md')
    const balancePurpose = (sectionId: string) =>
      balance.sections.find(item => item.sectionId === sectionId)?.purpose
    expect(balancePurpose('units_variables')).toContain('owner inputs')
    expect(balancePurpose('units_variables')).toContain('units')
    expect(balancePurpose('formulas')).toContain('formulas')
    expect(balancePurpose('formulas')).toContain('rounding')
    expect(balancePurpose('formulas')).toContain('boundaries')
    expect(balancePurpose('formulas')).toContain('without copying owner-table numeric inputs')
    for (const sectionId of ['economy', 'progression_curves', 'challenge_model']) {
      expect(balancePurpose(sectionId)).toContain('referencing parameter and formula IDs')
      expect(balancePurpose(sectionId)).toContain('do not copy owner inputs or persist derived totals')
    }
    expect(balancePurpose('tuning_validation')).toContain('validation chain')

    const level = getGameDocumentContract('docs/LEVEL_SCENE_DESIGN.md')
    const levelPurpose = (sectionId: string) =>
      level.sections.find(item => item.sectionId === sectionId)?.purpose
    expect(levelPurpose('world_structure')).toContain('coordinate space')
    expect(levelPurpose('world_structure')).toContain('path')
    expect(levelPurpose('world_structure')).toContain('trigger')
    expect(levelPurpose('world_structure')).toContain('off-screen')
    expect(levelPurpose('objectives_routes')).toContain('path/slot/trigger')
    expect(levelPurpose('objectives_routes')).toContain('mutual exclusion')
    expect(levelPurpose('objectives_routes')).toContain('computable layout evidence')
    expect(levelPurpose('camera_readability')).toContain('coordinate space')
    expect(levelPurpose('camera_readability')).toContain('off-screen')
    expect(levelPurpose('production_acceptance')).toContain('computable layout evidence')

    const ui = getGameDocumentContract('docs/UI_UX_SPEC.md')
    const uiPurpose = (sectionId: string) =>
      ui.sections.find(item => item.sectionId === sectionId)?.purpose
    for (const term of ['minimum viewport', 'safe-area', 'breakpoints', 'compression order']) {
      expect(uiPurpose('experience_architecture')).toContain(term)
    }
    expect(uiPurpose('hud')).toContain('minimum region sizes')
    expect(uiPurpose('input')).toContain('hit/focus evidence')
    expect(uiPurpose('prototype_acceptance')).toContain('overflow/scroll')
    expect(uiPurpose('prototype_acceptance')).toContain('evidence')
  })

  test('requires cross-document visual, audio, and asset authority', () => {
    const art = getGameDocumentContract('docs/ART_DIRECTION.md')
    for (const sectionId of ['composition_readability', 'camera_presentation']) {
      const purpose = art.sections.find(item => item.sectionId === sectionId)?.purpose
      expect(purpose).toContain('Level and UI geometry')
      expect(purpose).toContain('not invent layout dimensions')
    }
    for (const materialId of ['visual-language-board']) {
      const material = art.productionMaterials.find(item => item.materialId === materialId)
      const purpose = material?.purpose
      expect(purpose).toContain('unique visual acceptance evidence')
      expect(material?.format).toBe('markdown_table')
    }

    const audio = getGameDocumentContract('docs/AUDIO_DESIGN.md')
    const audioPurpose = (sectionId: string) =>
      audio.sections.find(item => item.sectionId === sectionId)?.purpose
    expect(audioPurpose('music')).toContain('manual pause')
    expect(audioPurpose('music')).toContain('focus loss')
    expect(audioPurpose('music')).toContain('state mappings')
    expect(audioPurpose('mix')).toContain('mute')
    expect(audioPurpose('mix')).toContain('ducking')
    expect(audioPurpose('production')).toContain('Never mark available upstream as unavailable')

    const asset = getGameDocumentContract('docs/ASSET_PLAN.md')
    const assetPurpose = (sectionId: string) =>
      asset.sections.find(item => item.sectionId === sectionId)?.purpose
    expect(assetPurpose('inventory')).toContain('type, instance and file')
    expect(assetPurpose('formats_budgets')).toContain('file')
    expect(assetPurpose('validation')).toContain('recomputed from unique detail')
    expect(
      asset.productionMaterials.find(item => item.materialId === 'asset-inventory-table')?.purpose,
    ).toContain('type, instance and file')
  })

  test('keeps Asset material authority domains disjoint on their shared inventory key', () => {
    const assetMaterials = Object.fromEntries(
      getGameDocumentContract('docs/ASSET_PLAN.md').productionMaterials.map(material => [
        material.materialId,
        material.authorityRule,
      ]),
    )

    expect(assetMaterials['asset-inventory-table']).toContain('resource identity')
    expect(assetMaterials['asset-inventory-table']).toContain('inventory IDs')
    expect(assetMaterials['asset-inventory-table']).not.toContain('responsibility')
    expect(assetMaterials['asset-inventory-table']).not.toContain('sourcing')
    expect(assetMaterials['asset-inventory-table']).not.toContain('licensing')
    expect(assetMaterials['asset-inventory-table']).not.toContain('milestone')
    expect(assetMaterials['responsibility-matrix']).toContain('creator')
    expect(assetMaterials['responsibility-matrix']).toContain('inventory IDs')
    expect(assetMaterials['responsibility-matrix']).not.toContain('license')
    expect(assetMaterials['dependency-integration-diagram']).toContain('dependency')
    expect(assetMaterials['dependency-integration-diagram']).toContain('inventory IDs')
    expect(assetMaterials['dependency-integration-diagram']).not.toContain('responsibility')
    expect(assetMaterials['license-register']).toContain('license')
    expect(assetMaterials['license-register']).toContain('inventory IDs')
    expect(assetMaterials['license-register']).not.toContain('milestone')
    expect(assetMaterials['milestone-maturity-table']).toContain('capacity')
    expect(assetMaterials['milestone-maturity-table']).toContain('inventory IDs')
    expect(assetMaterials['milestone-maturity-table']).not.toContain('licensing')
  })

})
