import { createHash } from 'node:crypto'
import { getGameDocumentContract } from './game-document-contracts'
import {
  FOUNDATION_FACT_CATALOG_VERSION,
  foundationFactDefinition,
  isFoundationFactKey,
  type FoundationFactKey,
} from './foundation-fact-definitions'
import {
  createFoundationFactStore,
  digestFactStore,
  type FoundationFact,
} from './foundation-fact-store'
import { digestSectionIndex, type SectionRef } from './foundation-section-index'
import type { AuditIssue, AuditIssueDraft } from './foundation-issue-registry'
import type { FoundationDocumentPath } from './types'

export const FOUNDATION_SEMANTIC_AUDIT_VERSION = 'foundation-semantic.v1' as const
export const SEMANTIC_PACKET_MAX_BYTES = 16 * 1024
export const SEMANTIC_OUTPUT_MAX_TOKENS = 768

export type FoundationSemanticDocumentId =
  | 'GDD'
  | 'LEVEL'
  | 'BALANCE'
  | 'TECHNICAL'
  | 'ART'
  | 'UI'
  | 'AUDIO'
  | 'ASSET'

export type FoundationSemanticModelTier = 'fast' | 'balanced' | 'strong'
export type FoundationSemanticSeverity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW'

export type FoundationSemanticSection = Readonly<{
  documentId: FoundationSemanticDocumentId
  sectionId: string
}>

export type FoundationSemanticCheck = Readonly<{
  checkId: string
  sections: readonly FoundationSemanticSection[]
  factKeys: readonly FoundationFactKey[]
  objective: string
  severity: FoundationSemanticSeverity
  modelTier: Exclude<FoundationSemanticModelTier, 'strong'>
}>

const documentPathById: Record<FoundationSemanticDocumentId, FoundationDocumentPath> = {
  GDD: 'docs/GDD.md',
  LEVEL: 'docs/LEVEL_SCENE_DESIGN.md',
  BALANCE: 'docs/BALANCE_DESIGN.md',
  TECHNICAL: 'docs/TECHNICAL_DESIGN.md',
  ART: 'docs/ART_DIRECTION.md',
  UI: 'docs/UI_UX_SPEC.md',
  AUDIO: 'docs/AUDIO_DESIGN.md',
  ASSET: 'docs/ASSET_PLAN.md',
}

const section = (documentId: FoundationSemanticDocumentId, sectionId: string): FoundationSemanticSection =>
  Object.freeze({ documentId, sectionId })

const check = (
  checkId: string,
  sections: readonly FoundationSemanticSection[],
  factKeys: readonly FoundationFactKey[],
  objective: string,
  severity: FoundationSemanticSeverity,
  modelTier: Exclude<FoundationSemanticModelTier, 'strong'>,
): FoundationSemanticCheck => Object.freeze({
  checkId,
  sections: Object.freeze(sections),
  factKeys: Object.freeze(factKeys),
  objective,
  severity,
  modelTier,
})

