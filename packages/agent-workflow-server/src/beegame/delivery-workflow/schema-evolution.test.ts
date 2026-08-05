import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { deliveryRunSchema, workflowUnitAcceptedEventSchema } from './schema'
import { DELIVERY_RUN_SCHEMA_VERSION } from './types'

const PERSISTED_SCHEMA_FINGERPRINTS: Readonly<Record<number, string>> = {
  13: 'be8121aaa71ccc50e7e7ff2dda166f1d0c92a494a7faf87b8968ff61cdf4499a',
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  )
}

function currentPersistedSchemaFingerprint(): string {
  const topology = canonicalize({
    acceptedUnitJournalEvent: z.toJSONSchema(workflowUnitAcceptedEventSchema),
    deliveryRun: z.toJSONSchema(deliveryRunSchema),
  })
  return createHash('sha256').update(JSON.stringify(topology)).digest('hex')
}

describe('persisted workflow schema evolution', () => {
  test('requires a version increment and migration for structural schema changes', () => {
    const expected = PERSISTED_SCHEMA_FINGERPRINTS[DELIVERY_RUN_SCHEMA_VERSION]
    expect(
      expected,
      `DELIVERY_RUN_SCHEMA_VERSION ${DELIVERY_RUN_SCHEMA_VERSION} has no registered persisted schema fingerprint; register the new fingerprint and migration`,
    ).toBeDefined()
    expect(
      currentPersistedSchemaFingerprint(),
      `persisted workflow schema changed at DELIVERY_RUN_SCHEMA_VERSION ${DELIVERY_RUN_SCHEMA_VERSION}; increment DELIVERY_RUN_SCHEMA_VERSION and add a snapshot migration`,
    ).toBe(expected)
  })
})
