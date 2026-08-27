import { describe, expect, test } from 'bun:test'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
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
      getGameDocumentContract('docs/AUDIO_DESIGN.md').productionMaterials.find(
        item => item.materialId === 'sound-reference-register',
      )?.format,
    ).toBe('evidence_register')
    expect(
      getGameDocumentContract('docs/ASSET_PLAN.md').productionMaterials.find(
        item => item.materialId === 'license-register',
      )?.format,
    ).toBe('evidence_register')
  })

  test('assigns the approved owner and reference-only authority to every material', () => {
    const expected = {
      'docs/GDD.md': {
        'core-loop-diagram': 'reference_only',
        'game-state-flow': 'reference_only',
      },
      'docs/LEVEL_SCENE_DESIGN.md': {
        'world-structure-diagram': 'owner',
        'route-choice-diagram': 'owner',
        'pacing-beat-table': 'owner',
        'scene-transition-diagram': 'reference_only',
      },
      'docs/BALANCE_DESIGN.md': {
        'variable-parameter-table': 'owner',
        'formula-boundary-table': 'reference_only',
        'economy-flow-diagram': 'reference_only',
        'tuning-validation-matrix': 'reference_only',
      },
      'docs/TECHNICAL_DESIGN.md': {
        'architecture-diagram': 'reference_only',
        'data-flow-diagram': 'reference_only',
        'runtime-lifecycle-diagram': 'reference_only',
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
        'sound-reference-register': 'reference_only',
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
      expect(Object.fromEntries(materials.map(material => [material.materialId, material.authorityMode]))).toEqual(materialAuthority)
      expect(materials.every(material => material.authorityRule.trim().length > 0)).toBe(true)
    }
    expect(getGameDocumentContract('docs/ART_DIRECTION.md').productionMaterials.map(material => material.materialId)).toEqual([
      'visual-language-board',
      'animation-vfx-state-table',
    ])
  })

  test('keeps Balance reference-only materials as structural owner-reference views', () => {
    const materials = getGameDocumentContract('docs/BALANCE_DESIGN.md').productionMaterials
      .filter(material => material.authorityMode === 'reference_only')

    expect(materials).toHaveLength(3)
    for (const material of materials) {
      expect(material.purpose).toContain('source-derived owner IDs')
      expect(material.authorityRule).toContain('structural relationships')
      expect(material.authorityRule).toContain('timing')
      expect(material.authorityRule).toContain('steps')
      expect(material.authorityRule).toContain('order')
      expect(material.authorityRule).toContain('ranks')
      expect(material.authorityRule).toContain('counts')
      expect(material.authorityRule).toContain('other owner facts')
      expect(material.authorityRule).toContain('table columns')
    }
  })

  test('removes the obsolete global derived-view output policy fields', () => {
    for (const contract of Object.values(GAME_DOCUMENT_CONTRACTS)) {
      expect(contract.outputPolicy).not.toHaveProperty('productionMaterialStyle')
      expect(contract.outputPolicy).not.toHaveProperty('derivedViewAuthority')
    }
  })

  test('keeps the GDD production material set focused on unique authorities', () => {
    const gdd = getGameDocumentContract('docs/GDD.md')
    expect(gdd.productionMaterials.map(item => item.materialId)).toEqual([
      'core-loop-diagram',
      'game-state-flow',
    ])
    expect(gdd.productionMaterials.map(item => item.purpose)).toEqual([
      'Compact, inspectable loop evidence that references core_loop decisions; do not restate section prose.',
      'Compact, inspectable state-transition evidence that references states_flow decisions; do not restate section prose.',
    ])
  })

  test('declares one executable merge/reference rule for every foundation document', () => {
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      const contract = getGameDocumentContract(path)
      const rule = contract.mergeReferenceRule
      expect(rule.trim()).toContain('Merge')
      expect(rule.trim().length).toBeGreaterThan(40)
      if (contract.productionMaterials.some(material => material.authorityMode === 'reference_only'))
        expect(rule.trim()).toContain('reference-only')
      else expect(rule.trim()).not.toContain('reference-only')
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

  test('requires balance derived materials to reference owner variables and formulas', () => {
    const balance = getGameDocumentContract('docs/BALANCE_DESIGN.md')
    for (const materialId of ['formula-boundary-table', 'economy-flow-diagram', 'tuning-validation-matrix']) {
      const purpose = balance.productionMaterials.find(item => item.materialId === materialId)?.purpose
      expect(purpose?.toLowerCase()).toContain('reference-only')
      expect(purpose?.toLowerCase()).toContain('variables')
      expect(purpose?.toLowerCase()).toContain('formulas')
    }
  })

  test('declares one concise authority rule for each foundation document', () => {
    const expected = {
      'docs/GDD.md': 'Behavior, state and gameplay rules are authoritative here; numeric values only declare Balance ownership and do not create a duplicate parameter table.',
      'docs/LEVEL_SCENE_DESIGN.md': 'One canonical coordinate/layout source owns coordinate, path, slot and trigger literals; other tables and diagrams reference it without duplicating them.',
      'docs/BALANCE_DESIGN.md': 'Variables and formulas own numeric values; explanations and materials reference them without copying results or totals.',
      'docs/TECHNICAL_DESIGN.md': 'Cover runtime and data boundaries only; do not repeat gameplay, write tutorials or include large pseudocode blocks.',
      'docs/ART_DIRECTION.md': 'Own visual language and visual acceptance conditions; Asset Plan owns resource IDs, production responsibility, sourcing, licensing and schedule facts.',
      'docs/UI_UX_SPEC.md': 'One canonical responsive geometry/layout source owns layout; wireframes and flows reference it without repeating the screen-state catalog.',
      'docs/AUDIO_DESIGN.md': 'Audio owns event-to-cue behavior and technical acceptance; Asset Plan owns resource IDs, production responsibility, sourcing, licensing and schedule facts.',
      'docs/ASSET_PLAN.md': 'The inventory uniquely owns semantic IDs, quantity and status; other materials reference IDs without repeating Art/UI/Audio specifications.',
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
    for (const sectionId of ['economy', 'progression_curves', 'challenge_model']) {
      expect(balancePurpose(sectionId)).toContain('recomputable results and totals')
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
      const purpose = art.productionMaterials.find(item => item.materialId === materialId)?.purpose
      expect(purpose).toContain('unique visual acceptance evidence')
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

})
