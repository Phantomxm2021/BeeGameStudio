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

function emptyInventory(packet: ReturnType<typeof projectionPacket>) {
  const body = {
    schemaVersion: 'game-ir-semantic-obligation-inventory.v1',
    moduleId: packet.source.moduleId,
    sourceDigest: packet.source.sourceDigest,
    obligations: [],
    index: {},
  }
  return { ...body, digest: digestGameIrValue(body) }
}

function projectionPacket(sliceId = 'gameplay.slice.0') {
  const compileRequest = {
    taskId: 'authority-task',
    foundation: {
      foundationRevision: 'foundation-revision',
      receiptDigest: 'r'.repeat(64),
    },
  }
  const moduleId = sliceId.slice(0, sliceId.indexOf('.slice')) as (typeof GAME_IR_DOMAIN_IDS)[number]
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
  const unselectedSection = {
    documentPath: 'docs/GDD.md' as const,
    sectionId: 'scope_risks',
    heading: 'scope_risks',
    startLine: 1,
    endLine: 1,
    digest: createHash('sha256').update('UNSELECTED_AUTHORITY').digest('hex'),
  }
  sectionIndex.push(unselectedSection)
  const sectionBytesWithUnselected = {
    ...sectionBytes,
    [`${unselectedSection.documentPath}#${unselectedSection.sectionId}`]:
      'UNSELECTED_AUTHORITY',
  }
  return {
    schemaVersion: 'game-ir-projection-operation-packet.v1',
    packetDigest: 'p'.repeat(64),
    source: {
      schemaVersion: 'game-ir-domain-source.v1',
      taskId: compileRequest.taskId,
      moduleId,
      compileRequest,
      authoritySectionIndex: sectionIndex,
      sectionIndex,
      sectionBytes: sectionBytesWithUnselected,
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
    sliceId?: string
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
      admittedCurrentNodes: Array<{ id: string; kind: string }>
    }
  } = {},
) {
  const context = options.context ?? {
    availablePriorNodes: [],
    requiredCurrentNodes: [],
    admittedCurrentNodes: [],
  }
  const sliceId = options.sliceId ?? packet.source.moduleId + '.slice.0'
  const moduleId = packet.source.moduleId as (typeof GAME_IR_DOMAIN_IDS)[number]
  return buildGameIrProjectionSliceAuthority({
    packet: packet as never,
    slice: deriveProjectionSlicePlan(moduleId).slices.find(
      slice => slice.sliceId === sliceId,
    )!,
    sliceContext: context,
    obligationInventory: emptyInventory(packet) as never,
    ...(options.retryDiagnostic
      ? { retryDiagnostic: options.retryDiagnostic }
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
    const selectedKeys = new Set(
      sourceSectionsForGameIrProjectionSlice('gameplay.slice.0').map(
        selector => `${selector.documentPath}#${selector.sectionId}`,
      ),
    )
    expect(authority.sourceFragments).toEqual(
      catalog.fragments.filter(fragment =>
        selectedKeys.has(`${fragment.documentPath}#${fragment.sectionId}`),
      ).map(fragment => ({
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
    expect(catalog.fragments).toContainEqual({
      fragmentId: `e${packet.source.sectionIndex.length - 1}.0`,
      documentPath: 'docs/GDD.md',
      sectionId: 'scope_risks',
      excerpt: 'UNSELECTED_AUTHORITY',
    })
    expect(authority.sourceFragments).not.toContainEqual(
      expect.objectContaining({ sectionId: 'scope_risks' }),
    )
  })

  test('rejects stale compile and Foundation receipt digests and stale selected bytes', () => {
    const packet = projectionPacket()
    const slice = deriveProjectionSlicePlan('gameplay').slices[0]!
    const context = { availablePriorNodes: [], requiredCurrentNodes: [], admittedCurrentNodes: [] }
    expect(() =>
      buildGameIrProjectionSliceAuthority({
        packet: packet as never,
        slice,
        sliceContext: context,
        obligationInventory: emptyInventory(packet) as never,
        compileRequestDigest: 'c'.repeat(64),
      }),
    ).toThrow(/compile request digest is stale/)
    expect(() =>
      buildGameIrProjectionSliceAuthority({
        packet: packet as never,
        slice,
        sliceContext: context,
        obligationInventory: emptyInventory(packet) as never,
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
        obligationInventory: emptyInventory(stale) as never,
      }),
    ).toThrow(/source bytes are stale/)
  })

  test('renders byte-identical Markdown for equivalent canonical authority input', () => {
    const first = authorityFor(projectionPacket('gameplay.slice.1'), {
      sliceId: 'gameplay.slice.1',
      context: {
        availablePriorNodes: [
          {
            id: 'prior-event',
            kind: 'gameplay.event',
            value: { metadata: { z: 2, a: 1 }, label: 'Event' },
          },
        ],
        requiredCurrentNodes: [],
        admittedCurrentNodes: [],
      },
    })
    const second = authorityFor(projectionPacket('gameplay.slice.1'), {
      sliceId: 'gameplay.slice.1',
      context: {
        availablePriorNodes: [
          {
            id: 'prior-event',
            kind: 'gameplay.event',
            value: { label: 'Event', metadata: { a: 1, z: 2 } },
          },
        ],
        requiredCurrentNodes: [],
        admittedCurrentNodes: [],
      },
    })
    expect(renderGameIrProjectionSliceAuthority(first)).toBe(
      renderGameIrProjectionSliceAuthority(second),
    )
    expect(renderGameIrProjectionSliceAuthority(first)).toContain(
      '## Output contract',
    )
  })

  test('renders Balance reference policy from the domain manifest', () => {
    const authority = authorityFor(projectionPacket('balance.slice.3'), {
      sliceId: 'balance.slice.3',
    })
    const rendered = renderGameIrProjectionSliceAuthority(authority)
    expect(rendered).toContain('reference policy')
    expect(rendered).toContain('exact-edge-targets')
    expect(rendered).not.toContain('balance.progression-curve')
  })

  test('renders Balance unit index policy from the domain manifest', () => {
    const authority = authorityFor(projectionPacket('balance.slice.0'), {
      sliceId: 'balance.slice.0',
    })
    const rendered = renderGameIrProjectionSliceAuthority(authority)
    expect(rendered).toContain('exact-single-index-reference')
    expect(rendered).toContain('exactly-one')
    expect(rendered).toContain('unitReferenceIndex')
    expect(rendered).toContain('balance.unit')
    expect(rendered).toContain('requiredIndex')
  })

  test('renders the recursive Balance formula index policy from the domain manifest', () => {
    const authority = authorityFor(projectionPacket('balance.slice.1'), {
      sliceId: 'balance.slice.1',
    })
    const rendered = renderGameIrProjectionSliceAuthority(authority)
    expect(rendered).toContain('formula-indexed-references')
    expect(rendered).toContain('value.outputUnitReferenceIndex')
    expect(rendered).toContain('value.expression.literal.unitReferenceIndex')
    expect(rendered).toContain('value.expression.reference.referenceIndex')
    expect(rendered).toContain('consumesEveryReference')
  })

  test('narrows record retries to the failed fragment while retaining direct context and admitted prefix', () => {
    const packet = projectionPacket('gameplay.slice.1')
    const authority = authorityFor(packet, {
      sliceId: 'gameplay.slice.1',
      context: {
        availablePriorNodes: [
          { id: 'prior-state', kind: 'gameplay.state', value: { label: 'Start' } },
        ],
        requiredCurrentNodes: [{ id: 'current-state', kind: 'gameplay.state' }],
        admittedCurrentNodes: [{ id: 'admitted-state', kind: 'gameplay.state' }],
      },
      retryDiagnostic: {
        scope: 'record',
        sliceId: 'gameplay.slice.1',
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

  test('cannot override the admitted prefix outside the normalized context', () => {
    const packet = projectionPacket('gameplay.slice.1')
    const authority = buildGameIrProjectionSliceAuthority({
      packet: packet as never,
      slice: deriveProjectionSlicePlan('gameplay').slices[1]!,
      sliceContext: {
        availablePriorNodes: [],
        requiredCurrentNodes: [],
        admittedCurrentNodes: [
          { id: 'context-prefix', kind: 'gameplay.action' },
        ],
      },
      obligationInventory: emptyInventory(packet) as never,
      admittedCurrentNodes: [
        { id: 'forged-prefix', kind: 'gameplay.action' },
      ],
    } as never)
    expect(authority.admittedCurrentNodes).toEqual([
      { id: 'context-prefix', kind: 'gameplay.action' },
    ])
  })

  test('keeps direct prior dependencies and excludes irrelevant prior nodes', () => {
    const authority = authorityFor(projectionPacket('balance.slice.1'), {
      sliceId: 'balance.slice.1',
      context: {
        availablePriorNodes: [
          {
            id: 'direct-parameter',
            kind: 'balance.parameter',
            value: { label: 'Direct' },
          },
          {
            id: 'irrelevant-progression',
            kind: 'balance.progression-curve',
            value: { label: 'Irrelevant' },
          },
        ],
        requiredCurrentNodes: [],
        admittedCurrentNodes: [],
      },
    })
    expect(authority.availablePriorNodes.map(node => node.id)).toEqual([
      'direct-parameter',
    ])
  })

  test('does not freeze caller-owned context while freezing the authority', () => {
    const context = {
      availablePriorNodes: [
        { id: 'prior-state', kind: 'gameplay.state', value: { label: 'Start' } },
      ],
      requiredCurrentNodes: [],
      admittedCurrentNodes: [],
    }
    authorityFor(projectionPacket(), { context })
    expect(Object.isFrozen(context)).toBe(false)
    expect(Object.isFrozen(context.availablePriorNodes)).toBe(false)
    expect(Object.isFrozen(context.availablePriorNodes[0])).toBe(false)
    expect(Object.isFrozen(context.availablePriorNodes[0]!.value)).toBe(false)
  })
})
