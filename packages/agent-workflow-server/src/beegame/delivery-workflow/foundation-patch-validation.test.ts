import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { FOUNDATION_FACT_CATALOG } from './foundation-fact-definitions'
import {
  createFoundationFactStore,
  digestFactStore,
  type FoundationFact,
} from './foundation-fact-store'
import { analyzeFoundationImpact, type FoundationImpactAnalysis } from './foundation-impact-analysis'
import {
  foundationPatchOperationsDigest,
  type PatchOperation,
} from './foundation-revision-stage'
import { getGameDocumentContract } from './game-document-contracts'
import {
  runProductionDeterministicFoundationAudit,
  type FoundationAuditProductionManifest,
} from './foundation-audit-production-manifest'
import {
  rebuildFoundationImpactedFacts,
  validateFoundationPatch,
  admitFoundationSemanticRecheckResult,
  buildFoundationSemanticRecheckPacket,
  digestFoundationSemanticRecheckResult,
  type FoundationPatchValidationInput,
} from './foundation-patch-validation'
import type { AuditIssue } from './foundation-issue-registry'
import type { FoundationDocumentPath } from './types'
import type { SectionRef } from './foundation-section-index'

const visionText = '# Vision\n## Vision\nplayers.max: 4\n'
const actionsText = '# Actions\n## Actions\nauthored controls describe movement and attack\n'
const vision: SectionRef = {
  documentPath: 'docs/GDD.md',
  sectionId: 'vision',
  heading: 'Vision',
  startLine: 1,
  endLine: 3,
  digest: createHash('sha256').update('# Vision\n## Vision').digest('hex'),
}
const actions: SectionRef = {
  documentPath: 'docs/GDD.md',
  sectionId: 'player_actions',
  heading: 'Actions',
  startLine: 1,
  endLine: 3,
  digest: createHash('sha256').update('# Actions\n## Actions').digest('hex'),
}

function impact(factKeys: string[]): FoundationImpactAnalysis {
  return {
    changedSections: factKeys.includes('game.mechanics') ? [
      { documentPath: 'docs/GDD.md', sectionId: 'player_actions' },
    ] : [
      { documentPath: 'docs/GDD.md', sectionId: 'vision' },
    ],
    factKeys: factKeys as FoundationImpactAnalysis['factKeys'],
    contractIds: [],
    checkIds: [],
    issueIds: ['issue-1'],
  }
}

function fact(
  key: FoundationFact['key'],
  value: FoundationFact['value'],
  source: SectionRef,
  line: string,
): FoundationFact {
  return {
    key,
    value,
    source,
    evidence: {
      documentPath: source.documentPath,
      sectionId: source.sectionId,
      startLine: 3,
      endLine: 3,
      digest: createHash('sha256').update(line).digest('hex'),
    },
  }
}

function productionFixture(): {
  sectionIndex: SectionRef[]
  factStore: FoundationFact[]
  postIssues: AuditIssue[]
} {
  const sectionIndex: SectionRef[] = []
  const sections = new Map<string, SectionRef>()
  for (const documentPath of [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
    'docs/TECHNICAL_DESIGN.md',
    'docs/ART_DIRECTION.md',
    'docs/UI_UX_SPEC.md',
    'docs/AUDIO_DESIGN.md',
    'docs/ASSET_PLAN.md',
  ] as FoundationDocumentPath[]) {
    for (const [index, definition] of getGameDocumentContract(documentPath).sections.entries()) {
      const ref: SectionRef = {
        documentPath,
        sectionId: definition.sectionId,
        heading: definition.title,
        startLine: index + 1,
        endLine: index + 3,
        digest: 'a'.repeat(64),
      }
      sectionIndex.push(ref)
      sections.set(`${documentPath}\0${definition.sectionId}`, ref)
    }
  }
  const factStore = FOUNDATION_FACT_CATALOG.map(definition => {
    const source = sections.get(`${definition.owner.documentPath}\0${definition.owner.sectionId}`)!
    const value = definition.valueType === 'number'
      ? Math.max(definition.valueSpec.min ?? 0, 1)
      : definition.valueType === 'string'
        ? definition.valueSpec.enum?.[0] ?? 'desktop'
        : ['shared']
    return {
      key: definition.key,
      value,
      source,
      evidence: {
        documentPath: source.documentPath,
        sectionId: source.sectionId,
        startLine: source.startLine + 1,
        endLine: source.startLine + 1,
        digest: 'b'.repeat(64),
      },
    } satisfies FoundationFact
  })
  // Leave one impacted contract and one unrelated contract broken. The post
  // audit must surface only the former as a new impacted issue.
  factStore.find(item => item.key === 'asset.boss.count')!.value = 2
  factStore.find(item => item.key === 'level.required_assets')!.value = ['level-only']
  factStore.find(item => item.key === 'technical.supported_actions')!.value = ['technical-only']
  factStore.find(item => item.key === 'game.mechanics')!.value = ['game-only']
  const postIssues = runProductionDeterministicFoundationAudit({
    sectionIndex,
    factStore: createFoundationFactStore(factStore),
  })
  return { sectionIndex, factStore, postIssues }
}

