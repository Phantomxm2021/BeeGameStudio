import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFoundationSectionIndex } from './foundation-section-index'
import { extractNormalizedFoundationFacts } from './foundation-fact-extraction'
import { FOUNDATION_FACT_CATALOG, type FoundationFactKey } from './foundation-fact-definitions'
import { getGameDocumentContract } from './game-document-contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import {
  FOUNDATION_AUDIT_PRODUCTION_MANIFEST,
  runProductionDeterministicFoundationAudit,
} from './foundation-audit-production-manifest'
import { FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS } from './foundation-audit-authority'
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
  'asset.covered_level_requirements': '[player_model, boss_model]',
  'asset.boss.count': '2',
  'asset.art_constraint_refs': '[low_poly, readable_silhouette]',
  'asset.formats': '[glb, png, wav]',
}

function fixtureDocuments(overrides: Partial<Record<string, string>> = {}): Map<string, string> {
  const byOwner = new Map<string, string[]>()
  for (const definition of FOUNDATION_FACT_CATALOG) {
    const entries = byOwner.get(`${definition.owner.documentPath}\0${definition.owner.sectionId}`) ?? []
    entries.push(`${definition.key}: ${overrides[definition.key] ?? values[definition.key]}`)
    byOwner.set(`${definition.owner.documentPath}\0${definition.owner.sectionId}`, entries)
  }
  return new Map(CANONICAL_FOUNDATION_DOCUMENTS.map(path => {
    const contract = getGameDocumentContract(path)
    const lines = [
      `# ${path}`,
      '',
      '<!-- beegame-executive-summary -->',
      '## Executive Summary',
      '',
      'summary authority',
      '',
    ]
    for (const section of contract.sections) {
      lines.push(`<!-- beegame-section:${section.sectionId} -->`, `## ${section.title}`, '')
      lines.push(...(byOwner.get(`${path}\0${section.sectionId}`) ?? ['authored content']), '')
    }
    lines.push('<!-- beegame-production-materials -->', '## Production Materials', '')
    for (const material of contract.productionMaterials)
      lines.push(`<!-- beegame-material:${material.materialId} -->`, `### ${material.title}`, '', `material ${material.materialId}`, '')
    return [path, `${lines.join('\n')}\n`] as const
  }))
}

