import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import {
  authoritySidecarPath,
  canonicalFoundationAuthoritySidecarBytes,
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
      statement: `Confirmed authority for ${section.sectionId}.`,
      responsibilityIds: [...section.responsibilityIds].sort(bytewise),
    }))
    .sort((left, right) => bytewise(left.authorityId, right.authorityId))
}

function storedSidecar() {
  return {
    schemaVersion: 1 as const,
    documentPath: 'docs/GDD.md' as const,
    documentDigest: createHash('sha256').update(markdown).digest('hex'),
    records: records(),
  }
}

describe('foundation authority sidecar', () => {
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
