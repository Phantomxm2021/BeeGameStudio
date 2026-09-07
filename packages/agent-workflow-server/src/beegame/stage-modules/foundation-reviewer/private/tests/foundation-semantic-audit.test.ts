import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { digestFactStore, type FoundationFact } from '../domain/foundation-fact-store'
import { canonicalFoundationBlockIds, digestSectionIndex, type SectionRef } from '../domain/foundation-section-index'
import type { AuditIssue } from '../domain/foundation-issue-registry'
import {
  FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
  FOUNDATION_SEMANTIC_CHECKS,
  admitFoundationSemanticResult,
  buildFoundationSemanticPacket,
  createDeepConfirmationRequest,
  semanticResultToFoundationIssueDrafts,
  validateFoundationSemanticManifest,
  type FoundationSemanticResult,
} from '../domain/foundation-semantic-audit'

const gameplaySections = [
  ...['vision', 'core_loop', 'player_actions', 'rules_systems', 'states_flow', 'progression', 'content_narrative', 'scope_risks'].map(sectionId => `GDD#${sectionId}`),
  ...canonicalFoundationBlockIds('docs/LEVEL_SCENE_DESIGN.md').map(sectionId => `LEVEL#${sectionId}`),
]

const expected = [
  ['SEM.gameplay_level_viability', gameplaySections, ['game.mechanics', 'level.required_entities'], '逐块核对整份 Level（摘要、正文与图表）是否符合 GDD 的产品范围、核心循环、玩家动作、时长、进度和持久化边界，并检查 Level 内部是否自相矛盾。每个仍要求范围外世界、关卡、机制或系统的块都必须形成可修复 Issue；不能因其他章节已改正确而忽略残留内容。仅检查产品范围与玩法可行性，不重复其他专项检查的数值、布局或实现细节。', 'HIGH', 'balanced'],
  ['SEM.progression_balance_coherence', ['GDD#progression', 'LEVEL#content_matrix', 'BALANCE#executive_summary', 'BALANCE#units_variables', 'BALANCE#entity_parameters', 'BALANCE#formulas', 'BALANCE#economy', 'BALANCE#progression_curves', 'BALANCE#challenge_model', 'BALANCE#rewards_value', 'BALANCE#bounds_exploits', 'BALANCE#tuning_validation', 'BALANCE#material.variable-parameter-table'], ['game.resources', 'balance.variable_ids'], '逐波数量、公式、经济、摘要与唯一参数表是否可重算并形成一致的进度与成长体验', 'HIGH', 'balanced'],
  ['SEM.state_runtime_recovery', ['GDD#states_flow', 'TECHNICAL#runtime_state', 'TECHNICAL#save_load', 'GDD#material.game-state-flow', 'UI#screen_inventory', 'UI#feedback_errors'], ['game.states'], '只审计暂停、失焦、挂起、恢复、运行时快照与持久化降级是否一致；胜负、检查点、重试与重开由 completion_recovery 独占', 'HIGH', 'balanced'],
  ['SEM.platform_performance_feasibility', ['TECHNICAL#performance', 'TECHNICAL#risks', 'TECHNICAL#executive_summary', 'LEVEL#production_acceptance'], ['game.platform', 'technical.target_fps', 'level.complexity_budget'], '目标平台、关卡复杂度与性能预算是否现实，且不得把已有上游 authority 描述为 unavailable', 'HIGH', 'balanced'],
  ['SEM.interaction_ui_coherence', ['GDD#player_actions', 'UI#input', 'UI#experience_architecture', 'UI#prototype_acceptance'], ['game.mechanics', 'ui.supported_actions'], '只审计普通玩家动作、滚动、导航、输入映射与交互验收是否连贯；不得审计暂停/失焦恢复或胜负/重开语义', 'HIGH', 'balanced'],
  ['SEM.camera_visual_readability', ['LEVEL#camera_readability', 'LEVEL#world_structure', 'LEVEL#objectives_routes', 'ART#composition_readability', 'ART#camera_presentation', 'ART#color_lighting', 'UI#experience_architecture', 'UI#hud', 'UI#prototype_acceptance', 'UI#material.wireframe-board', 'ART#material.visual-language-board'], ['art.style_constraints'], '坐标、路径与格位可计算，viewport、安全区、断点、区域和 overlay 几何在 Level、UI 与 Art 布局之间一致且可读', 'MEDIUM', 'fast'],
  ['SEM.content_asset_feasibility', ['ART#animation', 'ART#vfx', 'ART#asset_specifications', 'ASSET#executive_summary', 'ASSET#inventory', 'ASSET#dependencies', 'ASSET#formats_budgets', 'ASSET#validation', 'ASSET#material.asset-inventory-table', 'ASSET#material.milestone-maturity-table'], ['level.required_assets', 'asset.inventory_ids', 'asset.art_constraint_refs', 'asset.formats'], '资产类型与实例、帧数/图元/物理文件和预算总计可重算且与上游一致，不得保留 stale unavailable 假设', 'HIGH', 'balanced'],
  ['SEM.audio_state_feedback', ['GDD#states_flow', 'AUDIO#event_taxonomy', 'AUDIO#music', 'AUDIO#production', 'AUDIO#executive_summary', 'AUDIO#material.event-cue-matrix', 'AUDIO#material.music-state-diagram', 'AUDIO#material.bus-ducking-diagram'], ['game.states', 'audio.event_ids'], 'PAUSED、失焦、静音及其他关键状态在音频正文、摘要、事件/音乐/总线派生视图中行为一致，并拒绝 stale unavailable 上游假设', 'MEDIUM', 'fast'],
  ['SEM.multimodal_accessibility', ['GDD#accessibility_localization', 'UI#accessibility', 'ART#color_lighting', 'AUDIO#ui_feedback', 'UI#material.focus-accessibility-matrix', 'ART#material.visual-language-board'], [], '只审计视觉、输入模态、焦点与非视觉替代的可访问性；不得新增或改写玩法生命周期动作', 'HIGH', 'balanced'],
  ['SEM.completion_recovery_coherence', ['GDD#states_flow', 'GDD#challenge_recovery', 'LEVEL#objectives_routes', 'LEVEL#spawn_checkpoint', 'GDD#material.game-state-flow', 'UI#player_journeys', 'UI#screen_inventory'], ['game.states', 'game.win_conditions', 'game.loss_conditions'], '只审计胜负、目标、失败、关卡检查点、重试与重开是否闭环；暂停、失焦、挂起与恢复由 state_runtime_recovery 独占', 'HIGH', 'balanced'],
] as const

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

