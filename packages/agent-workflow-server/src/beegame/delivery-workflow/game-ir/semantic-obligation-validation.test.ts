import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  GAME_IR_SCHEMA_VERSION,
  receiptDigest,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import {
  buildGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import { sourceSectionsForGameIrProjectionSlice } from './projection-slice-authority'
import { deriveProjectionSlicePlan } from './projection-slices'
import { buildGameIrEvidenceFragmentCatalog } from './projection-slices'
import { digestSectionIndex } from '../foundation-section-index'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import type { GameIrSourceSection } from './model'
import {
  buildGameIrSemanticObligationInventory,
  GAME_IR_SEMANTIC_OBLIGATION_MANIFEST,
  type GameIrSemanticObligationRecord,
} from './semantic-obligation-inventory'
import {
  admitGameIrSemanticObligationValidationResult,
  buildGameIrSemanticObligationValidationAuthority,
  buildGameIrSemanticObligationValidationPromptAuthority,
  normalizeGameIrSemanticObligationValidationReceipt,
  parseGameIrSemanticObligationValidationResultStream,
  renderGameIrSemanticObligationValidationPrompt,
} from './semantic-obligation-validation'

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')

function balanceSource(): GameIrDomainSourceEnvelope {
  const selectors = new Map<string, string>()
  for (const slice of deriveProjectionSlicePlan('balance').slices)
    for (const selector of sourceSectionsForGameIrProjectionSlice(slice.sliceId))
      selectors.set(
        `${selector.documentPath}#${selector.sectionId}`,
        `${selector.documentPath} ${selector.sectionId}`,
      )
  const selectedDocuments = new Set(
    [...selectors.keys()].map(key => key.split('#')[0]),
  )
  const fullIndex: GameIrSourceSection[] = []
  const fullBytes: Record<string, string> = {}
  for (const documentPath of CANONICAL_FOUNDATION_DOCUMENTS) {
    if (!selectedDocuments.has(documentPath)) {
      const sectionId = `unselected-${documentPath.split('/').at(-1)!.replace('.md', '')}`
      const text = `${documentPath} ${sectionId}`
      fullIndex.push({
        documentPath,
        sectionId,
        heading: sectionId,
        startLine: 1,
        endLine: 1,
        digest: sha256(text),
      })
      continue
    }
    for (const key of [...selectors.keys()].filter(item =>
      item.startsWith(`${documentPath}#`),
    )) {
      const [, sectionId] = key.split('#')
      const text = selectors.get(key)!
      fullIndex.push({
        documentPath,
        sectionId: sectionId!,
        heading: sectionId!,
        startLine: 1,
        endLine: 1,
        digest: sha256(text),
      })
      fullBytes[key] = text
    }
  }
  const foundation: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'validation-project',
    foundationRevision: 'validation-revision',
    confirmedBriefDigest: 'a'.repeat(64),
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, 'b'.repeat(64)]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digestSectionIndex(fullIndex),
    authority: {
      kind: 'review',
      reviewDigest: 'c'.repeat(64),
      issueRegistryDigest: 'd'.repeat(64),
    },
  }
  const request: GameIrCompileRequest = {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'validation-task',
    publicationId: 'validation-publication',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: { ...foundation, receiptDigest: receiptDigest(foundation) },
  }
  return buildGameIrDomainSourceEnvelope({
    moduleId: 'balance',
    request,
    sectionIndex: fullIndex,
    sectionBytes: fullBytes,
  })
}

function inventory(source: GameIrDomainSourceEnvelope) {
  const selected = new Set(
    sourceSectionsForGameIrProjectionSlice('balance.slice.1').map(
      selector => `${selector.documentPath}#${selector.sectionId}`,
    ),
  )
  const fragmentId = buildGameIrEvidenceFragmentCatalog({
    sectionIndex: source.sectionIndex,
    sectionBytes: source.sectionBytes,
  }).fragments.find(fragment =>
    selected.has(`${fragment.documentPath}#${fragment.sectionId}`),
  )!.fragmentId
  const records: GameIrSemanticObligationRecord[] = [
    {
      record: 'obligation',
      moduleId: 'balance',
      targetId: 'balance.formula.alpha',
      targetKind: 'balance.formula',
      fragmentId,
    },
  ]
  return buildGameIrSemanticObligationInventory({
    moduleId: 'balance',
    source,
    records,
  })
}

function authority() {
  const source = balanceSource()
  return buildGameIrSemanticObligationValidationAuthority({
    source,
    inventory: inventory(source),
  })
}

function identities(value: ReturnType<typeof authority>) {
  return value.identities
}