/** The only semantic authority. This is intentionally exactly ten checks. */
export const FOUNDATION_SEMANTIC_CHECKS = Object.freeze([
  check('SEM.gameplay_level_viability', [section('GDD', 'core_loop'), section('GDD', 'rules_systems'), section('LEVEL', 'encounters'), section('LEVEL', 'pacing_beats')], ['game.mechanics', 'level.required_entities'], '核心循环、遭遇、节奏与反制是否可玩且不互相否定', 'HIGH', 'balanced'),
  check('SEM.progression_balance_coherence', [section('GDD', 'progression'), section('BALANCE', 'economy'), section('BALANCE', 'progression_curves')], ['game.resources', 'balance.variable_ids'], '进度、资源流与成长曲线是否形成可闭合体验', 'HIGH', 'balanced'),
  check('SEM.state_runtime_recovery', [section('GDD', 'states_flow'), section('TECHNICAL', 'runtime_state'), section('TECHNICAL', 'save_load')], ['game.states'], '状态、失败恢复与持久化语义是否可实现且一致', 'HIGH', 'balanced'),
  check('SEM.platform_performance_feasibility', [section('GDD', 'vision'), section('LEVEL', 'production_acceptance'), section('TECHNICAL', 'performance'), section('TECHNICAL', 'risks')], ['game.platform', 'technical.target_fps', 'level.complexity_budget'], '目标平台、关卡复杂度与性能预算是否现实', 'HIGH', 'balanced'),
  check('SEM.interaction_ui_coherence', [section('GDD', 'player_actions'), section('UI', 'input'), section('UI', 'feedback_errors')], ['game.mechanics', 'ui.supported_actions'], '玩家动作、输入、反馈与错误恢复是否连贯', 'HIGH', 'balanced'),
  check('SEM.camera_visual_readability', [section('LEVEL', 'camera_readability'), section('ART', 'composition_readability'), section('ART', 'camera_presentation')], ['art.style_constraints'], '镜头、构图、对比与玩法可读性是否一致', 'MEDIUM', 'fast'),
  check('SEM.content_asset_feasibility', [section('LEVEL', 'content_matrix'), section('ART', 'asset_specifications'), section('ASSET', 'inventory'), section('ASSET', 'formats_budgets')], ['level.required_assets', 'asset.inventory_ids', 'asset.art_constraint_refs', 'asset.formats'], '内容需求、资产质量与交付预算是否可执行', 'HIGH', 'balanced'),
  check('SEM.audio_state_feedback', [section('GDD', 'states_flow'), section('AUDIO', 'event_taxonomy'), section('AUDIO', 'music')], ['game.states', 'audio.event_ids'], '关键状态、事件与音频反馈是否覆盖且不冲突', 'MEDIUM', 'fast'),
  check('SEM.multimodal_accessibility', [section('GDD', 'accessibility_localization'), section('UI', 'accessibility'), section('ART', 'color_lighting'), section('AUDIO', 'ui_feedback')], [], '视觉、输入与非视觉替代是否共同满足可访问性', 'HIGH', 'balanced'),
  check('SEM.completion_recovery_coherence', [section('GDD', 'states_flow'), section('GDD', 'challenge_recovery'), section('LEVEL', 'objectives_routes'), section('LEVEL', 'spawn_checkpoint')], ['game.states', 'game.win_conditions', 'game.loss_conditions'], '胜负、目标、失败、检查点与重试是否形成闭环', 'HIGH', 'balanced'),
] as const)