function issue(id: string, source: SectionRef, type: AuditIssue['type'] = 'schema'): AuditIssue {
  return {
    id,
    severity: 'BLOCKER',
    type,
    source,
    expected: 'expected',
    actual: 'actual',
    fixDocument: source.documentPath,
    fixSectionId: source.sectionId,
  }
}

function validationInput(
  fixture: ReturnType<typeof productionFixture>,
  issueIds: string[],
  admittedIssues: AuditIssue[],
  operationSectionId = 'rules_systems',
): FoundationPatchValidationInput {
  const documentPath = operationSectionId === 'inventory' ? 'docs/ASSET_PLAN.md' : 'docs/GDD.md'
  const operation: PatchOperation = {
    kind: 'REPLACE',
    documentPath,
    sectionId: operationSectionId,
    issueIds,
    beforeDigest: 'c'.repeat(64),
    afterDigest: 'd'.repeat(64),
  }
  return {
    validatorTaskId: 'validator-task-1',
    round: 1,
    documentPath,
    baseDocumentDigest: 'e'.repeat(64),
    postPatchDocumentDigest: 'f'.repeat(64),
    patchOperations: [operation],
    impact: analyzeFoundationImpact([operation]),
    admittedIssues,
    sectionIndex: fixture.sectionIndex,
    factStore: fixture.factStore,
  }
}

describe('incremental foundation fact rebuilding', () => {
  test('replaces only impacted facts and preserves unrelated fact objects', () => {
    const unrelated = fact('game.mechanics', ['old'], actions, 'mechanics: [old]')
    const committed = createFoundationFactStore([
      fact('game.players.max', 2, vision, 'players.max: 2'),
      unrelated,
    ])
    const result = rebuildFoundationImpactedFacts({
      committedFactStore: committed,
      documents: { 'docs/GDD.md': visionText },
      sectionIndex: [vision],
      impact: impact(['game.players.max']),
      revision: 'revision-2',
      phase: 'admit' as const,
      results: [],
    })

    expect(result.packets).toEqual([])
    expect(result.factStore.find(item => item.key === 'game.players.max')?.value).toBe(4)
    expect(result.factStore.find(item => item.key === 'game.mechanics')).toEqual(unrelated)
  })

  test('builds unresolved packets and merges only validator-admitted results', () => {
    const committed = createFoundationFactStore([
      fact('game.mechanics', ['old'], actions, 'mechanics: [old]'),
    ])
    const input = {
      committedFactStore: committed,
      documents: { 'docs/GDD.md': actionsText },
      sectionIndex: [actions],
      impact: impact(['game.mechanics']),
      revision: 'revision-2',
      phase: 'admit' as const,
    }
    const result = rebuildFoundationImpactedFacts({
      ...input,
      results: [{
        key: 'game.mechanics',
        status: 'present' as const,
        value: ['move', 'attack'],
        evidence: {
          documentPath: 'docs/GDD.md',
          sectionId: 'player_actions',
          startLine: 3,
          endLine: 3,
          digest: createHash('sha256').update('authored controls describe movement and attack').digest('hex'),
        },
      }],
    })

    expect(result.packets[0]?.keys).toEqual(['game.mechanics'])
    expect(result.factStore.find(item => item.key === 'game.mechanics')?.value).toEqual(['move', 'attack'])
  })

  test('plans unresolved packets without pretending they were admitted', () => {
    const result = rebuildFoundationImpactedFacts({
      committedFactStore: createFoundationFactStore([]),
      documents: { 'docs/GDD.md': actionsText },
      sectionIndex: [actions],
      impact: impact(['game.mechanics']),
      revision: 'revision-2',
      phase: 'plan',
    })

    expect(result.packets).toHaveLength(1)
    expect(result.factStore).toEqual([])
  })

  test('returns the canonical store without workers when impact is empty', () => {
    const committed = createFoundationFactStore([
      fact('game.players.max', 2, vision, 'players.max: 2'),
    ])
    const result = rebuildFoundationImpactedFacts({
      committedFactStore: committed,
      documents: {},
      sectionIndex: [],
      impact: { ...impact([]), changedSections: [], factKeys: [] },
      revision: 'revision-2',
      phase: 'admit' as const,
      results: [],
    })

    expect(result.packets).toEqual([])
    expect(result.factStore).toEqual(committed)
    expect(result.extraction.normalizedFactDigest).toBe(digestFactStore([]))
  })

  test('rejects missing, extra, duplicate, and mis-scoped results', () => {
    const input = {
      committedFactStore: createFoundationFactStore([]),
      documents: { 'docs/GDD.md': actionsText },
      sectionIndex: [actions],
      impact: impact(['game.mechanics']),
      revision: 'revision-2',
      phase: 'admit' as const,
    }
    expect(() => rebuildFoundationImpactedFacts({ ...input, results: [] })).toThrow(/missing|result/i)
    const valid = {
      key: 'game.mechanics' as const,
      status: 'present' as const,
      value: ['move'],
      evidence: {
        documentPath: 'docs/GDD.md' as const,
        sectionId: 'player_actions',
        startLine: 3,
        endLine: 3,
        digest: createHash('sha256').update('authored controls describe movement and attack').digest('hex'),
      },
    }
    expect(() => rebuildFoundationImpactedFacts({ ...input, results: [valid, valid] })).toThrow(/duplicate|exactly/i)
    expect(() => rebuildFoundationImpactedFacts({ ...input, results: [{ ...valid, key: 'game.players.max' as const }] })).toThrow(/outside|assigned|unknown/i)
    expect(() => rebuildFoundationImpactedFacts({
      ...input,
      results: [{ ...valid, evidence: { ...valid.evidence, sectionId: 'vision' } }],
    })).toThrow(/scope|evidence|indexed/i)
  })
})

