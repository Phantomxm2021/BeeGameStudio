import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  assembleImplementationVerificationClosure,
  type ImplementationVerificationAssemblyAuthority,
} from './implementation-verification-assembler'
import {
  implementationVerificationFixture,
  type ImplementationVerificationFixtureOptions,
} from './implementation-verification-test-helpers'
import { prepareImplementationVerificationSemanticValidationPacket } from './phase7-admission'
import { canonicalGameIrJson } from './model'
import {
  commitGameIrPublication,
  prepareGameIrPublication,
  validateCommittedGameIr,
} from './publication'
import type { ResourceRealizationAssemblyAuthority } from './resource-realization-assembler'

function authority(
  options: ImplementationVerificationFixtureOptions = {},
): ImplementationVerificationAssemblyAuthority {
  const fixture = implementationVerificationFixture(options)
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

function publicationAuthority(
  workspacePath: string,
  options: ImplementationVerificationFixtureOptions = {},
) {
  const phase7Authority = authority(options)
  return {
    workspacePath,
    publicationId:
      phase7Authority.phase6Authority.phase5Authority.phase4Authority.gameplay
        .source.compileRequest.publicationId,
    phase7Authority,
  }
}

const MULTI_ARTIFACT_RESOURCE: NonNullable<
  ImplementationVerificationFixtureOptions['resourceMutate']
> = nodes => [
  ...nodes.map(node =>
    node.id === 'target-main'
      ? {
          ...node,
          value: {
            ...node.value,
            assetFormatCapabilities: ['glb', 'png', 'svg', 'wav'],
          },
        }
      : node,
  ),
  {
    id: 'resource-variant-alt',
    kind: 'resource-realization.variant',
    value: {
      activation: {
        kind: 'conditional',
        predicate: { field: 'runtime', operator: 'eq', value: 'web' },
      },
    },
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
    id: 'resource-artifact-alt',
    kind: 'resource-realization.delivery-artifact',
    value: {
      artifactClass: 'runtime-resource',
      path: 'assets/runtime/player-model-alt.svg',
      format: 'svg',
      runtimeRole: 'player',
    },
    references: [],
    edges: [
      {
        type: 'part-of',
        targetId: 'resource-variant-alt',
        targetType: 'resource-realization.variant',
      },
    ],
  },
]

const MULTI_ARTIFACT_RESOURCE_SOURCE = [
  'resource-variant-alt',
  'resource-artifact-alt',
  canonicalGameIrJson({
    type: 'realizes',
    targetId: 'resource.requirement.player-model',
    targetType: 'resource-realization.logical-resource',
  }),
  canonicalGameIrJson({
    type: 'part-of',
    targetId: 'resource-variant-alt',
    targetType: 'resource-realization.variant',
  }),
  canonicalGameIrJson({
    type: 'implements',
    targetId: 'resource-variant-alt',
    targetType: 'resource-realization.variant',
  }),
  canonicalGameIrJson({
    type: 'implements',
    targetId: 'resource-artifact-alt',
    targetType: 'resource-realization.delivery-artifact',
  }),
  canonicalGameIrJson({
    type: 'covers',
    targetId: 'resource-variant-alt',
    targetType: 'resource-realization.variant',
  }),
  canonicalGameIrJson({
    type: 'covers',
    targetId: 'resource-artifact-alt',
    targetType: 'resource-realization.delivery-artifact',
  }),
]

const EXPANDED_PROFILE: ImplementationVerificationFixtureOptions = {
  expandedCount: 28,
  resourceMutate: MULTI_ARTIFACT_RESOURCE,
  resourceSourceLiterals: MULTI_ARTIFACT_RESOURCE_SOURCE,
}

describe('Implementation/Verification complete profiles', () => {
  test('accepts a minimal runtime/resource profile and publishes the six-module candidate', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'game-ir-profile-'))
    try {
      const publication = publicationAuthority(workspacePath, {
        presentationRequirements: [],
      })
      const closure = assembleImplementationVerificationClosure(
        publication.phase7Authority,
      )
      expect(closure.candidate.modules.map(module => module.moduleId)).toEqual([
        'balance',
        'gameplay',
        'implementation-verification',
        'presentation',
        'resource-realization',
        'world-scene',
      ])
      expect(closure.phase6.resourceRealization.module.nodes).toHaveLength(5)
      expect(
        closure.implementationVerification.module.nodes.some(
          node =>
            node.kind === 'implementation-verification.evidence-requirement' &&
            node.value.kind === 'integration-test',
        ),
      ).toBe(true)
      const prepared = await prepareGameIrPublication(publication)
      const ready = await commitGameIrPublication(publication)
      expect(ready.committedPath).toBe(prepared.committedPath)
      await expect(validateCommittedGameIr(publication)).resolves.toEqual(ready)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('accepts an expanded multi-artifact conditional profile with all evidence modalities', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'game-ir-profile-'))
    try {
      const publication = publicationAuthority(workspacePath, EXPANDED_PROFILE)
      const closure = assembleImplementationVerificationClosure(
        publication.phase7Authority,
      )
      const evidenceKinds = new Set(
        closure.implementationVerification.module.nodes
          .filter(
            node =>
              node.kind === 'implementation-verification.evidence-requirement',
          )
          .map(node => node.value.kind),
      )
      expect(evidenceKinds).toEqual(
        new Set([
          'unit-test',
          'integration-test',
          'build',
          'runtime-observation',
          'visual-observation',
          'audio-observation',
          'file-inspection',
        ]),
      )
      expect(
        new Set(
          closure.implementationVerification.module.nodes
            .filter(
              node => node.kind === 'implementation-verification.invariant',
            )
            .map(node => node.value.scope),
        ),
      ).toEqual(
        new Set(['runtime', 'state', 'numeric', 'resource', 'persistence']),
      )
      expect(
        closure.phase6.resourceRealization.module.nodes.length,
      ).toBeGreaterThan(5)
      expect(closure.candidate.modules[2]!.nodes.length).toBeGreaterThan(20)
      const ready = await commitGameIrPublication(publication)
      await expect(validateCommittedGameIr(publication)).resolves.toEqual(ready)
      const manifest = JSON.parse(
        await readFile(
          join(
            workspacePath,
            ready.committedPath.replace(/\/COMMITTED\.json$/, '/manifest.json'),
          ),
          'utf8',
        ),
      ) as { semanticEvidence?: readonly { phase: string; moduleId: string }[] }
      expect(
        manifest.semanticEvidence?.map(({ phase, moduleId }) => ({
          phase,
          moduleId,
        })),
      ).toEqual([
        { phase: 'phase4', moduleId: 'balance' },
        { phase: 'phase4', moduleId: 'gameplay' },
        { phase: 'phase7', moduleId: 'implementation-verification' },
        { phase: 'phase5', moduleId: 'presentation' },
        { phase: 'phase6', moduleId: 'resource-realization' },
        { phase: 'phase5', moduleId: 'world-scene' },
      ])
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects detached Phase 6 identity and Phase 7 validation digest for every profile', () => {
    for (const options of [
      { presentationRequirements: [] },
      EXPANDED_PROFILE,
    ] satisfies readonly ImplementationVerificationFixtureOptions[]) {
      const base = authority(options)
      expect(() =>
        assembleImplementationVerificationClosure({
          ...base,
          implementationVerification: {
            ...base.implementationVerification,
            validation: {
              ...base.implementationVerification.validation,
              packetDigest: 'f'.repeat(64),
            },
          },
        }),
      ).toThrow(/packet digest|validation|fidelity/i)
      expect(() =>
        assembleImplementationVerificationClosure({
          ...base,
          phase6Authority: {
            ...base.phase6Authority,
            phase5Authority: {
              ...base.phase6Authority.phase5Authority,
              phase4Authority: {
                ...base.phase6Authority.phase5Authority.phase4Authority,
                gameplay: {
                  ...base.phase6Authority.phase5Authority.phase4Authority
                    .gameplay,
                  source: {
                    ...base.phase6Authority.phase5Authority.phase4Authority
                      .gameplay.source,
                    taskId: 'detached-task',
                  },
                },
              },
            },
          },
        } as never),
      ).toThrow(/taskId|authority|source/i)
    }
  })
})