export type FoundationSemanticManifest = Readonly<{
  version: typeof FOUNDATION_SEMANTIC_AUDIT_VERSION
  catalogVersion: typeof FOUNDATION_FACT_CATALOG_VERSION
  checks: readonly FoundationSemanticCheck[]
  digest: string
}>

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function digestManifest(input: Omit<FoundationSemanticManifest, 'digest'>): string {
  return sha256(canonical(input))
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

const manifestWithoutDigest = {
  version: FOUNDATION_SEMANTIC_AUDIT_VERSION,
  catalogVersion: FOUNDATION_FACT_CATALOG_VERSION,
  checks: FOUNDATION_SEMANTIC_CHECKS,
} as const

export const FOUNDATION_SEMANTIC_AUDIT_MANIFEST: FoundationSemanticManifest = deepFreeze({
  ...manifestWithoutDigest,
  digest: digestManifest(manifestWithoutDigest),
})

const expectedByCheck = new Map(FOUNDATION_SEMANTIC_CHECKS.map(item => [item.checkId, item]))

function sectionKey(value: FoundationSemanticSection): string {
  return `${value.documentId}#${value.sectionId}`
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function validateDeclaration(checkValue: FoundationSemanticCheck, index: number): void {
  if (!checkValue || typeof checkValue !== 'object') throw new Error(`semantic check ${index} is invalid`)
  const expected = expectedByCheck.get(String(checkValue.checkId))
  if (!expected) throw new Error(`unknown semantic check: ${String(checkValue.checkId)}`)
  if (!Array.isArray(checkValue.sections) || new Set(checkValue.sections.map(sectionKey)).size !== checkValue.sections.length)
    throw new Error(`duplicate semantic section in ${checkValue.checkId}`)
  if (!sameStringArray(checkValue.sections.map(sectionKey), expected.sections.map(sectionKey)))
    throw new Error(`semantic check ${checkValue.checkId} has an orphan or unassigned section`)
  if (!Array.isArray(checkValue.factKeys) || !checkValue.factKeys.every(isFoundationFactKey) || !sameStringArray(checkValue.factKeys, expected.factKeys))
    throw new Error(`semantic check ${checkValue.checkId} has an unknown or orphan fact`)
  if (checkValue.severity !== expected.severity || checkValue.modelTier !== expected.modelTier)
    throw new Error(`semantic check ${checkValue.checkId} has an invalid severity/model tier`)
  for (const rawItem of checkValue.sections) {
    const item = rawItem as FoundationSemanticSection
    const path = documentPathById[item.documentId]
    let contract: ReturnType<typeof getGameDocumentContract>
    try { contract = getGameDocumentContract(path) } catch { throw new Error(`semantic check section is not immutable: ${sectionKey(item)}`) }
    if (!contract.sections.some(candidate => candidate.sectionId === item.sectionId))
      throw new Error(`semantic check section is not in immutable contract: ${sectionKey(item)}`)
  }
  for (const key of checkValue.factKeys) {
    if (!foundationFactDefinition(key)) throw new Error(`semantic check fact is not in closed catalog: ${key}`)
  }
  if (typeof checkValue.objective !== 'string' || !checkValue.objective.trim()) throw new Error(`semantic check objective is required: ${checkValue.checkId}`)
}

export function validateFoundationSemanticManifest(input: unknown): FoundationSemanticManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('semantic manifest must be an object')
  const value = input as Partial<FoundationSemanticManifest>
  const manifestKeys = Object.keys(value).sort()
  if (JSON.stringify(manifestKeys) !== JSON.stringify(['catalogVersion', 'checks', 'digest', 'version']))
    throw new Error('semantic manifest has unknown or missing fields')
  if (value.version !== FOUNDATION_SEMANTIC_AUDIT_VERSION || value.catalogVersion !== FOUNDATION_FACT_CATALOG_VERSION)
    throw new Error('semantic manifest version/catalog is invalid')
  if (!Array.isArray(value.checks) || value.checks.length !== 10) throw new Error('semantic manifest must contain exactly ten checks')
  const ids = new Set<string>()
  for (const [index, item] of value.checks.entries()) {
    if (ids.has(item.checkId)) throw new Error(`duplicate semantic check: ${item.checkId}`)
    ids.add(item.checkId)
    validateDeclaration(item as FoundationSemanticCheck, index)
  }
  if (ids.size !== expectedByCheck.size) throw new Error('semantic manifest contains an orphan check')
  const withoutDigest = { version: value.version, catalogVersion: value.catalogVersion, checks: value.checks }
  const computed = digestManifest(withoutDigest)
  if (value.digest !== FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest || computed !== FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest)
    throw new Error('semantic manifest declaration or digest is not the service authority')
  if (canonical(value.checks) !== canonical(FOUNDATION_SEMANTIC_CHECKS))
    throw new Error('semantic manifest declaration differs from service authority')
  return Object.freeze({ ...withoutDigest, digest: value.digest }) as FoundationSemanticManifest
}

export type FoundationSemanticPacketInput = {
  revision: string
  checkId: string
  sectionIndex: readonly SectionRef[]
  sectionBytes: ReadonlyMap<string, string> | Record<string, string>
  factStore: readonly FoundationFact[]
  deterministicIssuePrefix: readonly AuditIssue[]
  deterministicReviewDigest: string
}

export type FoundationSemanticPacket = Readonly<{
  version: typeof FOUNDATION_SEMANTIC_AUDIT_VERSION
  revision: string
  manifestDigest: string
  checkId: string
  sections: readonly Readonly<{ sectionKey: string; ref: SectionRef; bytes: string }>[]
  facts: readonly FoundationFact[]
  deterministicIssuePrefix: readonly AuditIssue[]
  fullSectionIndexDigest: string
  fullFactStoreDigest: string
  deterministicReviewDigest: string
  identity: string
  bytes: number
  context: Readonly<{ fresh: true; resume: false; sessionId: null }>
}>

function mapValue(input: ReadonlyMap<string, string> | Record<string, string>, key: string): string | undefined {
  if (input instanceof Map) return input.get(key)
  return (input as Record<string, string>)[key]
}

function sectionRefIdentity(ref: SectionRef): string {
  return `${ref.documentPath}#${ref.sectionId}`
}

function modelSectionKey(ref: SectionRef): string {
  const documentId = Object.entries(documentPathById).find(([, path]) => path === ref.documentPath)?.[0]
  if (!documentId) throw new Error(`semantic section has no canonical model key: ${ref.documentPath}`)
  return `${documentId}#${ref.sectionId}`
}

function exactSection(index: readonly SectionRef[], path: FoundationDocumentPath, sectionId: string): SectionRef {
  const match = index.find(item => item.documentPath === path && item.sectionId === sectionId)
  if (!match) throw new Error(`semantic packet section is missing: ${path}#${sectionId}`)
  return match
}

function bodyValue(value: unknown, body: string): boolean {
  const normalized = body.trim()
  if (typeof value === 'string') return value.trim() === normalized
  return Array.isArray(value) && value.length === 1 && typeof value[0] === 'string' && value[0].trim() === normalized
}

export function buildFoundationSemanticPacket(input: FoundationSemanticPacketInput): FoundationSemanticPacket {
  if (!input.revision.trim()) throw new Error('semantic packet revision is required')
  if (!/^[a-f0-9]{64}$/.test(input.deterministicReviewDigest)) throw new Error('deterministic review digest is required')
  const manifest = validateFoundationSemanticManifest(FOUNDATION_SEMANTIC_AUDIT_MANIFEST)
  const declaration = expectedByCheck.get(input.checkId)
  if (!declaration) throw new Error(`unknown or caller-supplied semantic check: ${input.checkId}`)
  const expectedSections = declaration.sections.map(item => exactSection(input.sectionIndex, documentPathById[item.documentId], item.sectionId))
  const sectionSet = new Set(expectedSections.map(sectionRefIdentity))
  const sections = expectedSections.map(ref => {
    const bytes = mapValue(input.sectionBytes, sectionRefIdentity(ref))
    if (typeof bytes !== 'string') throw new Error(`semantic packet section bytes are missing: ${sectionRefIdentity(ref)}`)
    if (sha256(bytes) !== ref.digest) throw new Error(`semantic packet section bytes do not match committed digest: ${sectionRefIdentity(ref)}`)
    return Object.freeze({ sectionKey: modelSectionKey(ref), ref: { ...ref }, bytes })
  })
  const fullSectionIndexDigest = digestSectionIndex(input.sectionIndex)
  const fullStore = createFoundationFactStore([...input.factStore])
  const fullFactStoreDigest = digestFactStore(fullStore)
  const allowedFacts = new Set(declaration.factKeys)
  for (const fact of fullStore) {
    if (!allowedFacts.has(fact.key as FoundationFactKey)) continue
    const definition = foundationFactDefinition(fact.key)
    if (!definition || fact.source.documentPath !== definition.owner.documentPath || fact.source.sectionId !== definition.owner.sectionId) throw new Error(`semantic packet fact is not catalog-owned: ${fact.key}`)
    for (const body of input.sectionBytes instanceof Map ? input.sectionBytes.values() : Object.values(input.sectionBytes))
      if (bodyValue(fact.value, body)) throw new Error(`semantic packet rejects section-body fact: ${fact.key}`)
  }
  const facts = fullStore.filter(fact => allowedFacts.has(fact.key as FoundationFactKey)).sort((a, b) => a.key.localeCompare(b.key)).map(fact => ({ ...fact, source: { ...fact.source }, evidence: { ...fact.evidence } }))
  const deterministicIssuePrefix = input.deterministicIssuePrefix.filter(issue => sectionSet.has(sectionRefIdentity(issue.source)) && (!issue.target || sectionSet.has(sectionRefIdentity(issue.target))))
  const identity = sha256(canonical({ revision: input.revision, manifestDigest: manifest.digest, fullSectionIndexDigest, fullFactStoreDigest, deterministicReviewDigest: input.deterministicReviewDigest, checkId: input.checkId, selectedSectionDigests: sections.map(item => [item.sectionKey, item.ref.digest]) }))
  const packetBody = { version: FOUNDATION_SEMANTIC_AUDIT_VERSION, revision: input.revision, manifestDigest: manifest.digest, checkId: input.checkId, sections, facts, deterministicIssuePrefix, fullSectionIndexDigest, fullFactStoreDigest, deterministicReviewDigest: input.deterministicReviewDigest, identity, context: { fresh: true as const, resume: false as const, sessionId: null } }
  const bytes = Buffer.byteLength(canonical(packetBody), 'utf8')
  if (bytes > SEMANTIC_PACKET_MAX_BYTES) throw new Error(`semantic packet exceeds ${SEMANTIC_PACKET_MAX_BYTES} bytes`)
  return deepFreeze({ ...packetBody, bytes })
}

export type FoundationSemanticIssueDraft = Readonly<{
  problem: string
  expected: string
  actual: string
  sourceSectionKey: string
  fixSectionKey: string
  reasonCode?: string
}>

export type FoundationSemanticResult = Readonly<{
  checkId: string
  packetIdentity: string
  outcome: 'PASS' | 'ISSUES' | 'UNDECIDABLE'
  issues?: readonly FoundationSemanticIssueDraft[]
  reason?: string
}>

function strictIssue(value: unknown, packetSections: ReadonlySet<string>): FoundationSemanticIssueDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('semantic issue draft is invalid')
  const candidate = value as Record<string, unknown>
  const allowed = ['actual', 'expected', 'fixSectionKey', 'problem', 'reasonCode', 'sourceSectionKey']
  if (Object.keys(candidate).some(key => !allowed.includes(key)) || Object.keys(candidate).some(key => candidate[key] === undefined)) throw new Error('semantic issue draft contains an ID or redundant/unknown field')
  for (const key of ['problem', 'expected', 'actual', 'fixSectionKey', 'sourceSectionKey']) if (typeof candidate[key] !== 'string' || !candidate[key].trim()) throw new Error(`semantic issue ${key} is required`)
  if (!packetSections.has(candidate.sourceSectionKey as string) || !packetSections.has(candidate.fixSectionKey as string)) throw new Error('semantic issue section is outside assigned packet')
  if (candidate.reasonCode !== undefined && (typeof candidate.reasonCode !== 'string' || !candidate.reasonCode.trim())) throw new Error('semantic issue reason is invalid')
  return Object.freeze({ problem: candidate.problem as string, expected: candidate.expected as string, actual: candidate.actual as string, sourceSectionKey: candidate.sourceSectionKey as string, fixSectionKey: candidate.fixSectionKey as string, ...(candidate.reasonCode ? { reasonCode: candidate.reasonCode as string } : {}) })
}

