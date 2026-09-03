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
import {
  sourceSectionsForGameIrProjectionSlice,
} from './projection-slice-authority'
import { buildGameIrProjectionContract } from './projection-contract'
import {
  buildGameIrEvidenceFragmentCatalog,
  deriveProjectionSlicePlan,
} from './projection-slices'
import { digestSectionIndex } from '../foundation-section-index'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import type { GameIrSourceSection } from './model'
import {
  buildGameIrSemanticObligationInventory,
  buildGameIrSemanticObligationInventoryPromptAuthority,
  GAME_IR_SEMANTIC_OBLIGATION_MANIFEST,
  parseGameIrSemanticObligationRecordStream,
  renderGameIrSemanticObligationInventoryPrompt,
  validateGameIrSemanticObligationManifest,
} from './semantic-obligation-inventory'

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex')

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function balanceSource(): GameIrDomainSourceEnvelope {
  const selectors = new Map<string, string>()
  for (const slice of deriveProjectionSlicePlan('balance').slices) {
    for (const selector of sourceSectionsForGameIrProjectionSlice(slice.sliceId))
      selectors.set(
        `${selector.documentPath}#${selector.sectionId}`,
        `${selector.documentPath} ${selector.sectionId}`,
      )
  }
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
    for (const key of [...selectors.keys()].filter(item => item.startsWith(`${documentPath}#`))) {
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
  const withoutReceipt: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'obligation-project',
    foundationRevision: 'foundation-revision',
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
    taskId: 'obligation-task',
    publicationId: 'obligation-publication',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...withoutReceipt,
      receiptDigest: receiptDigest(withoutReceipt),
    },
  }
  return buildGameIrDomainSourceEnvelope({
    moduleId: 'balance',
    request,
    sectionIndex: fullIndex,
    sectionBytes: fullBytes,
  })
}

function fragmentFor(
  source: GameIrDomainSourceEnvelope,
  sliceId: string,
): string {
  const selectors = new Set(
    sourceSectionsForGameIrProjectionSlice(sliceId).map(
      selector => `${selector.documentPath}#${selector.sectionId}`,
    ),
  )
  return buildGameIrEvidenceFragmentCatalog({
    sectionIndex: source.sectionIndex,
    sectionBytes: source.sectionBytes,
  }).fragments.find(fragment =>
    selectors.has(`${fragment.documentPath}#${fragment.sectionId}`),
  )!.fragmentId
}

function line(
  targetId: string,
  targetKind: string,
  fragmentId: string,
): string {
  return JSON.stringify({
    record: 'obligation',
    moduleId: 'balance',
    targetId,
    targetKind,
    fragmentId,
  })
}

function done(): string {
  return JSON.stringify({ record: 'done', moduleId: 'balance' })
}

function firstWithOwnerSlice(raw: string): string {
  return raw.replace('}', ',"ownerSliceId":"balance.slice.0"}')
}

