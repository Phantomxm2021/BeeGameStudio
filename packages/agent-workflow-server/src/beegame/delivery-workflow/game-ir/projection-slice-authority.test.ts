import { describe, expect, test } from 'bun:test'
import {
  GAME_IR_DOMAIN_IDS,
  GAME_IR_MODULE_SOURCE_DOCUMENTS,
} from './domain-source'
import { deriveProjectionSlicePlan } from './projection-slices'
import { sourceSectionsForGameIrProjectionSlice } from './projection-slice-authority'
import { getGameDocumentContract } from '../game-document-contracts'

describe('Game IR projection slice authority source scope', () => {
  test('selects unique contract sections for every current slice', () => {
    for (const moduleId of GAME_IR_DOMAIN_IDS) {
      for (const slice of deriveProjectionSlicePlan(moduleId).slices) {
        const selectors = sourceSectionsForGameIrProjectionSlice(slice.sliceId)
        expect(selectors.length).toBeGreaterThan(0)
        expect(
          new Set(
            selectors.map(item => `${item.documentPath}#${item.sectionId}`),
          ).size,
        ).toBe(selectors.length)

        const allowedDocuments = new Set(
          GAME_IR_MODULE_SOURCE_DOCUMENTS[moduleId],
        )
        for (const selector of selectors) {
          expect(allowedDocuments.has(selector.documentPath)).toBe(true)
          const contract = getGameDocumentContract(selector.documentPath)
          expect(
            contract.sections.some(
              section => section.sectionId === selector.sectionId,
            ) ||
              contract.productionMaterials.some(
                material =>
                  material.materialId ===
                  selector.sectionId.replace(/^material\./u, ''),
              ),
          ).toBe(true)
        }
      }
    }
  })

  test('rejects an unknown slice selector', () => {
    expect(() =>
      sourceSectionsForGameIrProjectionSlice('unknown.slice.0'),
    ).toThrow(/slice|selector|unknown/i)
  })
})