export function admitFoundationSemanticResult(packet: FoundationSemanticPacket, input: unknown): FoundationSemanticResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('semantic result is invalid')
  const value = input as Record<string, unknown>
  const allowed = ['checkId', 'issues', 'outcome', 'packetIdentity', 'reason']
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('semantic result contains caller identity or redundant explanation')
  if (value.checkId !== packet.checkId) throw new Error('semantic result check identity does not match packet')
  if (value.packetIdentity !== packet.identity) throw new Error('semantic result packet identity does not match packet')
  if (!['PASS', 'ISSUES', 'UNDECIDABLE'].includes(String(value.outcome))) throw new Error('semantic result outcome is invalid')
  const sections = new Set<string>()
  for (const item of packet.sections) sections.add(item.sectionKey)
  const rawIssues = value.issues === undefined ? [] : value.issues
  if (!Array.isArray(rawIssues)) throw new Error('semantic result issues must be an array')
  const issues = rawIssues.map(item => strictIssue(item, sections))
  const identities = new Set(issues.map(item => canonical(item)))
  if (identities.size !== issues.length) throw new Error('duplicate semantic issue draft')
  if (value.outcome === 'PASS' && issues.length) throw new Error('PASS result cannot contain issues')
  if (value.outcome === 'ISSUES' && issues.length === 0) throw new Error('ISSUES result requires issue drafts')
  if (value.outcome === 'UNDECIDABLE' && (issues.length || typeof value.reason !== 'string' || !value.reason.trim())) throw new Error('UNDECIDABLE result requires only a reason')
  if (value.outcome !== 'UNDECIDABLE' && value.reason !== undefined) throw new Error('PASS/ISSUES result cannot contain a redundant reason')
  return Object.freeze({ checkId: packet.checkId, packetIdentity: packet.identity, outcome: value.outcome as FoundationSemanticResult['outcome'], issues: Object.freeze(issues), ...(value.reason ? { reason: value.reason as string } : {}) })
}

