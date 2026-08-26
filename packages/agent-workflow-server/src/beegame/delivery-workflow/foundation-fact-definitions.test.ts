import { describe, expect, test } from 'bun:test'
import {
  FOUNDATION_FACT_CATALOG,
  FOUNDATION_FACT_CATALOG_VERSION,
  foundationFactDefinition,
} from './foundation-fact-definitions'
import { GAME_DOCUMENT_CONTRACTS } from './game-document-contracts'

describe('normalized foundation fact catalog', () => {
  test('is a versioned closed catalog of exactly the 25 service-owned keys', () => {
    expect(FOUNDATION_FACT_CATALOG_VERSION).toBe('foundation-facts.v2')
    expect(FOUNDATION_FACT_CATALOG).toHaveLength(25)
    expect(new Set(FOUNDATION_FACT_CATALOG.map(item => item.key)).size).toBe(25)
    expect(FOUNDATION_FACT_CATALOG.map(item => item.key)).toEqual([
      'game.players.max',
      'game.boss.count',
      'game.mechanics',
      'game.resources',
      'game.states',
      'game.win_conditions',
      'game.loss_conditions',
      'game.platform',
      'level.required_entities',
      'level.required_assets',
      'level.complexity_budget',
      'balance.entity_ids',
      'balance.variable_ids',
      'technical.supported_actions',
      'technical.target_fps',
      'technical.content_kinds',
      'art.style_constraints',
      'ui.supported_actions',
      'ui.displayed_resources',
      'audio.event_ids',
      'asset.inventory_ids',
      'asset.covered_level_requirements',
      'asset.boss.count',
      'asset.art_constraint_refs',
      'asset.formats',
    ])
  })

  test('records ownership, policy, extraction, authority, and consumers for every key', () => {
    for (const definition of FOUNDATION_FACT_CATALOG) {
      expect(definition.owner.documentPath).toMatch(/^docs\/.+\.md$/)
      expect(definition.owner.sectionId).toMatch(/^[a-z0-9._-]+$/)
      expect(['string', 'number', 'boolean', 'string[]', 'number[]']).toContain(
        definition.valueType,
      )
      expect(['required', 'optional']).toContain(definition.presence)
      expect(['receipt_only', 'semantic_clarification', 'schema_issue']).toContain(
        definition.uncertainPolicy,
      )
      expect(['receipt_only', 'schema_issue', 'semantic_clarification']).toContain(
        definition.absentPolicy,
      )
      expect(['mechanical', 'model_if_unresolved']).toContain(
        definition.resolution,
      )
      expect(definition.extractionInstruction.length).toBeGreaterThan(10)
      expect(definition.sourceOfTruthDirection.length).toBeGreaterThan(0)
      expect(
        definition.consumers.length > 0 || definition.acceptanceOnlyRole,
      ).toBe(true)
    }
  })

  test('pins the two corrected ownership mappings', () => {
    expect(foundationFactDefinition('art.style_constraints')?.owner).toEqual({
      documentPath: 'docs/ART_DIRECTION.md',
      sectionId: 'visual_pillars',
    })
    expect(foundationFactDefinition('asset.art_constraint_refs')?.owner).toEqual({
      documentPath: 'docs/ASSET_PLAN.md',
      sectionId: 'dependencies',
    })
  })

  test('defines semantic labels for level assets and shared resource facts', () => {
    expect(foundationFactDefinition('level.required_assets')?.extractionInstruction)
      .toContain('natural-language')
    expect(foundationFactDefinition('level.required_assets')?.extractionInstruction)
      .toContain('physical asset IDs')
    for (const key of ['game.resources', 'ui.displayed_resources'] as const) {
      const instruction = foundationFactDefinition(key)?.extractionInstruction
      expect(instruction).toContain('same canonical short labels')
      expect(instruction).toContain('parenthetical')
      expect(instruction).toContain('health pool')
    }
  })

  test('uses one canonical player-facing action namespace across GDD and Technical', () => {
    const mechanicsInstruction = foundationFactDefinition('game.mechanics')?.extractionInstruction
    const technicalActionsInstruction = foundationFactDefinition('technical.supported_actions')?.extractionInstruction
    const gddPurpose = GAME_DOCUMENT_CONTRACTS['docs/GDD.md'].sections.find(section => section.sectionId === 'player_actions')?.purpose
    const technicalPurpose = GAME_DOCUMENT_CONTRACTS['docs/TECHNICAL_DESIGN.md'].sections.find(section => section.sectionId === 'input_interaction')?.purpose

    expect(mechanicsInstruction).toContain('GDD player_actions')
    expect(mechanicsInstruction).toContain('canonical player-facing action/mechanic labels')
    expect(technicalActionsInstruction).toContain('same GDD-owned player-action labels')
    expect(technicalActionsInstruction).toContain('runtime ACTION codes')
    expect(technicalActionsInstruction).toContain('mapping table')
    expect(technicalActionsInstruction).toContain('never extract the ACTION codes')
    expect(gddPurpose).toContain('canonical player-facing action/mechanic labels')
    expect(technicalPurpose).toContain('same canonical player-action labels')
    expect(technicalPurpose).toContain('runtime ACTION code')
    expect(technicalPurpose).toContain('independent mapping column')
  })
})