function ref(documentPath: SectionRef['documentPath'], sectionId: string, bytes = `${sectionId} bytes`): SectionRef {
  return { documentPath, sectionId, heading: sectionId, startLine: 1, endLine: 2, digest: hash(bytes) }
}

function deterministicIssue(id: string, source: SectionRef, actual = 'mismatch', type: AuditIssue['type'] = 'rule'): AuditIssue {
  return { id, severity: 'HIGH', type, source, expected: 'expected', actual, remediation: { kind: 'patch', scope: 'section', documentPath: source.documentPath, sectionIds: [source.sectionId] } }
}

function fullSnapshot() {
  const refs = [
    ...['vision', 'core_loop', 'player_actions', 'rules_systems', 'states_flow', 'progression', 'content_narrative', 'scope_risks'].map(sectionId => ref('docs/GDD.md', sectionId)),
    ...canonicalFoundationBlockIds('docs/LEVEL_SCENE_DESIGN.md').map(sectionId => ref('docs/LEVEL_SCENE_DESIGN.md', sectionId)),
    ref('docs/ASSET_PLAN.md', 'inventory'),
  ]
  const sectionBytes = new Map(refs.map(item => [`${item.documentPath}#${item.sectionId}`, `${item.sectionId} bytes`]))
  const mechanics = refs.find(item => item.sectionId === 'player_actions')!
  const encounters = refs.find(item => item.sectionId === 'encounters')!
  const vision = refs.find(item => item.sectionId === 'vision')!
  const facts: FoundationFact[] = [
    { key: 'game.mechanics', value: ['jump', 'dash'], source: mechanics, evidence: { documentPath: mechanics.documentPath, sectionId: mechanics.sectionId, startLine: 1, endLine: 2, digest: mechanics.digest } },
    { key: 'level.required_entities', value: ['player', 'boss'], source: encounters, evidence: { documentPath: encounters.documentPath, sectionId: encounters.sectionId, startLine: 1, endLine: 2, digest: encounters.digest } },
    { key: 'game.players.max', value: 4, source: vision, evidence: { documentPath: vision.documentPath, sectionId: vision.sectionId, startLine: 1, endLine: 2, digest: vision.digest } },
  ]
  return { revision: 'rev-1', checkId: 'SEM.gameplay_level_viability', sectionIndex: refs, sectionBytes, factStore: facts, deterministicIssuePrefix: [], deterministicReviewDigest: 'd'.repeat(64) }
}