export type FoundationDeepConfirmationRequest = Readonly<{
  packetIdentity: string
  checkId: string
  modelTier: 'strong'
  attempt: 1
  context: Readonly<{ fresh: true; resume: false; sessionId: null }>
}>

export function createDeepConfirmationRequest(packet: FoundationSemanticPacket, resultInput: FoundationSemanticResult, previous?: FoundationDeepConfirmationRequest): FoundationDeepConfirmationRequest {
  const result = admitFoundationSemanticResult(packet, resultInput)
  if (previous && previous.attempt >= 1) throw new Error('semantic strong confirmation may be requested at most once')
  const declaration = expectedByCheck.get(packet.checkId)!
  if (result.outcome !== 'UNDECIDABLE' && declaration.severity !== 'BLOCKER') throw new Error('strong confirmation is gated to BLOCKER or UNDECIDABLE')
  return Object.freeze({ packetIdentity: packet.identity, checkId: packet.checkId, modelTier: 'strong', attempt: 1 as const, context: { fresh: true as const, resume: false as const, sessionId: null } })
}

function resolvePacketSection(packet: FoundationSemanticPacket, value: string): SectionRef {
  const found = packet.sections.find(item => value === item.sectionKey)
  if (!found) throw new Error('semantic issue section is outside assigned packet')
  return found.ref
}

