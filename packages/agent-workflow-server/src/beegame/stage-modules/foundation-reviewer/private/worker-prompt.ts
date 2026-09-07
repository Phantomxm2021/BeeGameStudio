import { foundationFactDefinition } from './domain/foundation-fact-definitions'

/** Reviewer-private request; never exposed to the orchestrator. */
export type ReviewWorkerRequest = {
  workerType: 'foundation-fact-extractor' | 'foundation-semantic-reviewer'
  contract: { packet: unknown; kind?: 'source' | 'confirmation'; checkId?: string; issueId?: string }
}

const FOUNDATION_SEMANTIC_REMEDIATION_CONTRACT =
  'Semantic Issue drafts must include supportingSectionKeys as an explicit array (it may be empty) of additional read-only evidence refs; it must contain only packet section keys, at most 16 unique keys, and never sourceSectionKey. MUST list every additional packet section needed to verify any expected/actual assertion; never rely on an unreferenced section. A single-section claim may use []. Remediation must be exactly {"kind":"patch","sectionKeys":["..."]}. Do not wrap the result in `params` or add fields such as summary, steps, description, or value. sourceSectionKey identifies the canonical owner evidence that makes expected authoritative; supportingSectionKeys explain the additional evidence; remediation.sectionKeys identify the incorrect block to change. For a cross-document conflict these are different sides: preserve the owner and patch the downstream conflict. Resolve conflicts by the fixed Source of Truth order GDD > Technical > Level/Balance/UI/Art > Asset Plan, then by explicit packet hard constraints, then by the smallest authorized semantic change. Choose that repair directly; never request a user choice or preserve alternatives. All patch sectionKeys must belong to the same canonical document; never mix document prefixes in one patch. If a conflict spans documents, split it into separate Issues with independent single-document patch authority. A wording-only rewrite, synonym, alias, compatibility note, qualification, or restatement is not a repair unless it makes the exact expected condition true and removes the actual condition.'

export function buildPacketWorkerPrompt(request: ReviewWorkerRequest): string {
  const contract = formatPacketContract(request)
  return [
    `BeeGame delivery worker: ${request.workerType}`,
    'The packet is the sole input for this task. It is immutable service-owned authority.',
    'Do not read project files, call Read, Grep or Glob, inspect the workspace, use native tools, write files, mutate the platform, or add context from any other source.',
    'Return only the strict structured result for the assigned packet; do not return Markdown, prose explanations, or additional fields.',
    workerInstruction(request),
    terminalInstruction(request),
    `Model packet contract: ${contract}`,
  ].join('\n')
}

function formatPacketContract(request: ReviewWorkerRequest): string {
  const packet = request.contract.packet
  const projected = packet && typeof packet === 'object' && !Array.isArray(packet)
    ? projectPacketForModel(request.workerType, packet as Record<string, unknown>)
    : undefined
  const contract: Record<string, unknown> = {
    workerType: request.workerType,
    ...(typeof request.contract.kind === 'string' ? { kind: request.contract.kind } : {}),
    ...(typeof request.contract.checkId === 'string' ? { checkId: request.contract.checkId } : {}),
    ...(projected ? { packet: projected } : {}),
  }
  return JSON.stringify(contract)
}

function semanticRef(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const ref = value as Record<string, unknown>
  if (typeof ref.documentPath !== 'string' || typeof ref.sectionId !== 'string')
    return undefined
  return {
    documentPath: ref.documentPath,
    sectionId: ref.sectionId,
    ...(typeof ref.heading === 'string' ? { heading: ref.heading } : {}),
  }
}

function modelSection(value: unknown, contentKey: 'text' | 'bytes'): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const section = value as Record<string, unknown>
  const ref = semanticRef(section.ref ?? section)
  const content = section[contentKey]
  if (!ref || typeof content !== 'string') return undefined
  return {
    ...ref,
    ...(typeof section.sectionKey === 'string' ? { sectionKey: section.sectionKey } : {}),
    content,
  }
}

function projectItems<T>(
  values: unknown[],
  project: (value: unknown) => T | undefined,
  label: string,
): T[] {
  return values.map((value, index) => {
    const projected = project(value)
    if (projected === undefined)
      throw new Error(`model-facing ${label} item ${index} is invalid`)
    return projected
  })
}

