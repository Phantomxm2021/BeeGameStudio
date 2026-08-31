import { describe, expect, test } from 'bun:test'
import {
  admitImplementationVerificationSemanticResult,
  buildImplementationVerificationSemanticPacket,
  replayImplementationVerificationSemanticReceipt,
  replayImplementationVerificationSemanticResult,
  prepareImplementationVerificationModule,
  type ImplementationVerificationSemanticProjectionAuthority,
} from './implementation-verification-producer'
import { admitGameIrMechanicalProjectionReceipt } from './domain-projection'
import { buildGameIrDomainSourceEnvelope } from './domain-source'
import { digestGameIrValue } from './model'
import { implementationVerificationFixture } from './implementation-verification-test-helpers'
import { realAuthority } from './resource-realization-test-helpers'

function authority(): ImplementationVerificationSemanticProjectionAuthority {
  const phase5 = realAuthority().phase5Authority
  const sectionIndex =
    phase5.phase4Authority.gameplay.source.authoritySectionIndex
  const wanted = new Set([
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
    'docs/TECHNICAL_DESIGN.md',
  ])
  const sectionBytes = Object.fromEntries(
    sectionIndex
      .filter(section => wanted.has(section.documentPath))
      .map(section => {
        const source =
          section.documentPath === 'docs/GDD.md'
            ? phase5.phase4Authority.gameplay.source
            : section.documentPath === 'docs/LEVEL_SCENE_DESIGN.md'
              ? phase5.worldScene.source
              : section.documentPath === 'docs/BALANCE_DESIGN.md'
                ? phase5.phase4Authority.balance.source
                : realAuthority().resourceRealization.source
        return [
          `${section.documentPath}#${section.sectionId}`,
          source.sectionBytes[`${section.documentPath}#${section.sectionId}`]!,
        ]
      }),
  )
  const source = buildGameIrDomainSourceEnvelope({
    moduleId: 'implementation-verification',
    request: phase5.phase4Authority.gameplay.source.compileRequest,
    sectionIndex,
    sectionBytes,
  })
  const body = {
    schemaVersion: 'game-ir-mechanical-projection-receipt.v1' as const,
    taskId: source.taskId,
    moduleId: source.moduleId,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    sourceDigest: source.sourceDigest,
    nodes: [],
    verifiedClaims: [],
    ownedTargets: [],
  }
  return {
    source,
    mechanical: admitGameIrMechanicalProjectionReceipt({
      source,
      receipt: { ...body, receiptDigest: digestGameIrValue(body) },
    }),
  }
}

