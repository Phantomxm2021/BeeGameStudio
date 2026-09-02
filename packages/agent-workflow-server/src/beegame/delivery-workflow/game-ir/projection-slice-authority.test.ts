import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  GAME_IR_DOMAIN_IDS,
  GAME_IR_MODULE_SOURCE_DOCUMENTS,
} from './domain-source'
import {
  buildGameIrEvidenceFragmentCatalog,
  deriveProjectionSlicePlan,
} from './projection-slices'
import {
  buildGameIrProjectionSliceAuthority,
  renderGameIrProjectionSliceAuthority,
  sourceSectionsForGameIrProjectionSlice,
} from './projection-slice-authority'
import { digestGameIrValue } from './model'
import { getGameDocumentContract } from '../game-document-contracts'

function projectionPacket(sliceId = 'gameplay.slice.0') {
  const compileRequest = {
    taskId: 'authority-task',
    foundation: {
      foundationRevision: 'foundation-revision',
      receiptDigest: 'r'.repeat(64),
    },
  }
  const selectors = sourceSectionsForGameIrProjectionSlice(sliceId)
  const sectionBytes = Object.fromEntries(
    selectors.map((selector, index) => [
      `${selector.documentPath}#${selector.sectionId}`,
      index === 1 ? 'SECOND_SECTION_A\n\nSECOND_SECTION_B' : `SECTION_${index}`,
    ]),
  )
  const sectionIndex = selectors.map((selector, index) => {
    const text = sectionBytes[`${selector.documentPath}#${selector.sectionId}`]!
    return {
      ...selector,
      heading: selector.sectionId,
      startLine: 1,
      endLine: text.split(/\r?\n/u).length,
      digest: createHash('sha256').update(text).digest('hex'),
    }
  })
  return {
    schemaVersion: 'game-ir-projection-operation-packet.v1',
    packetDigest: 'p'.repeat(64),
    source: {
      schemaVersion: 'game-ir-domain-source.v1',
      taskId: compileRequest.taskId,
      moduleId: 'gameplay',
      compileRequest,
      authoritySectionIndex: sectionIndex,
      sectionIndex,
      sectionBytes,
      sourceDigest: 's'.repeat(64),
    },
    semanticPacket: {},
    projectionContract: { moduleId: 'gameplay', nodes: [], relationships: [], sourceEvidence: {} },
    dependencies: {},
  }
}

