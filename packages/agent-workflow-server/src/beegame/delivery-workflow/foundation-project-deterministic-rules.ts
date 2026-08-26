import { buildFoundationSectionIndex, type SectionRef } from './foundation-section-index'
import type {
  AuditIssueDraft,
} from './foundation-issue-registry'
import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath } from './types'

type DocumentInput = ReadonlyMap<string, string> | Record<string, string>

const CANONICAL_PATHS = new Set<string>(CANONICAL_FOUNDATION_DOCUMENTS)

export type FoundationProjectDeterministicInput = {
  documents: DocumentInput
  sectionIndex?: readonly SectionRef[]
}

function entries(input: DocumentInput): Array<readonly [string, string]> {
  return (input instanceof Map ? [...input.entries()] : Object.entries(input))
    .map(([path, body]) => [path.replaceAll('\\', '/'), body] as const)
}

function canonicalDocuments(input: DocumentInput): Map<string, string> {
  const result = new Map<string, string>()
  for (const [path, body] of entries(input)) {
    if (!CANONICAL_PATHS.has(path)) continue
    if (typeof body !== 'string') throw new Error(`canonical document content is invalid: ${path}`)
    result.set(path, body)
  }
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS)
    if (!result.has(path)) throw new Error(`canonical document is missing: ${path}`)
  return result
}

function exactIndex(input: FoundationProjectDeterministicInput, documents: Map<string, string>): readonly SectionRef[] {
  const expected = buildFoundationSectionIndex({ documents })
  if (!input.sectionIndex) return expected
  const supplied = input.sectionIndex.filter(section => CANONICAL_PATHS.has(section.documentPath))
  const expectedByKey = new Map(expected.map(section => [`${section.documentPath}\0${section.sectionId}`, section]))
  for (const section of supplied) {
    const reference = expectedByKey.get(`${section.documentPath}\0${section.sectionId}`)
    if (!reference || JSON.stringify(reference) !== JSON.stringify(section))
      throw new Error(`project deterministic SectionRef is not the committed index: ${section.documentPath}#${section.sectionId}`)
  }
  if (supplied.length !== expected.length)
    throw new Error('project deterministic SectionRef index must contain all eight canonical documents')
  return supplied
}

function sectionBody(markdown: string, section: SectionRef): string {
  const lines = markdown.split('\n')
  return lines.slice(section.startLine - 1, section.endLine - 1).join('\n')
}

function sectionTextMap(documents: Map<string, string>, index: readonly SectionRef[]): Map<string, string> {
  return new Map(index.map(section => [
    `${section.documentPath}\0${section.sectionId}`,
    sectionBody(documents.get(section.documentPath)!, section),
  ]))
}

const FIXED_SETTLEMENT_DEW_AUTHORITY = 'FIXED_SETTLEMENT_DEW' as const

function hasGapBudgetVocabulary(value: string): boolean {
  return /gap[- ]?budget|gap|缺口|间隙|差额/.test(value) && /dew|露珠/.test(value)
}

function hasFixedSettlementScope(value: string): boolean {
  const fixed = /fixed\s+settlement(?:\s+(?:grant|income|dew))?|固定结算(?:收入|奖励|露珠|发放)?|S[_₍(]?w[₎)]?/i
  const boundary = /scope|bound|constraint|trade-?off|appl(?:y|ies)|约束|边界|取舍|界定|只约束|不足以|不能同时/i
  return value.split('\n').some(line => fixed.test(line) && boundary.test(line))
}

function hasAllAvailableSettlementScope(value: string): boolean {
  return /all\s+(?:available|obtainable|earned|current)\s+dew/i.test(value) ||
    /(?:全部|所有)(?:的)?\s*(?:可用|可支配|可获得|可获取)?\s*露珠/.test(value) ||
    /(?:可用|可支配|可获得|可获取)\s*(?:的)?\s*(?:全部|所有)\s*露珠/.test(value) ||
    /间隙.{0,20}(?:全部|所有).{0,12}露珠/.test(value)
}

