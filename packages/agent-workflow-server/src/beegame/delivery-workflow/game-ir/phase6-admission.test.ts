import { describe, expect, test } from 'bun:test'
import {
  admitResourceRealizationSemanticResult,
  prepareResourceRealizationSemanticProjectionPacket,
} from './resource-realization-producer'
import {
  admitResourceRealizationSemanticValidationResult,
  prepareResourceRealizationSemanticValidationPacket,
} from './phase6-admission'
import { realAuthority } from './resource-realization.fixtures.test'
import { canonicalGameIrJson, digestGameIrValue } from './model'

function completeResourceInput(
  packet: ReturnType<typeof prepareResourceRealizationSemanticProjectionPacket>,
  sourceBytes: Readonly<Record<string, string>>,
  artifactRuntimeRole = 'player',
) {
  const nodes = [
    {
      id: 'resource.requirement.player-model',
      kind: 'resource-realization.logical-resource',
      value: {
        requirementId: 'player-model',
        resourceKind: 'model',
        runtimeRole: 'player',
      },
      references: [],
      edges: [
        {
          type: 'required-by',
          targetId: 'state-start',
          targetType: 'gameplay.state',
        },
      ],
    },
    {
      id: 'profile-main',
      kind: 'resource-realization.acquisition-profile',
      value: {
        required: true,
        dimensions: ['3D'],
        assetKinds: ['model'],
        usageTags: ['character'],
        capabilities: ['skinned'],
        styles: ['stylized'],
        sourcingPolicy: {
          allowedSourceKinds: ['agent-authored'],
          licenseConstraints: ['project-license'],
          responsibleParty: 'art-team',
          handoffCriteria: ['runtime-import-ready'],
        },
      },
      references: [],
      edges: [
        {
          type: 'describes',
          targetId: 'resource.requirement.player-model',
          targetType: 'resource-realization.logical-resource',
        },
      ],
    },
    {
      id: 'target-main',
      kind: 'resource-realization.delivery-target',
      value: {
        platform: 'desktop',
        runtime: 'web',
        assetFormatCapabilities: ['glb', 'svg'],
      },
      references: [],
      edges: [],
    },
    {
      id: 'variant-main',
      kind: 'resource-realization.variant',
      value: { activation: { kind: 'required' } },
      references: [],
      edges: [
        {
          type: 'realizes',
          targetId: 'resource.requirement.player-model',
          targetType: 'resource-realization.logical-resource',
        },
      ],
    },
    {
      id: 'artifact-main',
      kind: 'resource-realization.delivery-artifact',
      value: {
        artifactClass: 'runtime-resource',
        path: 'assets/runtime/player-model.glb',
        format: 'glb',
        runtimeRole: artifactRuntimeRole,
      },
      references: [],
      edges: [
        {
          type: 'part-of',
          targetId: 'variant-main',
          targetType: 'resource-realization.variant',
        },
      ],
    },
    {
      id: 'profile-screen-main',
      kind: 'resource-realization.acquisition-profile',
      value: {
        required: true,
        dimensions: ['2D'],
        assetKinds: ['ui-screen'],
        usageTags: ['ui'],
        capabilities: ['ui-states'],
        styles: ['stylized'],
        sourcingPolicy: {
          allowedSourceKinds: ['agent-authored'],
          licenseConstraints: ['project-license'],
          responsibleParty: 'art-team',
          handoffCriteria: ['runtime-import-ready'],
        },
      },
      references: [],
      edges: [
        {
          type: 'describes',
          targetId: 'resource.requirement.screen-main',
          targetType: 'resource-realization.logical-resource',
        },
      ],
    },
    {
      id: 'variant-screen-main',
      kind: 'resource-realization.variant',
      value: { activation: { kind: 'required' } },
      references: [],
      edges: [
        {
          type: 'realizes',
          targetId: 'resource.requirement.screen-main',
          targetType: 'resource-realization.logical-resource',
        },
      ],
    },
    {
      id: 'artifact-screen-main',
      kind: 'resource-realization.delivery-artifact',
      value: {
        artifactClass: 'runtime-resource',
        path: 'assets/runtime/screen-main.svg',
        format: 'svg',
        runtimeRole: 'screen',
      },
      references: [],
      edges: [
        {
          type: 'part-of',
          targetId: 'variant-screen-main',
          targetType: 'resource-realization.variant',
        },
      ],
    },
  ] as const
  const section = packet.sourceSections.find(
    item => item.documentPath === 'docs/ASSET_PLAN.md',
  )!
  const bytes = sourceBytes[`${section.documentPath}#${section.sectionId}`]!
  const literal = (node: (typeof nodes)[number], pointer: string): string => {
    if (pointer === '/id') return node.id
    if (pointer.startsWith('/edges/'))
      return canonicalGameIrJson(
        node.edges[Number(pointer.slice('/edges/'.length))],
      )
    let current: unknown = node.value
    for (const part of pointer.slice('/value/'.length).split('/'))
      current = (current as Record<string, unknown>)[part]
    return typeof current === 'string' ? current : canonicalGameIrJson(current)
  }
  const leaves = (value: unknown, pointer: string, output: string[]): void => {
    if (Array.isArray(value))
      value.forEach((item, index) =>
        leaves(item, `${pointer}/${index}`, output),
      )
    else if (value && typeof value === 'object')
      Object.entries(value).forEach(([key, item]) =>
        leaves(item, `${pointer}/${key}`, output),
      )
    else output.push(pointer)
  }
  const pointers = (node: (typeof nodes)[number]) => {
    const output = ['/id']
    const valuePointers: string[] = []
    leaves(node.value, '/value', valuePointers)
    output.push(
      ...valuePointers,
      ...node.edges.map((_, index) => `/edges/${index}`),
    )
    return output
  }
  const claims = nodes
    .flatMap(node =>
      pointers(node).map(pointer => {
        const value = literal(node, pointer)
        const start = bytes.indexOf(value)
        if (start < 0) throw new Error(`fixture literal missing: ${value}`)
        const startBytes = Buffer.byteLength(bytes.slice(0, start), 'utf8')
        return {
          subject: `node:${node.id}#${pointer}`,
          documentPath: section.documentPath,
          sectionId: section.sectionId,
          sourcePointer: `/bytes/${startBytes}/${startBytes + Buffer.byteLength(value, 'utf8')}`,
          literal: value,
        }
      }),
    )
    .sort((left, right) =>
      `${left.subject}\0${left.sourcePointer}\0${left.literal}`.localeCompare(
        `${right.subject}\0${right.sourcePointer}\0${right.literal}`,
      ),
    )
  return { outcome: 'PROJECTED' as const, nodes, sourceClaims: claims }
}

