import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { digestGameIrValue } from './model'
import { deriveProjectionSlicePlan } from './projection-slices'
import { buildGameplayProjectionOperationPacket } from './gameplay-producer'
import { buildBalanceProjectionOperationPacket } from './balance-producer'
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
import { sourceSectionsForGameIrProjectionSlice } from './projection-slice-authority'
import { buildGameIrSemanticObligationInventory } from './semantic-obligation-inventory'
import {
  admitGameIrSemanticObligationValidationResult,
  buildGameIrSemanticObligationValidationAuthority,
} from './semantic-obligation-validation'
import type { GameIrSemanticObligationRecord } from './semantic-obligation-inventory'

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
  const base = {
    journalPath,
    identity,
    operationStep: 'phase4/gameplay/projection',
    packet,
    slicePlan: deriveProjectionSlicePlan('gameplay'),
  } as GameIrProjectionSliceJournalInput
  return base
}

function balanceFixture(
  journalPath: string,
): GameIrProjectionSliceJournalInput {
  const authority = realAuthority().phase5Authority.phase4Authority.balance
  const packet = buildBalanceProjectionOperationPacket({
    source: authority.source,
    mechanical: authority.mechanical,
    gameplay: realAuthority().phase5Authority.phase4Authority.gameplay,
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
  const base = {
    journalPath,
    identity,
    operationStep: 'phase4/balance/projection',
    packet,
    slicePlan: deriveProjectionSlicePlan('balance'),
  } as GameIrProjectionSliceJournalInput
  return base
}

function emptyCompletion(sliceId: string): GameIrProjectionSliceCompletion {
  return {
    status: 'completed',
    sliceId,
    semantic: { nodes: [], sourceEvidenceGroups: [] },
  }
}

function emptyInventoryAndReceipt(input: GameIrProjectionSliceJournalInput) {
  const inventory = buildGameIrSemanticObligationInventory({
    moduleId: input.packet.source.moduleId,
    source: input.packet.source,
    records: [],
  })
  const authority = buildGameIrSemanticObligationValidationAuthority({
    source: input.packet.source,
    inventory,
  })
  const admitted = admitGameIrSemanticObligationValidationResult({
    authority,
    result: {
      outcome: 'PASS',
      moduleId: authority.moduleId,
      identities: authority.identities,
      coverage: authority.sourceFragments.map(fragment => fragment.fragmentId),
    },
  })
  if (admitted.outcome !== 'PASS') throw new Error('fixture preflight did not pass')
  return { inventory, receipt: admitted.receipt }
}

type TestObligation = Readonly<{
  targetId: string
  targetKind: string
  fragmentId?: string
}>

async function readyJournal(
  input: GameIrProjectionSliceJournalInput,
  obligations: readonly TestObligation[] = [],
) {
  const journal = await createGameIrProjectionSliceJournal(input)
  const defaultFragmentForKind = (targetKind: string): string => {
    const slice = input.slicePlan.slices.find(candidate =>
      candidate.nodeKinds.includes(targetKind),
    )
    if (!slice) throw new Error(`fixture kind is outside slice plan: ${targetKind}`)
    const selector = sourceSectionsForGameIrProjectionSlice(slice.sliceId)[0]!
    return firstEvidenceFragmentId(input, selector.documentPath, selector.sectionId)
  }
  const records = obligations
    .map(
      ({ targetId, targetKind, fragmentId = defaultFragmentForKind(targetKind) }) =>
        ({
          record: 'obligation',
          moduleId: input.packet.source.moduleId,
          targetId,
          targetKind,
          fragmentId,
        }) satisfies GameIrSemanticObligationRecord,
    )
    .sort((left, right) => left.targetId.localeCompare(right.targetId))
  const inventory = buildGameIrSemanticObligationInventory({
    moduleId: input.packet.source.moduleId,
    source: input.packet.source,
    records,
  })
  const authority = buildGameIrSemanticObligationValidationAuthority({
    source: input.packet.source,
    inventory,
  })
  const admitted = admitGameIrSemanticObligationValidationResult({
    authority,
    result: {
      outcome: 'PASS',
      moduleId: authority.moduleId,
      identities: authority.identities,
      coverage: authority.sourceFragments.map(fragment => fragment.fragmentId),
    },
  })
  if (admitted.outcome !== 'PASS') throw new Error('fixture preflight did not pass')
  await journal.admitObligationInventory(inventory)
  await journal.admitObligationValidationReceipt(admitted.receipt)
  return journal
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
    expect(first).toBe(
      '/workspace/.beegame/.game-ir-private/projection-slices/' +
        `${digestGameIrValue({
          identity: input.identity,
          operationStep: input.operationStep,
        })}.json`,
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
      const journal = await readyJournal(input)
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
      const identityInput = fixture('/tmp/ignored-by-helper.json')
      const input = fixture(
        gameIrProjectionSliceJournalPath({
          workspacePath: root,
          identity: identityInput.identity,
          operationStep: identityInput.operationStep,
        }),
      )
      const journal = await readyJournal(input)
      const [first, second] = journal.slicePlan.slices
      await expect(
        journal.append(emptyCompletion(second!.sliceId)),
      ).rejects.toThrow(/next|order/i)
      await journal.append(emptyCompletion(first!.sliceId))
      await expect(
        journal.append(emptyCompletion(first!.sliceId)),
      ).rejects.toThrow(/duplicate|next/i)

      const stalePlan = {
        ...input.slicePlan,
        slices: [...input.slicePlan.slices].reverse(),
      }
      const staleInput = { ...input, slicePlan: stalePlan }
      expect(
        gameIrProjectionSliceJournalPath({
          workspacePath: root,
          identity: input.identity,
          operationStep: input.operationStep,
        }),
      ).toBe(input.journalPath)
      const journalBeforeStaleLoad = await readFile(input.journalPath, 'utf8')
      await expect(loadGameIrProjectionSliceJournal(staleInput)).rejects.toThrow(
        /plan|stale/i,
      )
      expect(await readFile(input.journalPath, 'utf8')).toBe(
        journalBeforeStaleLoad,
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
      const journal = await readyJournal(input)
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

  test('rejects an intrinsically invalid Balance unit before slice persistence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = balanceFixture(join(root, 'journal.json'))
      const journal = await readyJournal(input, [
        { targetId: 'balance.unit.invalid', targetKind: 'balance.unit' },
      ])
      const sourceUnit =
        realAuthority().phase5Authority.phase4Authority.balance.semantic
          .nodes[0]!
      const { bindings: _bindings, producerMode: _producerMode, ...unit } =
        sourceUnit as typeof sourceUnit & {
          bindings?: unknown
          producerMode?: unknown
        }
      const invalid = {
        ...unit,
        id: 'balance.unit.invalid',
        value: {
          ...unit.value,
          dimensions: [
            { base: 'z', exponent: 1 },
            { base: 'a', exponent: 1 },
          ],
        },
      }
      const validResult = await journal.appendRecords([
        {
          fragmentId: firstEvidenceFragmentId(
            input,
            input.packet.source.sectionIndex[0]!.documentPath,
            input.packet.source.sectionIndex[0]!.sectionId,
          ),
          node: unit,
        },
      ], journal.slicePlan.slices[0]!.sliceId)
      expect(validResult.acceptedCount).toBe(1)
      const result = await journal.appendRecords([
        {
          fragmentId: firstEvidenceFragmentId(
            input,
            input.packet.source.sectionIndex[0]!.documentPath,
            input.packet.source.sectionIndex[0]!.sectionId,
          ),
          node: invalid,
        },
      ], journal.slicePlan.slices[0]!.sliceId)
      expect(result.acceptedCount).toBe(0)
      expect(result.diagnostic?.reason).toMatch(/dimensions.*sorted/i)
      expect(journal.entries).toHaveLength(0)
      expect(journal.currentSliceRecordPrefix).toEqual([
        { id: unit.id, kind: unit.kind },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('preserves the Balance prefix when a unit index is invalid and accepts its corrected replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = balanceFixture(join(root, 'journal.json'))
      const journal = await readyJournal(input, [
        { targetId: 'balance.alpha-unit', targetKind: 'balance.unit' },
        { targetId: 'balance.parameter.body-cold-base', targetKind: 'balance.parameter' },
      ])
      const first = journal.slicePlan.slices[0]!
      const fragmentId = firstEvidenceFragmentId(
        input,
        input.packet.source.sectionIndex[0]!.documentPath,
        input.packet.source.sectionIndex[0]!.sectionId,
      )
      const sourceUnit =
        realAuthority().phase5Authority.phase4Authority.balance.semantic.nodes[0]!
      const { bindings: _bindings, producerMode: _producerMode, ...unit } =
        sourceUnit as typeof sourceUnit & {
          bindings?: unknown
          producerMode?: unknown
        }
      const prefixUnit = { ...unit, id: 'balance.alpha-unit' }
      await journal.appendRecords(
        [{ fragmentId, node: prefixUnit }],
        first.sliceId,
      )
      const prefixBefore = journal.currentSliceRecordPrefix
      const digestsBefore = journal.currentSliceRecordDigests
      const pendingDigestBefore = journal.snapshot.pendingSlice?.pendingDigest
      const invalid = {
        id: 'balance.parameter.body-cold-base',
        kind: 'balance.parameter',
        value: { label: 'Body cold base', baseline: 1, unitReferenceIndex: 1 },
        references: [{ targetId: prefixUnit.id, targetType: 'balance.unit' }],
        edges: [],
      }
      const rejected = await journal.appendRecords(
        [{ fragmentId, node: invalid }],
        first.sliceId,
      )
      expect(rejected.acceptedCount).toBe(0)
      expect(rejected.diagnostic?.reason).toMatch(
        /unitReferenceIndex must be equal to constant/i,
      )
      expect(journal.currentSliceRecordPrefix).toEqual(prefixBefore)
      expect(journal.currentSliceRecordDigests).toEqual(digestsBefore)
      expect(journal.snapshot.pendingSlice?.pendingDigest).toBe(
        pendingDigestBefore,
      )
      const corrected = await journal.appendRecords(
        [
          {
            fragmentId,
            node: {
              ...invalid,
              value: { ...invalid.value, unitReferenceIndex: 0 },
            },
          },
        ],
        first.sliceId,
      )
      expect(corrected.acceptedCount).toBe(1)
      expect(journal.currentSliceRecordPrefix).toEqual([
        ...prefixBefore,
        { id: invalid.id, kind: invalid.kind },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects a Balance relationship/reference mismatch before persisting the cost', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = balanceFixture(join(root, 'journal.json'))
      const journal = await readyJournal(input, [
        { targetId: 'balance.cost.admitted', targetKind: 'balance.cost' },
        { targetId: 'balance.cost.invalid', targetKind: 'balance.cost' },
      ])
      const [first, second, third] = journal.slicePlan.slices
      const fragmentId = firstEvidenceFragmentId(
        input,
        input.packet.source.sectionIndex[0]!.documentPath,
        input.packet.source.sectionIndex[0]!.sectionId,
      )
      await journal.append(emptyCompletion(first!.sliceId))
      await journal.append(emptyCompletion(second!.sliceId))
      await journal.appendRecords(
        [
          {
            fragmentId,
            node: {
              id: 'balance.cost.admitted',
              kind: 'balance.cost',
              value: { label: 'Admitted cost' },
              references: [
                {
                  targetId: 'balance.variable.hp',
                  targetType: 'balance.variable',
                },
              ],
              edges: [
                {
                  type: 'amount',
                  targetId: 'balance.variable.hp',
                  targetType: 'balance.variable',
                },
              ],
            },
          },
        ],
        third!.sliceId,
      )
      const prefixBefore = journal.currentSliceRecordPrefix
      const digestsBefore = journal.currentSliceRecordDigests
      const pendingDigestBefore = journal.snapshot.pendingSlice?.pendingDigest
      const result = await journal.appendRecords(
        [
          {
            fragmentId,
            node: {
              id: 'balance.cost.invalid',
              kind: 'balance.cost',
              value: { label: 'Invalid cost' },
              references: [],
              edges: [
                {
                  type: 'amount',
                  targetId: 'balance.variable.missing',
                  targetType: 'balance.variable',
                },
              ],
            },
          },
        ],
        third!.sliceId,
      )
      expect(result.acceptedCount).toBe(0)
      expect(result.diagnostic?.reason).toMatch(
        /relationship references do not match role edges/i,
      )
      expect(result.diagnostic?.reason).toContain(
        'expected target IDs [balance.variable.missing]',
      )
      expect(result.diagnostic?.reason).toContain('received target IDs []')
      expect(journal.entries.map(entry => entry.sliceId)).toEqual([
        first!.sliceId,
        second!.sliceId,
      ])
      expect(journal.currentSliceRecordPrefix).toEqual(prefixBefore)
      expect(journal.currentSliceRecordDigests).toEqual(digestsBefore)
      expect(journal.snapshot.pendingSlice?.pendingDigest).toBe(
        pendingDigestBefore,
      )
      const corrected = await journal.appendRecords(
        [
          {
            fragmentId,
            node: {
              id: 'balance.cost.invalid',
              kind: 'balance.cost',
              value: { label: 'Corrected cost' },
              references: [
                {
                  targetId: 'balance.variable.missing',
                  targetType: 'balance.variable',
                },
              ],
              edges: [
                {
                  type: 'amount',
                  targetId: 'balance.variable.missing',
                  targetType: 'balance.variable',
                },
              ],
            },
          },
        ],
        third!.sliceId,
      )
      expect(corrected.acceptedCount).toBe(1)
      expect(journal.currentSliceRecordPrefix).toEqual([
        ...prefixBefore,
        { id: 'balance.cost.invalid', kind: 'balance.cost' },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('accepts a legal same-slice forward formula reference until slice closure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = balanceFixture(join(root, 'journal.json'))
      const journal = await readyJournal(input, [
        { targetId: 'balance-unit', targetKind: 'balance.unit' },
        { targetId: 'balance.formula.a', targetKind: 'balance.formula' },
        { targetId: 'balance.formula.b', targetKind: 'balance.formula' },
      ])
      const [first, second] = journal.slicePlan.slices
      const sourceUnit =
        realAuthority().phase5Authority.phase4Authority.balance.semantic.nodes[0]!
      const { bindings: _bindings, producerMode: _producerMode, ...unit } =
        sourceUnit as typeof sourceUnit & {
          bindings?: unknown
          producerMode?: unknown
        }
      const fragmentId = firstEvidenceFragmentId(
        input,
        input.packet.source.sectionIndex[0]!.documentPath,
        input.packet.source.sectionIndex[0]!.sectionId,
      )
      await journal.append({
        status: 'completed',
        sliceId: first!.sliceId,
        semantic: {
          nodes: [unit],
          sourceEvidenceGroups: [{ nodeIds: [unit.id], fragmentId }],
        },
      } as unknown as GameIrProjectionSliceCompletion)
      const formulaA = {
        id: 'balance.formula.a',
        kind: 'balance.formula',
        value: {
          label: 'Forward formula',
          expression: { kind: 'reference', referenceIndex: 1 },
          outputUnitReferenceIndex: 0,
        },
        references: [
          { targetId: unit.id, targetType: 'balance.unit' },
          { targetId: 'balance.formula.b', targetType: 'balance.formula' },
        ],
        edges: [
          {
            type: 'depends-on',
            targetId: 'balance.formula.b',
            targetType: 'balance.formula',
          },
        ],
      }
      const formulaB = {
        id: 'balance.formula.b',
        kind: 'balance.formula',
        value: {
          label: 'Referenced formula',
          expression: { kind: 'literal', value: 1, unitReferenceIndex: 0 },
          outputUnitReferenceIndex: 0,
        },
        references: [{ targetId: unit.id, targetType: 'balance.unit' }],
        edges: [],
      }
      await expect(
        journal.appendRecords(
          [
            { fragmentId, node: formulaA },
            { fragmentId, node: formulaB },
          ],
          second!.sliceId,
        ),
      ).resolves.toEqual({ acceptedCount: 2 })
      expect(journal.currentSliceRecordPrefix).toEqual([
        { id: formulaA.id, kind: formulaA.kind },
        { id: formulaB.id, kind: formulaB.kind },
      ])
      await journal.completeCurrentSlice()
      expect(journal.entries.map(entry => entry.sliceId)).toEqual([
        first!.sliceId,
        second!.sliceId,
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rolls back a pending failed owner and every later suffix record atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = balanceFixture(join(root, 'journal.json'))
      const journal = await readyJournal(input, [
        { targetId: 'balance.a-unit', targetKind: 'balance.unit' },
        { targetId: 'balance.parameter.b', targetKind: 'balance.parameter' },
        { targetId: 'balance.variable.c', targetKind: 'balance.variable' },
      ])
      const first = journal.slicePlan.slices[0]!
      const fragmentId = firstEvidenceFragmentId(
        input,
        input.packet.source.sectionIndex[0]!.documentPath,
        input.packet.source.sectionIndex[0]!.sectionId,
      )
      const sourceUnit =
        realAuthority().phase5Authority.phase4Authority.balance.semantic.nodes[0]!
      const { bindings: _bindings, producerMode: _producerMode, ...unit } =
        sourceUnit as typeof sourceUnit & {
          bindings?: unknown
          producerMode?: unknown
        }
      const prefix = { ...unit, id: 'balance.a-unit' }
      const failed = {
        id: 'balance.parameter.b',
        kind: 'balance.parameter',
        value: { label: 'B', baseline: 1, unitReferenceIndex: 0 },
        references: [
          { targetId: 'balance.unit.future', targetType: 'balance.unit' },
        ],
        edges: [],
      }
      const suffix = {
        id: 'balance.variable.c',
        kind: 'balance.variable',
        value: { label: 'C', baseline: 1, unitReferenceIndex: 0 },
        references: [
          { targetId: 'balance.unit.future', targetType: 'balance.unit' },
        ],
        edges: [],
      }
      await expect(
        journal.appendRecords(
          [
            { fragmentId, node: prefix },
            { fragmentId, node: failed },
            { fragmentId, node: suffix },
          ],
          first.sliceId,
        ),
      ).resolves.toEqual({ acceptedCount: 3 })
      const prefixBefore = journal.currentSliceRecordPrefix
      const digestsBefore = journal.currentSliceRecordDigests
      const pendingDigestBefore = journal.snapshot.pendingSlice?.pendingDigest
      let reason = ''
      try {
        await journal.completeCurrentSlice()
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error)
      }
      expect(reason).toMatch(/balance\.parameter\.b|unknown|dangling/i)
      const rollback = await journal.rollbackOwnerForDiagnostic({
        ownerSliceId: first.sliceId,
        obligationId: `balance:balance.parameter:${failed.id}`,
        fragmentId,
        recordId: failed.id,
      })
      expect(rollback).toEqual({
        scope: 'record',
        sliceId: first.sliceId,
        recordId: failed.id,
        fragmentId,
        reason,
      })
      expect(journal.currentSliceRecordPrefix).toEqual([prefixBefore[0]])
      expect(journal.currentSliceRecordDigests).toEqual([digestsBefore[0]])
      expect(journal.snapshot.pendingSlice?.pendingDigest).not.toBe(
        pendingDigestBefore,
      )
      await expect(
        journal.appendRecords(
          [
            {
              fragmentId,
              node: {
                ...failed,
                references: [{ targetId: prefix.id, targetType: 'balance.unit' }],
              },
            },
            {
              fragmentId,
              node: {
                ...suffix,
                references: [{ targetId: prefix.id, targetType: 'balance.unit' }],
              },
            },
          ],
          first.sliceId,
        ),
      ).resolves.toEqual({ acceptedCount: 2 })
      await expect(journal.completeCurrentSlice()).resolves.toBe(journal)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('does not mutate a pending slice when a failure has no pending owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = balanceFixture(join(root, 'journal.json'))
      const journal = await readyJournal(input, [
        { targetId: 'balance.a-unit', targetKind: 'balance.unit' },
      ])
      const first = journal.slicePlan.slices[0]!
      const fragmentId = firstEvidenceFragmentId(
        input,
        input.packet.source.sectionIndex[0]!.documentPath,
        input.packet.source.sectionIndex[0]!.sectionId,
      )
      const sourceUnit =
        realAuthority().phase5Authority.phase4Authority.balance.semantic.nodes[0]!
      const { bindings: _bindings, producerMode: _producerMode, ...unit } =
        sourceUnit as typeof sourceUnit & {
          bindings?: unknown
          producerMode?: unknown
        }
      await journal.appendRecords(
        [{ fragmentId, node: { ...unit, id: 'balance.a-unit' } }],
        first.sliceId,
      )
      const before = journal.snapshot
      expect('rollbackPendingRecordsForDiagnostic' in journal).toBe(false)
      expect(journal.snapshot).toEqual(before)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('exposes only a fully verified completed snapshot and never a raw merge completion path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const journal = await readyJournal(input)
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

  test('invalidates only the formula owner after all balance slices are complete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = balanceFixture(join(root, 'journal.json'))
      const journal = await readyJournal(input, [
        { targetId: 'balance-unit', targetKind: 'balance.unit' },
        { targetId: 'balance.formula.bad', targetKind: 'balance.formula' },
      ])
      const [first, second, third, fourth] = journal.slicePlan.slices
      const sourceUnit =
        realAuthority().phase5Authority.phase4Authority.balance.semantic
          .nodes[0]!
      const { bindings: _bindings, producerMode: _producerMode, ...unit } =
        sourceUnit as typeof sourceUnit & {
          bindings?: unknown
          producerMode?: unknown
        }
      await journal.append({
        status: 'completed',
        sliceId: first!.sliceId,
        semantic: {
          nodes: [unit],
          sourceEvidenceGroups: [
            {
              nodeIds: [unit.id],
              fragmentId: firstEvidenceFragmentId(
                input,
                input.packet.source.sectionIndex[0]!.documentPath,
                input.packet.source.sectionIndex[0]!.sectionId,
              ),
            },
          ],
        },
      } as unknown as GameIrProjectionSliceCompletion)
      await journal.append({
        status: 'completed',
        sliceId: second!.sliceId,
        semantic: {
          nodes: [
            {
              id: 'balance.formula.bad',
              kind: 'balance.formula',
              value: {
                label: 'Bad formula',
                expression: {
                  kind: 'literal',
                  value: 1,
                  unitReferenceIndex: 0,
                },
                outputUnitReferenceIndex: 0,
              },
              references: [
                { targetId: 'balance-unit', targetType: 'balance.unit' },
              ],
              edges: [],
            },
          ],
          sourceEvidenceGroups: [
            {
              nodeIds: ['balance.formula.bad'],
              fragmentId: firstEvidenceFragmentId(
                input,
                input.packet.source.sectionIndex[0]!.documentPath,
                input.packet.source.sectionIndex[0]!.sectionId,
              ),
            },
          ],
        },
      } as unknown as GameIrProjectionSliceCompletion)
      await journal.append(emptyCompletion(third!.sliceId))
      await journal.append(emptyCompletion(fourth!.sliceId))
      const diagnostic =
        'invalid Balance module: node balance.formula.bad formula expression.right.unit reference index is out of range'
      const rollback = await journal.rollbackOwnerForDiagnostic({
        ownerSliceId: second!.sliceId,
        obligationId: `balance:balance.formula:${'balance.formula.bad'}`,
        fragmentId: firstEvidenceFragmentId(
          input,
          input.packet.source.sectionIndex[0]!.documentPath,
          input.packet.source.sectionIndex[0]!.sectionId,
        ),
        recordId: 'balance.formula.bad',
        diagnosticDigest: digestGameIrValue(diagnostic),
      })
      expect(rollback).toEqual({
        scope: 'record',
        sliceId: second!.sliceId,
        recordId: 'balance.formula.bad',
        fragmentId: firstEvidenceFragmentId(
          input,
          input.packet.source.sectionIndex[0]!.documentPath,
          input.packet.source.sectionIndex[0]!.sectionId,
        ),
        reason: diagnostic,
      })
      expect(journal.entries.map(entry => entry.sliceId)).toEqual([
        first!.sliceId,
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('does not rollback an unknown module-level diagnostic', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = balanceFixture(join(root, 'journal.json'))
      const journal = await readyJournal(input)
      for (const slice of journal.slicePlan.slices)
        await journal.append(emptyCompletion(slice.sliceId))
      const before = journal.snapshot
      expect('rollbackCompletedOwnerForDiagnostic' in journal).toBe(false)
      expect(journal.snapshot).toEqual(before)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rolls back a completed owner addressed by its canonical node index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const journal = await readyJournal(input, [
        { targetId: 'entity.hero', targetKind: 'gameplay.entity' },
      ])
      const slice = journal.nextSlice!
      const fragmentId = firstEvidenceFragmentId(
        input,
        input.packet.source.sectionIndex[0]!.documentPath,
        input.packet.source.sectionIndex[0]!.sectionId,
      )
      await journal.append({
        status: 'completed',
        sliceId: slice.sliceId,
        semantic: {
          nodes: [
            {
              id: 'entity.hero',
              kind: 'gameplay.entity',
              value: { label: 'Hero' },
              references: [],
              edges: [],
            },
          ],
          sourceEvidenceGroups: [{ nodeIds: ['entity.hero'], fragmentId }],
        },
      } as unknown as GameIrProjectionSliceCompletion)
      await journal.append(emptyCompletion(journal.nextSlice!.sliceId))
      const rollback = await journal.rollbackOwnerForDiagnostic({
        ownerSliceId: slice.sliceId,
        obligationId: 'gameplay:gameplay.entity:entity.hero',
        fragmentId,
        recordId: 'entity.hero',
      })
      expect(rollback).toEqual({
        scope: 'record',
        sliceId: slice.sliceId,
        recordId: 'entity.hero',
        fragmentId,
        reason: 'invalid projection nodes[0] owner',
      })
      expect(journal.entries).toHaveLength(0)
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
      const sourceNode = authority.semantic.nodes.find(node =>
        input.slicePlan.slices.some(slice =>
          slice.nodeKinds.includes(node.kind),
        ),
      )!
      const journal = await readyJournal(input, [
        { targetId: sourceNode.id, targetKind: sourceNode.kind },
      ])
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
      const journal = await readyJournal(input, [
        { targetId: 'outcome.win', targetKind: 'gameplay.outcome' },
        { targetId: 'state.start', targetKind: 'gameplay.state' },
        { targetId: 'objective.escape', targetKind: 'gameplay.objective' },
        { targetId: 't', targetKind: 'gameplay.transition' },
      ])
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
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects unordered or duplicate node collections without repairing worker output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const authority = realAuthority().phase5Authority.phase4Authority.gameplay
      const journal = await readyJournal(input, [
        { targetId: 'condition.a', targetKind: 'gameplay.condition' },
        { targetId: 'event.z', targetKind: 'gameplay.event' },
        { targetId: 'state.a', targetKind: 'gameplay.state' },
        { targetId: 'action.canonical', targetKind: 'gameplay.action' },
      ])
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
      const journal = await readyJournal(input, [
        { targetId: 'state.a', targetKind: 'gameplay.state' },
        { targetId: 'state.b', targetKind: 'gameplay.state' },
        { targetId: 'state.c', targetKind: 'gameplay.state' },
        { targetId: 'action.cardinality', targetKind: 'gameplay.action' },
        { targetId: 'transition.cardinality', targetKind: 'gameplay.transition' },
      ])
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
      const journal = await readyJournal(input)
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

  test('persists an admitted current-slice prefix and promotes it only on completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const journal = await readyJournal(input)
      const authoritySection = input.packet.source.sectionIndex[0]!
      const record = {
        fragmentId: firstEvidenceFragmentId(
          input,
          authoritySection.documentPath,
          authoritySection.sectionId,
        ),
        node: {
          id: 'condition.a',
          kind: 'gameplay.condition',
          value: { expression: { kind: 'boolean', value: true } },
          references: [],
          edges: [],
        },
      } as const
      await expect(journal.appendRecords([record])).resolves.toEqual({
        acceptedCount: 1,
      })
      expect(journal.entries).toHaveLength(0)
      expect(journal.currentSliceRecordPrefix).toEqual([
        { id: 'condition.a', kind: 'gameplay.condition' },
      ])
      expect(journal.currentSliceRecordDigests).toHaveLength(1)
      expect(journal.currentSliceRecordDigests[0]).toMatch(/^[a-f0-9]{64}$/)
      const reloaded = await loadGameIrProjectionSliceJournal(input)
      expect(reloaded.currentSliceRecordPrefix).toEqual(
        journal.currentSliceRecordPrefix,
      )
      expect(reloaded.currentSliceRecordDigests).toEqual(
        journal.currentSliceRecordDigests,
      )
      await reloaded.completeCurrentSlice()
      expect(reloaded.entries).toHaveLength(1)
      expect(reloaded.currentSliceRecordPrefix).toEqual([])
      await expect(
        reloaded.appendRecords([record], journal.slicePlan.slices[0]!.sliceId),
      ).resolves.toEqual({ acceptedCount: 1, replayed: true })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('durably appends multiple records in one call without freezing the next append', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const journal = await readyJournal(input, [
        { targetId: 'condition.a', targetKind: 'gameplay.condition' },
        { targetId: 'condition.b', targetKind: 'gameplay.condition' },
      ])
      const fragmentId = firstEvidenceFragmentId(
        input,
        input.packet.source.sectionIndex[0]!.documentPath,
        input.packet.source.sectionIndex[0]!.sectionId,
      )
      const records = [
        {
          fragmentId,
          node: {
            id: 'condition.a',
            kind: 'gameplay.condition',
            value: { expression: { kind: 'boolean', value: true } },
            references: [],
            edges: [],
          },
        },
        {
          fragmentId,
          node: {
            id: 'condition.b',
            kind: 'gameplay.condition',
            value: { expression: { kind: 'boolean', value: false } },
            references: [],
            edges: [],
          },
        },
      ] as const
      await expect(journal.appendRecords(records)).resolves.toEqual({
        acceptedCount: 2,
      })
      expect(journal.currentSliceRecordPrefix).toEqual([
        { id: 'condition.a', kind: 'gameplay.condition' },
        { id: 'condition.b', kind: 'gameplay.condition' },
      ])
      const firstDigests = journal.currentSliceRecordDigests
      const reloaded = await loadGameIrProjectionSliceJournal(input)
      expect(reloaded.currentSliceRecordDigests).toEqual(firstDigests)
      await reloaded.completeCurrentSlice()
      expect(reloaded.entries[0]!.semantic.nodes.map(node => node.id)).toEqual([
        'condition.a',
        'condition.b',
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('replays an exact prefix idempotently and diagnoses conflicts or descending IDs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const input = fixture(join(root, 'journal.json'))
      const journal = await readyJournal(input, [
        { targetId: 'condition.a', targetKind: 'gameplay.condition' },
      ])
      const fragmentId = firstEvidenceFragmentId(
        input,
        input.packet.source.sectionIndex[0]!.documentPath,
        input.packet.source.sectionIndex[0]!.sectionId,
      )
      const record = {
        fragmentId,
        node: {
          id: 'condition.a',
          kind: 'gameplay.condition',
          value: { expression: { kind: 'boolean', value: true } },
          references: [],
          edges: [],
        },
      } as const
      await journal.appendRecords([record])
      await expect(journal.appendRecords([record])).resolves.toEqual({
        acceptedCount: 1,
      })
      const conflict = structuredClone(record) as any
      conflict.node.value.expression.value = false
      await expect(journal.appendRecords([conflict])).resolves.toMatchObject({
        acceptedCount: 0,
        diagnostic: { scope: 'record', recordId: 'condition.a' },
      })
      const descending = structuredClone(record) as any
      descending.node.id = 'condition.0'
      await expect(journal.appendRecords([descending])).resolves.toMatchObject({
        acceptedCount: 0,
        diagnostic: { scope: 'record', recordId: 'condition.0' },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('stages inventory and validation in one journal before projection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'game-ir-slice-journal-'))
    try {
      const base = balanceFixture(join(root, 'journal.json'))
      const journal = await createGameIrProjectionSliceJournal(base)
      expect(journal.preflightMode).toBe('obligation-inventory')
      expect(() => journal.nextSlice).toThrow(/preflight|validation|receipt/i)
      await expect(journal.append(emptyCompletion(journal.slicePlan.slices[0]!.sliceId)))
        .rejects.toThrow(/preflight|validation|receipt/i)

      const { inventory, receipt } = emptyInventoryAndReceipt(base)
      await journal.admitObligationInventory(inventory)
      expect(journal.preflightMode).toBe('obligation-validation')
      expect(journal.obligationInventory?.digest).toBe(inventory.digest)
      const reloadedWithInventory = await loadGameIrProjectionSliceJournal(base)
      expect(reloadedWithInventory.preflightMode).toBe('obligation-validation')
      expect(() => reloadedWithInventory.nextSlice).toThrow(/preflight|validation|receipt/i)

      await journal.admitObligationValidationReceipt(receipt)
      expect(journal.preflightMode).toBe('projection')
      const reloadedWithPass = await loadGameIrProjectionSliceJournal(base)
      expect(reloadedWithPass.preflightMode).toBe('projection')
      expect(reloadedWithPass.validationReceipt?.receiptDigest).toBe(receipt.receiptDigest)
      for (const slice of reloadedWithPass.slicePlan.slices)
        await reloadedWithPass.append(emptyCompletion(slice.sliceId))
      expect(reloadedWithPass.completedSnapshot.entries).toHaveLength(
        reloadedWithPass.slicePlan.slices.length,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
