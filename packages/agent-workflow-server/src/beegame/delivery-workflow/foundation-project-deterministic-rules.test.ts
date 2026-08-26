import { describe, expect, test } from 'bun:test'
import { buildFoundationSectionIndex } from './foundation-section-index'
import { getGameDocumentContract } from './game-document-contracts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import {
  collectGapBudgetPatchDrafts,
  collectFoundationProjectDeterministicDrafts,
} from './foundation-project-deterministic-rules'

function documents(overrides: Record<string, string> = {}): Map<string, string> {
  const result = new Map<string, string>(CANONICAL_FOUNDATION_DOCUMENTS.map(path => [
    path,
    (() => {
      const contract = getGameDocumentContract(path)
      const sections = contract.sections.map(section => `<!-- beegame-section:${section.sectionId} -->\n## ${section.title}\n\n${overrides[path] && ((path === 'docs/GDD.md' && section.sectionId === 'progression') || (path === 'docs/BALANCE_DESIGN.md' && section.sectionId === 'economy')) ? overrides[path] : 'canonical content'}\n`).join('\n')
      const materials = contract.productionMaterials.map(material => `<!-- beegame-material:${material.materialId} -->\n### ${material.title}\n\nmaterial ${material.materialId}\n`).join('\n')
      return `# ${path}\n\n<!-- beegame-executive-summary -->\n## Executive Summary\n\nsummary authority\n\n${sections}<!-- beegame-production-materials -->\n## Production Materials\n\n${materials}`
    })(),
  ]))
  const canonicalPaths = new Set<string>(CANONICAL_FOUNDATION_DOCUMENTS)
  for (const [path, body] of Object.entries(overrides))
    if (!canonicalPaths.has(path)) result.set(path, body)
  return result
}

function replaceSectionBody(
  input: Map<string, string>,
  documentPath: string,
  sectionId: string,
  body: string,
): void {
  const section = buildFoundationSectionIndex({ documents: input }).find(candidate =>
    candidate.documentPath === documentPath && candidate.sectionId === sectionId,
  )
  if (!section) throw new Error(`missing test section: ${documentPath}#${sectionId}`)
  const markdown = input.get(documentPath)!
  const lines = markdown.split('\n')
  const heading = lines[section.startLine - 1]!
  lines.splice(section.startLine - 1, section.endLine - section.startLine, heading, '', body)
  input.set(documentPath, lines.join('\n'))
}

describe('project-local deterministic foundation rules', () => {
  test('recognizes the Chinese gap vocabulary and patches only the ambiguous GDD owner', () => {
    const input = documents({
      'docs/GDD.md': '波次清空会发放固定结算。\n每次间隙的可用露珠不应同时满足建造与升级。',
      'docs/BALANCE_DESIGN.md': '该边界明确界定在波次结算收入 S_w 上。',
    })
    const sectionIndex = buildFoundationSectionIndex({ documents: input })
    const drafts = collectFoundationProjectDeterministicDrafts({ documents: input, sectionIndex })
    const gapDrafts = drafts.filter(draft => draft.checkId === 'deterministic.progression-gap-budget-scope')
    expect(gapDrafts).toHaveLength(1)
    expect(gapDrafts[0]).toMatchObject({
      source: { documentPath: 'docs/GDD.md', sectionId: 'progression' },
      remediation: { kind: 'patch', documentPath: 'docs/GDD.md', sectionIds: ['progression'] },
      conflictIdentity: { authority: 'FIXED_SETTLEMENT_DEW', scope: 'ambiguous' },
    })
    expect(gapDrafts[0]?.actual).toContain('without stating')
  })

  test('patches an explicitly widened Balance section without creating a GDD patch', () => {
    const input = documents({
      'docs/GDD.md': '每次间隙的固定结算收入为 S_w，不能同时补塔和升级。',
      'docs/BALANCE_DESIGN.md': '每个间隙的全部可用露珠都必须低于最便宜建造加最便宜升级。',
    })
    const sectionIndex = buildFoundationSectionIndex({ documents: input })
    const drafts = collectGapBudgetPatchDrafts({ documents: input, sectionIndex })
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      source: { documentPath: 'docs/BALANCE_DESIGN.md', sectionId: 'economy' },
      remediation: { kind: 'patch', documentPath: 'docs/BALANCE_DESIGN.md', sectionIds: ['economy'] },
      conflictIdentity: { authority: 'FIXED_SETTLEMENT_DEW', scope: 'all' },
    })
  })

  test('does not create a no-progress Balance patch when Balance already scopes S_w', () => {
    const input = documents({
      'docs/GDD.md': '每次间隙的固定结算收入为 S_w，不能同时补塔和升级。',
      'docs/BALANCE_DESIGN.md': '间隙预算只约束新发放的固定结算露珠 S_w，保存余额和击杀掉落是玩家可控奖励。',
    })
    const sectionIndex = buildFoundationSectionIndex({ documents: input })
    expect(collectGapBudgetPatchDrafts({ documents: input, sectionIndex })).toEqual([])
  })

  test('does not treat unrelated Balance route prose as a budget owner', () => {
    const input = documents({
      'docs/GDD.md': '每次间隙的固定结算收入为 S_w，不能同时补塔和升级。',
      'docs/BALANCE_DESIGN.md': '间隙预算只约束新发放的固定结算露珠 S_w。',
    })
    replaceSectionBody(input, 'docs/BALANCE_DESIGN.md', 'progression_curves', '路线展示间隙中的露珠收集节奏。')
    const sectionIndex = buildFoundationSectionIndex({ documents: input })
    expect(collectGapBudgetPatchDrafts({ documents: input, sectionIndex })).toEqual([])
  })
})
