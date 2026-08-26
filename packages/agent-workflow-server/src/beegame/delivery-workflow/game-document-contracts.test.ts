import { describe, expect, test } from 'bun:test'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import {
  GAME_DOCUMENT_CONTRACTS,
  GAME_DOCUMENT_RESPONSIBILITIES,
  getGameDocumentContract,
} from './game-document-contracts'

describe('complete game document contracts', () => {
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

  test('makes every section and production material decision-dense by contract', () => {
    for (const contract of Object.values(GAME_DOCUMENT_CONTRACTS)) {
      expect(contract.outputPolicy).toEqual({
        sectionStyle: 'final_owned_decisions',
        executiveSummaryStyle: 'authority_index',
        productionMaterialStyle: 'derived_compact_views',
        derivedViewAuthority: 'owner_references_only',
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
    for (const materialId of [
      'visual-pillar-board',
      'palette-board',
      'silhouette-scale-board',
    ]) {
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
    expect(audioPurpose('production')).toContain('never mark available upstream as unavailable')

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