function validResult(
  current: ImplementationVerificationSemanticProjectionAuthority,
) {
  const packet = buildImplementationVerificationSemanticPacket(current)
  const section = current.source.sectionIndex.find(
    item => item.documentPath === 'docs/TECHNICAL_DESIGN.md',
  )!
  const bytes =
    current.source.sectionBytes[`${section.documentPath}#${section.sectionId}`]!
  const node = {
    id: 'target-main',
    kind: 'implementation-verification.target',
    value: {
      label: 'player-model',
      runtime: 'web',
      platforms: ['desktop'],
      projectRoots: ['assets'],
    },
    references: [],
    edges: [],
  }
  const literal = (pointer: string): string => {
    if (pointer === '/id') return node.id
    let value: unknown = node.value
    for (const part of pointer.slice('/value/'.length).split('/'))
      value = (value as Record<string, unknown>)[part]
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
  const sourceClaims = [
    '/id',
    '/value/label',
    '/value/runtime',
    '/value/platforms/0',
    '/value/projectRoots/0',
  ]
    .map(pointer => {
      const text = literal(pointer)
      const offset = bytes.indexOf(text)
      if (offset < 0) throw new Error(`fixture literal missing: ${text}`)
      const start = Buffer.byteLength(bytes.slice(0, offset), 'utf8')
      return {
        subject: `node:${node.id}#${pointer}`,
        documentPath: section.documentPath,
        sectionId: section.sectionId,
        sourcePointer: `/bytes/${start}/${start + Buffer.byteLength(text, 'utf8')}`,
        literal: text,
      }
    })
    .sort((left, right) => left.subject.localeCompare(right.subject))
  return {
    packet,
    value: { outcome: 'PROJECTED' as const, nodes: [node], sourceClaims },
  }
}

describe('Implementation/Verification semantic producer', () => {
  test('builds the service-owned five-kind packet from the exact source envelope and empty receipt', () => {
    const packet = buildImplementationVerificationSemanticPacket(authority())
    expect(packet.moduleId).toBe('implementation-verification')
    expect(packet.allowedNodeKinds).toHaveLength(5)
    expect(packet.allowedRelationshipTypes).toContain('implements')
    expect(packet.allowedEvidencePointers).toEqual(
      expect.arrayContaining([
        expect.stringContaining('section:docs/GDD.md#'),
        expect.stringContaining('section:docs/LEVEL_SCENE_DESIGN.md#'),
        expect.stringContaining('section:docs/BALANCE_DESIGN.md#'),
        expect.stringContaining('section:docs/TECHNICAL_DESIGN.md#'),
      ]),
    )
    expect(packet.forbiddenTargets).toEqual([])
    expect(Object.isFrozen(packet)).toBe(true)
  })

  test('admits and replays a source-byte-bound semantic receipt', () => {
    const current = authority()
    const fixture = validResult(current)
    const receipt = admitImplementationVerificationSemanticResult(
      current,
      fixture.packet,
      fixture.value,
    )
    expect(receipt.outcome).toBe('PROJECTED')
    if (receipt.outcome !== 'PROJECTED') return
    expect(receipt.moduleId).toBe('implementation-verification')
    expect(receipt.packetDigest).toBe(fixture.packet.packetDigest)
    expect(
      replayImplementationVerificationSemanticReceipt(
        current,
        fixture.packet,
        receipt,
      ),
    ).toEqual(receipt)
  })

  test('rejects caller-owned identity, bindings, and forbidden node fields', () => {
    const current = authority()
    const fixture = validResult(current)
    for (const field of ['moduleId', 'producerMode', 'bindings']) {
      expect(() =>
        admitImplementationVerificationSemanticResult(current, fixture.packet, {
          ...fixture.value,
          nodes: [
            {
              ...fixture.value.nodes[0],
              [field]:
                field === 'moduleId' ? 'implementation-verification' : {},
            },
          ],
        }),
      ).toThrow(/semantic result|unknown|field|node/)
    }
  })

  test('rejects an exact-literal claim whose UTF-8 range is detached', () => {
    const current = authority()
    const fixture = validResult(current)
    const sourceClaims = fixture.value.sourceClaims.map((claim, index) =>
      index === 0 ? { ...claim, sourcePointer: '/bytes/1/2' } : claim,
    )
    expect(() =>
      admitImplementationVerificationSemanticResult(current, fixture.packet, {
        ...fixture.value,
        sourceClaims,
      }),
    ).toThrow(/source literal|byte range|UTF-8|source pointer/)
  })

  test('binds the complete semantic receipt through the one Core admission path', () => {
    const fixture = implementationVerificationFixture()
    const prepared = prepareImplementationVerificationModule({
      source: fixture.authority.source,
      mechanical: fixture.authority.mechanical,
      semantic: fixture.semantic,
      priorModules: fixture.priorModules,
    })
    expect(prepared.module.moduleId).toBe('implementation-verification')
    expect(Object.isFrozen(prepared)).toBe(true)
    expect(Object.isFrozen(prepared.module)).toBe(true)
    expect(prepared.module.nodes).toHaveLength(fixture.nodes.length)
    expect(
      prepared.module.nodes.every(node => node.producerMode === 'semantic'),
    ).toBe(true)
    expect(
      prepared.module.nodes.every(
        node => Object.keys(node.bindings).length > 0,
      ),
    ).toBe(true)
  })

  test('rejects caller-supplied module, bindings, prior closure, and digest fields', () => {
    const fixture = implementationVerificationFixture()
    const input = {
      source: fixture.authority.source,
      mechanical: fixture.authority.mechanical,
      semantic: fixture.semantic,
      priorModules: fixture.priorModules,
    }
    for (const field of ['module', 'bindings', 'priorClosure', 'digest'])
      expect(() =>
        prepareImplementationVerificationModule({
          ...input,
          [field]: {},
        } as never),
      ).toThrow(/module preparation input|unknown|field/)
    expect(() =>
      prepareImplementationVerificationModule({
        ...input,
        priorModules: fixture.priorModules.slice(0, -1),
      }),
    ).toThrow(/prior modules|complete Phase 6 sequence/)
  })

  test('rejects stale and relabelled packets and stale semantic receipt replay', () => {
    const fixture = implementationVerificationFixture()
    const { packetDigest: _packetDigest, ...packetBody } = fixture.packet
    const stalePacketBody = {
      ...packetBody,
      allowedEvidencePointers: [
        ...fixture.packet.allowedEvidencePointers,
        '/caller',
      ],
    }
    const stalePacket = {
      ...stalePacketBody,
      packetDigest: digestGameIrValue(stalePacketBody),
    }
    expect(() =>
      replayImplementationVerificationSemanticReceipt(
        fixture.authority,
        stalePacket as never,
        fixture.semantic,
      ),
    ).toThrow(/packet|stale|authority|field/)

    expect(() =>
      replayImplementationVerificationSemanticReceipt(
        fixture.authority,
        { ...fixture.packet, moduleId: 'resource-realization' } as never,
        fixture.semantic,
      ),
    ).toThrow(/moduleId|allowed|relabel|packet/)

    const { receiptDigest: _receiptDigest, ...receiptBody } = fixture.semantic
    const staleReceiptBody = { ...receiptBody, packetDigest: 'f'.repeat(64) }
    expect(() =>
      replayImplementationVerificationSemanticReceipt(
        fixture.authority,
        fixture.packet,
        {
          ...staleReceiptBody,
          receiptDigest: digestGameIrValue(staleReceiptBody),
        },
      ),
    ).toThrow(/packet|authority|stale|digest/)
  })

  test('rejects hidden, accessor, and symbol packet fields without invoking accessors', () => {
    const current = authority()
    const fixture = validResult(current)
    let invoked = false
    const packetWithAccessor = Object.create(
      Object.getPrototypeOf(fixture.packet),
      Object.fromEntries(
        Reflect.ownKeys(fixture.packet).map(key => {
          const descriptor = Object.getOwnPropertyDescriptor(
            fixture.packet,
            key,
          )!
          return [
            key,
            key === 'allowedNodeKinds'
              ? {
                  configurable: true,
                  enumerable: true,
                  get: () => {
                    invoked = true
                    throw new Error('getter executed')
                  },
                }
              : descriptor,
          ]
        }),
      ),
    )
    Object.defineProperty(packetWithAccessor, Symbol('hidden'), {
      value: true,
      enumerable: true,
    })
    expect(() =>
      admitImplementationVerificationSemanticResult(
        current,
        packetWithAccessor,
        fixture.value,
      ),
    ).toThrow(/hidden|accessor|symbol|field/)
    expect(invoked).toBe(false)
  })

  test('replays structured missing and ambiguous diagnostics and rejects stale ones', () => {
    const current = authority()
    const packet = buildImplementationVerificationSemanticPacket(current)
    const missing = admitImplementationVerificationSemanticResult(
      current,
      packet,
      {
        outcome: 'FAIL',
        reasonCode: 'missing-projection',
        actual: 'none',
        missingSubject: 'node:target-main#/id',
        expectedProjection: 'target identity',
        evidencePointers: [packet.allowedEvidencePointers[0]!],
      },
    )
    expect(missing.outcome).toBe('FAIL')
    expect(
      replayImplementationVerificationSemanticResult(current, packet, missing),
    ).toEqual(missing)
    const ambiguous = admitImplementationVerificationSemanticResult(
      current,
      packet,
      {
        outcome: 'AMBIGUOUS',
        reasonCode: 'ambiguous-projection',
        actual: 'two candidates',
        missingSubject: 'node:target-main#/id',
        expectedProjection: 'one target',
        evidencePointers: [packet.allowedEvidencePointers[0]!],
      },
    )
    expect(ambiguous.outcome).toBe('AMBIGUOUS')
    expect(() =>
      replayImplementationVerificationSemanticResult(current, packet, {
        ...ambiguous,
        diagnosticDigest: 'f'.repeat(64),
      }),
    ).toThrow(/diagnostic.*digest|stale|invalid/)
  })
})
