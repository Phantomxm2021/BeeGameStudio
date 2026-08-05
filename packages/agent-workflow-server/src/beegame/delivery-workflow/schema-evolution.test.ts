import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import {
  deliveryRunSchema,
  tasksPlannedEventSchema,
  workflowUnitAcceptedEventSchema,
} from './schema'
import { DELIVERY_RUN_SCHEMA_VERSION } from './types'

const PERSISTED_SCHEMA_FINGERPRINTS: Readonly<Record<number, string>> = {
  13: '263640f06ada501afb0421806f29215b83e54b4fb239591b9dc1256e8e4b5067',
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
    tasksPlannedJournalEvent: z.toJSONSchema(tasksPlannedEventSchema),
  })
  return createHash('sha256').update(JSON.stringify(topology)).digest('hex')
}

describe('persisted workflow schema evolution', () => {
  test('requires a version increment for structural schema changes', () => {
    const expected = PERSISTED_SCHEMA_FINGERPRINTS[DELIVERY_RUN_SCHEMA_VERSION]
    expect(
      expected,
      `DELIVERY_RUN_SCHEMA_VERSION ${DELIVERY_RUN_SCHEMA_VERSION} has no registered persisted schema fingerprint`,
    ).toBeDefined()
    expect(
      currentPersistedSchemaFingerprint(),
      `persisted workflow schema changed at DELIVERY_RUN_SCHEMA_VERSION ${DELIVERY_RUN_SCHEMA_VERSION}; increment DELIVERY_RUN_SCHEMA_VERSION`,
    ).toBe(expected)
  })
})
