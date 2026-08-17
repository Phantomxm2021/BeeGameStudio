import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../../__tests__/complete-game-document-fixture'
import { getGameDocumentContract } from './game-document-contracts'
import {
  assembleFoundationRemediationTransaction,
  buildFoundationRemediationTransactionRequest,
} from './foundation-remediation-transaction'
import type { FoundationReview } from './foundation-review'

const PATH = 'docs/GDD.md' as const
const REVIEW_DIGEST = 'a'.repeat(64)
const SOURCE_REVISION = 'b'.repeat(64)
const PREVIOUS_UPDATED_AT = '2026-08-17T10:00:00.000Z'
const COMMITTED_AT = '2026-08-17T11:00:00.000Z'

function canonicalDocument(): string {
  return [
    '---',
    'document_id: GDD',
    'version: 1.0.0',
    `updated_at: ${PREVIOUS_UPDATED_AT}`,
    '---',
    renderTestCompleteGameDocument(PATH, completeTestSubmission(PATH)).trimEnd(),
    '',
  ].join('\n')
}

function conflict(): FoundationReview['conflicts'][number] {
  return {
    id: 'B1',
    title: 'Core loop authority is incomplete',
    problem: 'The implementation boundary cannot be verified.',
    evidence: [
      {
        path: PATH,
        location: 'Core loop section',
        observed: 'The acceptance boundary is missing.',
      },
    ],
    requiredOutcome: 'Define one observable implementation boundary.',
    changes: [
      {
        path: PATH,
        action: 'Add the observable boundary to the core loop authority.',
      },
    ],
    acceptance: ['The core loop authority has an observable boundary.'],
  }
}

function request() {
  return buildFoundationRemediationTransactionRequest({
    sourcePath: PATH,
    sourceMarkdown: canonicalDocument(),
    reviewDigest: REVIEW_DIGEST,
    sourceRevision: SOURCE_REVISION,
    conflicts: [conflict()],
  })
}