describe('foundation semantic audit authority', () => {
  test('freezes the exact ten-check manifest snapshot without a 22-edge fallback', () => {
    expect(FOUNDATION_SEMANTIC_CHECKS).toHaveLength(10)
    const snapshot = FOUNDATION_SEMANTIC_CHECKS.map(item => [item.checkId, item.sections.map(section => `${section.documentId}#${section.sectionId}`), item.factKeys, item.objective, item.severity, item.modelTier])
    expect(snapshot).toEqual(expected as unknown as typeof snapshot)
    expect(Object.isFrozen(FOUNDATION_SEMANTIC_AUDIT_MANIFEST)).toBe(true)
    expect(Object.isFrozen(FOUNDATION_SEMANTIC_CHECKS)).toBe(true)
  })

  test('includes deferred-fact owner sections in the exact semantic packets', () => {
    const refs = [
      ref('docs/TECHNICAL_DESIGN.md', 'performance'),
      ref('docs/TECHNICAL_DESIGN.md', 'risks'),
      ref('docs/TECHNICAL_DESIGN.md', 'executive_summary'),
      ref('docs/LEVEL_SCENE_DESIGN.md', 'production_acceptance'),
      ref('docs/ART_DIRECTION.md', 'animation'),
      ref('docs/ART_DIRECTION.md', 'vfx'),
      ref('docs/ART_DIRECTION.md', 'asset_specifications'),
      ref('docs/ASSET_PLAN.md', 'executive_summary'),
      ref('docs/ASSET_PLAN.md', 'inventory'),
      ref('docs/ASSET_PLAN.md', 'formats_budgets'),
      ref('docs/ASSET_PLAN.md', 'dependencies'),
      ref('docs/ASSET_PLAN.md', 'validation'),
      ref('docs/ASSET_PLAN.md', 'material.asset-inventory-table'),
      ref('docs/ASSET_PLAN.md', 'material.milestone-maturity-table'),
    ]
    const sectionBytes = new Map(refs.map(item => [`${item.documentPath}#${item.sectionId}`, `${item.sectionId} bytes`]))
    const base = { revision: 'rev-1', sectionIndex: refs, sectionBytes, factStore: [], deterministicIssuePrefix: [], deterministicReviewDigest: 'd'.repeat(64) }
    expect(buildFoundationSemanticPacket({ ...base, checkId: 'SEM.platform_performance_feasibility' }).sections.map(item => item.sectionKey)).toEqual([
      'TECHNICAL#performance', 'TECHNICAL#risks', 'TECHNICAL#executive_summary', 'LEVEL#production_acceptance',
    ])
    expect(buildFoundationSemanticPacket({ ...base, checkId: 'SEM.content_asset_feasibility' }).sections.map(item => item.sectionKey)).toEqual([
      'ART#animation', 'ART#vfx', 'ART#asset_specifications', 'ASSET#executive_summary', 'ASSET#inventory', 'ASSET#dependencies', 'ASSET#formats_budgets', 'ASSET#validation', 'ASSET#material.asset-inventory-table', 'ASSET#material.milestone-maturity-table',
    ])
  })

  test('selects declared derived blocks while excluding unrelated summaries and materials', () => {
    const refs = [
      ref('docs/GDD.md', 'progression'),
      ref('docs/LEVEL_SCENE_DESIGN.md', 'content_matrix'),
      ref('docs/BALANCE_DESIGN.md', 'executive_summary'),
      ...['units_variables', 'entity_parameters', 'formulas', 'economy', 'progression_curves', 'challenge_model', 'rewards_value', 'bounds_exploits', 'tuning_validation'].map(sectionId => ref('docs/BALANCE_DESIGN.md', sectionId)),
      ref('docs/BALANCE_DESIGN.md', 'material.variable-parameter-table'),
      ref('docs/BALANCE_DESIGN.md', 'material.unrelated'),
    ]
    const sectionBytes = new Map(refs.map(item => [`${item.documentPath}#${item.sectionId}`, `${item.sectionId} bytes`]))
    const packet = buildFoundationSemanticPacket({
      revision: 'rev-1',
      checkId: 'SEM.progression_balance_coherence',
      sectionIndex: refs,
      sectionBytes,
      factStore: [],
      deterministicIssuePrefix: [],
      deterministicReviewDigest: 'd'.repeat(64),
    })
    expect(packet.sections.map(item => item.sectionKey)).toEqual([...expected[1]![1]])
    expect(packet.sections.map(item => item.sectionKey)).not.toContain('BALANCE#material.unrelated')
  })

  test('accepts only an identical service manifest and rejects objective, digest, order, or any declaration mutation', () => {
    expect(validateFoundationSemanticManifest(structuredClone(FOUNDATION_SEMANTIC_AUDIT_MANIFEST)).digest).toBe(FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest)
    const objective = structuredClone(FOUNDATION_SEMANTIC_AUDIT_MANIFEST)
    ;(objective.checks[0] as { objective: string }).objective += '!'
    expect(() => validateFoundationSemanticManifest(objective)).toThrow(/authority|declaration|exact/i)
    expect(() => validateFoundationSemanticManifest({ ...FOUNDATION_SEMANTIC_AUDIT_MANIFEST, digest: '0'.repeat(64) })).toThrow(/digest/i)
    const reversed = structuredClone(FOUNDATION_SEMANTIC_AUDIT_MANIFEST)
    ;(reversed.checks as unknown as unknown[]).reverse()
    expect(() => validateFoundationSemanticManifest(reversed)).toThrow(/order|declaration|authority/i)
    const extra = structuredClone(FOUNDATION_SEMANTIC_AUDIT_MANIFEST) as Record<string, unknown>
    extra.callerCheck = true
    expect(() => validateFoundationSemanticManifest(extra)).toThrow(/field|authority|declaration/i)
  })

  test('builds from full committed snapshots and selects only declared sections, facts, and in-scope deterministic references', () => {
    const input = fullSnapshot()
    const packet = buildFoundationSemanticPacket(input)
    expect(packet.sections.map(item => item.sectionKey)).toEqual(gameplaySections)
    expect(packet.objective).toBe(expected[0]![3])
    expect(packet.facts.map(item => item.key)).toEqual(['game.mechanics', 'level.required_entities'])
    expect(JSON.stringify(packet)).not.toContain('docs/acceptance')
    expect(packet.fullSectionIndexDigest).toBe(digestSectionIndex(input.sectionIndex))
    expect(packet.fullFactStoreDigest).toBe(digestFactStore(input.factStore))
    expect(packet.deterministicReviewDigest).toBe(input.deterministicReviewDigest)
    expect(packet.identity).toMatch(/^[a-f0-9]{64}$/)
  })

  test('binds identity to the selected deterministic prefix while excluding unrelated entries and semantic/duplicate IDs', () => {
    const input = fullSnapshot()
    const inScope = deterministicIssue('AUD-IN', input.sectionIndex.find(item => item.sectionId === 'core_loop')!)
    const outOfScope = deterministicIssue('AUD-OUT', input.sectionIndex.find(item => item.sectionId === 'inventory')!)
    const first = buildFoundationSemanticPacket({ ...input, deterministicIssuePrefix: [inScope, outOfScope] })
    const changedSelected = buildFoundationSemanticPacket({ ...input, deterministicIssuePrefix: [deterministicIssue('AUD-IN', inScope.source, 'changed'), outOfScope] })
    const changedUnrelated = buildFoundationSemanticPacket({ ...input, deterministicIssuePrefix: [inScope, deterministicIssue('AUD-OUT', outOfScope.source, 'unrelated')] })
    expect(first.deterministicIssuePrefix.map(issue => issue.id)).toEqual(['AUD-IN'])
    expect(changedSelected.selectedDeterministicPrefixDigest).not.toBe(first.selectedDeterministicPrefixDigest)
    expect(changedSelected.identity).not.toBe(first.identity)
    expect(changedUnrelated.selectedDeterministicPrefixDigest).toBe(first.selectedDeterministicPrefixDigest)
    expect(changedUnrelated.identity).toBe(first.identity)
    expect(() => buildFoundationSemanticPacket({ ...input, deterministicIssuePrefix: [inScope, inScope] })).toThrow(/duplicate/i)
    expect(() => buildFoundationSemanticPacket({ ...input, deterministicIssuePrefix: [deterministicIssue('AUD-SEM', inScope.source, 'bad', 'semantic')] })).toThrow(/semantic|deterministic/i)
  })

  test('allows absent declared facts for deterministic Schema issues but rejects invalid or duplicate full Fact Store entries', () => {
    const input = fullSnapshot()
    const omitted = buildFoundationSemanticPacket({ ...input, factStore: [input.factStore[2]!] })
    expect(omitted.facts).toEqual([])
    expect(() => buildFoundationSemanticPacket({ ...input, factStore: [...input.factStore, input.factStore[0]!] })).toThrow(/duplicate|fact/i)
    expect(() => buildFoundationSemanticPacket({ ...input, factStore: [{ ...input.factStore[0]!, value: { caller: true } as never }] })).toThrow(/fact|value/i)
  })

  test('requires exact committed section bytes, rejects body facts, and accepts large committed sections', () => {
    const input = fullSnapshot()
    const wrongBytes = new Map(input.sectionBytes)
    wrongBytes.set('docs/GDD.md#core_loop', 'changed bytes')
    expect(() => buildFoundationSemanticPacket({ ...input, sectionBytes: wrongBytes })).toThrow(/digest/i)
    const body = 'player actions body'
    // Keep this body-fact rejection genuinely out of the gameplay packet
    // scope now that GDD#player_actions is an assigned section.
    const source = input.sectionIndex.find(item => item.documentPath === 'docs/ASSET_PLAN.md' && item.sectionId === 'inventory')!
    const bodyBytes = new Map(input.sectionBytes)
    bodyBytes.set(`${source.documentPath}#${source.sectionId}`, body)
    expect(() => buildFoundationSemanticPacket({ ...input, factStore: [{ ...input.factStore[0]!, value: [body] }], sectionBytes: bodyBytes })).toThrow(/body/i)
    const hugeBytes = new Map(input.sectionBytes)
    hugeBytes.set('docs/GDD.md#core_loop', 'x'.repeat(17 * 1024))
    const largePacket = buildFoundationSemanticPacket({ ...input, sectionIndex: input.sectionIndex.map(item => item.sectionId === 'core_loop' ? { ...item, digest: hash('x'.repeat(17 * 1024)) } : item), sectionBytes: hugeBytes })
    expect(largePacket.bytes).toBeGreaterThan(16 * 1024)
    expect(largePacket.sections).toHaveLength(gameplaySections.length)
    expect(largePacket.sections.find(item => item.sectionKey === 'GDD#core_loop')?.ref.digest).toBe(hash('x'.repeat(17 * 1024)))
    expect(largePacket.identity).toMatch(/^[a-f0-9]{64}$/)
    expect(admitFoundationSemanticResult(largePacket, {
      checkId: largePacket.checkId,
      packetIdentity: largePacket.identity,
      outcome: 'PASS',
      issues: [],
    }).packetIdentity).toBe(largePacket.identity)
  })

  test('uses exactly one canonical model sectionKey representation', () => {
    const packet = buildFoundationSemanticPacket(fullSnapshot())
    const base = { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'ISSUES' as const }
    const issue = { problem: 'break', expected: 'coherent', actual: 'contradictory', remediation: { kind: 'patch', sectionKeys: ['GDD#core_loop'] }, sourceSectionKey: 'GDD#core_loop', supportingSectionKeys: [] }
    expect(admitFoundationSemanticResult(packet, { ...base, issues: [issue] }).issues).toHaveLength(1)
    expect(() => admitFoundationSemanticResult(packet, { ...base, issues: [{ ...issue, remediation: { kind: 'patch', sectionKeys: ['docs/GDD.md#core_loop'] } }] })).toThrow(/section/i)
    expect(() => admitFoundationSemanticResult(packet, { ...base, issues: [{ ...issue, id: 'AUD-caller' }] })).toThrow(/ID|unknown/i)
  })

  test('canonicalizes supporting evidence order while preserving cross-source scope', () => {
    const packet = buildFoundationSemanticPacket(fullSnapshot())
    const base = { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'ISSUES' as const }
    const issue = { problem: 'cross-source conflict', expected: 'coherent', actual: 'contradictory', sourceSectionKey: 'GDD#vision', supportingSectionKeys: ['LEVEL#content_matrix', 'GDD#core_loop'], remediation: { kind: 'patch' as const, sectionKeys: ['LEVEL#content_matrix'] } }
    const admitted = admitFoundationSemanticResult(packet, { ...base, issues: [issue] })
    expect(admitted.issues![0]!.supportingSectionKeys).toEqual(['GDD#core_loop', 'LEVEL#content_matrix'])
    expect(semanticResultToFoundationIssueDrafts(packet, admitted)[0]!.supportingSections?.map(ref => `${ref.documentPath}#${ref.sectionId}`)).toEqual(['docs/GDD.md#core_loop', 'docs/LEVEL_SCENE_DESIGN.md#content_matrix'])
  })

  test('admits strict PASS, ISSUES, and UNDECIDABLE unions', () => {
    const packet = buildFoundationSemanticPacket(fullSnapshot())
    const pass = { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'PASS' as const, issues: [] }
    expect(admitFoundationSemanticResult(packet, pass).outcome).toBe('PASS')
    expect(admitFoundationSemanticResult(packet, { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'UNDECIDABLE', reason: 'missing evidence' }).outcome).toBe('UNDECIDABLE')
    expect(() => admitFoundationSemanticResult(packet, { ...pass, outcome: 'ISSUES', issues: [] })).toThrow(/issue/i)
    const large = { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'ISSUES' as const, issues: [{ problem: 'x'.repeat(9000), expected: 'e', actual: 'a', remediation: { kind: 'patch', sectionKeys: ['GDD#core_loop'] }, sourceSectionKey: 'GDD#core_loop', supportingSectionKeys: [] }] }
    expect(admitFoundationSemanticResult(packet, large).outcome).toBe('ISSUES')
  })

  test('allows one same-packet strong confirmation only for UNDECIDABLE and emits drafts without IDs', () => {
    const packet = buildFoundationSemanticPacket(fullSnapshot())
    const undecidable: FoundationSemanticResult = { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'UNDECIDABLE', reason: 'unclear' }
    const request = createDeepConfirmationRequest(packet, undecidable)
    expect(request.modelTier).toBe('strong')
    expect(request.packetIdentity).toBe(packet.identity)
    expect(request.context).toEqual({ fresh: true, resume: false, sessionId: null })
    expect(() => createDeepConfirmationRequest(packet, { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'PASS', issues: [] })).toThrow(/strong|BLOCKER|undecidable/i)
    expect(() => createDeepConfirmationRequest(packet, undecidable, request)).toThrow(/once|at most/i)
    const result = admitFoundationSemanticResult(packet, { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'ISSUES', issues: [{ problem: 'break', expected: 'coherent', actual: 'contradictory', remediation: { kind: 'patch', sectionKeys: ['GDD#core_loop'] }, sourceSectionKey: 'GDD#core_loop', supportingSectionKeys: [] }] })
    const drafts = semanticResultToFoundationIssueDrafts(packet, result)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).not.toHaveProperty('id')
  })
})
