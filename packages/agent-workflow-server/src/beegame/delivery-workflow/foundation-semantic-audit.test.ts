import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
  FOUNDATION_SEMANTIC_CHECKS,
  buildFoundationSemanticPacket,
  admitFoundationSemanticResult,
  createDeepConfirmationRequest,
  validateFoundationSemanticManifest,
  type FoundationSemanticResult,
} from './foundation-semantic-audit'

const expected = [
  ['SEM.gameplay_level_viability', ['GDD#core_loop', 'GDD#rules_systems', 'LEVEL#encounters', 'LEVEL#pacing_beats'], ['game.mechanics', 'level.required_entities'], 'HIGH', 'balanced'],
  ['SEM.progression_balance_coherence', ['GDD#progression', 'BALANCE#economy', 'BALANCE#progression_curves'], ['game.resources', 'balance.variable_ids'], 'HIGH', 'balanced'],
  ['SEM.state_runtime_recovery', ['GDD#states_flow', 'TECHNICAL#runtime_state', 'TECHNICAL#save_load'], ['game.states'], 'HIGH', 'balanced'],
  ['SEM.platform_performance_feasibility', ['GDD#vision', 'LEVEL#production_acceptance', 'TECHNICAL#performance', 'TECHNICAL#risks'], ['game.platform', 'technical.target_fps', 'level.complexity_budget'], 'HIGH', 'balanced'],
  ['SEM.interaction_ui_coherence', ['GDD#player_actions', 'UI#input', 'UI#feedback_errors'], ['game.mechanics', 'ui.supported_actions'], 'HIGH', 'balanced'],
  ['SEM.camera_visual_readability', ['LEVEL#camera_readability', 'ART#composition_readability', 'ART#camera_presentation'], ['art.style_constraints'], 'MEDIUM', 'fast'],
  ['SEM.content_asset_feasibility', ['LEVEL#content_matrix', 'ART#asset_specifications', 'ASSET#inventory', 'ASSET#formats_budgets'], ['level.required_assets', 'asset.inventory_ids', 'asset.art_constraint_refs', 'asset.formats'], 'HIGH', 'balanced'],
  ['SEM.audio_state_feedback', ['GDD#states_flow', 'AUDIO#event_taxonomy', 'AUDIO#music'], ['game.states', 'audio.event_ids'], 'MEDIUM', 'fast'],
  ['SEM.multimodal_accessibility', ['GDD#accessibility_localization', 'UI#accessibility', 'ART#color_lighting', 'AUDIO#ui_feedback'], [], 'HIGH', 'balanced'],
  ['SEM.completion_recovery_coherence', ['GDD#states_flow', 'GDD#challenge_recovery', 'LEVEL#objectives_routes', 'LEVEL#spawn_checkpoint'], ['game.states', 'game.win_conditions', 'game.loss_conditions'], 'HIGH', 'balanced'],
] as const

function sampleDocuments() {
  const docs: Record<string, string> = {}
  for (const path of ['GDD', 'LEVEL_SCENE_DESIGN', 'BALANCE_DESIGN', 'TECHNICAL_DESIGN', 'ART_DIRECTION', 'UI_UX_SPEC', 'AUDIO_DESIGN', 'ASSET_PLAN']) {
    docs[`docs/${path}.md`] = '# Document\n\n<!-- beegame-section:vision -->\n## Vision\nbody\n'
  }
  return docs
}

function packetInput() {
  const section = { documentPath: 'docs/GDD.md' as const, sectionId: 'core_loop', heading: 'Core Loop', startLine: 1, endLine: 3, digest: 'a'.repeat(64) }
  return {
    revision: 'rev-1',
    checkId: 'SEM.gameplay_level_viability',
    sectionIndex: [section],
    sectionBytes: new Map([['docs/GDD.md#core_loop', '## Core Loop\nPlayers act, recover, repeat.']]),
    facts: [],
    receipts: [{ key: 'game.mechanics', digest: 'b'.repeat(64) }],
    deterministicIssuePrefix: [],
  }
}