describe('targeted foundation patch validation', () => {
  test('returns exactly one deterministic PASS/FAIL per original issue and filters new issues by impact', () => {
    const fixture = productionFixture()
    const impactedPostIssue = fixture.postIssues.find(issue => issue.type === 'contract' && issue.target?.sectionId === 'rules_systems')!
    const newImpactedPostIssue = fixture.postIssues.find(issue => issue.type === 'contract' && issue.target?.sectionId === 'content_matrix')!
    const unrelatedPostIssue = fixture.postIssues.find(issue => issue.type === 'contract' && issue.target?.sectionId === 'player_actions')!
    const inventory = fixture.sectionIndex.find(section => section.sectionId === 'inventory')!
    const input = validationInput(
      fixture,
      ['original-resolved', impactedPostIssue.id],
      [issue('original-resolved', inventory), impactedPostIssue],
      'inventory',
    )

    const result = validateFoundationPatch(input)

    expect(result.patchValidations).toHaveLength(2)
    expect(result.patchValidations.map(item => [item.issueId, item.status])).toEqual([
      ['original-resolved', 'PASS'],
      [impactedPostIssue.id, 'FAIL'],
    ].sort(([left], [right]) => left.localeCompare(right)))
    expect(result.patchValidations.every(item => item.documentPath === 'docs/ASSET_PLAN.md')).toBe(true)
    expect(result.patchValidations.every(item => item.patchDigest === foundationPatchOperationsDigest(input.patchOperations))).toBe(true)
    expect(result.newImpactedIssues.map(item => item.id)).toEqual([newImpactedPostIssue.id])
    expect(result.newImpactedIssues.map(item => item.id)).not.toContain(unrelatedPostIssue?.id)
  })

  test('never manufactures validation for semantic originals and returns a recheck list', () => {
    const fixture = productionFixture()
    const inventory = fixture.sectionIndex.find(section => section.sectionId === 'inventory')!
    const semantic = issue('semantic-original', inventory, 'semantic')
    const input = validationInput(fixture, [semantic.id], [semantic], 'inventory')

    const result = validateFoundationPatch(input)

    expect(result.patchValidations).toEqual([])
    expect(result.semanticRecheckIssueIds).toEqual([semantic.id])
  })

  test('rejects duplicate or out-of-scope issue and operation bindings', () => {
    const fixture = productionFixture()
    const rules = fixture.sectionIndex.find(section => section.sectionId === 'rules_systems')!
    const original = issue('original', rules)
    const input = validationInput(fixture, [original.id], [original])

    expect(() => validateFoundationPatch({ ...input, admittedIssues: [original, original] })).toThrow(/duplicate|unique|coverage/i)
    expect(() => validateFoundationPatch({
      ...input,
      patchOperations: input.patchOperations.map(operation => ({ ...operation, documentPath: 'docs/ASSET_PLAN.md' as FoundationDocumentPath })),
    })).toThrow(/document|impact|scope/i)
    expect(() => validateFoundationPatch({ ...input, baseDocumentDigest: 'not-a-digest' })).toThrow(/digest/i)
  })

  test('is stable when operations and admitted issues arrive in a different order', () => {
    const fixture = productionFixture()
    const rules = fixture.sectionIndex.find(section => section.sectionId === 'rules_systems')!
    const vision = fixture.sectionIndex.find(section => section.sectionId === 'vision')!
    const operations: PatchOperation[] = [
      { kind: 'REPLACE', documentPath: 'docs/GDD.md', sectionId: 'vision', issueIds: ['b'], beforeDigest: '1'.repeat(64), afterDigest: '2'.repeat(64) },
      { kind: 'REPLACE', documentPath: 'docs/GDD.md', sectionId: 'rules_systems', issueIds: ['a'], beforeDigest: '3'.repeat(64), afterDigest: '4'.repeat(64) },
    ]
    const impact = analyzeFoundationImpact(operations)
    const base = {
      validatorTaskId: 'validator-task-1' as const,
      round: 1 as const,
      documentPath: 'docs/GDD.md' as const,
      baseDocumentDigest: 'e'.repeat(64),
      postPatchDocumentDigest: 'f'.repeat(64),
      patchOperations: operations,
      impact,
      admittedIssues: [issue('b', vision), issue('a', rules)],
      sectionIndex: fixture.sectionIndex,
      factStore: fixture.factStore,
    }
    const result = validateFoundationPatch(base)
    expect(result.patchValidations.map(item => item.issueId)).toEqual(['a', 'b'])
    expect(result.patchValidations[0]?.changedSectionIds).toEqual(['rules_systems', 'vision'])
  })
})