type GapScope = 'fixed' | 'all' | 'ambiguous' | 'unrelated'

function gapScope(value: string, gapContext: boolean): GapScope {
  const hasDewScope = /dew|露珠/i.test(value) && gapContext
  if (!hasDewScope) return 'unrelated'
  if (hasAllAvailableSettlementScope(value)) return 'all'
  if (hasFixedSettlementScope(value)) return 'fixed'
  return hasGapBudgetVocabulary(value) ? 'ambiguous' : 'unrelated'
}

const GAP_BUDGET_EXPECTED =
  'FIXED_SETTLEMENT_DEW: one gap must allow one meaningful action, and the gap tension bounds only the newly granted fixed settlement S_w; saved balance and kill drops remain player-controlled bonus dew.'

function gapBudgetIssueDraft(
  source: SectionRef,
  actual: string,
  scope: Exclude<GapScope, 'unrelated'>,
): AuditIssueDraft {
  return {
    checkId: 'deterministic.progression-gap-budget-scope',
    severity: 'BLOCKER',
    type: 'contract',
    source,
    expected: GAP_BUDGET_EXPECTED,
    actual,
    remediation: { kind: 'patch', documentPath: source.documentPath, sectionIds: [source.sectionId] },
    conflictIdentity: {
      authority: FIXED_SETTLEMENT_DEW_AUTHORITY,
      documentPath: source.documentPath,
      sectionId: source.sectionId,
      scope,
    },
  }
}

/** Admits only sections that are contrary to or ambiguous about the fixed settlement boundary. */
export function collectGapBudgetPatchDrafts(
  input: FoundationProjectDeterministicInput,
): AuditIssueDraft[] {
  const documents = canonicalDocuments(input.documents)
  const index = exactIndex(input, documents)
  const bodies = sectionTextMap(documents, index)
  const gdd = index.find(section => section.documentPath === 'docs/GDD.md' && section.sectionId === 'progression')
  const balanceSections = index.filter(section =>
    section.documentPath === 'docs/BALANCE_DESIGN.md' &&
    section.sectionId === 'economy',
  )
  if (!gdd || balanceSections.length === 0) throw new Error('progression/economy owner sections are missing from canonical index')
  const gddBody = bodies.get(`${gdd.documentPath}\0${gdd.sectionId}`)!
  const balanceBodies = balanceSections.map(section => ({
    section,
    body: bodies.get(`${section.documentPath}\0${section.sectionId}`)!,
  }))
  const allBodies = [gddBody, ...balanceBodies.map(entry => entry.body)]
  const gapContext = allBodies.some(hasGapBudgetVocabulary)

  const gddScope = gapScope(gddBody, gapContext)
  const drafts: AuditIssueDraft[] = []
  if (gddScope === 'all' || gddScope === 'ambiguous') {
    drafts.push(gapBudgetIssueDraft(
      gdd,
      gddScope === 'all'
        ? 'GDD progression expands the one-gap boundary beyond the newly granted fixed settlement S_w.'
        : 'GDD progression mentions the gap/dew boundary without stating that it applies only to fixed settlement S_w.',
      gddScope,
    ))
  }
  for (const { section, body } of balanceBodies) {
    const scope = gapScope(body, gapContext)
    if (scope === 'all' || scope === 'ambiguous') {
      drafts.push(gapBudgetIssueDraft(
        section,
        scope === 'all'
          ? `${section.sectionId} expands the one-gap boundary beyond the newly granted fixed settlement S_w.`
          : `${section.sectionId} mentions the gap/dew boundary without stating that it applies only to fixed settlement S_w.`,
        scope,
      ))
    }
  }
  return drafts
}

export function collectFoundationProjectDeterministicDrafts(
  input: FoundationProjectDeterministicInput,
): AuditIssueDraft[] {
  return collectGapBudgetPatchDrafts(input)
}

export type { FoundationDocumentPath }