function validPacketInput() {
  const specs = [
    ['docs/GDD.md', 'core_loop'], ['docs/GDD.md', 'rules_systems'],
    ['docs/LEVEL_SCENE_DESIGN.md', 'encounters'], ['docs/LEVEL_SCENE_DESIGN.md', 'pacing_beats'],
  ] as const
  const sectionIndex = specs.map(([documentPath, sectionId], index) => {
    const bytes = `${sectionId} bytes`
    return { documentPath, sectionId, heading: sectionId, startLine: index + 1, endLine: index + 2, digest: createHash('sha256').update(bytes).digest('hex') }
  })
  return { ...packetInput(), sectionIndex, sectionBytes: new Map(sectionIndex.map(ref => [`${ref.documentPath}#${ref.sectionId}`, `${ref.sectionId} bytes`])) }
}

describe('foundation semantic audit authority', () => {
  test('freezes the exact ten-check manifest snapshot without a 22-edge fallback', () => {
    expect(FOUNDATION_SEMANTIC_CHECKS).toHaveLength(10)
    const snapshot = FOUNDATION_SEMANTIC_CHECKS.map(check => [check.checkId, check.sections.map(section => `${section.documentId}#${section.sectionId}`), check.factKeys, check.severity, check.modelTier])
    expect(snapshot).toEqual(expected as unknown as typeof snapshot)
    expect(FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks).toBe(FOUNDATION_SEMANTIC_CHECKS)
    expect(Object.isFrozen(FOUNDATION_SEMANTIC_AUDIT_MANIFEST)).toBe(true)
    expect(Object.isFrozen(FOUNDATION_SEMANTIC_CHECKS)).toBe(true)
  })

  test('manifest digest is stable and changes when any declaration changes', () => {
    const first = validateFoundationSemanticManifest(FOUNDATION_SEMANTIC_AUDIT_MANIFEST).digest
    const altered = validateFoundationSemanticManifest({ ...FOUNDATION_SEMANTIC_AUDIT_MANIFEST, checks: FOUNDATION_SEMANTIC_CHECKS.map((check, index) => index === 0 ? { ...check, objective: `${check.objective}!` } : check) })
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(altered.digest).not.toBe(first)
  })

  test('requires every declared section to exist in immutable contracts and every fact in the closed catalog', () => {
    expect(() => validateFoundationSemanticManifest(FOUNDATION_SEMANTIC_AUDIT_MANIFEST)).not.toThrow()
    const unknown = { ...FOUNDATION_SEMANTIC_AUDIT_MANIFEST, checks: [{ ...FOUNDATION_SEMANTIC_CHECKS[0]!, sections: [{ documentId: 'GDD', sectionId: 'not_contract' }] }] }
    expect(() => validateFoundationSemanticManifest(unknown)).toThrow(/section|contract|ten/i)
    const badFact = { ...FOUNDATION_SEMANTIC_AUDIT_MANIFEST, checks: [{ ...FOUNDATION_SEMANTIC_CHECKS[0]!, factKeys: ['caller.fact'] }] }
    expect(() => validateFoundationSemanticManifest(badFact)).toThrow(/fact|ten/i)
  })

  test('rejects caller checks, unknown, duplicate, and orphan declarations', () => {
    expect(() => buildFoundationSemanticPacket({ ...packetInput(), checkId: 'SEM.caller' })).toThrow(/check/i)
    expect(() => validateFoundationSemanticManifest({ ...FOUNDATION_SEMANTIC_AUDIT_MANIFEST, checks: [...FOUNDATION_SEMANTIC_CHECKS, FOUNDATION_SEMANTIC_CHECKS[0]!] })).toThrow(/duplicate|exactly ten/i)
    expect(() => validateFoundationSemanticManifest({ ...FOUNDATION_SEMANTIC_AUDIT_MANIFEST, checks: FOUNDATION_SEMANTIC_CHECKS.map(check => check.checkId === 'SEM.gameplay_level_viability' ? { ...check, factKeys: [...check.factKeys, 'game.players.max'] } : check) })).toThrow(/orphan|owner|fact/i)
  })

  test('builds a bounded packet from exact sections and rejects body facts, out-of-scope sections, and the eighth document', () => {
    expect(() => buildFoundationSemanticPacket(packetInput())).toThrow(/section/i)
    const section = { documentPath: 'docs/GDD.md' as const, sectionId: 'core_loop', heading: 'Core Loop', startLine: 1, endLine: 3, digest: 'a'.repeat(64) }
    const valid = buildFoundationSemanticPacket(validPacketInput())
    expect(valid.bytes <= 16 * 1024).toBe(true)
    expect(valid.identity).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(valid)).not.toContain('docs/acceptance')
    const withEighthDocument = buildFoundationSemanticPacket({ ...validPacketInput(), sectionIndex: [...validPacketInput().sectionIndex, { ...section, documentPath: 'docs/acceptance/gameplay-checklist.md' as never }], sectionBytes: new Map([...validPacketInput().sectionBytes, ['docs/acceptance/gameplay-checklist.md#core_loop', 'no']]) })
    expect(JSON.stringify(withEighthDocument)).not.toContain('docs/acceptance')
    const bodySource = { documentPath: 'docs/GDD.md' as const, sectionId: 'player_actions', heading: 'Player Actions', startLine: 1, endLine: 2, digest: 'c'.repeat(64) }
    expect(() => buildFoundationSemanticPacket({ ...validPacketInput(), sectionBytes: new Map([...validPacketInput().sectionBytes, ['docs/GDD.md#player_actions', '## Core Loop\nPlayers act']]), facts: [{ key: 'game.mechanics', value: '## Core Loop\nPlayers act', source: bodySource, evidence: { documentPath: bodySource.documentPath, sectionId: bodySource.sectionId, startLine: 1, endLine: 2, digest: 'c'.repeat(64) } }] })).toThrow(/body/i)
  })

  test('admits only strict scoped PASS, ISSUES, or UNDECIDABLE results with no caller IDs', () => {
    const section = { documentPath: 'docs/GDD.md' as const, sectionId: 'core_loop', heading: 'Core Loop', startLine: 1, endLine: 3, digest: 'a'.repeat(64) }
    const packet = buildFoundationSemanticPacket(validPacketInput())
    const pass: FoundationSemanticResult = { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'PASS', issues: [] }
    expect(admitFoundationSemanticResult(packet, pass).outcome).toBe('PASS')
    expect(() => admitFoundationSemanticResult(packet, { ...pass, issues: [{ id: 'AUD-caller' }] } as never)).toThrow(/id|scope/i)
    expect(() => admitFoundationSemanticResult(packet, { ...pass, checkId: 'SEM.other' })).toThrow(/check/i)
    expect(admitFoundationSemanticResult(packet, { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'ISSUES', issues: [{ problem: 'Loop breaks', expected: 'coherent', actual: 'contradictory', fixSection: 'GDD#core_loop', sourceSection: 'GDD#core_loop' }] }).issues).toHaveLength(1)
    expect(admitFoundationSemanticResult(packet, { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'UNDECIDABLE', reason: 'missing evidence' }).outcome).toBe('UNDECIDABLE')
  })

  test('enforces the output budget and allows one strong confirmation only for BLOCKER/undecidable', () => {
    const section = { documentPath: 'docs/GDD.md' as const, sectionId: 'core_loop', heading: 'Core Loop', startLine: 1, endLine: 3, digest: 'a'.repeat(64) }
    const packet = buildFoundationSemanticPacket(validPacketInput())
    expect(() => admitFoundationSemanticResult(packet, { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'ISSUES', issues: [{ problem: 'x'.repeat(9000), expected: 'e', actual: 'a', fixSection: 'GDD#core_loop', sourceSection: 'GDD#core_loop' }] })).toThrow(/768|budget/i)
    expect(() => createDeepConfirmationRequest(packet, { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'PASS', issues: [] })).toThrow(/strong|BLOCKER|undecidable/i)
    const request = createDeepConfirmationRequest(packet, { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'UNDECIDABLE', reason: 'unclear' })
    expect(request.modelTier).toBe('strong')
    expect(request.packetIdentity).toBe(packet.identity)
    expect(() => createDeepConfirmationRequest(packet, { checkId: packet.checkId, packetIdentity: packet.identity, outcome: 'ISSUES', issues: [{ problem: 'x', expected: 'e', actual: 'a', fixSection: 'GDD#core_loop', sourceSection: 'GDD#core_loop' }] })).toThrow(/strong|BLOCKER|undecidable/i)
  })
})