describe('semantic patch targeted recheck authority', () => {
  const text = (sectionId: string, body: string) => `## ${sectionId}\n${body}`
  const snapshot = () => {
    const sourceText = text('core_loop', 'loop body')
    const targetText = text('vision', 'updated vision')
    const source: SectionRef = {
      documentPath: 'docs/GDD.md', sectionId: 'core_loop', heading: 'core_loop',
      startLine: 1, endLine: 2, digest: createHash('sha256').update(sourceText).digest('hex'),
    }
    const target: SectionRef = {
      documentPath: 'docs/GDD.md', sectionId: 'vision', heading: 'vision',
      startLine: 3, endLine: 4, digest: createHash('sha256').update(targetText).digest('hex'),
    }
    const operation: PatchOperation = {
      kind: 'REPLACE', documentPath: 'docs/GDD.md', sectionId: 'vision', issueIds: ['semantic-1'],
      beforeDigest: 'b'.repeat(64), afterDigest: target.digest,
    }
    const issue: AuditIssue = {
      id: 'semantic-1', severity: 'HIGH', type: 'semantic', source,
      target, expected: 'coherent', actual: 'contradictory',
      fixDocument: 'docs/GDD.md', fixSectionId: 'vision',
    }
    const fact: FoundationFact = {
      key: 'game.players.max', value: 4, source: target,
      evidence: { documentPath: target.documentPath, sectionId: target.sectionId, startLine: 4, endLine: 4, digest: target.digest },
    }
    return {
      sourceText, targetText, source, target, operation, issue, fact,
      sectionIndex: [source, target],
      documents: { 'docs/GDD.md': `${sourceText}\n${targetText}\n` },
      impact: analyzeFoundationImpact([operation]),
    }
  }

  const packetInput = (input: ReturnType<typeof snapshot>) => {
    const { sourceText: _sourceText, targetText: _targetText, fact: _fact, source: _source, target: _target, operation, ...value } = input
    return { ...value, patchOperation: operation }
  }

  test('builds one immutable packet from the exact deduplicated current slices and related facts', () => {
    const input = snapshot()
    const packet = buildFoundationSemanticRecheckPacket({ ...packetInput(input), factStore: [input.fact] })
    expect(packet.issueId).toBe('semantic-1')
    expect(packet.sections.map(section => `${section.ref.documentPath}#${section.ref.sectionId}`)).toEqual([
      'docs/GDD.md#core_loop', 'docs/GDD.md#vision',
    ])
    expect(packet.sections.find(section => section.ref.sectionId === 'vision')?.text).toBe(input.targetText)
    expect(packet.patchOperation).toEqual({ kind: 'REPLACE', documentPath: 'docs/GDD.md', sectionId: 'vision', beforeDigest: 'b'.repeat(64), afterDigest: input.target.digest })
    expect(packet.facts.map(fact => fact.key)).toEqual(['game.players.max'])
    expect(Object.isFrozen(packet)).toBe(true)
    expect(Object.isFrozen(packet.sections)).toBe(true)
    expect(packet.packetDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  test('rebinds changed issue references to the new digest but rejects drift in unchanged references', () => {
    const input = snapshot()
    const oldTarget = { ...input.target, digest: 'c'.repeat(64) }
    const packet = buildFoundationSemanticRecheckPacket({ ...packetInput(input), issue: { ...input.issue, target: oldTarget }, factStore: [input.fact] })
    expect(packet.sections.find(section => section.ref.sectionId === 'vision')?.ref.digest).toBe(input.target.digest)
    expect(() => buildFoundationSemanticRecheckPacket({
      ...packetInput(input),
      issue: { ...input.issue, source: { ...input.source, digest: 'c'.repeat(64) } },
      factStore: [input.fact],
    })).toThrow(/unchanged|digest|section/i)
  })

  test('is stable under input ordering and excludes other issue IDs and full documents', () => {
    const input = snapshot()
    const first = buildFoundationSemanticRecheckPacket({ ...packetInput(input), factStore: [input.fact] })
    const reversed = buildFoundationSemanticRecheckPacket({
      ...packetInput(input),
      sectionIndex: [...input.sectionIndex].reverse(),
      factStore: [input.fact],
    })
    expect(reversed.packetDigest).toBe(first.packetDigest)
    expect(JSON.stringify(first)).not.toContain('semantic-2')
    expect(JSON.stringify(first)).not.toContain(`${input.sourceText}\n${input.targetText}\n`)
    expect(first.sections.some(section => section.text === input.targetText)).toBe(true)
  })

  test('admits only exact PASS/FAIL results bound to the packet and produces a stable result digest', () => {
    const input = snapshot()
    const packet = buildFoundationSemanticRecheckPacket({ ...packetInput(input), factStore: [input.fact] })
    const pass = admitFoundationSemanticRecheckResult(packet, { issueId: packet.issueId, packetDigest: packet.packetDigest, status: 'PASS' })
    expect(pass).toEqual({ issueId: 'semantic-1', packetDigest: packet.packetDigest, status: 'PASS' })
    expect(digestFoundationSemanticRecheckResult(pass)).toBe(digestFoundationSemanticRecheckResult({ ...pass }))
    expect(() => admitFoundationSemanticRecheckResult(packet, { ...pass, status: 'UNDECIDABLE' })).toThrow(/status|PASS|FAIL/i)
    expect(() => admitFoundationSemanticRecheckResult(packet, { ...pass, issueId: 'other' })).toThrow(/identity|issue/i)
    expect(() => admitFoundationSemanticRecheckResult(packet, { ...pass, extra: true })).toThrow(/extra|shape|key/i)
  })

  test('rejects oversized packets and facts or sections outside the impact/current index', () => {
    const input = snapshot()
    expect(() => buildFoundationSemanticRecheckPacket({
      ...packetInput(input),
      documents: { 'docs/GDD.md': `${input.sourceText}\n${text('vision', 'x'.repeat(17 * 1024))}\n` },
      sectionIndex: [input.source, { ...input.target, digest: createHash('sha256').update(text('vision', 'x'.repeat(17 * 1024))).digest('hex') }],
      patchOperation: { ...input.operation, afterDigest: createHash('sha256').update(text('vision', 'x'.repeat(17 * 1024))).digest('hex') },
      factStore: [input.fact],
    })).toThrow(/16.*KiB|bytes|size/i)
    expect(() => buildFoundationSemanticRecheckPacket({ ...packetInput(input), factStore: [{ ...input.fact, key: 'game.mechanics' as const }] })).toThrow(/impact|fact|scope/i)
    expect(() => buildFoundationSemanticRecheckPacket({
      ...packetInput(input),
      issue: { ...input.issue, source: { ...input.source, sectionId: 'unknown' } },
      factStore: [input.fact],
    })).toThrow(/unknown|section|index/i)
    expect(() => buildFoundationSemanticRecheckPacket({
      ...packetInput(input),
      patchOperation: { ...input.operation, sectionId: 'core_loop', afterDigest: input.source.digest },
      factStore: [input.fact],
    })).toThrow(/bind|target|operation|impact/i)
  })
})
