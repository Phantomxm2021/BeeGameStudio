import { describe, expect, test } from 'bun:test'
import {
  GAME_IR_STAGED_OPERATIONS,
  type GameIrStagedOperation,
  admitStagedValidationOperation,
  buildStagedOperationPacket,
  nextGameIrOperation,
  stagedCompilerContract,
  assembleStagedProjectionOperation,
  stagedProjectionJournalCompletion,
} from './staged-compiler'
import { implementationVerificationFixture } from './implementation-verification-test-helpers'
import { assembleGameplayBalanceModules } from './gameplay-balance-assembler'
import { assembleWorldPresentationClosure } from './world-presentation-assembler'
import { assembleResourceRealizationClosure } from './resource-realization-assembler'
import { assembleImplementationVerificationClosure } from './implementation-verification-assembler'
import type { GameIrCheckpointRecordKind } from './stage-checkpoint'
import { prepareImplementationVerificationSemanticValidationPacket } from './phase7-admission'
import { createGameIrProjectionSliceJournal } from './projection-slice-journal'
import { deriveProjectionSlicePlan } from './projection-slices'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FoundationDocumentPath } from '../types'
import { digestGameIrValue } from './model'
import { buildGameIrEvidenceFragmentCatalog } from './projection-slices'
import type { GameIrDomainSourceEnvelope } from './domain-source'

type ProjectionOperation = GameIrStagedOperation & {
  operation: 'projection'
  domain: keyof ReturnType<typeof ownerFixtureState>['sources']
}

