import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  expireStaleCreditReservations,
  getCreditBalance,
  grantCredits,
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
        idempotencyKey: 'intake-request-reserve',
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
        idempotencyKey: 'intake-request-settle',
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
        metadata: entry.metadata,
      }))).toEqual([
        {
          kind: 'reserve',
          credits: 5,
          weightedTokens: undefined,
          projectId: 'project-a',
          metadata: {
            kind: 'generation',
            phase: 'intake',
            idempotencyKey: 'intake-request-reserve',
          },
        },
        {
          kind: 'settle',
          credits: 3,
          weightedTokens: 23_001,
          projectId: 'project-a',
          metadata: {
            phase: 'intake',
            idempotencyKey: 'intake-request-settle',
          },
        },
        {
          kind: 'refund',
          credits: 2,
          weightedTokens: undefined,
          projectId: 'project-a',
          metadata: { reason: 'unused_reservation' },
        },
      ])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('settles actual usage above the initial reservation when balance is available', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-credit-overage-'))
    try {
      const reservation = reserveCredits('user-a', {
        dataDir,
        credits: 2,
        kind: 'full_build',
      })
      const settled = settleCreditReservation('user-a', {
        dataDir,
        reservationId: reservation.id,
        weightedTokens: 35_001,
      })

      expect(settled).toEqual(expect.objectContaining({
        reservedCredits: 2,
        settledCredits: 4,
        refundedCredits: 0,
      }))
      expect(getCreditBalance('user-a', { dataDir })).toEqual(expect.objectContaining({
        balanceCredits: 296,
        consumedCredits: 4,
        reservedCredits: 0,
      }))
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('keeps the reservation open when actual usage exceeds the available balance', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-credit-overage-'))
    try {
      const reservation = reserveCredits('user-a', {
        dataDir,
        credits: 200,
        kind: 'full_build',
      })

      expect(() => settleCreditReservation('user-a', {
        dataDir,
        reservationId: reservation.id,
        weightedTokens: 3_000_001,
      })).toThrow('Insufficient credits to settle actual token usage')
      expect(getCreditBalance('user-a', { dataDir })).toEqual(expect.objectContaining({
        balanceCredits: 100,
        consumedCredits: 0,
        reservedCredits: 200,
      }))
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('grants credits with provider-neutral payment metadata', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-credit-store-'))
    try {
      const grant = grantCredits('user-a', {
        dataDir,
        credits: 25,
        metadata: {
          source: 'payment_provider',
          provider: 'manual',
          providerReference: 'manual-topup-1',
          reason: 'operator_credit_topup',
        },
        now: new Date('2026-07-08T12:00:00.000Z'),
      })

      expect(grant.grantedCredits).toBe(25)
      expect(grant.balance).toEqual(expect.objectContaining({
        includedCredits: 325,
        balanceCredits: 325,
        consumedCredits: 0,
        reservedCredits: 0,
      }))
      expect(listCreditLedger('user-a', { dataDir })).toContainEqual(expect.objectContaining({
        userId: 'user-a',
        kind: 'grant',
        credits: 25,
        metadata: {
          source: 'payment_provider',
          provider: 'manual',
          providerReference: 'manual-topup-1',
          reason: 'operator_credit_topup',
        },
        createdAt: '2026-07-08T12:00:00.000Z',
      }))
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

  test('expires stale reservations without touching active or settled reservations', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-credit-store-'))
    try {
      const staleReservation = reserveCredits('user-a', {
        dataDir,
        credits: 7,
        kind: 'edit_turn',
        projectId: 'project-a',
        now: new Date('2026-07-08T08:00:00.000Z'),
      })
      const activeReservation = reserveCredits('user-a', {
        dataDir,
        credits: 5,
        kind: 'edit_turn',
        projectId: 'project-a',
        now: new Date('2026-07-08T10:00:00.000Z'),
      })
      const settledReservation = reserveCredits('user-a', {
        dataDir,
        credits: 3,
        kind: 'edit_turn',
        projectId: 'project-a',
        now: new Date('2026-07-08T08:15:00.000Z'),
      })
      settleCreditReservation('user-a', {
        dataDir,
        reservationId: settledReservation.id,
        weightedTokens: 10_000,
        projectId: 'project-a',
      })

      const expired = expireStaleCreditReservations('user-a', {
        dataDir,
        olderThan: new Date('2026-07-08T09:00:00.000Z'),
        projectId: 'project-a',
      })

      expect(expired.expiredReservations).toEqual([staleReservation.id])
      expect(expired.refundedCredits).toBe(7)
      expect(expired.balance).toEqual(expect.objectContaining({
        consumedCredits: 1,
        reservedCredits: 5,
        balanceCredits: 294,
      }))
      expect(listCreditLedger('user-a', { dataDir }).map(entry => ({
        kind: entry.kind,
        credits: entry.credits,
        reservationId: entry.reservationId,
        metadata: entry.metadata,
      }))).toContainEqual({
        kind: 'refund',
        credits: 7,
        reservationId: staleReservation.id,
        metadata: { reason: 'stale_reservation_expired' },
      })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