function modelFact(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const fact = value as Record<string, unknown>
  const source = semanticRef(fact.source)
  if (typeof fact.key !== 'string' || source === undefined || !('value' in fact)) return undefined
  return { key: fact.key, value: fact.value, source }
}

function modelIssue(value: unknown, includeId: boolean): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const issue = value as Record<string, unknown>
  const remediation = issue.remediation
  if (
    (includeId && typeof issue.id !== 'string') ||
    typeof issue.expected !== 'string' ||
    typeof issue.actual !== 'string' ||
    !remediation || typeof remediation !== 'object' || Array.isArray(remediation)
  ) return undefined
  const fix = remediation as Record<string, unknown>
  const rawSource = issue.source
  if (!rawSource || typeof rawSource !== 'object' || Array.isArray(rawSource)) return undefined
  const sourceRecord = rawSource as Record<string, unknown>
  if (sourceRecord.scope === 'document') {
    if (
      typeof sourceRecord.documentPath !== 'string' ||
      fix.kind !== 'patch' ||
      fix.scope !== 'document' ||
      fix.documentPath !== sourceRecord.documentPath ||
      issue.target !== undefined
    ) return undefined
    return {
      ...(includeId ? { id: issue.id } : {}),
      ...(typeof issue.severity === 'string' ? { severity: issue.severity } : {}),
      ...(typeof issue.type === 'string' ? { type: issue.type } : {}),
      source: { scope: 'document', documentPath: sourceRecord.documentPath },
      expected: issue.expected,
      actual: issue.actual,
      remediation: { kind: 'patch', scope: 'document', documentPath: fix.documentPath },
      ...(typeof issue.reasonCode === 'string' ? { reasonCode: issue.reasonCode } : {}),
    }
  }
  const source = semanticRef(rawSource)
  const target = issue.target === undefined ? undefined : semanticRef(issue.target)
  const supporting = issue.supportingSections === undefined ? undefined : Array.isArray(issue.supportingSections)
    ? issue.supportingSections.map(semanticRef)
    : undefined
  if (source === undefined || fix.kind !== 'patch' || fix.scope !== 'section' || typeof fix.documentPath !== 'string' || !Array.isArray(fix.sectionIds) || fix.sectionIds.some(sectionId => typeof sectionId !== 'string') || (issue.target !== undefined && target === undefined) || (issue.supportingSections !== undefined && (!supporting || supporting.some(ref => ref === undefined)))) return undefined
  return {
    ...(includeId ? { id: issue.id } : {}),
    ...(typeof issue.severity === 'string' ? { severity: issue.severity } : {}),
    ...(typeof issue.type === 'string' ? { type: issue.type } : {}),
    source,
    ...(target ? { target } : {}),
    ...(supporting ? { supportingSections: supporting } : {}),
    expected: issue.expected,
    actual: issue.actual,
    remediation: {
      kind: 'patch',
      scope: 'section',
      documentPath: fix.documentPath,
      sectionIds: fix.sectionIds,
    },
    ...(typeof issue.reasonCode === 'string' ? { reasonCode: issue.reasonCode } : {}),
  }
}

function projectPacketForModel(
  workerType: ReviewWorkerRequest['workerType'],
  packet: Record<string, unknown>,
): Record<string, unknown> {
  if (workerType === 'foundation-fact-extractor') {
    return {
      keys: Array.isArray(packet.keys) ? packet.keys : [],
      sections: Array.isArray(packet.sections)
        ? projectItems(packet.sections, section => modelSection(section, 'text'), 'fact section')
        : [],
    }
  }
  if (workerType === 'foundation-semantic-reviewer') {
    const projected: Record<string, unknown> = {
      ...(typeof packet.checkId === 'string' ? { checkId: packet.checkId } : {}),
      ...(typeof packet.objective === 'string' ? { objective: packet.objective } : {}),
      sections: Array.isArray(packet.sections)
        ? projectItems(packet.sections, section => modelSection(section, 'bytes') ?? modelSection(section, 'text'), 'semantic section')
        : [],
      facts: Array.isArray(packet.facts)
        ? projectItems(packet.facts, modelFact, 'semantic fact')
        : [],
      deterministicIssuePrefix: Array.isArray(packet.deterministicIssuePrefix)
        ? projectItems(packet.deterministicIssuePrefix, issue => modelIssue(issue, false), 'deterministic issue')
        : [],
    }
    if (typeof packet.expected === 'string') projected.expected = packet.expected
    if (typeof packet.actual === 'string') projected.actual = packet.actual
    if (packet.patchOperation && typeof packet.patchOperation === 'object' && !Array.isArray(packet.patchOperation)) {
      const operation = packet.patchOperation as Record<string, unknown>
      projected.patchOperation = {
        ...(typeof operation.kind === 'string' ? { kind: operation.kind } : {}),
        ...(typeof operation.documentPath === 'string' ? { documentPath: operation.documentPath } : {}),
        ...(typeof operation.sectionId === 'string' ? { sectionId: operation.sectionId } : {}),
      }
    }
    return projected
  }
  return packet
}

