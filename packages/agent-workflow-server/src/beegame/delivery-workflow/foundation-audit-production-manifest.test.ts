import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFoundationSectionIndex } from './foundation-section-index'
import { extractNormalizedFoundationFacts } from './foundation-fact-extraction'
import { FOUNDATION_FACT_CATALOG } from './foundation-fact-definitions'
import { getGameDocumentContract } from './game-document-contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import {
  FOUNDATION_AUDIT_PRODUCTION_MANIFEST,
  runProductionDeterministicFoundationAudit,
} from './foundation-audit-production-manifest'
import { SERVICE_OWNED_CATALOG_EDGES } from './foundation-audit-contracts'
import {
  resolveFoundationFixTarget,
  TECHNICAL_IMPOSSIBILITY_REASON_CODE,
} from './foundation-audit-authority'
import {
  foundationDeterministicReviewArtifactPaths,
  publishDeterministicFoundationReview,
  loadDeterministicFoundationReview,
} from './foundation-audit-artifacts'

const values: Record<string, string> = {
  'game.players.max': '4',
  'game.boss.count': '3',
  'game.mechanics': '[move, attack, dash]',
  'game.resources': '[hp, energy]',
  'game.states': '[menu, playing, won, lost]',
  'game.win_conditions': '[boss_defeated]',
  'game.loss_conditions': '[player_defeated]',
  'game.platform': 'quest',
  'level.required_entities': '[Player, Boss_A]',
  'level.required_assets': '[player_model, boss_model]',
  'level.complexity_budget': '100',
  'balance.entity_ids': '[Player, Boss_A]',
  'balance.variable_ids': '[player_hp, boss_hp]',
  'technical.supported_actions': '[move, attack, dash]',
  'technical.target_fps': '72',
  'technical.content_kinds': '[model, texture, audio]',
  'art.style_constraints': '[low_poly, readable_silhouette]',
  'ui.supported_actions': '[move, attack, dash]',
  'ui.displayed_resources': '[hp, energy]',
  'audio.event_ids': '[boss_spawn, boss_defeated]',
  'asset.inventory_ids': '[player_model, boss_model]',
  'asset.boss.count': '2',
  'asset.art_constraint_refs': '[low_poly, readable_silhouette]',
  'asset.formats': '[glb, png, wav]',
}

function fixtureDocuments(): Map<string, string> {
  const byOwner = new Map<string, string[]>()
  for (const definition of FOUNDATION_FACT_CATALOG) {
    const entries = byOwner.get(`${definition.owner.documentPath}\0${definition.owner.sectionId}`) ?? []
    entries.push(`${definition.key}: ${values[definition.key]}`)
    byOwner.set(`${definition.owner.documentPath}\0${definition.owner.sectionId}`, entries)
  }
  return new Map(CANONICAL_FOUNDATION_DOCUMENTS.map(path => {
    const contract = getGameDocumentContract(path)
    const lines = [`# ${path}`, '']
    for (const section of contract.sections) {
      lines.push(`<!-- beegame-section:${section.sectionId} -->`, `## ${section.title}`, '')
      lines.push(...(byOwner.get(`${path}\0${section.sectionId}`) ?? ['authored content']), '')
    }
    return [path, `${lines.join('\n')}\n`] as const
  }))
}

