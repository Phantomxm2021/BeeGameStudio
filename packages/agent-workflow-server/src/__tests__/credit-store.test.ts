import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  getCreditBalance,
  listCreditLedger,
  reserveCredits,
  settleCreditReservation,
  summarizeCreditLedger,
} from '../credit-store'

describe('credit-store', () => {
  test('reserves and settles credits with ledger entries', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-credit-store-'))
    try {
      const reservation = reserveCredits('user-a', {
        dataDir,
        credits: 5,
        kind: 'generation',
        projectId: 'project-a',
        metadata: { phase: 'intake' },
      })

      expect(reservation.reservedCredits).toBe(5)
      expect(getCreditBalance('user-a', { dataDir })).toEqual(expect.objectContaining({
        balanceCredits: 295,
        consumedCredits: 0,
        reservedCredits: 5,
      }))

      const settled = settleCreditReservation('user-a', {
        dataDir,
        reservationId: reservation.id,
        weightedTokens: 23_001,
        projectId: 'project-a',
        metadata: { phase: 'intake' },
      })

      expect(settled.settledCredits).toBe(3)
      expect(settled.refundedCredits).toBe(2)
      expect(getCreditBalance('user-a', { dataDir })).toEqual(expect.objectContaining({
        balanceCredits: 297,
        consumedCredits: 3,
        reservedCredits: 0,
      }))
      expect(listCreditLedger('user-a', { dataDir }).map(entry => ({
        kind: entry.kind,
        credits: entry.credits,
        weightedTokens: entry.weightedTokens,
        projectId: entry.projectId,
      }))).toEqual([
        {
          kind: 'reserve',
          credits: 5,
          weightedTokens: undefined,
          projectId: 'project-a',
        },
        {
          kind: 'settle',
          credits: 3,
          weightedTokens: 23_001,
          projectId: 'project-a',
        },
        {
          kind: 'refund',
          credits: 2,
          weightedTokens: undefined,
          projectId: 'project-a',
        },
      ])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('summarizes settled and reserved credits for one project', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-credit-store-'))
    try {
      const projectAReservation = reserveCredits('user-a', {
        dataDir,
        credits: 10,
        kind: 'full_build',
        projectId: 'project-a',
      })
      settleCreditReservation('user-a', {
        dataDir,
        reservationId: projectAReservation.id,
        weightedTokens: 31_000,
        projectId: 'project-a',
      })
      reserveCredits('user-a', {
        dataDir,
        credits: 5,
        kind: 'edit_turn',
        projectId: 'project-a',
      })
      reserveCredits('user-a', {
        dataDir,
        credits: 50,
        kind: 'edit_turn',
        projectId: 'project-b',
      })

      expect(summarizeCreditLedger('user-a', { dataDir, projectId: 'project-a' })).toEqual({
        entriesCount: 4,
        reservedCredits: 15,
        settledCredits: 4,
        refundedCredits: 6,
        outstandingReservedCredits: 5,
        weightedTokens: 31_000,
      })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
