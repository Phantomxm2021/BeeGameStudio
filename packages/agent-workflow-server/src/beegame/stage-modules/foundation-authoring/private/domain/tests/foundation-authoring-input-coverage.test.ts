import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { projectFoundationAuthority } from '../foundation-authority-projection'
import { FOUNDATION_AUTHORING_SOURCE_GROUPS, foundationAuthoringDocumentContract, foundationAuthoringSources } from '../foundation-authoring-contract'
import type { FoundationDocumentPath } from '../types'

// Completed author bodies from d3108, with only a final newline normalized;
// not synthetic facts arranged to fit the selector. These tests exercise
// transport, not gameplay validation.
const fixture = (name: string) => readFileSync(resolve(import.meta.dir, '../../test-fixtures/stage2-authoring', name), 'utf8')
const documents = new Map([
  ['docs/GDD.md' as const, fixture('GDD.md')],
  ['docs/LEVEL_SCENE_DESIGN.md' as const, fixture('LEVEL_SCENE_DESIGN.md')],
])

describe('real Stage 2 upstream coverage', () => {
  test('declared fact owners and every intended consumer share the complete block group', () => {
    const consumers: Record<keyof typeof FOUNDATION_AUTHORING_SOURCE_GROUPS, FoundationDocumentPath[]> = {
      fairness: ['docs/LEVEL_SCENE_DESIGN.md', 'docs/BALANCE_DESIGN.md', 'docs/UI_UX_SPEC.md'],
      waveComposition: ['docs/BALANCE_DESIGN.md', 'docs/TECHNICAL_DESIGN.md', 'docs/ASSET_PLAN.md'],
      interaction: ['docs/TECHNICAL_DESIGN.md', 'docs/AUDIO_DESIGN.md'],
      audioDelivery: ['docs/ASSET_PLAN.md'],
    }
    for (const key of Object.keys(consumers) as Array<keyof typeof consumers>) {
      const group = FOUNDATION_AUTHORING_SOURCE_GROUPS[key]
      const owner = foundationAuthoringDocumentContract(group.path)
      expect(JSON.stringify(owner).split(group.rule)).toHaveLength(2)
      const validOwners = [...owner.sections.map(section => section.sectionId), ...owner.productionMaterials.map(material => `material.${material.materialId}`)]
      for (const target of consumers[key]) {
        const selected = foundationAuthoringSources(target).find(source => source.path === group.path)!
        for (const fact of group.blocks) {
          expect(validOwners).toContain(fact.ownerBlock)
          expect(selected.blocks).toContain(fact)
          expect(selected.sectionIds.filter(id => id === fact.ownerBlock)).toHaveLength(1)
        }
      }
    }
  })

  test('UI receives the GDD fairness requirement without full-document fallback', () => {
    const projection = projectFoundationAuthority({ targetPath: 'docs/UI_UX_SPEC.md', availableUpstreamPaths: ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'], documents })
    expect(projection.sources.every(source => source.selectionScope === 'sections')).toBe(true)
    expect(projection.sources.find(source => source.path === 'docs/GDD.md')!.content).toContain('每波开始前，玩家必须能看到该波的敌人构成预告')
  })

  test('Asset receives actual wave composition, not just beat IDs and derived intensity', () => {
    const projection = projectFoundationAuthority({ targetPath: 'docs/ASSET_PLAN.md', availableUpstreamPaths: ['docs/LEVEL_SCENE_DESIGN.md'], documents })
    const source = projection.sources[0]!
    expect(source.selectionScope).toBe('sections')
    expect(source.content).toContain('| 波次 | 生成组ID | 敌人类型 | 数量 | t0 (s) | 组内间隔 (s) |')
    expect(source.content).toContain('| W4 | G4-4 | 光甲萤火虫 | 3 | 52.0 | 4.5 | 61.0 |')
    expect(source.content.split('| W4 | G4-4 | 光甲萤火虫 | 3 |')).toHaveLength(2)
  })

  test('Audio waits for committed Technical delivery mode while UI remains independent of Balance', () => {
    expect(foundationAuthoringSources('docs/UI_UX_SPEC.md').map(source => source.path)).toEqual(['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'])
    expect(foundationAuthoringSources('docs/AUDIO_DESIGN.md').map(source => source.path)).toEqual(['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md', 'docs/UI_UX_SPEC.md', 'docs/TECHNICAL_DESIGN.md'])
  })
})
