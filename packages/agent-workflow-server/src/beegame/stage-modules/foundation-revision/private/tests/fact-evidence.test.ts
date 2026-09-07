import { expect, test } from 'bun:test'
import { FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS } from '../../../foundation-reviewer/private/domain/foundation-audit-authority'
import { FOUNDATION_FACT_CATALOG } from '../../../foundation-reviewer/private/domain/foundation-fact-definitions'
import { reviewerRepairEvidenceKeys } from '../../../foundation-reviewer/private/repair-evidence'
import { reviewFixtureDocuments } from '../../../foundation-reviewer/private/test-fixtures/review-fixture'
import { buildFoundationSectionIndex } from '../domain/foundation-section-index'
import {
  REVISION_DETERMINISTIC_CONTRACT_ENDPOINTS,
  REVISION_FACT_HANDOFF_CONSTRAINTS,
} from '../domain/fact-handoff-constraints'
import { assertRevisionFactConstraint, revisionRepairEvidenceKeys } from '../fact-evidence'

const documents = reviewFixtureDocuments(true)
const index = buildFoundationSectionIndex({ documents: new Map(documents.map(document => [document.path, document.content])) })
const refFor = (documentPath: string, sectionId: string) => index.find(ref => ref.documentPath === documentPath && ref.sectionId === sectionId)!

function issueFor(documentPath: string, sectionId: string, extra: Record<string, unknown> = {}) {
  const source = refFor(documentPath, sectionId)
  return { id: `${documentPath}-${sectionId}`, severity: 'HIGH' as const, type: 'rule' as const, source,
    expected: 'expected', actual: 'actual', remediation: { kind: 'patch' as const, scope: 'section' as const, documentPath, sectionIds: [sectionId] }, ...extra } as never
}

function factFor(key: string, value: unknown, sourceOverride?: { documentPath: string; sectionId: string }) {
  const constraint = REVISION_FACT_HANDOFF_CONSTRAINTS.find(item => item.key === key)
  const source = refFor(sourceOverride?.documentPath ?? constraint?.owner.documentPath ?? 'docs/GDD.md', sourceOverride?.sectionId ?? constraint?.owner.sectionId ?? 'vision')
  return { key, value, source, evidence: { documentPath: source.documentPath, sectionId: source.sectionId, startLine: source.startLine, endLine: source.endLine, digest: source.digest } } as never
}

test('projects all 23 catalog constraints without importing Reviewer production code', () => {
  expect(REVISION_FACT_HANDOFF_CONSTRAINTS.map(item => item.key).sort()).toEqual(FOUNDATION_FACT_CATALOG.map(item => item.key).sort())
  for (const original of FOUNDATION_FACT_CATALOG) {
    const projected = REVISION_FACT_HANDOFF_CONSTRAINTS.find(item => item.key === original.key)!
    expect(projected).toEqual({ key: original.key, owner: original.owner, valueType: original.valueType, valueSpec: original.valueSpec,
      presence: original.presence, extractionInstruction: original.extractionInstruction, sourceOfTruthDirection: original.sourceOfTruthDirection })
  }
})

test('repair evidence closure matches Reviewer oracle and keeps contract edges non-recursive', () => {
  for (const constraint of REVISION_FACT_HANDOFF_CONSTRAINTS) {
    const issue = issueFor(constraint.owner.documentPath, constraint.owner.sectionId)
    expect(revisionRepairEvidenceKeys(issue)).toEqual(reviewerRepairEvidenceKeys(issue))
  }
  for (const endpoint of REVISION_DETERMINISTIC_CONTRACT_ENDPOINTS) {
    const original = FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS.find(item => item.sourceFactKey === endpoint.sourceFactKey && item.targetFactKey === endpoint.targetFactKey)!
    expect(original).toBeDefined()
    const owner = REVISION_FACT_HANDOFF_CONSTRAINTS.find(item => item.key === endpoint.sourceFactKey)!.owner
    const issue = issueFor(owner.documentPath, owner.sectionId)
    const keys = revisionRepairEvidenceKeys(issue)
    expect(keys).toContain(endpoint.sourceFactKey)
    expect(keys).toContain(endpoint.targetFactKey)
  }
  const vision = issueFor('docs/GDD.md', 'vision')
  expect(revisionRepairEvidenceKeys(vision)).not.toContain('technical.target_fps')
})

test('fact constraints reject unknown keys, wrong owners, type/range/list and enum violations', () => {
  assertRevisionFactConstraint(factFor('game.players.max', 4))
  expect(() => assertRevisionFactConstraint(factFor('game.players.max', 0))).toThrow(/range/)
  expect(() => assertRevisionFactConstraint(factFor('game.players.max', '4'))).toThrow(/type/)
  expect(() => assertRevisionFactConstraint(factFor('game.players.max', 4, { documentPath: 'docs/GDD.md', sectionId: 'vision' }))).not.toThrow()
  expect(() => assertRevisionFactConstraint(factFor('game.mechanics', ['move'], { documentPath: 'docs/GDD.md', sectionId: 'vision' }))).toThrow(/owner/)
  expect(() => assertRevisionFactConstraint(factFor('game.mechanics', []))).toThrow(/length/)
  expect(() => assertRevisionFactConstraint(factFor('game.mechanics', [4]))).toThrow(/item/)
  expect(() => assertRevisionFactConstraint(factFor('game.platform', 'quantum'))).toThrow(/enum/)
  expect(() => assertRevisionFactConstraint(factFor('game.platform', 4))).toThrow(/type/)
  expect(() => assertRevisionFactConstraint(factFor('invented.fact', 'x'))).toThrow(/unknown/)
})