function firstFragment(value: ReturnType<typeof authority>): string {
  return value.sourceFragments.find(fragment =>
    new Set(
      sourceSectionsForGameIrProjectionSlice('balance.slice.1').map(
        selector => `${selector.documentPath}#${selector.sectionId}`,
      ),
    ).has(`${fragment.documentPath}#${fragment.sectionId}`),
  )!.fragmentId
}

function passLine(value: ReturnType<typeof authority>) {
  return JSON.stringify({
    record: 'pass',
    moduleId: 'balance',
    ...identities(value),
  })
}

function passStream(value: ReturnType<typeof authority>) {
  const coverage = value.sourceFragments
    .map(fragment =>
      JSON.stringify({
        record: 'coverage',
        moduleId: 'balance',
        fragmentId: fragment.fragmentId,
      }),
    )
    .join('\n')
  return `${passLine(value)}\n${coverage}\n${JSON.stringify({ record: 'done', moduleId: 'balance' })}\n`
}

describe('Game IR semantic obligation validation', () => {
  test('accepts PASS only with ordered full-source coverage and bound identities', () => {
    const expected = authority()
    const parsed = parseGameIrSemanticObligationValidationResultStream({
      authority: expected,
      text: passStream(expected),
    })
    expect(parsed.done).toBe(true)
    const admitted = admitGameIrSemanticObligationValidationResult({
      authority: expected,
      result: parsed.result!,
    })
    if (admitted.outcome !== 'PASS') throw new Error('expected PASS')
    expect(admitted.receipt.coverage.map(item => item.fragmentId)).toEqual(
      expected.sourceFragments.map(item => item.fragmentId),
    )
    expect(admitted.receipt.identities).toEqual(expected.identities)
    expect(admitted.receipt.schemaVersion).toBe(
      'game-ir-semantic-obligation-validation-receipt.v1',
    )
    expect(Object.isFrozen(admitted)).toBe(true)
    expect(Object.isFrozen(admitted.receipt)).toBe(true)
    expect(Object.isFrozen(admitted.receipt.coverage)).toBe(true)
  })

  test('replays a valid frozen PASS receipt and rejects stale or non-canonical persistence', () => {
    const expected = authority()
    const parsed = parseGameIrSemanticObligationValidationResultStream({
      authority: expected,
      text: passStream(expected),
    })
    const admitted = admitGameIrSemanticObligationValidationResult({
      authority: expected,
      result: parsed.result!,
    })
    if (admitted.outcome !== 'PASS') throw new Error('expected PASS')
    expect(normalizeGameIrSemanticObligationValidationReceipt(expected, admitted.receipt)).toEqual(admitted.receipt)
    const staleIdentity = structuredClone(admitted.receipt) as any
    staleIdentity.identities.sourceDigest = 'f'.repeat(64)
    expect(() => normalizeGameIrSemanticObligationValidationReceipt(expected, staleIdentity)).toThrow(/identity|stale/i)
    const staleCoverage = structuredClone(admitted.receipt) as any
    staleCoverage.coverage.reverse()
    expect(() => normalizeGameIrSemanticObligationValidationReceipt(expected, staleCoverage)).toThrow(/coverage|ordered/i)
    const staleDigest = structuredClone(admitted.receipt) as any
    staleDigest.receiptDigest = '0'.repeat(64)
    expect(() => normalizeGameIrSemanticObligationValidationReceipt(expected, staleDigest)).toThrow(/digest/i)
    const unknownField = { ...admitted.receipt, extra: true }
    expect(() => normalizeGameIrSemanticObligationValidationReceipt(expected, unknownField)).toThrow(/field|unknown/i)
  })

  test('derives a missing obligation identity and owner slice outside inventory', () => {
    const expected = authority()
    const fragmentId = firstFragment(expected)
    const raw = JSON.stringify({
      record: 'fail',
      moduleId: 'balance',
      reasonCode: 'missing-obligation',
      targetId: 'balance.formula.missing',
      expectedKind: 'balance.formula',
      semanticRole: GAME_IR_SEMANTIC_OBLIGATION_MANIFEST.balance['balance.formula']!.semanticRole,
      fragmentId,
    })
    const parsed = parseGameIrSemanticObligationValidationResultStream({
      authority: expected,
      text: `${raw}\n${JSON.stringify({ record: 'done', moduleId: 'balance' })}\n`,
    })
    const admitted = admitGameIrSemanticObligationValidationResult({
      authority: expected,
      result: parsed.result!,
    })
    expect(admitted).toMatchObject({
      outcome: 'FAIL',
      reasonCode: 'missing-obligation',
      obligationId: 'balance:balance.formula:balance.formula.missing',
      ownerSliceId: 'balance.slice.1',
    })
    expect(Object.hasOwn(parsed.result!, 'obligationId')).toBe(false)
    expect(Object.hasOwn(parsed.result!, 'ownerSliceId')).toBe(false)
  })

  test('rejects forged missing-obligation kind, role, or fragment', () => {
    const expected = authority()
    const base = {
      record: 'fail',
      moduleId: 'balance',
      reasonCode: 'missing-obligation',
      targetId: 'balance.formula.forged',
      expectedKind: 'balance.formula',
      semanticRole: 'formula-dependency',
      fragmentId: firstFragment(expected),
    }
    for (const patch of [
      { expectedKind: 'balance.unit' },
      { semanticRole: 'forged-role' },
      { fragmentId: 'e999.0' },
    ]) {
      const parsed = parseGameIrSemanticObligationValidationResultStream({
        authority: expected,
        text: `${JSON.stringify({ ...base, ...patch })}\n${JSON.stringify({ record: 'done', moduleId: 'balance' })}\n`,
      })
      expect(() =>
        admitGameIrSemanticObligationValidationResult({
          authority: expected,
          result: parsed.result!,
        }),
      ).toThrow(/kind|role|fragment|authority/i)
    }
  })

  test('rejects caller-supplied obligationId and ownerSliceId', () => {
    const expected = authority()
    const text = `${JSON.stringify({
      record: 'fail',
      moduleId: 'balance',
      reasonCode: 'missing-obligation',
      targetId: 'balance.formula.forged',
      expectedKind: 'balance.formula',
      semanticRole: 'formula-dependency',
      fragmentId: firstFragment(expected),
      obligationId: 'fake',
      ownerSliceId: 'fake',
    })}\n${JSON.stringify({ record: 'done', moduleId: 'balance' })}\n`
    expect(
      parseGameIrSemanticObligationValidationResultStream({
        authority: expected,
        text,
      }).diagnostic,
    ).toMatch(/field|unknown/i)
  })

  test('rejects duplicate terminal and ambiguous responses', () => {
    const expected = authority()
    const done = JSON.stringify({ record: 'done', moduleId: 'balance' })
    const ambiguous = JSON.stringify({
      record: 'ambiguous',
      moduleId: 'balance',
      reasonCode: 'ambiguous-obligation',
      detail: 'two source interpretations',
    })
    const fail = JSON.stringify({
      record: 'fail',
      moduleId: 'balance',
      reasonCode: 'missing-obligation',
      targetId: 'balance.formula.x',
      expectedKind: 'balance.formula',
      semanticRole: 'formula-dependency',
      fragmentId: expected.sourceFragments[0]!.fragmentId,
    })
    expect(
      parseGameIrSemanticObligationValidationResultStream({
        authority: expected,
        text: `${ambiguous}\n${fail}\n${done}\n`,
      }).diagnostic,
    ).toMatch(/duplicate|multiple|terminal|ambiguous/i)
  })

  test('renders independently selected full source and strict terminal protocol for both provider modes', () => {
    const expected = authority()
    const promptAuthority = buildGameIrSemanticObligationValidationPromptAuthority(expected)
    const sourceCatalog = buildGameIrEvidenceFragmentCatalog({
      sectionIndex: expected.source.sectionIndex,
      sectionBytes: expected.source.sectionBytes,
    })
    for (const providerMode of ['anthropic', 'openai'] as const) {
      const rendered = renderGameIrSemanticObligationValidationPrompt(promptAuthority, providerMode)
      expect(rendered).toContain('## Fixed obligation manifest')
      expect(rendered).toContain('## Admitted inventory')
      expect(rendered).toContain('## Source fragments')
      for (const fragment of sourceCatalog.fragments) {
        expect(rendered.match(new RegExp(`\\b${fragment.fragmentId}:`, 'g'))).toHaveLength(1)
        expect(rendered).toContain(fragment.excerpt)
      }
      expect(rendered).toContain('"record":"pass"')
      expect(rendered).toContain('"record":"coverage"')
      expect(rendered).toContain('"record":"fail"')
      expect(rendered).toContain('"record":"ambiguous"')
      expect(rendered).toContain('"record":"done"')
      expect(rendered).not.toContain('sectionBytes')
      expect(rendered).not.toContain('authoritySectionIndex')
      expect(rendered).not.toContain('operation-packet')
    }
  })

  test('does not derive validator source fragments from admitted inventory', () => {
    const source = balanceSource()
    const emptyInventory = buildGameIrSemanticObligationInventory({
      moduleId: 'balance',
      source,
      records: [],
    })
    const expected = buildGameIrSemanticObligationValidationPromptAuthority({
      source,
      inventory: emptyInventory,
    })
    const complete = buildGameIrEvidenceFragmentCatalog({
      sectionIndex: source.sectionIndex,
      sectionBytes: source.sectionBytes,
    })
    expect(expected.sourceFragments.map(fragment => fragment.fragmentId)).toEqual(
      complete.fragments.map(fragment => fragment.fragmentId),
    )
  })
})