describe('service-owned deterministic production audit', () => {
  test('exposes exactly one closed, versioned manifest with catalog-grounded declarations', () => {
    expect(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.version).toBe('foundation-deterministic.v1')
    expect(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion).toBe('foundation-facts.v2')
    expect(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.schemaKeys).toHaveLength(25)
    expect('rules' in FOUNDATION_AUDIT_PRODUCTION_MANIFEST).toBe(false)
    expect(new Set(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.schemaKeys).size).toBe(25)
    expect(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contracts.map(item => item.id)).toContain('asset-boss-count-authority')
    expect(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contracts.map(item => item.id)).not.toContain('asset-art-constraints-authority')
    expect(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.deferredSemanticKeys).toEqual([
      'technical.target_fps',
      'level.complexity_budget',
      'asset.art_constraint_refs',
    ])
    expect(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.digest).toBe('2eb15f222f4c51784915041bb9b8483ae2ce49129d9a629291c15904e177f7bc')
    expect(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contracts).toBe(FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS)
    expect(FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contracts).toEqual(FOUNDATION_DETERMINISTIC_CONTRACT_DECLARATIONS)
    expect(Object.isFrozen(FOUNDATION_AUDIT_PRODUCTION_MANIFEST)).toBe(true)
  })

  test('production schema owns missing fact completeness without contract duplicates', () => {
    const documents = fixtureDocuments()
    const sectionIndex = buildFoundationSectionIndex({ documents })
    const issues = runProductionDeterministicFoundationAudit({ sectionIndex, factStore: [] })
    expect(issues).toHaveLength(22)
    expect(issues.filter(issue => issue.type === 'schema')).toHaveLength(22)
    expect(issues.filter(issue => issue.type === 'contract')).toHaveLength(0)
  })

  test('defers absent performance facts to semantic review while retaining non-deferred schema blockers', () => {
    const documents = fixtureDocuments({ 'asset.boss.count': '3' })
    const sectionIndex = buildFoundationSectionIndex({ documents })
    const extraction = extractNormalizedFoundationFacts({ documents, sectionIndex })
    const withoutDeferred = extraction.facts.filter(fact =>
      !['technical.target_fps', 'level.complexity_budget'].includes(fact.key),
    )
    const deferredIssues = runProductionDeterministicFoundationAudit({ sectionIndex, factStore: withoutDeferred })
    expect(deferredIssues).toEqual([])

    const withoutAnyDeferred = extraction.facts.filter(fact =>
      !FOUNDATION_AUDIT_PRODUCTION_MANIFEST.deferredSemanticKeys.includes(fact.key as FoundationFactKey),
    )
    expect(runProductionDeterministicFoundationAudit({ sectionIndex, factStore: withoutAnyDeferred })).toEqual([])

    const withoutRequired = withoutDeferred.filter(fact => fact.key !== 'game.platform')
    const requiredIssues = runProductionDeterministicFoundationAudit({ sectionIndex, factStore: withoutRequired })
    expect(requiredIssues.filter(issue => issue.type === 'schema')).toHaveLength(1)
    expect(requiredIssues[0]?.actual).toBe('missing fact game.platform')
  })

  test('still validates the catalog value bounds for a present deferred fact', () => {
    const documents = fixtureDocuments({ 'asset.boss.count': '3' })
    const sectionIndex = buildFoundationSectionIndex({ documents })
    const extraction = extractNormalizedFoundationFacts({ documents, sectionIndex })
    const invalid = extraction.facts.map(fact =>
      fact.key === 'technical.target_fps' ? { ...fact, value: 0 } : fact,
    )
    const issues = runProductionDeterministicFoundationAudit({ sectionIndex, factStore: invalid })
    expect(issues.filter(issue => issue.type === 'schema')).toHaveLength(1)
    expect(issues[0]?.actual).toContain('technical.target_fps')
  })

  test('does not compare art constraint references with visual constraint values', () => {
    const documents = fixtureDocuments({
      'asset.boss.count': '3',
      'art.style_constraints': '[V1, V2]',
      'asset.art_constraint_refs': '[ART_DIRECTION/VP-1, ART_DIRECTION/AR-1]',
    })
    const sectionIndex = buildFoundationSectionIndex({ documents })
    const extraction = extractNormalizedFoundationFacts({ documents, sectionIndex })
    const issues = runProductionDeterministicFoundationAudit({ sectionIndex, factStore: extraction.facts })
    expect(issues.filter(issue => issue.type === 'contract')).toEqual([])
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
      remediation: { kind: 'patch', documentPath: 'docs/ASSET_PLAN.md', sectionIds: ['inventory'] },
    })
  })

  test('compares covered level requirements, not physical inventory IDs', () => {
    const documents = fixtureDocuments({
      'level.required_assets': '[网格底板 × 1, 可操控角色 × 1]',
      'asset.inventory_ids': '[GC-BOARD, GC-HERO]',
      'asset.covered_level_requirements': '[网格底板 × 1, 可操控角色 × 1]',
      'asset.boss.count': '3',
    })
    const sectionIndex = buildFoundationSectionIndex({ documents })
    const extraction = extractNormalizedFoundationFacts({ documents, sectionIndex })
    const issues = runProductionDeterministicFoundationAudit({
      sectionIndex,
      factStore: extraction.facts,
    })
    expect(issues.filter(issue => issue.type === 'contract')).toEqual([])

    const missingCoverageDocuments = fixtureDocuments({
      'level.required_assets': '[网格底板 × 1, 可操控角色 × 1]',
      'asset.inventory_ids': '[GC-BOARD, GC-HERO]',
      'asset.covered_level_requirements': '[网格底板 × 1]',
      'asset.boss.count': '3',
    })
    const missingCoverageIndex = buildFoundationSectionIndex({ documents: missingCoverageDocuments })
    const missingCoverageFacts = extractNormalizedFoundationFacts({
      documents: missingCoverageDocuments,
      sectionIndex: missingCoverageIndex,
    })
    const missingCoverageIssues = runProductionDeterministicFoundationAudit({
      sectionIndex: missingCoverageIndex,
      factStore: missingCoverageFacts.facts,
    })
    expect(missingCoverageIssues).toHaveLength(1)
    expect(missingCoverageIssues[0]).toMatchObject({
      id: expect.stringMatching(/^AUD-[A-F0-9]{24}$/),
      type: 'contract',
      severity: 'HIGH',
      remediation: { kind: 'patch', documentPath: 'docs/ASSET_PLAN.md', sectionIds: ['inventory'] },
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
      expect(mismatchIssues.find(issue => issue.type === 'contract')?.remediation).toMatchObject({ kind: 'patch', documentPath: declaration.source.documentPath })
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