function authorityFor(
  packet = projectionPacket(),
  options: {
    retryDiagnostic?: {
      scope: 'record'
      sliceId: string
      recordId: string
      fragmentId: string
      reason: string
    }
    context?: {
      availablePriorNodes: Array<{
        id: string
        kind: string
        value: Record<string, unknown>
      }>
      requiredCurrentNodes: Array<{ id: string; kind: string }>
    }
    admittedCurrentNodes?: Array<{ id: string; kind: string }>
  } = {},
) {
  const context = options.context ?? {
    availablePriorNodes: [],
    requiredCurrentNodes: [],
  }
  const sliceId = packet.source.moduleId + '.slice.0'
  return buildGameIrProjectionSliceAuthority({
    packet: packet as never,
    slice: deriveProjectionSlicePlan('gameplay').slices.find(
      slice => slice.sliceId === sliceId,
    )!,
    sliceContext: context,
    ...(options.retryDiagnostic
      ? { retryDiagnostic: options.retryDiagnostic }
      : {}),
    ...(options.admittedCurrentNodes
      ? { admittedCurrentNodes: options.admittedCurrentNodes }
      : {}),
  })
}

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

  test('uses fragment IDs from the complete source catalog, including non-first sections and blank lines', () => {
    const packet = projectionPacket()
    const catalog = buildGameIrEvidenceFragmentCatalog({
      sectionIndex: packet.source.sectionIndex,
      sectionBytes: packet.source.sectionBytes,
    })
    const authority = authorityFor(packet)
    expect(authority.sourceFragments).toEqual(
      catalog.fragments.map(fragment => ({
        fragmentId: fragment.fragmentId,
        documentPath: fragment.documentPath,
        sectionId: fragment.sectionId,
        text: fragment.excerpt,
      })),
    )
    expect(authority.sourceFragments).toContainEqual({
      fragmentId: 'e1.1',
      documentPath: 'docs/GDD.md',
      sectionId: packet.source.sectionIndex[1]!.sectionId,
      text: 'SECOND_SECTION_B',
    })
  })

  test('rejects stale compile and Foundation receipt digests and stale selected bytes', () => {
    const packet = projectionPacket()
    const slice = deriveProjectionSlicePlan('gameplay').slices[0]!
    const context = { availablePriorNodes: [], requiredCurrentNodes: [] }
    expect(() =>
      buildGameIrProjectionSliceAuthority({
        packet: packet as never,
        slice,
        sliceContext: context,
        compileRequestDigest: 'c'.repeat(64),
      }),
    ).toThrow(/compile request digest is stale/)
    expect(() =>
      buildGameIrProjectionSliceAuthority({
        packet: packet as never,
        slice,
        sliceContext: context,
        foundationReadyReceiptDigest: 'f'.repeat(64),
      }),
    ).toThrow(/Foundation receipt digest is stale/)
    const stale = structuredClone(packet)
    stale.source.sectionBytes[
      `${stale.source.sectionIndex[0]!.documentPath}#${stale.source.sectionIndex[0]!.sectionId}`
    ] = 'STALE'
    expect(() =>
      buildGameIrProjectionSliceAuthority({
        packet: stale as never,
        slice,
        sliceContext: context,
      }),
    ).toThrow(/source bytes are stale/)
  })

  test('renders byte-identical Markdown for equivalent canonical authority input', () => {
    const first = authorityFor(projectionPacket())
    const second = authorityFor(structuredClone(projectionPacket()))
    expect(renderGameIrProjectionSliceAuthority(first)).toBe(
      renderGameIrProjectionSliceAuthority(second),
    )
    expect(renderGameIrProjectionSliceAuthority(first)).toContain(
      '## Output contract',
    )
  })

  test('narrows record retries to the failed fragment while retaining direct context and admitted prefix', () => {
    const packet = projectionPacket()
    const authority = authorityFor(packet, {
      context: {
        availablePriorNodes: [
          { id: 'prior-state', kind: 'gameplay.state', value: { label: 'Start' } },
        ],
        requiredCurrentNodes: [{ id: 'current-state', kind: 'gameplay.state' }],
      },
      admittedCurrentNodes: [{ id: 'admitted-state', kind: 'gameplay.state' }],
      retryDiagnostic: {
        scope: 'record',
        sliceId: 'gameplay.slice.0',
        recordId: 'current-state',
        fragmentId: 'e1.0',
        reason: 'record failed validation',
      },
    })
    const rendered = renderGameIrProjectionSliceAuthority(authority)
    expect(authority.sourceFragments).toHaveLength(1)
    expect(authority.sourceFragments[0]!.fragmentId).toBe('e1.0')
    expect(rendered).toContain('prior-state')
    expect(rendered).toContain('admitted-state')
    expect(rendered).not.toContain('e0.0 —')
  })

  test('does not freeze caller-owned context while freezing the authority', () => {
    const context = {
      availablePriorNodes: [
        { id: 'prior-state', kind: 'gameplay.state', value: { label: 'Start' } },
      ],
      requiredCurrentNodes: [],
    }
    authorityFor(projectionPacket(), { context })
    expect(Object.isFrozen(context)).toBe(false)
    expect(Object.isFrozen(context.availablePriorNodes)).toBe(false)
    expect(Object.isFrozen(context.availablePriorNodes[0])).toBe(false)
    expect(Object.isFrozen(context.availablePriorNodes[0]!.value)).toBe(false)
  })
})
