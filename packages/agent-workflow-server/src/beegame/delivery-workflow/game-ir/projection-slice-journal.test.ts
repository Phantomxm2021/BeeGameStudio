import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { digestGameIrValue } from './model'
import { deriveProjectionSlicePlan } from './projection-slices'
import { buildGameplayProjectionOperationPacket } from './gameplay-producer'
import { realAuthority } from './resource-realization-test-helpers'
import {
  createGameIrProjectionSliceJournal,
  loadGameIrProjectionSliceJournal,
  gameIrProjectionSliceJournalPath,
  cleanupGameIrProjectionSliceJournalAfterCheckpoint,
  type GameIrProjectionSliceCompletion,
  type GameIrProjectionSliceJournalInput,
} from './projection-slice-journal'
import type { GameIrCompilationIdentity } from '../types'
import { buildGameIrEvidenceFragmentCatalog } from './projection-slices'

const digest = (letter: string): string => letter.repeat(64)

function fixture(journalPath: string): GameIrProjectionSliceJournalInput {
  const authority = realAuthority().phase5Authority.phase4Authority.gameplay
  const packet = buildGameplayProjectionOperationPacket({
    source: authority.source,
    mechanical: authority.mechanical,
  })
  const identity: GameIrCompilationIdentity = {
    runId: 'run-1',
    taskId: authority.source.taskId,
    publicationId: authority.source.compileRequest.publicationId,
    confirmedBriefDigest:
      authority.source.compileRequest.foundation.confirmedBriefDigest,
    foundationRevision:
      authority.source.compileRequest.foundation.foundationRevision,
    foundationReadyReceiptDigest:
      authority.source.compileRequest.foundation.receiptDigest,
  }
  return {
    journalPath,
    identity,
    operationStep: 'phase4/gameplay/projection',
    packet,
    slicePlan: deriveProjectionSlicePlan('gameplay'),
  }
}

function emptyCompletion(sliceId: string): GameIrProjectionSliceCompletion {
  return {
    status: 'completed',
    sliceId,
    semantic: { nodes: [], sourceEvidenceGroups: [] },
  }
}

function firstEvidenceFragmentId(
  input: GameIrProjectionSliceJournalInput,
  documentPath: string,
  sectionId: string,
): string {
  const catalog = buildGameIrEvidenceFragmentCatalog({
    sectionIndex: input.packet.source.sectionIndex,
    sectionBytes: input.packet.source.sectionBytes,
  })
  const fragment = catalog.fragments.find(
    candidate =>
      candidate.documentPath === documentPath &&
      candidate.sectionId === sectionId,
  )
  if (!fragment) throw new Error('fixture section has no evidence fragment')
  return fragment.fragmentId
}

