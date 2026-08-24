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
  14: 'e96f3be72863e49335cfa40a30339e3aba4bc8731a94c6e7dd71dc806772502f',
  15: 'b3ab7051195615c4fc10604119a5d5c182d8c5d5dd148e36eff7727f0d949c17',
  16: 'babed79caaa373722db640fe32cd31e1b96d40c8b21e6c994f4979e10652d16c',
  17: 'dc68dca067800b5b15de725cba916d95313ed311b61023a239a456f5033f6723',
  18: '2352e359db168510bb94df80f2d3c503c31cc103c5102e62027e70b74232d52f',
  19: 'fa7ed231a746a3fc859f8d427f4dcfdd098f64a18efdfb15f378cdbdfb90848b',
  20: '1877eb5bed542b4d0ec97f3ef3bfda55523f63eb2a20e3aa744c5f8c4000e29a',
  21: 'f7a9be464348e9b3b147eab4675439e24035ef776c502779c8672ae6069ac820',
  22: '3f5bbd9d8653e4043879c1eb34f2f2fa2662457cbd6ae4b9af51dfd9361cdb81',
  23: '5f5058823411b98aeebedd5e015b1f54f3f2db02ceb2bc41feed3ca19645929e',
  24: 'facee311b19a5f1ebc85ff6a762d7a8ef9909ec8502fa530765f52263d3073df',
  25: '8aee130912d5c1b6313946d8ed6579ba470443667fe3fb7b218ad782367975ef',
  26: '88dcdf3314759e405f38b211fa56dcc8642b4bf3e7547b12983aba9c03557245',
  27: 'f1437b7488bf6a0844e14eeda637189c9dd681e68bd5d202082acd6528df84b7',
  28: 'cb10b23c9676f0d66e8deba45505d5d1b0a974871fc8e2ba2e63a207694ab0b6',
  29: '3b018da54421c0afa25daae8d231fea138a464d8918e5b31dfc5eb3bf349924c',
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
