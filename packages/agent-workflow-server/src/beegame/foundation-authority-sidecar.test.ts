import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import {
  authoritySidecarPath,
  canonicalFoundationAuthoritySidecarBytes,
  createDocumentSectionAuthoritySidecar,
  createFoundationAuthoritySidecar,
  validateFoundationAuthoritySidecar,
} from './foundation-authority-sidecar'

const markdown = '# Canonical GDD\n\nComplete authority.\n'

function bytewise(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function records() {
  return getGameDocumentContract('docs/GDD.md').sections
    .map(section => ({
      authorityId: `gdd.${section.sectionId}.primary`,
      sectionId: section.sectionId,
      kind: 'fact' as const,
      state: 'confirmed' as const,
      source: 'confirmed_brief' as const,
      evidenceRefs: [],
      statement: `Confirmed authority for ${section.sectionId}.`,
      responsibilityIds: [...section.responsibilityIds].sort(bytewise),
    }))
    .sort((left, right) => bytewise(left.authorityId, right.authorityId))
}

function legacyRecords() {
  return records().map(({ source: _source, evidenceRefs: _evidenceRefs, ...record }) =>
    record,
  )
}

function storedSidecarV1() {
  return {
    schemaVersion: 1 as const,
    documentPath: 'docs/GDD.md' as const,
    documentDigest: createHash('sha256').update(markdown).digest('hex'),
    records: legacyRecords(),
  }
}

function storedSidecar() {
  return {
    schemaVersion: 2 as const,
    documentPath: 'docs/GDD.md' as const,
    documentDigest: createHash('sha256').update(markdown).digest('hex'),
    records: records(),
  }
}

describe('foundation authority sidecar', () => {
  test('derives a trustworthy section index from the completed Markdown file', () => {
    const path = 'docs/GDD.md' as const
    const contract = getGameDocumentContract(path)
    const markdown = '# Game Design Document\n\nCompleted human-authored content.\n'
    const sidecar = createDocumentSectionAuthoritySidecar({
      documentPath: path,
      markdown,
    })

    expect(sidecar.records).toHaveLength(contract.sections.length)
    expect(sidecar.records[0]).toMatchObject({
      authorityId: 'gdd.accessibility_localization.canonical_section',
      source: 'upstream_authority',
      state: 'confirmed',
      evidenceRefs: [
        {
          kind: 'file',
          locator: 'docs/GDD.md#accessibility_localization',
          digest: sidecar.documentDigest,
        },
      ],
    })
    expect(
      validateFoundationAuthoritySidecar({
        documentPath: path,
        markdown,
        value: sidecar,
      }),
    ).toEqual(sidecar)
  })

  test('creates canonical frozen sidecars with service-owned identity', () => {
    const sidecar = createFoundationAuthoritySidecar({
      documentPath: 'docs/GDD.md',
      markdown,
      submission: { records: records() },
    })

    expect(sidecar).toEqual(storedSidecar())
    expect(authoritySidecarPath('docs/GDD.md')).toBe(
      'docs/GDD.authority.json',
    )
    expect(Object.isFrozen(sidecar)).toBe(true)
    expect(Object.isFrozen(sidecar.records)).toBe(true)
    expect(sidecar.records.every(Object.isFrozen)).toBe(true)
    expect(
      canonicalFoundationAuthoritySidecarBytes(sidecar),
    ).toBe(`${JSON.stringify(sidecar, null, 2)}\n`)
  })

  test('reads v1 sidecars without upgrading legacy trust', () => {
    const sidecar = validateFoundationAuthoritySidecar({
      documentPath: 'docs/GDD.md',
      markdown,
      value: storedSidecarV1(),
    })

    expect(sidecar.schemaVersion).toBe(1)
    expect(sidecar.records[0]).toMatchObject({
      state: 'confirmed',
      source: 'upstream_authority',
      evidenceRefs: [],
    })
    expect(sidecar.records.some(record => record.state === 'verified')).toBe(false)
  })

  test('rejects model estimates that claim confirmed or verified authority', () => {
    const valid = records()
    const first = valid[0]!
    for (const state of ['confirmed', 'verified'] as const) {
      expect(() =>
        createFoundationAuthoritySidecar({
          documentPath: 'docs/GDD.md',
          markdown,
          submission: {
            records: valid.map(record =>
              record.authorityId === first.authorityId
                ? { ...record, source: 'model_estimate', state }
                : record,
            ),
          },
        }),
      ).toThrow(/model estimate|model_estimate/i)
    }
  })

  test('requires evidence for verified authority', () => {
    const valid = records()
    const first = valid[0]!
    expect(() =>
      createFoundationAuthoritySidecar({
        documentPath: 'docs/GDD.md',
        markdown,
        submission: {
          records: valid.map(record =>
            record.authorityId === first.authorityId
              ? {
                  ...record,
                  source: 'measured_evidence',
                  state: 'verified',
                  evidenceRefs: [],
                }
              : record,
          ),
        },
      }),
    ).toThrow(/evidence/i)

    const sidecar = createFoundationAuthoritySidecar({
      documentPath: 'docs/GDD.md',
      markdown,
      submission: {
        records: valid.map(record =>
          record.authorityId === first.authorityId
            ? {
                ...record,
                source: 'measured_evidence',
                state: 'verified',
                evidenceRefs: [
                  {
                    kind: 'measurement',
                    locator: 'measurement:playtest.primary-action-time',
                  },
                ],
              }
            : record,
        ),
      },
    })
    expect(sidecar.records.find(record => record.authorityId === first.authorityId)).toMatchObject({
      state: 'verified',
      source: 'measured_evidence',
    })
  })

  test('requires deferred open decisions with owner and milestone metadata', () => {
    const valid = records()
    const first = valid[0]!
    for (const mutation of [
      { ...first, kind: 'open_decision', state: 'deferred' },
      {
        ...first,
        kind: 'open_decision',
        state: 'confirmed',
        decision: { owner: 'product', neededBy: 'milestone.prototype' },
      },
    ]) {
      expect(() =>
        createFoundationAuthoritySidecar({
          documentPath: 'docs/GDD.md',
          markdown,
          submission: {
            records: valid.map(record =>
              record.authorityId === first.authorityId ? mutation : record,
            ),
          },
        }),
      ).toThrow(/open decision|decision/i)
    }

    expect(() =>
      createFoundationAuthoritySidecar({
        documentPath: 'docs/GDD.md',
        markdown,
        submission: {
          records: valid.map(record =>
            record.authorityId === first.authorityId
              ? {
                  ...record,
                  kind: 'open_decision',
                  state: 'deferred',
                  source: 'model_estimate',
                  decision: {
                    owner: 'product',
                    neededBy: 'milestone.prototype',
                  },
                }
              : record,
          ),
        },
      }),
    ).not.toThrow()

    expect(() =>
      createFoundationAuthoritySidecar({
        documentPath: 'docs/GDD.md',
        markdown,
        submission: {
          records: valid.map(record =>
            record.authorityId === first.authorityId
              ? {
                  ...record,
                  kind: 'open_decision',
                  state: 'deferred',
                  source: 'confirmed_brief',
                  decision: {
                    owner: 'product',
                    neededBy: 'milestone.prototype',
                  },
                }
              : record,
          ),
        },
      }),
    ).not.toThrow()
  })

  test('rejects lower-priority redefinitions of the same authority ID', () => {
    const valid = records()
    const first = { ...valid[0]!, source: 'user_setting' as const }
    const lowerPriority = {
      ...first,
      source: 'model_estimate' as const,
      state: 'assumed' as const,
    }
    expect(() =>
      createFoundationAuthoritySidecar({
        documentPath: 'docs/GDD.md',
        markdown,
        submission: {
          records: [
            first,
            ...valid.slice(1),
            lowerPriority,
          ],
        },
      }),
    ).toThrow(/priority|replace/i)
  })

  test('canonicalizes submission record and responsibility ordering', () => {
    const unordered = records()
      .map(record => ({
        ...record,
        responsibilityIds: [...record.responsibilityIds].reverse(),
      }))
      .reverse()
    const sidecar = createFoundationAuthoritySidecar({
      documentPath: 'docs/GDD.md',
      markdown,
      submission: { records: unordered },
    })

    expect(sidecar.records).toEqual(records())
  })

  test('rejects stale identity, noncanonical ordering, and duplicate records', () => {
    const valid = storedSidecar()
    expect(() =>
      validateFoundationAuthoritySidecar({
        documentPath: 'docs/GDD.md',
        markdown: `${markdown}changed`,
        value: valid,
      }),
    ).toThrow(/digest/i)
    expect(() =>
      validateFoundationAuthoritySidecar({
        documentPath: 'docs/GDD.md',
        markdown,
        value: { ...valid, documentPath: 'docs/LEVEL_SCENE_DESIGN.md' },
      }),
    ).toThrow(/path/i)
    expect(() =>
      validateFoundationAuthoritySidecar({
        documentPath: 'docs/GDD.md',
        markdown,
        value: { ...valid, records: [...valid.records].reverse() },
      }),
    ).toThrow(/order/i)
    expect(() =>
      validateFoundationAuthoritySidecar({
        documentPath: 'docs/GDD.md',
        markdown,
        value: { ...valid, records: [...valid.records, valid.records[0]] },
      }),
    ).toThrow(/duplicate|order/i)
  })

  test('rejects records outside their section contract', () => {
    const valid = storedSidecar()
    const first = valid.records[0]!
    const mutations = [
      { ...first, sectionId: 'not_a_section' },
      { ...first, responsibilityIds: ['technical_architecture'] },
      { ...first, authorityId: 'other.scope.primary' },
      { ...first, statement: 'Markdown\nparagraph' },
    ]
    for (const mutation of mutations) {
      const changed = valid.records
        .map(record => (record.authorityId === first.authorityId ? mutation : record))
        .sort((left, right) => bytewise(left.authorityId, right.authorityId))
      expect(() =>
        validateFoundationAuthoritySidecar({
          documentPath: 'docs/GDD.md',
          markdown,
          value: { ...valid, records: changed },
        }),
      ).toThrow()
    }
  })

  test('requires complete section coverage and valid authority states', () => {
    const valid = storedSidecar()
    const first = valid.records[0]!
    expect(() =>
      validateFoundationAuthoritySidecar({
        documentPath: 'docs/GDD.md',
        markdown,
        value: { ...valid, records: valid.records.slice(1) },
      }),
    ).toThrow(/coverage/i)

    for (const mutation of [
      { ...first, kind: 'open_decision', state: 'confirmed' },
      { ...first, kind: 'metric', value: 60 },
    ]) {
      const changed = valid.records
        .map(record => (record.authorityId === first.authorityId ? mutation : record))
        .sort((left, right) => bytewise(left.authorityId, right.authorityId))
      expect(() =>
        validateFoundationAuthoritySidecar({
          documentPath: 'docs/GDD.md',
          markdown,
          value: { ...valid, records: changed },
        }),
      ).toThrow()
    }
  })

  test('rejects sidecars larger than the bounded machine interface', () => {
    const valid = storedSidecar()
    const expanded = Array.from({ length: 220 }, (_, index) => ({
      ...valid.records[index % valid.records.length]!,
      authorityId: `gdd.vision.oversized-${String(index).padStart(3, '0')}`,
      sectionId: 'vision',
      statement: `Bounded authority ${index} ${'x'.repeat(500)}`,
      responsibilityIds: ['product_vision'],
    }))
    const combined = [...valid.records, ...expanded].sort((left, right) =>
      bytewise(left.authorityId, right.authorityId),
    )
    expect(() =>
      validateFoundationAuthoritySidecar({
        documentPath: 'docs/GDD.md',
        markdown,
        value: { ...valid, records: combined },
      }),
    ).toThrow(/96|size/i)
  })
})