describe('service-owned deterministic production audit', () => {
  test('exposes exactly one closed, versioned manifest with catalog-grounded declarations', () => {
    expect(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.version).toBe('foundation-deterministic.v1')
    expect(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion).toBe('foundation-facts.v1')
    expect(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.schemaKeys).toHaveLength(24)
    expect('rules' in FOUNDATION_AUDIT_PRODUCTION_MANIFEST).toBe(false)
    expect(new Set(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.schemaKeys).size).toBe(24)
    expect(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contracts.map(item => item.id)).toContain('asset-boss-count-authority')
    expect(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contracts.map(item => `${item.sourceFactKey}->${item.targetFactKey}`).sort()).toEqual(SERVICE_OWNED_CATALOG_EDGES.map(item => `${item.sourceFactKey}->${item.targetFactKey}`).sort())
    expect(Object.isFrozen(FOUNDATION_AUDIT_PRODUCTION_MANIFEST)).toBe(true)
  })

  test('runs the real eight-document normalized-fact pipeline without caller rules or a worker', () => {
    const documents = fixtureDocuments()
    const sectionIndex = buildFoundationSectionIndex({ documents })
    const extraction = extractNormalizedFoundationFacts({ documents, sectionIndex })
    expect(extraction.unresolvedKeys).toEqual([])
    expect(extraction.facts.some(fact => typeof fact.value === 'string' && fact.value.includes('##'))).toBe(false)

    const issues = runProductionDeterministicFoundationAudit({
      sectionIndex,
      factStore: extraction.facts,
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      id: expect.stringMatching(/^AUD-[A-F0-9]{24}$/),
      type: 'contract',
      fixDocument: 'docs/ASSET_PLAN.md',
      fixSectionId: 'inventory',
    })
  })

  test('executes every declared production contract, accepts reordered/extra downstream lists, and defers FPS complexity semantics', () => {
    const documents = fixtureDocuments()
    const sectionIndex = buildFoundationSectionIndex({ documents })
    const extraction = extractNormalizedFoundationFacts({ documents, sectionIndex })
    const tolerantFacts = extraction.facts.map(fact => {
      if (fact.key === 'technical.supported_actions') return { ...fact, value: ['dash', 'move', 'attack', 'parry'] }
      if (fact.key === 'ui.displayed_resources') return { ...fact, value: ['energy', 'hp', 'shield'] }
      if (fact.key === 'asset.inventory_ids') return { ...fact, value: ['boss_model', 'player_model', 'arena_model'] }
      if (fact.key === 'asset.art_constraint_refs') return { ...fact, value: ['readable_silhouette', 'low_poly', 'contrast'] }
      if (fact.key === 'level.complexity_budget') return { ...fact, value: 20 }
      return fact
    })
    const issues = runProductionDeterministicFoundationAudit({ sectionIndex, factStore: tolerantFacts })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.id).toBe(runProductionDeterministicFoundationAudit({ sectionIndex, factStore: extraction.facts })[0]?.id)
    const passingFacts = extraction.facts.map(fact => fact.key === 'asset.boss.count' ? { ...fact, value: 3 } : fact)
    for (const declaration of FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contracts) {
      const sourceKey = declaration.sourceFactKey
      const targetKey = declaration.targetFactKey
      const mismatch = passingFacts.map(fact => fact.key === sourceKey ? {
        ...fact,
        value: typeof fact.value === 'number' ? (fact.value as number) + 7 : ['deliberate-mismatch'],
      } : fact)
      if (sourceKey === 'technical.target_fps') continue
      const mismatchIssues = runProductionDeterministicFoundationAudit({ sectionIndex, factStore: mismatch })
      expect(mismatchIssues.some(issue => issue.type === 'contract'), declaration.id).toBe(true)
      expect(mismatchIssues.find(issue => issue.type === 'contract')?.fixDocument).toBe(declaration.source.documentPath)
      expect(targetKey).toBeTruthy()
    }
  })

  test('rejects caller-supplied production declarations', () => {
    const documents = fixtureDocuments()
    const sectionIndex = buildFoundationSectionIndex({ documents })
    const extraction = extractNormalizedFoundationFacts({ documents, sectionIndex })
    expect(() => runProductionDeterministicFoundationAudit({
      sectionIndex,
      factStore: extraction.facts,
      rules: [],
    } as never)).toThrow('caller')
  })

  test('allows Technical to GDD only for the explicit technical-impossibility blocker', () => {
    const technical = { documentPath: 'docs/TECHNICAL_DESIGN.md' as const, sectionId: 'performance' }
    const gdd = { documentPath: 'docs/GDD.md' as const, sectionId: 'vision' }
    expect(() => resolveFoundationFixTarget({ source: technical, target: gdd, severity: 'HIGH' })).toThrow('authority')
    expect(resolveFoundationFixTarget({ source: technical, target: gdd, severity: 'BLOCKER', reasonCode: TECHNICAL_IMPOSSIBILITY_REASON_CODE })).toEqual(gdd)
  })

  test('persists one revision-bound deterministic registry prefix and rejects stale or duplicate replay', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-deterministic-review-'))
    try {
      const documents = fixtureDocuments()
      const sectionIndex = buildFoundationSectionIndex({ documents })
      const extraction = extractNormalizedFoundationFacts({ documents, sectionIndex })
      const issues = runProductionDeterministicFoundationAudit({ sectionIndex, factStore: extraction.facts })
      const documentDigests = Object.fromEntries(CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, 'a'.repeat(64)])) as Record<string, string>
      const published = await publishDeterministicFoundationReview({
        workspacePath,
        revision: 'revision-deterministic',
        documentDigests,
        sectionIndex,
        factStore: extraction.facts,
        issues,
      })
      expect(await stat(published.paths.issueRegistry)).toBeTruthy()
      expect(await loadDeterministicFoundationReview({ workspacePath, revision: 'revision-deterministic', reviewDigest: published.reviewDigest })).toMatchObject({
        reviewDigest: published.reviewDigest,
        issues,
      })
      await expect(publishDeterministicFoundationReview({
        workspacePath,
        revision: 'revision-deterministic',
        documentDigests: { ...documentDigests, 'docs/GDD.md': 'b'.repeat(64) },
        sectionIndex,
        factStore: extraction.facts,
        issues,
      })).rejects.toThrow('stale')
      await expect(publishDeterministicFoundationReview({
        workspacePath,
        revision: 'revision-deterministic-duplicate',
        documentDigests,
        sectionIndex,
        factStore: extraction.facts,
        issues: [issues[0]!, issues[0]!],
      })).rejects.toThrow('duplicate')
      await expect(publishDeterministicFoundationReview({
        workspacePath,
        revision: 'revision-custom-manifest',
        documentDigests,
        sectionIndex,
        factStore: extraction.facts,
        issues,
        manifest: { ...FOUNDATION_AUDIT_PRODUCTION_MANIFEST, digest: 'f'.repeat(64) },
      } as never)).rejects.toThrow(/manifest|authority|caller/i)
      expect(await readFile(published.paths.issueRegistry, 'utf8')).toContain('AUD-')
      expect(foundationDeterministicReviewArtifactPaths(workspacePath, 'revision-deterministic', published.reviewDigest).issueRegistry).toBe(published.paths.issueRegistry)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