/** Converts admitted drafts to Task 3's sole registry compiler input. */
export function semanticResultToFoundationIssueDrafts(
  packet: FoundationSemanticPacket,
  admitted: FoundationSemanticResult,
): AuditIssueDraft[] {
  const result = admitFoundationSemanticResult(packet, admitted)
  if (result.outcome !== 'ISSUES') return []
  const declaration = expectedByCheck.get(packet.checkId)!
  return result.issues!.map(issue => {
    const source = resolvePacketSection(packet, issue.sourceSectionKey)
    const fix = resolvePacketSection(packet, issue.fixSectionKey)
    return {
      checkId: packet.checkId,
      severity: declaration.severity,
      type: 'semantic' as const,
      source,
      expected: issue.expected,
      actual: issue.actual,
      fixDocument: fix.documentPath,
      fixSectionId: fix.sectionId,
      ...(issue.reasonCode ? { reasonCode: issue.reasonCode } : {}),
      conflictIdentity: {
        packetIdentity: packet.identity,
        problem: issue.problem,
        source: sectionRefIdentity(source),
        fix: sectionRefIdentity(fix),
      },
    }
  })
}

// Compatibility-free descriptive aliases for the service-owned surface.
export const FOUNDATION_SEMANTIC_MANIFEST = FOUNDATION_SEMANTIC_AUDIT_MANIFEST
export const SEMANTIC_CHECK_MANIFEST = FOUNDATION_SEMANTIC_AUDIT_MANIFEST

// Fail closed during module initialization if a future edit breaks the graph,
// catalog, exact ten-check set, or service-owned tier/severity mapping.
validateFoundationSemanticManifest(FOUNDATION_SEMANTIC_AUDIT_MANIFEST)