describe('foundation remediation section transaction', () => {
  test('accepts a canonical document without the optional audit appendix', () => {
    const sourceMarkdown = canonicalDocument().split(
      '<!-- beegame-audit-appendix -->',
    )[0]!
    const projected = buildFoundationRemediationTransactionRequest({
      sourcePath: PATH,
      sourceMarkdown,
      reviewDigest: REVIEW_DIGEST,
      sourceRevision: SOURCE_REVISION,
      conflicts: [conflict()],
    })

    expect(projected.units.at(-1)?.unitId).toStartWith('material:')
    expect(projected.units.at(-1)?.endLine).toBe(
      sourceMarkdown.split('\n').length,
    )
  })

  test('projects the source once and atomically replaces one canonical body unit', () => {
    const projected = request()
    const contract = getGameDocumentContract(PATH)
    expect(projected.units.map(unit => String(unit.unitId))).toEqual([
      'executive-summary',
      ...contract.sections.map(section => `section:${section.sectionId}`),
      ...contract.productionMaterials.map(
        material => `material:${material.materialId}`,
      ),
    ])
    expect(projected.units.every(unit => !('body' in unit))).toBeTrue()
    expect(projected.sourceMarkdown).toBe(canonicalDocument())

    const target = projected.units.find(unit =>
      unit.unitId.startsWith('section:'),
    )!
    const assembled = assembleFoundationRemediationTransaction({
      request: projected,
      result: {
        version: 1,
        sourcePath: PATH,
        sourceDigest: projected.sourceDigest,
        resolvedConflictIds: ['B1'],
        patches: [
          {
            unitId: target.unitId,
            expectedBodyDigest: target.bodyDigest,
            replacementBody:
              'Revised authority with an observable implementation boundary and a concrete verification result.',
          },
        ],
      },
      previousMetadata: {
        version: '1.0.0',
        updatedAt: PREVIOUS_UPDATED_AT,
      },
      committedAt: COMMITTED_AT,
    })

    expect(assembled.receipt).toEqual({
      reviewDigest: REVIEW_DIGEST,
      sourceRevision: SOURCE_REVISION,
      targetPath: PATH,
      sourceDigest: projected.sourceDigest,
      patchedUnitIds: [target.unitId],
      finalDigest: createHash('sha256')
        .update(assembled.markdown)
        .digest('hex'),
      committedAt: COMMITTED_AT,
    })
    expect(assembled.markdown).toContain('version: 1.0.1')
    expect(assembled.markdown).toContain(`updated_at: ${COMMITTED_AT}`)
    expect(assembled.markdown).toContain('Revised authority')
    expect(assembled.markdown).toContain(
      '<!-- beegame-executive-summary -->\n## Executive Summary',
    )
  })

  test('rejects stale source and body digests', () => {
    const projected = request()
    const target = projected.units[1]!
    const valid = {
      version: 1 as const,
      sourcePath: PATH,
      sourceDigest: projected.sourceDigest,
      resolvedConflictIds: ['B1'],
      patches: [
        {
          unitId: target.unitId,
          expectedBodyDigest: target.bodyDigest,
          replacementBody: 'A valid replacement body with concrete authority.',
        },
      ],
    }
    expect(() =>
      assembleFoundationRemediationTransaction({
        request: projected,
        result: { ...valid, sourceDigest: 'c'.repeat(64) },
        previousMetadata: {
          version: '1.0.0',
          updatedAt: PREVIOUS_UPDATED_AT,
        },
        committedAt: COMMITTED_AT,
      }),
    ).toThrow('foundation remediation source digest changed')
    expect(() =>
      assembleFoundationRemediationTransaction({
        request: projected,
        result: {
          ...valid,
          patches: [
            { ...valid.patches[0]!, expectedBodyDigest: 'd'.repeat(64) },
          ],
        },
        previousMetadata: {
          version: '1.0.0',
          updatedAt: PREVIOUS_UPDATED_AT,
        },
        committedAt: COMMITTED_AT,
      }),
    ).toThrow('foundation remediation body digest changed')
  })

  test('requires exact conflict closure and canonical unique patch order', () => {
    const projected = request()
    const first = projected.units[1]!
    const second = projected.units[2]!
    const base = {
      version: 1 as const,
      sourcePath: PATH,
      sourceDigest: projected.sourceDigest,
      resolvedConflictIds: ['B1'],
    }
    const assemble = (result: unknown) =>
      assembleFoundationRemediationTransaction({
        request: projected,
        result,
        previousMetadata: {
          version: '1.0.0',
          updatedAt: PREVIOUS_UPDATED_AT,
        },
        committedAt: COMMITTED_AT,
      })

    expect(() =>
      assemble({
        ...base,
        resolvedConflictIds: [],
        patches: [
          {
            unitId: first.unitId,
            expectedBodyDigest: first.bodyDigest,
            replacementBody: 'First replacement authority.',
          },
        ],
      }),
    ).toThrow('foundation remediation conflict closure is incomplete')
    expect(() =>
      assemble({
        ...base,
        patches: [
          {
            unitId: second.unitId,
            expectedBodyDigest: second.bodyDigest,
            replacementBody: 'Second replacement authority.',
          },
          {
            unitId: first.unitId,
            expectedBodyDigest: first.bodyDigest,
            replacementBody: 'First replacement authority.',
          },
        ],
      }),
    ).toThrow('foundation remediation patches are not in canonical order')
    expect(() =>
      assemble({
        ...base,
        patches: [
          {
            unitId: first.unitId,
            expectedBodyDigest: first.bodyDigest,
            replacementBody: 'First replacement authority.',
          },
          {
            unitId: first.unitId,
            expectedBodyDigest: first.bodyDigest,
            replacementBody: 'Duplicate replacement authority.',
          },
        ],
      }),
    ).toThrow('foundation remediation patch units must be unique')
  })

  test('rejects replacement bodies that can escape their canonical unit', () => {
    const projected = request()
    const target = projected.units[1]!
    const assemble = (replacementBody: string) =>
      assembleFoundationRemediationTransaction({
        request: projected,
        result: {
          version: 1,
          sourcePath: PATH,
          sourceDigest: projected.sourceDigest,
          resolvedConflictIds: ['B1'],
          patches: [
            {
              unitId: target.unitId,
              expectedBodyDigest: target.bodyDigest,
              replacementBody,
            },
          ],
        },
        previousMetadata: {
          version: '1.0.0',
          updatedAt: PREVIOUS_UPDATED_AT,
        },
        committedAt: COMMITTED_AT,
      })

    expect(() => assemble('# Replacement document')).toThrow(
      'foundation remediation replacement contains a document title',
    )
    expect(() => assemble('<!-- beegame-section:escape -->')).toThrow(
      'foundation remediation replacement contains a protocol marker',
    )
    expect(() => assemble('## Production Materials')).toThrow(
      'foundation remediation replacement contains a canonical unit heading',
    )
  })
})