describe('Game IR semantic obligation inventory', () => {
  test('uses an explicit frozen descriptor for every projection contract kind', () => {
    validateGameIrSemanticObligationManifest()
    for (const moduleId of ['gameplay', 'balance', 'world-scene', 'presentation', 'resource-realization', 'implementation-verification'] as const) {
      const contractKinds = new Set(buildGameIrProjectionContract(moduleId).nodes.map(node => node.kind))
      const manifest = GAME_IR_SEMANTIC_OBLIGATION_MANIFEST[moduleId]
      expect(Object.keys(manifest).sort()).toEqual([...contractKinds].sort())
      for (const kind of contractKinds) {
        expect(Object.isFrozen(manifest[kind])).toBe(true)
        expect(manifest[kind]!.obligationClass.length).toBeGreaterThan(0)
        expect(manifest[kind]!.semanticRole.length).toBeGreaterThan(0)
      }
    }
  })

  test('accepts any number of Balance formula obligations and derives service identity', () => {
    const source = balanceSource()
    const formulas = ['balance.formula.alpha', 'balance.formula.beta', 'balance.formula.gamma']
    const text = [
      ...formulas.map(id => line(id, 'balance.formula', fragmentFor(source, 'balance.slice.1'))),
      done(),
    ].join('\n') + '\n'
    const parsed = parseGameIrSemanticObligationRecordStream({
      expectedModuleId: 'balance',
      text,
    })
    expect(parsed.done).toBe(true)
    const inventory = buildGameIrSemanticObligationInventory({
      moduleId: 'balance',
      source,
      records: parsed.records,
    })
    expect(inventory.obligations).toHaveLength(3)
    expect(inventory.obligations[0]!.obligationId).toBe(
      'balance:balance.formula:balance.formula.alpha',
    )
    expect(inventory.obligations[0]!.obligationClass).toBe('balance-formula')
    expect(inventory.obligations[0]!.semanticRole).toBe('formula-dependency')
    expect(inventory.obligations[0]!.ownerSliceId).toBe('balance.slice.1')
    expect(inventory.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(inventory)).toBe(true)
    expect(Object.isFrozen(inventory.obligations)).toBe(true)
    expect(Object.isFrozen(inventory.index)).toBe(true)
  })

  test('allows structurally valid empty inventory for a later completeness validator', () => {
    const source = balanceSource()
    const parsed = parseGameIrSemanticObligationRecordStream({
      expectedModuleId: 'balance',
      text: `${done()}\n`,
    })
    const inventory = buildGameIrSemanticObligationInventory({
      moduleId: 'balance',
      source,
      records: parsed.records,
    })
    expect(inventory.obligations).toEqual([])
  })

  test('rejects a target kind outside the module contract', () => {
    const source = balanceSource()
    const parsed = parseGameIrSemanticObligationRecordStream({
      expectedModuleId: 'balance',
      text: `${line('balance.formula.bad-kind', 'gameplay.rule', fragmentFor(source, 'balance.slice.1'))}\n${done()}\n`,
    })
    expect(() => buildGameIrSemanticObligationInventory({ moduleId: 'balance', source, records: parsed.records })).toThrow(/kind|contract/i)
  })

  test('derives the unique owner slice from the contract kind', () => {
    const source = balanceSource()
    const parsed = parseGameIrSemanticObligationRecordStream({
      expectedModuleId: 'balance',
      text: `${line('balance.formula.derived-slice', 'balance.formula', fragmentFor(source, 'balance.slice.1'))}\n${done()}\n`,
    })
    const inventory = buildGameIrSemanticObligationInventory({
      moduleId: 'balance',
      source,
      records: parsed.records,
    })
    expect(inventory.obligations[0]!.ownerSliceId).toBe('balance.slice.1')
  })

  test('rejects a fragment outside the selected source authority of the owner slice', () => {
    const source = balanceSource()
    const catalog = buildGameIrEvidenceFragmentCatalog({ sectionIndex: source.sectionIndex, sectionBytes: source.sectionBytes })
    const wrongFragment = catalog.fragments.find(fragment => fragment.sectionId === 'progression_curves')!.fragmentId
    const parsed = parseGameIrSemanticObligationRecordStream({
      expectedModuleId: 'balance',
      text: `${line('balance.formula.bad-fragment', 'balance.formula', wrongFragment)}\n${done()}\n`,
    })
    expect(() => buildGameIrSemanticObligationInventory({ moduleId: 'balance', source, records: parsed.records })).toThrow(/fragment|authority/i)
  })

  test('rejects duplicate and unsorted raw records, wrappers, unknown fields, and caller digests', () => {
    const source = balanceSource()
    const fragmentId = fragmentFor(source, 'balance.slice.1')
    const first = line('balance.formula.alpha', 'balance.formula', fragmentId)
    expect(parseGameIrSemanticObligationRecordStream({ expectedModuleId: 'balance', text: `${first}\n${first}\n${done()}\n` }).diagnostic).toMatch(/duplicate|sorted/i)
    expect(parseGameIrSemanticObligationRecordStream({ expectedModuleId: 'balance', text: `${line('balance.formula.beta', 'balance.formula', fragmentId)}\n${line('balance.formula.alpha', 'balance.formula', fragmentId)}\n${done()}\n` }).diagnostic).toMatch(/sorted/i)
    expect(parseGameIrSemanticObligationRecordStream({ expectedModuleId: 'balance', text: `${JSON.stringify({ obligations: [] })}\n` }).diagnostic).toMatch(/field|record|done/i)
    expect(parseGameIrSemanticObligationRecordStream({ expectedModuleId: 'balance', text: `${first.replace('}', ',"digest":"' + 'a'.repeat(64) + '"}')}\n${done()}\n` }).diagnostic).toMatch(/field|unknown/i)
  })

  test('rejects caller-supplied owner slice authority', () => {
    const source = balanceSource()
    const fragmentId = fragmentFor(source, 'balance.slice.1')
    const parsed = parseGameIrSemanticObligationRecordStream({
      expectedModuleId: 'balance',
      text: [
        firstWithOwnerSlice(line('balance.formula.owner', 'balance.formula', fragmentId)),
        done(),
      ].join('\n') + '\n',
    })
    expect(parsed.diagnostic).toMatch(/field|unknown/i)
  })

  test('rejects a stale source envelope before binding fragments', () => {
    const source = balanceSource()
    const stale = {
      ...source,
      sectionBytes: {
        ...source.sectionBytes,
        [Object.keys(source.sectionBytes)[0]!]: 'changed source',
      },
    }
    const fragmentId = fragmentFor(source, 'balance.slice.1')
    const parsed = parseGameIrSemanticObligationRecordStream({ expectedModuleId: 'balance', text: `${line('balance.formula.stale', 'balance.formula', fragmentId)}\n${done()}\n` })
    expect(() => buildGameIrSemanticObligationInventory({ moduleId: 'balance', source: stale as GameIrDomainSourceEnvelope, records: parsed.records })).toThrow(/stale|digest|source/i)
  })

  test('renders complete canonical source fragments and service-owned kind authority for both provider modes', () => {
    const source = balanceSource()
    const catalog = buildGameIrEvidenceFragmentCatalog({
      sectionIndex: source.sectionIndex,
      sectionBytes: source.sectionBytes,
    })
    const authority = buildGameIrSemanticObligationInventoryPromptAuthority({ source })
    for (const providerMode of ['anthropic', 'openai'] as const) {
      const rendered = renderGameIrSemanticObligationInventoryPrompt(authority, providerMode)
      expect(rendered).toContain('## Source fragments')
      for (const fragment of catalog.fragments) {
        expect(rendered.match(new RegExp(`\\b${fragment.fragmentId}:`, 'g'))).toHaveLength(1)
        expect(rendered).toContain(fragment.excerpt)
      }
      for (const [targetKind, descriptor] of Object.entries(GAME_IR_SEMANTIC_OBLIGATION_MANIFEST.balance)) {
        expect(rendered).toContain(`${targetKind} | ${descriptor.obligationClass} | ${descriptor.semanticRole}`)
      }
      const output = rendered.slice(rendered.indexOf('## Output contract'))
      expect(output).toContain('{"record":"obligation","moduleId":"balance","targetId":"<targetId>","targetKind":"<targetKind>","fragmentId":"<fragmentId>"}')
      expect(output).toContain('{"record":"done","moduleId":"balance"}')
      expect(output).not.toContain('ownerSliceId')
      expect(output).not.toContain('semanticRole')
      expect(output).not.toContain('digest')
      expect(rendered).not.toContain('sectionBytes')
      expect(rendered).not.toContain('authoritySectionIndex')
      expect(rendered).not.toContain('operation-packet')
    }
  })
})
