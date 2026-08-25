import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { buildFoundationSectionIndex } from './foundation-section-index'
import type { SectionRef } from './foundation-section-index'
import {
  buildFoundationFactPackets,
  extractNormalizedFoundationFacts,
  extractSelectedFoundationFacts,
  mergeFoundationFactResults,
  validateFoundationFactResults,
  type FoundationFactReceipt,
} from './foundation-fact-extraction'
import { FOUNDATION_FACT_CATALOG, foundationFactDefinition } from './foundation-fact-definitions'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../../__tests__/complete-game-document-fixture'
import { withTestDocumentMetadata } from '../../__tests__/delivery-workflow-test-helpers'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

const docs = {
  'docs/GDD.md': `# GDD\n<!-- beegame-section:vision -->\n## Vision and Product Promise\nplayers.max: 4\nplatform: quest\n<!-- beegame-section:rules_systems -->\n## Gameplay Rules and Systems\nboss.count: 2\nresources: [hp, energy]\n<!-- beegame-section:player_actions -->\n## Player Actions and Controls\nmechanics: [move, attack, dash]\n<!-- beegame-section:states_flow -->\n## Game States and Flow\nstates: [menu, play, win, loss]\nwin_conditions: [boss defeated]\nloss_conditions: [health zero]\n`,
  'docs/LEVEL_SCENE_DESIGN.md': `# LEVEL\n<!-- beegame-section:encounters -->\n## Encounters and Challenge Placement\nrequired_entities: [player, boss]\n<!-- beegame-section:content_matrix -->\n## Content Matrix and Replay Structure\nrequired_assets: [player, boss]\n<!-- beegame-section:production_acceptance -->\n## Level Production and Acceptance\ncomplexity_budget: 100\n`,
  'docs/BALANCE_DESIGN.md': `# BALANCE\n<!-- beegame-section:entity_parameters -->\n## Entity and Ability Parameters\nentity_ids: [player, boss]\n<!-- beegame-section:units_variables -->\n## Units, Variables and Conventions\nvariable_ids: [health, damage]\n`,
  'docs/TECHNICAL_DESIGN.md': `# TECH\n<!-- beegame-section:input_interaction -->\n## Input and Interaction Boundary\nsupported_actions: [move, attack]\n<!-- beegame-section:performance -->\n## Performance and Capacity Budgets\ntarget_fps: 72\n<!-- beegame-section:data_content -->\n## Data and Content Contracts\ncontent_kinds: [entity, level]\n`,
  'docs/ART_DIRECTION.md': `# ART\n<!-- beegame-section:visual_pillars -->\n## Visual Pillars and References\nstyle_constraints: [bold silhouettes, high contrast]\n`,
  'docs/UI_UX_SPEC.md': `# UI\n<!-- beegame-section:input -->\n## Input, Focus and Interaction\nsupported_actions: [move, attack]\n<!-- beegame-section:hud -->\n## HUD and In-Game Information\ndisplayed_resources: [hp, energy]\n`,
  'docs/AUDIO_DESIGN.md': `# AUDIO\n<!-- beegame-section:event_taxonomy -->\n## Event and Cue Taxonomy\nevent_ids: [player.jump, boss.hit]\n`,
  'docs/ASSET_PLAN.md': `# ASSET\n<!-- beegame-section:inventory -->\n## Asset Inventory and Coverage\ninventory_ids: [player, boss]\nboss.count: 2\n<!-- beegame-section:dependencies -->\n## Asset Dependencies and Constraints\nart_constraint_refs: [style.bold]\n<!-- beegame-section:formats_budgets -->\n## Formats and Budgets\nformats: [png, wav]\n`,
} as const

function indexDocuments(input: Record<string, string>): SectionRef[] {
  const output: SectionRef[] = []
  for (const [documentPath, markdown] of Object.entries(input)) {
    const lines = markdown.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const marker = /^<!-- beegame-section:([a-z0-9._-]+) -->$/.exec(lines[index]!.trim())
      if (!marker) continue
      const heading = lines[index + 1]!.replace(/^##\s+/, '')
      const next = lines.findIndex((line, offset) => offset > index && /^<!-- beegame-section:/.test(line.trim()))
      const endLine = next < 0 ? lines.length : next
      output.push({
        documentPath: documentPath as SectionRef['documentPath'],
        sectionId: marker[1]!,
        heading,
        startLine: index + 2,
        endLine,
        digest: createHash('sha256').update(lines.slice(index + 1, endLine).join('\n')).digest('hex'),
      })
    }
  }
  return output
}