describe('Game IR projection slice journal', () => {
  test('derives a deterministic private path from identity and exact operation step', () => {
    const input = fixture('/tmp/ignored-by-helper.json')
    const first = gameIrProjectionSliceJournalPath({
      workspacePath: '/workspace',
      identity: input.identity,
      operationStep: input.operationStep,
    })
    const second = gameIrProjectionSliceJournalPath({
      workspacePath: '/workspace',
      identity: input.identity,
      operationStep: input.operationStep,
    })
    expect(first).toBe(second)
    expect(first).toContain(
      digestGameIrValue({
        identity: input.identity,
        operationStep: input.operationStep,
        slicePlanDigest: digestGameIrValue(deriveProjectionSlicePlan('gameplay')),
      }),
    )
    expect(first).toContain('/.beegame/.game-ir-private/')
    expect(first).toMatch(/\.json$/)
    expect(first).not.toContain(input.identity.runId)
    expect(() =>
      gameIrProjectionSliceJournalPath({
        workspacePath: '/workspace',
        identity: input.identity,
        operationStep: '../../outside' as never,
      }),
    ).toThrow(/operation|projection|step/i)
  })

  test('appends atomically and reloads the exact next slice', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const journal = await createGameIrProjectionSliceJournal(input)
      const first = journal.slicePlan.slices[0]!
      await journal.append(emptyCompletion(first.sliceId))

      const reloaded = await loadGameIrProjectionSliceJournal(input)
      expect(reloaded.entries).toHaveLength(1)
      expect(reloaded.nextSlice?.sliceId).toBe(
        journal.slicePlan.slices[1]?.sliceId,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects duplicate, skipped, stale-plan, and tampered entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const journal = await createGameIrProjectionSliceJournal(input)
      const [first, second] = journal.slicePlan.slices
      await expect(
        journal.append(emptyCompletion(second!.sliceId)),
      ).rejects.toThrow(/next|order/i)
      await journal.append(emptyCompletion(first!.sliceId))
      await expect(
        journal.append(emptyCompletion(first!.sliceId)),
      ).rejects.toThrow(/duplicate|next/i)

      const stalePlan = {
        ...input,
        slicePlan: deriveProjectionSlicePlan('balance'),
      }
      await expect(loadGameIrProjectionSliceJournal(stalePlan)).rejects.toThrow(
        /plan|stale|binding/i,
      )

      const bytes = await readFile(input.journalPath, 'utf8')
      await Bun.write(
        input.journalPath,
        bytes.replace(first!.sliceId, 'tampered.slice'),
      )
      await expect(loadGameIrProjectionSliceJournal(input)).rejects.toThrow(
        /digest|journal|tamper/i,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('requires the exact shared compilation identity and rejects the old invented identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const oldIdentity = {
        ...input,
        identity: {
          compilationId: 'compile-1',
          taskId: input.identity.taskId,
          foundationRevision: input.identity.foundationRevision,
          foundationReadyReceiptDigest:
            input.identity.foundationReadyReceiptDigest,
        },
      } as unknown as GameIrProjectionSliceJournalInput
      await expect(
        createGameIrProjectionSliceJournal(oldIdentity),
      ).rejects.toThrow(/identity|runId|publication/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects a strict slice-schema violation before it can enter the journal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const journal = await createGameIrProjectionSliceJournal(input)
      const slice = journal.nextSlice!
      await expect(
        journal.append({
          status: 'completed',
          sliceId: slice.sliceId,
          semantic: {
            nodes: [
              {
                id: 'invented',
                kind: slice.nodeKinds[0],
                value: { forbidden: true },
                references: [],
                edges: [],
                extra: true,
              },
            ],
            sourceEvidenceGroups: [],
          },
        } as unknown as GameIrProjectionSliceCompletion),
      ).rejects.toThrow(/schema|field|slice|evidence/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('exposes only a fully verified completed snapshot and never a raw merge completion path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const journal = await createGameIrProjectionSliceJournal(input)
      expect(() => journal.completedSnapshot).toThrow(/complete|slice/i)
      for (const slice of journal.slicePlan.slices)
        await journal.append(emptyCompletion(slice.sliceId))
      expect(journal.completedSnapshot.entries).toHaveLength(
        journal.slicePlan.slices.length,
      )
      expect('complete' in journal).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('binds packet digest to the canonical parsed operation packet on reload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      await createGameIrProjectionSliceJournal(input)
      const changedPacket = {
        ...input.packet,
        dependencies: { changed: true },
      }
      const recomputedPacket = {
        ...changedPacket,
        packetDigest: digestGameIrValue(
          (({ packetDigest: _ignored, ...body }) => body)(changedPacket),
        ),
      }
      await expect(
        loadGameIrProjectionSliceJournal({
          ...input,
          packet: recomputedPacket as typeof input.packet,
        }),
      ).rejects.toThrow(/packet|binding|digest/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rebinds source evidence to canonical bytes and rejects duplicate subjects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const authority = realAuthority().phase5Authority.phase4Authority.gameplay
      const journal = await createGameIrProjectionSliceJournal(input)
      const sourceNode = authority.semantic.nodes.find(node =>
        journal.slicePlan.slices.some(slice =>
          slice.nodeKinds.includes(node.kind),
        ),
      )!
      const sliceIndex = journal.slicePlan.slices.findIndex(slice =>
        slice.nodeKinds.includes(sourceNode.kind),
      )
      for (const slice of journal.slicePlan.slices.slice(0, sliceIndex))
        await journal.append(emptyCompletion(slice.sliceId))
      const node = structuredClone(sourceNode) as Record<string, unknown>
      delete node.producerMode
      const claims = authority.semantic.sourceClaims.filter(claim =>
        claim.subject.startsWith(`node:${sourceNode.id}#`),
      )
      const claim = claims[0]!
      const groups = [
        {
          nodeIds: [sourceNode.id],
          fragmentId: firstEvidenceFragmentId(
            input,
            claim.documentPath,
            claim.sectionId,
          ),
        },
      ]
      const completion = {
        status: 'completed' as const,
        sliceId: journal.slicePlan.slices[sliceIndex]!.sliceId,
        semantic: { nodes: [node], sourceEvidenceGroups: groups },
      }
      await expect(
        journal.append({
          ...completion,
          semantic: {
            nodes: [node],
            sourceEvidenceGroups: [...groups, groups[0]!],
          },
        } as unknown as GameIrProjectionSliceCompletion),
      ).rejects.toThrow(/evidence|subject|target/i)
      await journal.append(
        completion as unknown as GameIrProjectionSliceCompletion,
      )
      const reloaded = await loadGameIrProjectionSliceJournal(input)
      expect(reloaded.entries.at(-1)?.sliceId).toBe(completion.sliceId)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects coordinated journal digest recomputation against the exact packet binding', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      await createGameIrProjectionSliceJournal(input)
      const raw = JSON.parse(
        await readFile(input.journalPath, 'utf8'),
      ) as Record<string, unknown>
      raw.operationPacketDigest = digest('d')
      const { journalDigest: _oldJournalDigest, ...body } = raw
      raw.journalDigest = digestGameIrValue(body)
      await Bun.write(input.journalPath, `${JSON.stringify(raw)}\n`)
      await expect(loadGameIrProjectionSliceJournal(input)).rejects.toThrow(
        /packet|binding|digest|stale/i,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('binds the protocol step to both the packet module and slice plan module', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      await expect(
        createGameIrProjectionSliceJournal({
          ...input,
          slicePlan: deriveProjectionSlicePlan('balance'),
        }),
      ).rejects.toThrow(/step|module|binding/i)
      await expect(
        createGameIrProjectionSliceJournal({
          ...input,
          operationStep: 'phase4/balance/projection',
        }),
      ).rejects.toThrow(/step|module|binding/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('admits a slice edge only after its target kind is durable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const authority = realAuthority().phase5Authority.phase4Authority.gameplay
      const journal = await createGameIrProjectionSliceJournal(input)
      const section = authority.source.sectionIndex[0]!
      const fragmentId = firstEvidenceFragmentId(
        input,
        section.documentPath,
        section.sectionId,
      )
      await journal.append({
        status: 'completed',
        sliceId: journal.nextSlice!.sliceId,
        semantic: {
          nodes: [
            {
              id: 'outcome.win',
              kind: 'gameplay.outcome',
              value: { label: 'Win', result: 'win' },
              references: [],
              edges: [],
            },
            {
              id: 'state.start',
              kind: 'gameplay.state',
              value: { label: 'Start', initial: true, terminal: 'none' },
              references: [],
              edges: [],
            },
          ],
          sourceEvidenceGroups: [
            { nodeIds: ['outcome.win', 'state.start'], fragmentId },
          ],
        },
      } as unknown as GameIrProjectionSliceCompletion)
      expect(journal.nextSliceContext.availablePriorNodes).toEqual([
        {
          id: 'outcome.win',
          kind: 'gameplay.outcome',
          value: { label: 'Win', result: 'win' },
        },
        {
          id: 'state.start',
          kind: 'gameplay.state',
          value: { initial: true, label: 'Start', terminal: 'none' },
        },
      ])

      const sourceNode = {
        id: 'objective.escape',
        kind: 'gameplay.objective',
        value: { label: 'Escape' },
        references: [],
        edges: [
          {
            type: 'succeeds-with',
            targetId: 'outcome.win',
            targetType: 'gameplay.outcome',
          },
        ],
      }
      await journal.append({
        status: 'completed',
        sliceId: journal.nextSlice!.sliceId,
        semantic: {
          nodes: [
            structuredClone(sourceNode),
            {
              id: 't',
              kind: 'gameplay.transition',
              value: { label: 'Loop' },
              references: [],
              edges: [
                {
                  type: 'from',
                  targetId: 'state.start',
                  targetType: 'gameplay.state',
                },
                {
                  type: 'to',
                  targetId: 'state.start',
                  targetType: 'gameplay.state',
                },
              ],
            },
          ],
          sourceEvidenceGroups: [
            { nodeIds: [sourceNode.id, 't'], fragmentId },
          ],
        },
      } as unknown as GameIrProjectionSliceCompletion)
      expect(journal.entries).toHaveLength(2)
      expect(journal.nextSlice).toBeUndefined()
      expect(
        journal.ownerSliceIdForDiagnostic(
          'objective objective.escape must reach an explicit outcome',
        ),
      ).toBe('gameplay.slice.1')
      expect(
        journal.ownerSliceIdForDiagnostic(
          'transition t leaves terminal state state.start',
        ),
      ).toBe('gameplay.slice.1')
      expect(
        journal.ownerSliceIdForDiagnostic(
          'gameplay module must declare at least one state',
        ),
      ).toBe('gameplay.slice.0')
      expect(journal.ownerSliceIdForDiagnostic('unknown closure failure')).toBe(
        'gameplay.slice.0',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects unordered or duplicate node collections without repairing worker output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const authority = realAuthority().phase5Authority.phase4Authority.gameplay
      const journal = await createGameIrProjectionSliceJournal(input)
      const fragmentId = firstEvidenceFragmentId(
        input,
        authority.source.sectionIndex[0]!.documentPath,
        authority.source.sectionIndex[0]!.sectionId,
      )
      await journal.append({
        status: 'completed',
        sliceId: journal.nextSlice!.sliceId,
        semantic: {
          nodes: [
            {
              id: 'condition.a',
              kind: 'gameplay.condition',
              value: { expression: { kind: 'boolean', value: true } },
              references: [],
              edges: [],
            },
            {
              id: 'event.z',
              kind: 'gameplay.event',
              value: { label: 'Event Z' },
              references: [],
              edges: [],
            },
            {
              id: 'state.a',
              kind: 'gameplay.state',
              value: { label: 'State A', initial: true, terminal: 'none' },
              references: [],
              edges: [],
            },
          ],
          sourceEvidenceGroups: [
            {
              nodeIds: ['condition.a', 'event.z', 'state.a'],
              fragmentId,
            },
          ],
        },
      } as unknown as GameIrProjectionSliceCompletion)
      const slice = journal.nextSlice!
      const section = authority.source.sectionIndex[0]!
      const completion = {
        status: 'completed' as const,
        sliceId: slice.sliceId,
        semantic: {
          nodes: [
            {
              id: 'action.canonical',
              kind: 'gameplay.action',
              value: { label: 'Canonical action' },
              references: [
                { targetId: 'event.z', targetType: 'gameplay.event' },
                { targetId: 'condition.a', targetType: 'gameplay.condition' },
              ],
              edges: [
                {
                  type: 'requires',
                  targetId: 'condition.a',
                  targetType: 'gameplay.condition',
                },
                {
                  type: 'causes',
                  targetId: 'event.z',
                  targetType: 'gameplay.event',
                },
              ],
            },
          ],
          sourceEvidenceGroups: [
            {
              nodeIds: ['action.canonical'],
              fragmentId: firstEvidenceFragmentId(
                input,
                section.documentPath,
                section.sectionId,
              ),
            },
          ],
        },
      }
      await expect(
        journal.append(
          completion as unknown as GameIrProjectionSliceCompletion,
        ),
      ).rejects.toThrow(/unique|sorted|canonical/i)
      const canonical = structuredClone(completion)
      canonical.semantic.nodes[0]!.references.reverse()
      canonical.semantic.nodes[0]!.edges.reverse()
      await journal.append(
        canonical as unknown as GameIrProjectionSliceCompletion,
      )
      expect(journal.entries[1]!.semantic.nodes[0]!.references).toEqual([
        { targetId: 'condition.a', targetType: 'gameplay.condition' },
        { targetId: 'event.z', targetType: 'gameplay.event' },
      ])
      expect(
        journal.entries[1]!.semantic.nodes[0]!.edges.map(edge => edge.type),
      ).toEqual(['causes', 'requires'])

      await journal.invalidate(slice.sliceId)
      const duplicate = structuredClone(canonical)
      duplicate.semantic.nodes[0]!.edges.push(
        structuredClone(duplicate.semantic.nodes[0]!.edges[0]!),
      )
      await expect(
        journal.append(duplicate as unknown as GameIrProjectionSliceCompletion),
      ).rejects.toThrow(/duplicate|edges/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects missing required and repeated singleton relationships at slice admission', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const authority = realAuthority().phase5Authority.phase4Authority.gameplay
      const journal = await createGameIrProjectionSliceJournal(input)
      const section = authority.source.sectionIndex[0]!
      const fragmentId = firstEvidenceFragmentId(
        input,
        section.documentPath,
        section.sectionId,
      )
      await journal.append({
        status: 'completed',
        sliceId: journal.nextSlice!.sliceId,
        semantic: {
          nodes: ['a', 'b', 'c'].map((id, index) => ({
            id: `state.${id}`,
            kind: 'gameplay.state',
            value: {
              label: `State ${id}`,
              initial: index === 0,
              terminal: 'none',
            },
            references: [],
            edges: [],
          })),
          sourceEvidenceGroups: [
            {
              nodeIds: ['state.a', 'state.b', 'state.c'],
              fragmentId,
            },
          ],
        },
      } as unknown as GameIrProjectionSliceCompletion)
      const base = {
        status: 'completed' as const,
        sliceId: journal.nextSlice!.sliceId,
        semantic: {
          nodes: [
            {
              id: 'action.cardinality',
              kind: 'gameplay.action',
              value: { label: 'Cardinality action' },
              references: [],
              edges: [],
            },
          ],
          sourceEvidenceGroups: [
            {
              nodeIds: ['action.cardinality'],
              fragmentId,
            },
          ],
        },
      }
      await expect(
        journal.append(base as unknown as GameIrProjectionSliceCompletion),
      ).rejects.toThrow(/missing|required|relationship/i)

      const transition = {
        ...base,
        semantic: {
          nodes: [
            {
              id: 'transition.cardinality',
              kind: 'gameplay.transition',
              value: { label: 'Cardinality transition' },
              references: [],
              edges: [
                {
                  type: 'from',
                  targetId: 'state.a',
                  targetType: 'gameplay.state',
                },
                {
                  type: 'from',
                  targetId: 'state.b',
                  targetType: 'gameplay.state',
                },
                {
                  type: 'to',
                  targetId: 'state.c',
                  targetType: 'gameplay.state',
                },
              ],
            },
          ],
          sourceEvidenceGroups: [
            {
              ...base.semantic.sourceEvidenceGroups[0]!,
              nodeIds: ['transition.cardinality'],
            },
          ],
        },
      }
      await expect(
        journal.append(
          transition as unknown as GameIrProjectionSliceCompletion,
        ),
      ).rejects.toThrow(/singleton|relationship/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reuses the validated authority and slice validator across a retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const journal = await createGameIrProjectionSliceJournal(input)
      const first = journal.nextSlice!
      await journal.append(emptyCompletion(first.sliceId))
      await journal.invalidate(first.sliceId)
      await journal.append(emptyCompletion(first.sliceId))
      expect(journal.entries).toHaveLength(1)
      expect(journal.nextSlice?.sliceId).toBe(
        journal.slicePlan.slices[1]?.sliceId,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('does not re-normalize the full packet or recompile the canonical slice schema per append', async () => {
    const source = await readFile(
      new URL('./projection-slice-journal.ts', import.meta.url),
      'utf8',
    )
    expect(source).not.toContain('normalizePacket(this.authority.packet)')
    expect(source).toContain('sliceValidators')
  })

  test('does not expose cleanup without a loader-verified checkpoint identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      await createGameIrProjectionSliceJournal(input)
      await expect(
        cleanupGameIrProjectionSliceJournalAfterCheckpoint({
          workspacePath: root,
          identity: input.identity,
          operationStep: input.operationStep,
          deliveryRun: undefined,
        } as never),
      ).rejects.toThrow(/checkpoint|loader|DeliveryRun|compiling/i)
      expect(await readFile(input.journalPath, 'utf8')).toBeTruthy()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('recognizes only an exact replay of the already-admitted terminal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const journal = await createGameIrProjectionSliceJournal(input)
      const slice = journal.slicePlan.slices[0]!
      const completion = emptyCompletion(slice.sliceId)
      await journal.append(completion)
      expect(journal.matchesAdmittedTerminal(completion)).toBe(true)
      const second = journal.nextSlice!
      const secondCompletion = emptyCompletion(second.sliceId)
      await journal.append(secondCompletion)
      expect(journal.matchesAdmittedTerminal(completion)).toBe(true)
      expect(journal.matchesAdmittedTerminal(secondCompletion)).toBe(true)
      expect(journal.nextSlice?.sliceId).toBe(
        journal.slicePlan.slices[2]?.sliceId,
      )
      expect(
        journal.matchesAdmittedTerminal({
          ...completion,
          semantic: { ...completion.semantic, nodes: [{ id: 'changed' }] },
        } as never),
      ).toBe(false)
      expect(
        journal.matchesAdmittedTerminal({
          ...completion,
          sliceId: journal.slicePlan.slices[2]?.sliceId,
        } as never),
      ).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
