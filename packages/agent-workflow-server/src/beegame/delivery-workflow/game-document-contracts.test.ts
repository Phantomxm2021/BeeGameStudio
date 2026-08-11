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
})