function sectionIndex(): SectionRef[] {
  return indexDocuments(docs)
}

function receiptKey(key: string): FoundationFactReceipt['key'] {
  return key as FoundationFactReceipt['key']
}

describe('mechanical normalized foundation extraction', () => {
  test('extracts only selected keys and their owner sections', () => {
    const index = sectionIndex()
    const result = extractSelectedFoundationFacts({
      keys: ['game.players.max', 'game.mechanics'],
      documents: { 'docs/GDD.md': docs['docs/GDD.md'] },
      sectionIndex: index,
    })

    expect(result.facts.map(fact => fact.key)).toEqual([
      'game.mechanics',
      'game.players.max',
    ])
    expect(result.receipts.map(receipt => receipt.key)).toEqual([
      'game.mechanics',
      'game.players.max',
    ])
    expect(result.unresolvedKeys).toEqual([])
  })

  test('rejects duplicate and unknown selected keys', () => {
    const index = sectionIndex()
    expect(() =>
      extractSelectedFoundationFacts({
        keys: ['game.players.max', 'game.players.max'],
        documents: docs,
        sectionIndex: index,
      }),
    ).toThrow(/duplicate/i)
    expect(() =>
      extractSelectedFoundationFacts({
        keys: ['not-a-foundation-key' as never],
        documents: docs,
        sectionIndex: index,
      }),
    ).toThrow(/unknown/i)
  })

  test('indexes the complete canonical document fixture without requiring author output changes', () => {
    const canonicalDocuments = Object.fromEntries(CANONICAL_FOUNDATION_DOCUMENTS.map(path => [
      path,
      withTestDocumentMetadata(path, renderTestCompleteGameDocument(path, completeTestSubmission(path))),
    ]))
    const index = buildFoundationSectionIndex({ documents: canonicalDocuments })
    const result = extractNormalizedFoundationFacts({ documents: canonicalDocuments, sectionIndex: index })
    expect(result.receipts).toHaveLength(FOUNDATION_FACT_CATALOG.length)
    expect(result.unresolvedKeys).toHaveLength(FOUNDATION_FACT_CATALOG.length)
    const packets = buildFoundationFactPackets({ revision: 'canonical-revision', documents: canonicalDocuments, sectionIndex: index, unresolvedKeys: result.unresolvedKeys })
    expect(packets).toHaveLength(8)
    expect(new Set(packets.flatMap(packet => packet.keys)).size).toBe(FOUNDATION_FACT_CATALOG.length)
    const admitted = packets.flatMap(packet => {
      const results = packet.keys.map(key => {
        const definition = foundationFactDefinition(key)!
        const section = packet.sections.find(candidate => candidate.documentPath === definition.owner.documentPath && candidate.sectionId === definition.owner.sectionId)!
        const value = definition.valueType === 'number'
          ? definition.valueSpec.min ?? 1
          : definition.valueType === 'string'
            ? definition.valueSpec.enum?.[0] ?? 'fixture'
            : definition.valueType === 'boolean'
              ? true
              : definition.valueType === 'number[]'
                ? [1]
                : ['fixture']
        return {
          key,
          status: 'present' as const,
          value,
          evidence: {
            documentPath: section.documentPath,
            sectionId: section.sectionId,
            startLine: section.startLine,
            endLine: section.endLine,
            digest: createHash('sha256').update(section.text).digest('hex'),
          },
        }
      })
      return validateFoundationFactResults({ packet, expectedRevision: 'canonical-revision', documents: canonicalDocuments, sectionIndex: index, results }).facts
    })
    expect(admitted).toHaveLength(FOUNDATION_FACT_CATALOG.length)
    expect(admitted.every(fact => fact.evidence)).toBe(true)
  })

  test('rejects prose-body facts and emits typed facts with exact indexed provenance', () => {
    const index = sectionIndex()
    const result = extractNormalizedFoundationFacts({ documents: docs, sectionIndex: index })
    expect(result.facts.map(fact => fact.key)).toContain('game.players.max')
    expect(result.facts.find(fact => fact.key === 'game.players.max')?.value).toBe(4)
    expect(result.facts.find(fact => fact.key === 'game.mechanics')?.value).toEqual([
      'move',
      'attack',
      'dash',
    ])
    expect(result.facts.some(fact => fact.value === 'players.max: 4')).toBe(false)
    const fact = result.facts.find(item => item.key === 'game.players.max')!
    expect(fact.source).toEqual(
      expect.objectContaining({
        documentPath: 'docs/GDD.md',
        sectionId: 'vision',
      }),
    )
    expect(fact.evidence!.startLine).toBeGreaterThanOrEqual(fact.source.startLine)
    expect(fact.evidence!.endLine).toBeLessThanOrEqual(fact.source.endLine)
    expect(fact.evidence!.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  test('creates packets only for unresolved keys and exact owner slices', () => {
    const index = sectionIndex()
    const mechanical = extractNormalizedFoundationFacts({ documents: docs, sectionIndex: index })
    const packets = buildFoundationFactPackets({
      revision: 'revision-1',
      documents: docs,
      sectionIndex: index,
      unresolvedKeys: mechanical.unresolvedKeys,
    })
    expect(packets.every(packet => packet.bytesUtf8 > 0)).toBe(true)
    expect(packets.every(packet => packet.keys.every(key => FOUNDATION_FACT_CATALOG.some(item => item.key === key)))).toBe(true)
    expect(packets.every(packet => packet.sections.every(section => section.text.length > 0))).toBe(true)
    expect(packets.every(packet => !('documentPathSelector' in packet))).toBe(true)
  })

  test('keeps one stable packet per document without dropping complete owner sections', () => {
    const level = `# LEVEL\n<!-- beegame-section:encounters -->\n## Encounters\nrequired_entities: [player]\n${'x'.repeat(6000)}\n<!-- beegame-section:content_matrix -->\n## Content Matrix\nrequired_assets: [player]\n${'x'.repeat(6000)}\n<!-- beegame-section:production_acceptance -->\n## Production Acceptance\ncomplexity_budget: 100\n${'x'.repeat(6000)}\n`
    const documents = { ...docs, 'docs/LEVEL_SCENE_DESIGN.md': level }
    const packets = buildFoundationFactPackets({
      revision: 'revision-large',
      documents,
      sectionIndex: indexDocuments(documents),
      unresolvedKeys: ['level.complexity_budget', 'level.required_assets', 'level.required_entities'],
    })
    expect(packets).toHaveLength(1)
    expect(packets.every(packet => packet.bytesUtf8 > 0)).toBe(true)
    expect(packets.flatMap(packet => packet.keys).sort()).toEqual([
      'level.complexity_budget',
      'level.required_assets',
      'level.required_entities',
    ])
    expect(packets.flatMap(packet => packet.sections.map(section => section.sectionId)).sort()).toEqual([
      'content_matrix',
      'encounters',
      'production_acceptance',
    ])
    expect(packets[0]!.sections.map(section => section.sectionId)).toEqual(['content_matrix', 'encounters', 'production_acceptance'])
  })

  test('builds and validates a legal single owner section larger than 16 KiB', () => {
    const level = `# LEVEL\n<!-- beegame-section:encounters -->\n## Encounters\nrequired_entities: [player]\n${'x'.repeat(20_000)}\n`
    const documents = { ...docs, 'docs/LEVEL_SCENE_DESIGN.md': level }
    const index = indexDocuments(documents)
    const packet = buildFoundationFactPackets({
      revision: 'revision-too-large',
      documents,
      sectionIndex: index,
      unresolvedKeys: ['level.required_entities'],
    })[0]!
    expect(packet.bytesUtf8).toBeGreaterThan(16 * 1024)
    expect(packet.packetDigest).toMatch(/^[a-f0-9]{64}$/)
    const admitted = validateFoundationFactResults({
      packet,
      expectedRevision: 'revision-too-large',
      documents,
      sectionIndex: index,
      results: [{
        key: 'level.required_entities',
        status: 'present',
        value: ['player'],
        evidence: {
          documentPath: 'docs/LEVEL_SCENE_DESIGN.md',
          sectionId: 'encounters',
          startLine: 4,
          endLine: 4,
          digest: createHash('sha256').update('required_entities: [player]').digest('hex'),
        },
      }],
    })
    expect(admitted.facts.map(fact => fact.key)).toEqual(['level.required_entities'])
    expect(admitted.normalizedFactDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  test('canonicalizes reordered unresolved keys to identical packets and digests', () => {
    const index = sectionIndex()
    const unresolvedKeys = extractNormalizedFoundationFacts({ documents: docs, sectionIndex: index }).unresolvedKeys
    const build = (keys: readonly string[]) => buildFoundationFactPackets({ revision: 'revision-order', documents: docs, sectionIndex: index, unresolvedKeys: keys })
    expect(build([...unresolvedKeys].reverse())).toEqual(build(unresolvedKeys))
  })

  test('admits each assigned result exactly once and rejects bad evidence or scope', () => {
    const index = sectionIndex()
    const mechanical = extractNormalizedFoundationFacts({ documents: docs, sectionIndex: index })
    const fact = mechanical.facts.find(item => item.key === 'game.mechanics')!
    const packet = buildFoundationFactPackets({
      revision: 'revision-1',
      documents: docs,
      sectionIndex: index,
      unresolvedKeys: ['game.mechanics'],
    })[0]!
    expect(() =>
      validateFoundationFactResults({
        packet,
        expectedRevision: 'stale-revision',
        documents: docs,
        sectionIndex: index,
        results: [],
      }),
    ).toThrow(/stale|revision/i)
    expect(() =>
      validateFoundationFactResults({
        packet,
        expectedRevision: 'revision-1',
        documents: docs,
        sectionIndex: index,
        results: [
          {
            key: 'game.mechanics',
            status: 'present',
            value: fact.value,
            evidence: fact.evidence!,
          },
          {
            key: 'game.mechanics',
            status: 'present',
            value: fact.value,
            evidence: fact.evidence!,
          },
        ],
      }),
    ).toThrow(/duplicate|exactly once/i)
    expect(() =>
      validateFoundationFactResults({
        packet,
        expectedRevision: 'revision-1',
        documents: docs,
        sectionIndex: index,
        results: [
          {
            key: 'game.mechanics',
            status: 'present',
            value: fact.value,
            evidence: fact.evidence!,
            reason: 'unexpected extra field',
          },
        ],
      }),
    ).toThrow(/reason|present.*field/i)
    expect(() =>
      validateFoundationFactResults({
        packet,
        expectedRevision: 'revision-1',
        documents: docs,
        sectionIndex: index,
        results: [
          {
            key: 'game.mechanics',
            status: 'absent',
            value: undefined,
          },
        ],
      }),
    ).toThrow(/absent.*value/i)
    const digest = createHash('sha256').update('wrong').digest('hex')
    expect(() =>
      validateFoundationFactResults({
        packet,
        expectedRevision: 'revision-1',
        documents: docs,
        sectionIndex: index,
        results: [
          {
            key: 'game.mechanics',
            status: 'present',
            value: fact.value,
            evidence: { ...fact.evidence!, digest },
          },
        ],
      }),
    ).toThrow(/digest/i)
  })

  test('merges a complete mechanical catalog without requiring worker facts', () => {
    const extraction = extractNormalizedFoundationFacts({ documents: docs, sectionIndex: sectionIndex() })
    expect(extraction.unresolvedKeys).toEqual([])
    expect(mergeFoundationFactResults({ mechanicalFacts: extraction.facts, workerFacts: [], workerReceipts: [] })).toEqual(extraction.facts)
  })

  test('merges mixed present, absent, and uncertain worker accounting into a present-only store', () => {
    const extraction = extractNormalizedFoundationFacts({ documents: docs, sectionIndex: sectionIndex() })
    const absent = extraction.facts.find(fact => fact.key === 'game.players.max')!
    const uncertain = extraction.facts.find(fact => fact.key === 'game.platform')!
    const worker = extraction.facts.find(fact => fact.key === 'game.mechanics')!
    const mechanical = extraction.facts.filter(fact => ![absent, uncertain, worker].includes(fact))
    const merged = mergeFoundationFactResults({
      mechanicalFacts: mechanical,
      workerFacts: [worker],
      workerReceipts: [
        { key: receiptKey(worker.key), status: 'present', value: worker.value, evidence: worker.evidence },
        { key: receiptKey(absent.key), status: 'absent' },
        { key: receiptKey(uncertain.key), status: 'uncertain', reason: 'owner section is ambiguous', evidence: uncertain.evidence },
      ],
    })
    expect(merged).toEqual(extraction.facts.filter(fact => fact !== absent && fact !== uncertain))
  })

  test('fails closed on duplicate, overlap, and mismatched worker accounting', () => {
    const extraction = extractNormalizedFoundationFacts({ documents: docs, sectionIndex: sectionIndex() })
    const fact = extraction.facts.find(item => item.key === 'game.players.max')!
    expect(() => mergeFoundationFactResults({
      mechanicalFacts: extraction.facts,
      workerFacts: [{ ...fact, value: 5 }],
      workerReceipts: [{ key: receiptKey(fact.key), status: 'present', value: 5, evidence: fact.evidence }],
    })).toThrow(/overlap|mechanical/i)
    expect(() => mergeFoundationFactResults({
      mechanicalFacts: extraction.facts,
      workerFacts: [{ ...fact, evidence: { ...fact.evidence, digest: 'f'.repeat(64) } }],
      workerReceipts: [{ key: receiptKey(fact.key), status: 'present', value: fact.value, evidence: fact.evidence }],
    })).toThrow(/overlap|mechanical/i)
    const worker = extraction.facts.find(item => item.key === 'game.mechanics')!
    const mechanical = extraction.facts.filter(item => item.key !== worker.key)
    expect(() => mergeFoundationFactResults({
      mechanicalFacts: mechanical,
      workerFacts: [worker],
      workerReceipts: [
        { key: receiptKey(worker.key), status: 'absent' },
      ],
    })).toThrow(/absent.*worker fact|worker fact.*absent/i)
    expect(() => mergeFoundationFactResults({
      mechanicalFacts: mechanical,
      workerFacts: [worker],
      workerReceipts: [
        { key: receiptKey(worker.key), status: 'present', value: ['wrong'], evidence: worker.evidence },
      ],
    })).toThrow(/value|receipt|matching/i)
    expect(() => mergeFoundationFactResults({
      mechanicalFacts: mechanical,
      workerFacts: [],
      workerReceipts: [
        { key: receiptKey(worker.key), status: 'present', value: worker.value, evidence: worker.evidence },
      ],
    })).toThrow(/worker fact|present/i)
    expect(() => mergeFoundationFactResults({
      mechanicalFacts: mechanical,
      workerFacts: [worker],
      workerReceipts: [
        { key: receiptKey(worker.key), status: 'present', value: worker.value, evidence: worker.evidence },
        { key: receiptKey(worker.key), status: 'present', value: worker.value, evidence: worker.evidence },
      ],
    })).toThrow(/duplicate/i)
    expect(() => mergeFoundationFactResults({
      mechanicalFacts: mechanical,
      workerFacts: [],
      workerReceipts: [
        { key: receiptKey(worker.key), status: 'absent', extra: true } as never,
      ],
    })).toThrow(/unexpected fields/i)
    expect(() => mergeFoundationFactResults({
      mechanicalFacts: mechanical,
      workerFacts: [],
      workerReceipts: [{
        key: receiptKey(worker.key),
        status: 'uncertain',
        reason: 'ambiguous',
        evidence: { ...worker.evidence, sectionId: 'wrong-owner' },
      }],
    })).toThrow(/uncertain.*incomplete/i)
  })

  test('fails closed on missing or unknown catalog keys', () => {
    const extraction = extractNormalizedFoundationFacts({ documents: docs, sectionIndex: sectionIndex() })
    const missing = extraction.facts.slice(1)
    expect(() => mergeFoundationFactResults({ mechanicalFacts: missing, workerFacts: [], workerReceipts: [] })).toThrow(/coverage.*incomplete/i)
    expect(() => mergeFoundationFactResults({
      mechanicalFacts: extraction.facts,
      workerFacts: [{ ...extraction.facts[0]!, key: 'unknown.fact' }],
      workerReceipts: [],
    })).toThrow(/unknown.*foundation fact (key|receipt key)/i)
    expect(() => mergeFoundationFactResults({
      mechanicalFacts: extraction.facts,
      workerFacts: [],
      workerReceipts: [{ key: 'unknown.fact' as never, status: 'absent' }],
    })).toThrow(/unknown.*foundation fact (key|receipt key)/i)
  })
})