describe('Phase 6 Resource Realization admission', () => {
  test('admits a complete real Resource receipt into an exact fidelity packet', () => {
    const authority = realAuthority()
    const projectionPacket =
      prepareResourceRealizationSemanticProjectionPacket(authority)
    const semantic = admitResourceRealizationSemanticResult(
      authority,
      projectionPacket,
      completeResourceInput(
        projectionPacket,
        authority.resourceRealization.source.sectionBytes,
      ),
    )
    expect(semantic.outcome).toBe('PROJECTED')
    if (semantic.outcome !== 'PROJECTED') return
    const validationAuthority = {
      phase5Authority: authority.phase5Authority,
      resourceRealization: { ...authority.resourceRealization, semantic },
    }
    const packet =
      prepareResourceRealizationSemanticValidationPacket(validationAuthority)
    expect(packet.moduleId).toBe('resource-realization')
    expect(packet.moduleBytes).toContain('resource.requirement.screen-main')
    const result = admitResourceRealizationSemanticValidationResult(
      validationAuthority,
      packet,
      {
        outcome: 'PASS',
        packetDigest: packet.packetDigest,
        checkIds: packet.checkIds,
        coveredTargets: packet.requiredTargets,
      },
    )
    expect(result.outcome).toBe('PASS')
  })

  test('rejects a packet when its source bytes or module bytes are detached', () => {
    const authority = realAuthority()
    const projectionPacket =
      prepareResourceRealizationSemanticProjectionPacket(authority)
    const semantic = admitResourceRealizationSemanticResult(
      authority,
      projectionPacket,
      completeResourceInput(
        projectionPacket,
        authority.resourceRealization.source.sectionBytes,
      ),
    )
    if (semantic.outcome !== 'PROJECTED')
      throw new Error('fixture did not project')
    const validationAuthority = {
      phase5Authority: authority.phase5Authority,
      resourceRealization: { ...authority.resourceRealization, semantic },
    }
    const packet =
      prepareResourceRealizationSemanticValidationPacket(validationAuthority)
    expect(() =>
      admitResourceRealizationSemanticValidationResult(
        validationAuthority,
        { ...packet, moduleBytes: `${packet.moduleBytes} ` },
        {
          outcome: 'PASS',
          packetDigest: packet.packetDigest,
          checkIds: packet.checkIds,
          coveredTargets: packet.requiredTargets,
        },
      ),
    ).toThrow(/stale|detached|authority/)
    expect(() =>
      admitResourceRealizationSemanticValidationResult(
        validationAuthority,
        {
          ...packet,
          sourceSections: packet.sourceSections.map(section => ({
            ...section,
            bytes: `${section.bytes}tampered`,
          })),
        },
        {
          outcome: 'PASS',
          packetDigest: packet.packetDigest,
          checkIds: packet.checkIds,
          coveredTargets: packet.requiredTargets,
        },
      ),
    ).toThrow(/stale|detached|authority/)
    expect(digestGameIrValue(packet.moduleBytes)).toHaveLength(64)
  })

  test('rejects a full-recomputed packet replacement and cross-authority packet', () => {
    const authority = realAuthority()
    const projectionPacket =
      prepareResourceRealizationSemanticProjectionPacket(authority)
    const semantic = admitResourceRealizationSemanticResult(
      authority,
      projectionPacket,
      completeResourceInput(
        projectionPacket,
        authority.resourceRealization.source.sectionBytes,
      ),
    )
    if (semantic.outcome !== 'PROJECTED')
      throw new Error('fixture did not project')
    const validationAuthority = {
      phase5Authority: authority.phase5Authority,
      resourceRealization: { ...authority.resourceRealization, semantic },
    }
    const packet =
      prepareResourceRealizationSemanticValidationPacket(validationAuthority)
    const replacementModule = JSON.parse(packet.moduleBytes) as {
      nodes: Array<{ id: string; value: Record<string, unknown> }>
    }
    const replacementNode = replacementModule.nodes.find(
      node => node.id === 'resource.requirement.player-model',
    )!
    replacementNode.value = { ...replacementNode.value, runtimeRole: 'screen' }
    const replacementBody = {
      ...packet,
      moduleBytes: canonicalGameIrJson(replacementModule),
      moduleDigest: digestGameIrValue(replacementModule),
    }
    const { packetDigest: _packetDigest, ...replacementWithoutDigest } =
      replacementBody
    const replacementPacket = {
      ...replacementBody,
      packetDigest: digestGameIrValue(replacementWithoutDigest),
    }
    expect(() =>
      admitResourceRealizationSemanticValidationResult(
        validationAuthority,
        replacementPacket,
        {
          outcome: 'PASS',
          packetDigest: replacementPacket.packetDigest,
          checkIds: packet.checkIds,
          coveredTargets: packet.requiredTargets,
        },
      ),
    ).toThrow(/stale|detached|authority/)

    const otherProjectionPacket =
      prepareResourceRealizationSemanticProjectionPacket(authority)
    const otherSemantic = admitResourceRealizationSemanticResult(
      authority,
      otherProjectionPacket,
      completeResourceInput(
        otherProjectionPacket,
        authority.resourceRealization.source.sectionBytes,
        'screen',
      ),
    )
    if (otherSemantic.outcome !== 'PROJECTED')
      throw new Error('alternate fixture did not project')
    const otherValidationAuthority = {
      phase5Authority: authority.phase5Authority,
      resourceRealization: {
        ...authority.resourceRealization,
        semantic: otherSemantic,
      },
    }
    const otherPacket = prepareResourceRealizationSemanticValidationPacket(
      otherValidationAuthority,
    )
    expect(() =>
      admitResourceRealizationSemanticValidationResult(
        validationAuthority,
        otherPacket,
        {
          outcome: 'PASS',
          packetDigest: otherPacket.packetDigest,
          checkIds: otherPacket.checkIds,
          coveredTargets: otherPacket.requiredTargets,
        },
      ),
    ).toThrow(/stale|detached|authority/)
  })
})
