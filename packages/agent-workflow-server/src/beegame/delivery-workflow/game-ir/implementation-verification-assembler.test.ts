import { describe, expect, test } from 'bun:test'
import {
  assembleImplementationVerificationClosure,
  type ImplementationVerificationAssemblyAuthority,
} from './implementation-verification-assembler'
import { implementationVerificationFixture } from './implementation-verification-test-helpers'
import { prepareImplementationVerificationSemanticValidationPacket } from './phase7-admission'
import type { ResourceRealizationAssemblyAuthority } from './resource-realization-assembler'

function authority(
  expandedCount = 0,
): ImplementationVerificationAssemblyAuthority {
  const fixture = implementationVerificationFixture({ expandedCount })
  const phase6Authority =
    fixture.phase6Authority as ResourceRealizationAssemblyAuthority
  const preparation = {
    phase6Authority,
    implementationVerification: {
      source: fixture.authority.source,
      mechanical: fixture.authority.mechanical,
      semantic: fixture.semantic,
    },
  } as const
  const packet =
    prepareImplementationVerificationSemanticValidationPacket(preparation)
  return {
    phase6Authority,
    implementationVerification: {
      ...preparation.implementationVerification,
      validation: {
        outcome: 'PASS',
        packetDigest: packet.packetDigest,
        checkIds: packet.checkIds,
        coveredTargets: packet.requiredTargets,
      },
    },
  }
}

describe('complete Game IR assembly from Phase 7 authority', () => {
  test('replays all prior authorities and produces deterministic complete closure', () => {
    const input = authority()
    const first = assembleImplementationVerificationClosure(input)
    const second = assembleImplementationVerificationClosure(input)
    expect(first).toEqual(second)
    expect(first.closureDigest).toBe(second.closureDigest)
    expect(first.candidate.modules.map(module => module.moduleId)).toEqual([
      'balance',
      'gameplay',
      'implementation-verification',
      'presentation',
      'resource-realization',
      'world-scene',
    ])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.candidate.modules)).toBe(true)
    expect(Object.isFrozen(first.implementationVerification)).toBe(true)
  })

  test('rejects detached validation, source, semantic, and Phase 6 authority inputs', () => {
    const input = authority()
    expect(() =>
      assembleImplementationVerificationClosure({
        ...input,
        implementationVerification: {
          ...input.implementationVerification,
          validation: {
            ...input.implementationVerification.validation,
            packetDigest: 'f'.repeat(64),
          },
        },
      }),
    ).toThrow(/packet digest|validation|fidelity/i)
    expect(() =>
      assembleImplementationVerificationClosure({
        ...input,
        implementationVerification: {
          ...input.implementationVerification,
          source: {
            ...input.implementationVerification.source,
            taskId: 'detached-task',
          },
        },
      } as never),
    ).toThrow(/taskId|authority|source/i)
    expect(() =>
      assembleImplementationVerificationClosure({
        ...input,
        phase6Authority: {
          ...input.phase6Authority,
          detachedClosure: {},
        },
      } as never),
    ).toThrow(/unknown|authority|Resource Realization/i)
  })

  test('rejects outer authority hidden, symbol, and accessor fields before dereference', () => {
    const input = authority()
    let getterExecuted = false
    const symbol = Symbol('detached')
    const candidates: readonly [string, unknown][] = [
      [
        'hidden',
        Object.defineProperty({ ...input }, 'detached', {
          value: true,
          enumerable: false,
        }),
      ],
      [
        'symbol',
        Object.defineProperty({ ...input }, symbol, {
          value: true,
          enumerable: true,
        }),
      ],
      [
        'accessor',
        Object.defineProperty({ ...input }, 'phase6Authority', {
          get: () => {
            getterExecuted = true
            return input.phase6Authority
          },
          enumerable: true,
        }),
      ],
    ]
    for (const [label, candidate] of candidates) {
      expect(() =>
        assembleImplementationVerificationClosure(candidate as never),
      ).toThrow(/hidden|accessor|symbol|property/i)
      expect(getterExecuted, `${label} must not execute a getter`).toBe(false)
    }
  })

  test('accepts expanded graphs without a fixed node, edge, or evidence cap', () => {
    const ordinary = assembleImplementationVerificationClosure(authority())
    const expanded = assembleImplementationVerificationClosure(authority(24))
    expect(expanded.candidate.modules[2]!.nodes.length).toBeGreaterThan(
      ordinary.candidate.modules[2]!.nodes.length,
    )
    expect(expanded.candidateDigest).not.toBe(ordinary.candidateDigest)
    expect(expanded.closureDigest).toMatch(/^[a-f0-9]{64}$/)
  })
})