function canonicalGroups(
  groups: Iterable<{ nodeIds: string[]; fragmentId: string }>,
) {
  return [...groups].sort((left, right) => {
    const leftKey = `${left.fragmentId}\0${left.nodeIds.join('\0')}`
    const rightKey = `${right.fragmentId}\0${right.nodeIds.join('\0')}`
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
}

function uniqueExcerpt(source: string, sourcePointer: string): string {
  const [startByte, endByte] = sourcePointer.split('/').slice(2).map(Number)
  const bytes = Buffer.from(source, 'utf8')
  const start = bytes.subarray(0, startByte).toString('utf8').length
  const end = bytes.subarray(0, endByte).toString('utf8').length
  for (let radius = 0; radius <= source.length; radius += 1) {
    const excerpt = source.slice(
      Math.max(0, start - radius),
      Math.min(source.length, end + radius),
    )
    if (excerpt && source.indexOf(excerpt) === source.lastIndexOf(excerpt))
      return excerpt
  }
  throw new Error('owner fixture source claim has no unique excerpt')
}

function evidenceFragmentId(
  source: GameIrDomainSourceEnvelope,
  documentPath: FoundationDocumentPath,
  sectionId: string,
  excerpt: string,
): string {
  const catalog = buildGameIrEvidenceFragmentCatalog({
    sectionIndex: source.sectionIndex,
    sectionBytes: source.sectionBytes,
  })
  const sectionFragments = catalog.fragments.filter(
    candidate =>
      candidate.documentPath === documentPath &&
      candidate.sectionId === sectionId,
  )
  const fragment =
    sectionFragments.find(
      candidate =>
        candidate.excerpt.includes(excerpt) ||
        excerpt.includes(candidate.excerpt),
    ) ?? sectionFragments[0]
  if (!fragment) throw new Error('fixture evidence has no canonical fragment')
  return fragment.fragmentId
}

function ownerFixtureState() {
  const fixture = implementationVerificationFixture()
  const phase4 = fixture.phase6Authority.phase5Authority.phase4Authority
  const phase5 = fixture.phase6Authority.phase5Authority
  const phase6 = fixture.phase6Authority
  const ivPreparation = {
    phase6Authority: phase6,
    implementationVerification: {
      source: fixture.authority.source,
      mechanical: fixture.authority.mechanical,
      semantic: fixture.semantic,
    },
  }
  const ivValidationPacket =
    prepareImplementationVerificationSemanticValidationPacket(ivPreparation)
  const phase7 = {
    phase6Authority: phase6,
    implementationVerification: {
      ...ivPreparation.implementationVerification,
      validation: {
        outcome: 'PASS' as const,
        packetDigest: ivValidationPacket.packetDigest,
        checkIds: ivValidationPacket.checkIds,
        coveredTargets: ivValidationPacket.requiredTargets,
      },
    },
  }
  const sources = {
    gameplay: phase4.gameplay.source,
    balance: phase4.balance.source,
    'world-scene': phase5.worldScene.source,
    presentation: phase5.presentation.source,
    'resource-realization': phase6.resourceRealization.source,
    'implementation-verification': phase7.implementationVerification.source,
  }
  const semantic = {
    gameplay: phase4.gameplay.semantic,
    balance: phase4.balance.semantic,
    'world-scene': phase5.worldScene.semantic,
    presentation: phase5.presentation.semantic,
    'resource-realization': phase6.resourceRealization.semantic,
    'implementation-verification': fixture.semantic,
  }
  const mechanical = {
    gameplay: phase4.gameplay.mechanical,
    balance: phase4.balance.mechanical,
    'world-scene': phase5.worldScene.mechanical,
    presentation: phase5.presentation.mechanical,
    'resource-realization': phase6.resourceRealization.mechanical,
    'implementation-verification': phase7.implementationVerification.mechanical,
  }
  const validation = {
    'world-scene': phase5.worldScene.validation,
    presentation: phase5.presentation.validation,
    'resource-realization': phase6.resourceRealization.validation,
    'implementation-verification': phase7.implementationVerification.validation,
  }
  const records = new Map<GameIrCheckpointRecordKind, unknown>()
  for (const operation of GAME_IR_STAGED_OPERATIONS) {
    const packet = buildStagedOperationPacket({
      operation,
      ...(operation.operation === 'projection'
        ? { source: sources[operation.domain] }
        : {}),
      records,
    })
    const result =
      operation.operation === 'projection'
        ? {
            status: 'completed' as const,
            semantic: {
              outcome: 'PROJECTED' as const,
              nodes: semantic[operation.domain].nodes.map(
                ({ producerMode: _producerMode, ...node }) => node,
              ),
              sourceClaims: semantic[operation.domain].sourceClaims,
            },
          }
        : (() => {
            const expected =
              validation[operation.domain as keyof typeof validation]
            if (expected.outcome !== 'PASS')
              throw new Error('owner fixture validation did not pass')
            return {
              status: 'completed' as const,
              validation: {
                outcome: 'PASS' as const,
                checkIds: expected.checkIds,
                coveredTargets: expected.coveredTargets,
              },
            }
          })()
    if (operation.operation === 'projection') {
      records.set(
        `${operation.step.replace('/projection', '')}/source` as GameIrCheckpointRecordKind,
        sources[operation.domain],
      )
      records.set(
        `${operation.step.replace('/projection', '')}/mechanical` as GameIrCheckpointRecordKind,
        mechanical[operation.domain],
      )
      records.set(
        `${operation.step.replace('/projection', '')}/semantic` as GameIrCheckpointRecordKind,
        semantic[operation.domain],
      )
    } else {
      for (const item of admitStagedValidationOperation({
        operation,
        packet,
        records,
        result,
      }))
        records.set(item.kind, item.record)
    }
  }
  return { fixture, records, sources, semantic }
}

async function graphJournal(
  state: ReturnType<typeof ownerFixtureState>,
  root: string,
  includeEvent: boolean,
) {
  const operation = GAME_IR_STAGED_OPERATIONS[0]! as ProjectionOperation
  const source = state.sources.gameplay
  const packet = buildStagedOperationPacket({
    operation,
    source,
    records: state.records,
  })
  const identity = {
    runId: 'graph-run',
    taskId: source.taskId,
    publicationId: source.compileRequest.publicationId,
    confirmedBriefDigest: source.compileRequest.foundation.confirmedBriefDigest,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    foundationReadyReceiptDigest:
      source.compileRequest.foundation.receiptDigest,
  }
  const journal = await createGameIrProjectionSliceJournal({
    journalPath: join(
      root,
      includeEvent ? 'graph-complete.json' : 'graph-dangling.json',
    ),
    identity,
    operationStep: operation.step,
    packet: packet as never,
    slicePlan: deriveProjectionSlicePlan('gameplay'),
  })
  const section = source.sectionIndex[0]!
  const excerpt =
    source.sectionBytes[`${section.documentPath}#${section.sectionId}`]!
  const nodes = [
    {
      id: 'state-forward',
      kind: 'gameplay.state',
      value: { label: 'Forward state', initial: true, terminal: 'none' },
      references: [],
      edges: [],
    },
    {
      id: 'condition-forward',
      kind: 'gameplay.condition',
      value: { expression: { kind: 'boolean', value: true } },
      references: [],
      edges: [],
    },
    {
      id: 'action-forward',
      kind: 'gameplay.action',
      value: { label: 'Forward action' },
      references: [],
      edges: [
        {
          type: 'causes',
          targetId: 'event-forward',
          targetType: 'gameplay.event',
        },
        {
          type: 'requires',
          targetId: 'condition-forward',
          targetType: 'gameplay.condition',
        },
      ],
    },
    ...(includeEvent
      ? [
          {
            id: 'event-forward',
            kind: 'gameplay.event',
            value: { label: 'Forward event' },
            references: [],
            edges: [],
          },
        ]
      : []),
  ]
  for (const slice of journal.slicePlan.slices) {
    const owned = nodes
      .filter(node => slice.nodeKinds.includes(node.kind))
      .sort((left, right) => left.id.localeCompare(right.id))
    const sourceEvidenceGroups =
      owned.length === 0
        ? []
        : [
            {
              nodeIds: owned.map(node => node.id),
              fragmentId: evidenceFragmentId(
                source,
                section.documentPath,
                section.sectionId,
                excerpt,
              ),
            },
          ]
    await journal.append({
      status: 'completed',
      sliceId: slice.sliceId,
      semantic: { nodes: owned, sourceEvidenceGroups },
    })
  }
  return { journal, packet, operation }
}

async function resourceJournalWithDanglingEdge(
  state: ReturnType<typeof ownerFixtureState>,
  root: string,
) {
  const operation = GAME_IR_STAGED_OPERATIONS.find(
    item => item.step === 'phase6/resource-realization/projection',
  )! as ProjectionOperation
  const source = state.sources[operation.domain]
  const packet = buildStagedOperationPacket({
    operation,
    source,
    records: state.records,
  })
  const identity = {
    runId: 'resource-graph-run',
    taskId: source.taskId,
    publicationId: source.compileRequest.publicationId,
    confirmedBriefDigest: source.compileRequest.foundation.confirmedBriefDigest,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    foundationReadyReceiptDigest:
      source.compileRequest.foundation.receiptDigest,
  }
  const journal = await createGameIrProjectionSliceJournal({
    journalPath: join(root, 'resource-dangling.json'),
    identity,
    operationStep: operation.step,
    packet: packet as never,
    slicePlan: deriveProjectionSlicePlan(operation.domain),
  })
  const expected = state.semantic[operation.domain]
  for (const slice of journal.slicePlan.slices) {
    const nodes = expected.nodes
      .filter(node => slice.nodeKinds.includes(node.kind))
      .map(({ producerMode: _producerMode, ...node }) =>
        node.id === 'profile-main'
          ? {
              ...node,
              edges: node.edges.map(edge => ({
                ...edge,
                targetId: 'missing-logical-resource',
              })),
            }
          : node,
      )
    const ids = new Set(nodes.map(node => node.id))
    const grouped = new Map<string, { nodeIds: string[]; fragmentId: string }>()
    for (const claim of expected.sourceClaims.filter(claim =>
      ids.has(claim.subject.slice('node:'.length, claim.subject.indexOf('#'))),
    )) {
      const nodeId = claim.subject.slice(
        'node:'.length,
        claim.subject.indexOf('#'),
      )
      if (!grouped.has(nodeId))
        grouped.set(nodeId, {
          nodeIds: [nodeId],
          fragmentId: evidenceFragmentId(
            source,
            claim.documentPath,
            claim.sectionId,
            uniqueExcerpt(
              source.sectionBytes[`${claim.documentPath}#${claim.sectionId}`]!,
              claim.sourcePointer,
            ),
          ),
        })
    }
    await journal.append({
      status: 'completed',
      sliceId: slice.sliceId,
      semantic: {
        nodes,
        sourceEvidenceGroups: canonicalGroups(grouped.values()),
      },
    })
  }
  return { journal, packet, operation }
}

async function gameplayJournalWithInvalidLocalGraph(
  state: ReturnType<typeof ownerFixtureState>,
  root: string,
) {
  const operation = GAME_IR_STAGED_OPERATIONS[0]! as ProjectionOperation
  const source = state.sources.gameplay
  const packet = buildStagedOperationPacket({
    operation,
    source,
    records: state.records,
  })
  const journal = await createGameIrProjectionSliceJournal({
    journalPath: join(root, 'gameplay-invalid-local-graph.json'),
    identity: {
      runId: 'gameplay-invalid-local-graph-run',
      taskId: source.taskId,
      publicationId: source.compileRequest.publicationId,
      confirmedBriefDigest:
        source.compileRequest.foundation.confirmedBriefDigest,
      foundationRevision: source.compileRequest.foundation.foundationRevision,
      foundationReadyReceiptDigest:
        source.compileRequest.foundation.receiptDigest,
    },
    operationStep: operation.step,
    packet: packet as never,
    slicePlan: deriveProjectionSlicePlan('gameplay'),
  })
  const expected = state.semantic.gameplay
  for (const slice of journal.slicePlan.slices) {
    const nodes = expected.nodes
      .filter(node => slice.nodeKinds.includes(node.kind))
      .map(({ producerMode: _producerMode, ...node }) =>
        node.kind === 'gameplay.state'
          ? {
              ...node,
              value: { ...node.value, initial: false },
            }
          : node,
      )
    const ids = new Set(nodes.map(node => node.id))
    const groups = new Map<
      string,
      { nodeIds: string[]; fragmentId: string }
    >()
    for (const claim of expected.sourceClaims.filter(claim =>
      ids.has(claim.subject.slice('node:'.length, claim.subject.indexOf('#'))),
    )) {
      const nodeId = claim.subject.slice(
        'node:'.length,
        claim.subject.indexOf('#'),
      )
      if (!groups.has(nodeId))
        groups.set(nodeId, {
          nodeIds: [nodeId],
          fragmentId: evidenceFragmentId(
            source,
            claim.documentPath,
            claim.sectionId,
            uniqueExcerpt(
              source.sectionBytes[
                `${claim.documentPath}#${claim.sectionId}`
              ]!,
              claim.sourcePointer,
            ),
          ),
        })
    }
    await journal.append({
      status: 'completed',
      sliceId: slice.sliceId,
      semantic: {
        nodes,
        sourceEvidenceGroups: canonicalGroups(groups.values()),
      },
    })
  }
  return { journal, packet, operation }
}

describe('Game IR staged compiler scheduler', () => {
  test('assembles all six canonical projection journals through domain admission', async () => {
    const state = ownerFixtureState()
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-assembly-'))
    try {
      const identity = {
        runId: 'assembly-run',
        taskId: state.sources.gameplay.taskId,
        publicationId: state.sources.gameplay.compileRequest.publicationId,
        confirmedBriefDigest:
          state.sources.gameplay.compileRequest.foundation.confirmedBriefDigest,
        foundationRevision:
          state.sources.gameplay.compileRequest.foundation.foundationRevision,
        foundationReadyReceiptDigest:
          state.sources.gameplay.compileRequest.foundation.receiptDigest,
      }
      for (const operation of GAME_IR_STAGED_OPERATIONS.filter(
        item => item.operation === 'projection',
      ) as ProjectionOperation[]) {
        const source = state.sources[operation.domain]
        const expected = state.semantic[operation.domain]
        const packet = buildStagedOperationPacket({
          operation,
          source,
          records: state.records,
        })
        const journal = await createGameIrProjectionSliceJournal({
          journalPath: join(root, `${operation.domain}.json`),
          identity,
          operationStep: operation.step,
          packet: packet as never,
          slicePlan: deriveProjectionSlicePlan(operation.domain),
        })
        for (const slice of journal.slicePlan.slices) {
          const nodes = expected.nodes
            .filter(node => slice.nodeKinds.includes(node.kind))
            .map(({ producerMode: _producerMode, ...node }) => node)
          const ids = new Set(nodes.map(node => node.id))
          const grouped = new Map<
            string,
            { nodeIds: string[]; fragmentId: string }
          >()
          for (const claim of expected.sourceClaims.filter(claim =>
            ids.has(
              claim.subject.slice('node:'.length, claim.subject.indexOf('#')),
            ),
          )) {
            const nodeId = claim.subject.slice(
              'node:'.length,
              claim.subject.indexOf('#'),
            )
            if (!grouped.has(nodeId))
              grouped.set(nodeId, {
                nodeIds: [nodeId],
                fragmentId: evidenceFragmentId(
                  source,
                  claim.documentPath,
                  claim.sectionId,
                  uniqueExcerpt(
                    source.sectionBytes[
                      `${claim.documentPath}#${claim.sectionId}`
                    ]!,
                    claim.sourcePointer,
                  ),
                ),
              })
          }
          await journal.append({
            status: 'completed',
            sliceId: slice.sliceId,
            semantic: {
              nodes,
              sourceEvidenceGroups: canonicalGroups(grouped.values()),
            },
          })
        }
        const result = assembleStagedProjectionOperation({
          operation,
          packet,
          records: state.records,
          journal,
        })
        expect(result.outcome).toBe('PROJECTED')
        if (result.outcome !== 'PROJECTED')
          throw new Error('owner fixture assembly did not project')
        expect(result.moduleId).toBe(operation.domain)
        expect(result.nodes).toEqual(expected.nodes)
        expect(result.sourceClaims.map(claim => claim.subject)).toEqual(
          expected.sourceClaims.map(claim => claim.subject),
        )
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('completes Balance projection from the exact Gameplay-only checkpoint prefix', async () => {
    const state = ownerFixtureState()
    const operation = GAME_IR_STAGED_OPERATIONS.find(
      item => item.step === 'phase4/balance/projection',
    )! as ProjectionOperation
    const source = state.sources.balance
    const records = new Map(
      [...state.records].filter(([kind]) => kind.startsWith('phase4/gameplay/')),
    )
    const packet = buildStagedOperationPacket({ operation, source, records })
    const root = await mkdtemp(join(tmpdir(), 'game-ir-balance-prefix-'))
    try {
      const journal = await createGameIrProjectionSliceJournal({
        journalPath: join(root, 'balance.json'),
        identity: {
          runId: 'balance-prefix-run',
          taskId: source.taskId,
          publicationId: source.compileRequest.publicationId,
          confirmedBriefDigest:
            source.compileRequest.foundation.confirmedBriefDigest,
          foundationRevision:
            source.compileRequest.foundation.foundationRevision,
          foundationReadyReceiptDigest:
            source.compileRequest.foundation.receiptDigest,
        },
        operationStep: operation.step,
        packet: packet as never,
        slicePlan: deriveProjectionSlicePlan('balance'),
      })
      const expected = state.semantic.balance
      for (const slice of journal.slicePlan.slices) {
        const nodes = expected.nodes
          .filter(node => slice.nodeKinds.includes(node.kind))
          .map(({ producerMode: _producerMode, ...node }) => node)
        const ids = new Set(nodes.map(node => node.id))
        const groups = new Map<
          string,
          { nodeIds: string[]; fragmentId: string }
        >()
        for (const claim of expected.sourceClaims.filter(claim =>
          ids.has(
            claim.subject.slice('node:'.length, claim.subject.indexOf('#')),
          ),
        )) {
          const nodeId = claim.subject.slice(
            'node:'.length,
            claim.subject.indexOf('#'),
          )
          if (!groups.has(nodeId))
            groups.set(nodeId, {
              nodeIds: [nodeId],
              fragmentId: evidenceFragmentId(
                source,
                claim.documentPath,
                claim.sectionId,
                uniqueExcerpt(
                  source.sectionBytes[
                    `${claim.documentPath}#${claim.sectionId}`
                  ]!,
                  claim.sourcePointer,
                ),
              ),
            })
        }
        await journal.append({
          status: 'completed',
          sliceId: slice.sliceId,
          semantic: {
            nodes,
            sourceEvidenceGroups: canonicalGroups(groups.values()),
          },
        })
      }

      expect(
        stagedProjectionJournalCompletion({
          operation,
          packet,
          records,
          journal,
        }).map(item => item.kind),
      ).toEqual([
        'phase4/balance/source',
        'phase4/balance/mechanical',
        'phase4/balance/semantic',
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('carries forward references and rejects dangling local targets at slice admission', async () => {
    const state = ownerFixtureState()
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-graph-'))
    try {
      const complete = await graphJournal(state, root, true)
      const admitted = assembleStagedProjectionOperation({
        operation: complete.operation,
        packet: complete.packet,
        records: state.records,
        journal: complete.journal,
      })
      expect(admitted.outcome).toBe('PROJECTED')
      if (admitted.outcome === 'PROJECTED')
        expect(admitted.nodes.map(node => node.id)).toEqual([
          'action-forward',
          'condition-forward',
          'event-forward',
          'state-forward',
        ])

      await expect(
        resourceJournalWithDanglingEdge(state, root),
      ).rejects.toThrow(/target|event|graph|reference|missing|required/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects an invalid local Gameplay graph at Gameplay journal completion', async () => {
    const state = ownerFixtureState()
    const root = await mkdtemp(join(tmpdir(), 'game-ir-gameplay-local-'))
    try {
      const invalid = await gameplayJournalWithInvalidLocalGraph(state, root)
      expect(() =>
        stagedProjectionJournalCompletion({
          operation: invalid.operation,
          packet: invalid.packet,
          records: state.records,
          journal: invalid.journal,
        }),
      ).toThrow(/gameplay module must declare an initial state/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects incomplete, detached, and re-signed packets through the exact staged entry', async () => {
    const state = ownerFixtureState()
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-binding-'))
    try {
      const operation = GAME_IR_STAGED_OPERATIONS[0]! as ProjectionOperation
      const source = state.sources.gameplay
      const packet = buildStagedOperationPacket({
        operation,
        source,
        records: state.records,
      })
      const identity = {
        runId: 'binding-run',
        taskId: source.taskId,
        publicationId: source.compileRequest.publicationId,
        confirmedBriefDigest:
          source.compileRequest.foundation.confirmedBriefDigest,
        foundationRevision: source.compileRequest.foundation.foundationRevision,
        foundationReadyReceiptDigest:
          source.compileRequest.foundation.receiptDigest,
      }
      const journal = await createGameIrProjectionSliceJournal({
        journalPath: join(root, 'incomplete.json'),
        identity,
        operationStep: operation.step,
        packet: packet as never,
        slicePlan: deriveProjectionSlicePlan('gameplay'),
      })
      expect(() =>
        assembleStagedProjectionOperation({
          operation,
          packet,
          records: state.records,
          journal,
        }),
      ).toThrow(/complete|slice/i)
      for (const slice of journal.slicePlan.slices)
        await journal.append({
          status: 'completed',
          sliceId: slice.sliceId,
          semantic: { nodes: [], sourceEvidenceGroups: [] },
        })
      const forged = {
        ...(packet as Record<string, unknown>),
        dependencies: { forged: true },
      } as Record<string, unknown>
      const forgedPacket = {
        ...forged,
        packetDigest: digestGameIrValue(
          (({ packetDigest: _ignored, ...body }) => body)(forged),
        ),
      }
      expect(() =>
        assembleStagedProjectionOperation({
          operation,
          packet: forgedPacket,
          records: state.records,
          journal,
        }),
      ).toThrow(/dependency|unknown|packet/i)
      expect(() =>
        assembleStagedProjectionOperation({
          operation,
          packet,
          records: state.records,
          journal: journal.snapshot as never,
        }),
      ).toThrow(/journal|instance|verified/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects re-signed dependency packets for every dependent projection operation', async () => {
    const state = ownerFixtureState()
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-dependencies-'))
    try {
      const identity = {
        runId: 'dependency-run',
        taskId: state.sources.gameplay.taskId,
        publicationId: state.sources.gameplay.compileRequest.publicationId,
        confirmedBriefDigest:
          state.sources.gameplay.compileRequest.foundation.confirmedBriefDigest,
        foundationRevision:
          state.sources.gameplay.compileRequest.foundation.foundationRevision,
        foundationReadyReceiptDigest:
          state.sources.gameplay.compileRequest.foundation.receiptDigest,
      }
      for (const operation of GAME_IR_STAGED_OPERATIONS.filter(
        item => item.operation === 'projection',
      ) as ProjectionOperation[]) {
        const packet = buildStagedOperationPacket({
          operation,
          source: state.sources[operation.domain],
          records: state.records,
        }) as Record<string, unknown>
        const journal = await createGameIrProjectionSliceJournal({
          journalPath: join(root, `${operation.domain}.json`),
          identity,
          operationStep: operation.step,
          packet: packet as never,
          slicePlan: deriveProjectionSlicePlan(operation.domain),
        })
        const forged = { ...packet, dependencies: { forged: true } } as Record<
          string,
          unknown
        >
        const forgedPacket = {
          ...forged,
          packetDigest: digestGameIrValue(
            (({ packetDigest: _ignored, ...body }) => body)(forged),
          ),
        }
        expect(() =>
          assembleStagedProjectionOperation({
            operation,
            packet: forgedPacket,
            records: state.records,
            journal,
          }),
        ).toThrow(/dependency|packet|stale|unknown/i)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  test('derives the fixed ten operation cursor from the checkpoint loader', () => {
    expect(GAME_IR_STAGED_OPERATIONS.map(operation => operation.step)).toEqual([
      'phase4/gameplay/projection',
      'phase4/balance/projection',
      'phase5/world-scene/projection',
      'phase5/world-scene/validation',
      'phase5/presentation/projection',
      'phase5/presentation/validation',
      'phase6/resource-realization/projection',
      'phase6/resource-realization/validation',
      'phase7/implementation-verification/projection',
      'phase7/implementation-verification/validation',
    ])
    expect(nextGameIrOperation()).toEqual(GAME_IR_STAGED_OPERATIONS[0])
    expect(
      nextGameIrOperation({ nextStep: 'phase5/world-scene/projection' }),
    ).toEqual(GAME_IR_STAGED_OPERATIONS[2])
  })

  test('builds one operation contract with only the current packet', () => {
    expect(
      stagedCompilerContract({
        operation: GAME_IR_STAGED_OPERATIONS[0]!,
        packet: { packetDigest: 'packet' },
      }),
    ).toEqual({
      kind: 'projection',
      packet: { packetDigest: 'packet' },
    })
  })

  test('carries a current-step correction diagnostic outside the immutable packet', () => {
    const packet = { packetDigest: 'packet' }
    const correctionDiagnostic = {
      step: GAME_IR_STAGED_OPERATIONS[3]!.step,
      reason: 'Output does not match required schema: /semantic',
    }
    expect(
      stagedCompilerContract({
        operation: GAME_IR_STAGED_OPERATIONS[3]!,
        packet,
        correctionDiagnostic,
      }),
    ).toEqual({
      kind: 'validation',
      packet,
      correctionDiagnostic,
    })
    expect(packet).toEqual({ packetDigest: 'packet' })
  })

  test('executes the ten operations against the owner fixture without future-prefix reads', () => {
    const fixture = implementationVerificationFixture()
    const phase4 = fixture.phase6Authority.phase5Authority.phase4Authority
    const phase5 = fixture.phase6Authority.phase5Authority
    const phase6 = fixture.phase6Authority
    const ivPreparation = {
      phase6Authority: phase6,
      implementationVerification: {
        source: fixture.authority.source,
        mechanical: fixture.authority.mechanical,
        semantic: fixture.semantic,
      },
    }
    const ivValidationPacket =
      prepareImplementationVerificationSemanticValidationPacket(ivPreparation)
    const phase7 = {
      phase6Authority: phase6,
      implementationVerification: {
        ...ivPreparation.implementationVerification,
        validation: {
          outcome: 'PASS' as const,
          packetDigest: ivValidationPacket.packetDigest,
          checkIds: ivValidationPacket.checkIds,
          coveredTargets: ivValidationPacket.requiredTargets,
        },
      },
    }
    const sources = {
      gameplay: phase4.gameplay.source,
      balance: phase4.balance.source,
      'world-scene': phase5.worldScene.source,
      presentation: phase5.presentation.source,
      'resource-realization': phase6.resourceRealization.source,
      'implementation-verification': phase7.implementationVerification.source,
    }
    const semantic = {
      gameplay: phase4.gameplay.semantic,
      balance: phase4.balance.semantic,
      'world-scene': phase5.worldScene.semantic,
      presentation: phase5.presentation.semantic,
      'resource-realization': phase6.resourceRealization.semantic,
      'implementation-verification': phase7.implementationVerification.semantic,
    }
    const mechanical = {
      gameplay: phase4.gameplay.mechanical,
      balance: phase4.balance.mechanical,
      'world-scene': phase5.worldScene.mechanical,
      presentation: phase5.presentation.mechanical,
      'resource-realization': phase6.resourceRealization.mechanical,
      'implementation-verification':
        phase7.implementationVerification.mechanical,
    }
    const validation = {
      'world-scene': phase5.worldScene.validation,
      presentation: phase5.presentation.validation,
      'resource-realization': phase6.resourceRealization.validation,
      'implementation-verification':
        phase7.implementationVerification.validation,
    }
    const records = new Map<GameIrCheckpointRecordKind, unknown>()
    for (const operation of GAME_IR_STAGED_OPERATIONS) {
      const packet = buildStagedOperationPacket({
        operation,
        ...(operation.operation === 'projection'
          ? { source: sources[operation.domain] }
          : {}),
        records,
      })
      const result =
        operation.operation === 'projection'
          ? {
              status: 'completed' as const,
              semantic: {
                outcome: 'PROJECTED' as const,
                nodes: semantic[operation.domain].nodes.map(
                  ({ producerMode: _producerMode, ...node }) => node,
                ),
                sourceClaims: semantic[operation.domain].sourceClaims,
              },
            }
          : (() => {
              const expected =
                validation[operation.domain as keyof typeof validation]
              if (expected.outcome !== 'PASS')
                throw new Error(
                  `fixture validation failed for ${operation.domain}`,
                )
              return {
                status: 'completed' as const,
                validation: {
                  outcome: 'PASS' as const,
                  checkIds: expected.checkIds,
                  coveredTargets: expected.coveredTargets,
                },
              }
            })()
      if (operation.operation === 'projection') {
        records.set(
          `${operation.step.replace('/projection', '')}/source` as GameIrCheckpointRecordKind,
          sources[operation.domain],
        )
        records.set(
          `${operation.step.replace('/projection', '')}/mechanical` as GameIrCheckpointRecordKind,
          mechanical[operation.domain],
        )
        records.set(
          `${operation.step.replace('/projection', '')}/semantic` as GameIrCheckpointRecordKind,
          semantic[operation.domain],
        )
      } else {
        for (const item of admitStagedValidationOperation({
          operation,
          packet,
          records,
          result,
        }))
          records.set(item.kind, item.record)
      }
      if (operation.step === 'phase4/balance/projection')
        expect(() => assembleGameplayBalanceModules(phase4)).not.toThrow()
      if (operation.step === 'phase5/presentation/validation')
        expect(() => assembleWorldPresentationClosure(phase5)).not.toThrow()
      if (operation.step === 'phase6/resource-realization/validation')
        expect(() => assembleResourceRealizationClosure(phase6)).not.toThrow()
      if (operation.step === 'phase7/implementation-verification/validation')
        expect(() =>
          assembleImplementationVerificationClosure(phase7),
        ).not.toThrow()
    }
    expect(records.size).toBe(22)
  })

  test('fails closed when a dependency prefix record is missing', () => {
    const operation = GAME_IR_STAGED_OPERATIONS[1]!
    const fixture = implementationVerificationFixture()
    const source =
      fixture.phase6Authority.phase5Authority.phase4Authority.gameplay.source
    expect(() =>
      buildStagedOperationPacket({ operation, source, records: new Map() }),
    ).toThrow(/missing phase4\/gameplay/)
  })
})
