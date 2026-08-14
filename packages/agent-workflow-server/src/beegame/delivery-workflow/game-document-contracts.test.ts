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
      expect(contract.outputPolicy.maximumUtf8Bytes).toBe(48_000)
      expect(contract.sections.length).toBeGreaterThanOrEqual(8)
      expect(new Set(contract.sections.map(section => section.sectionId)).size).toBe(
        contract.sections.length,
      )
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
    expect([...covered].sort()).toEqual([...GAME_DOCUMENT_RESPONSIBILITIES].sort())
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
          ['markdown_table', 'mermaid', 'inline_svg', 'evidence_register'].includes(
            item.format,
          ),
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
        maximumUtf8Bytes: 48_000,
        sectionStyle: 'final_owned_decisions',
        productionMaterialStyle: 'canonical_compact_views',
        workedExamples: 'one_per_distinct_boundary',
        acceptanceScenarios: 'materially_distinct_only',
      })
    }
  })
})