function workerInstruction(request: ReviewWorkerRequest): string {
  switch (request.workerType) {
    case 'foundation-fact-extractor':
      return [
        'Extract only the declared fact keys from the exact packet sections.',
        ...factExtractionInstructions(request),
        'Account for every assigned key exactly once as present, absent, or uncertain. Present values must be typed. Do not return evidence, section prose, or values not declared by the packet.',
      ].join(' ')
    case 'foundation-semantic-reviewer':
      if (request.contract.kind === 'confirmation')
        return `This is a strong independent confirmation of the completed source task. Re-evaluate only the same immutable packet against packet.objective and the same check, and return your own supported PASS, ISSUES, or UNDECIDABLE outcome. Do not inherit or preserve the source outcome. Do not expand scope, create a second audit track, introduce a new check, or read any other context. ${FOUNDATION_SEMANTIC_REMEDIATION_CONTRACT}`
      if (typeof request.contract.issueId === 'string')
        return 'Recheck only the admitted Issue expected against the packet current evidence. Return only PASS or FAIL in the supplied StructuredOutput schema. PASS means the exact expected is now true and the admitted actual is removed. FAIL requires one structured diagnostic grounded in packet evidence; do not discover, split, rewrite, or remediate Issues.'
      return [
        'Review only the exact semantic packet sections, normalized facts, and deterministic references.',
        'Apply packet.objective to every assigned section, including summaries and production materials. PASS requires no supported contradiction within that objective; a correct statement in one section does not cancel an incompatible requirement elsewhere. Report each conflicting block that must change, using the authoritative source section and downstream remediation section keys.',
        FOUNDATION_SEMANTIC_REMEDIATION_CONTRACT,
        'Issue drafts must use only assigned section keys and contain no IDs.',
      ].join(' ')
  }
}

function factExtractionInstructions(request: ReviewWorkerRequest): string[] {
  const packet = request.contract.packet
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return []
  const keys = (packet as { keys?: unknown }).keys
  if (!Array.isArray(keys)) return []
  return keys.flatMap(key => {
    if (typeof key !== 'string') return []
    const instruction = foundationFactDefinition(key)?.extractionInstruction
    return instruction ? [`Fact ${key}: ${instruction}`] : []
  })
}

function terminalInstruction(request: ReviewWorkerRequest): string {
  switch (request.workerType) {
    case 'foundation-fact-extractor':
      return 'Return exactly one native StructuredOutput value conforming to the supplied foundation fact schema with the complete bounded result set. For each assigned key, return exactly one status: present requires key, status, and value; omit evidence and reason. Absent requires only key and status and must omit value, evidence, and reason. Uncertain requires key, status, and reason; omit evidence and value. The service binds immutable provenance from the packet owner section into the durable terminal.'
    case 'foundation-semantic-reviewer':
      if (typeof request.contract.issueId === 'string')
        return 'Return exactly one native StructuredOutput value conforming to the targeted semantic recheck schema. Use PASS without diagnostic, or FAIL with exactly one structured diagnostic containing observedActual, evidence, and failureReasonCode. Do not return ISSUES or UNDECIDABLE; the service determines scope assessment.'
      return 'Return exactly one native StructuredOutput value conforming to the supplied semantic schema. Use exactly one outcome shape: PASS omits issues and reason; ISSUES includes a non-empty issues array and omits reason; UNDECIDABLE includes reason and omits issues.'
  }
}
