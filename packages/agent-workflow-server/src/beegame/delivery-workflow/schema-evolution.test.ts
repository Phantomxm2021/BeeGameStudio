import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import {
  deliveryRunSchema,
  tasksPlannedEventSchema,
  workflowUnitAcceptedEventSchema,
} from './schema'
import {
  SUPPORTED_WORKFLOW_SNAPSHOT_VERSIONS,
  WORKFLOW_SNAPSHOT_MIGRATIONS,
} from './snapshot-migrations'
import { DELIVERY_RUN_SCHEMA_VERSION } from './types'

const PERSISTED_SCHEMA_FINGERPRINTS: Readonly<Record<number, string>> = {
  13: '2dd56a8ef8057464d6f5f79ecb01439f89b529f0ed7550ed63954d4c496106ac',
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

  test('requires one explicit complete migration chain from every supported prior version', () => {
    expect(SUPPORTED_WORKFLOW_SNAPSHOT_VERSIONS.at(-1)).toBe(
      DELIVERY_RUN_SCHEMA_VERSION,
    )
    for (const version of SUPPORTED_WORKFLOW_SNAPSHOT_VERSIONS) {
      if (version === DELIVERY_RUN_SCHEMA_VERSION) continue
      let cursor: number = version
      const visited = new Set<number>()
      while (cursor < DELIVERY_RUN_SCHEMA_VERSION) {
        expect(
          visited.has(cursor),
          `migration chain cycles at v${cursor}`,
        ).toBe(false)
        visited.add(cursor)
        const edges = WORKFLOW_SNAPSHOT_MIGRATIONS.filter(
          migration => migration.from === cursor,
        )
        expect(
          edges,
          `supported workflow snapshot v${version} has no unique migration edge from v${cursor}`,
        ).toHaveLength(1)
        expect(
          Number(edges[0]?.to),
          `workflow snapshot migration v${cursor} must advance exactly one version`,
        ).toBe(cursor + 1)
        cursor = edges[0]!.to
      }
      expect(cursor).toBe(DELIVERY_RUN_SCHEMA_VERSION)
    }
  })
})
