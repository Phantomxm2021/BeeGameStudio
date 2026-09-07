import { z } from 'zod/v4'
import { revisionCanonicalJson } from './json-digest'

const scopeSchema = z.enum(['document', 'section'])
const promptInputSchema = z.object({
  scope: scopeSchema,
  packet: z.record(z.string(), z.unknown()),
  priorFailureReason: z.string().optional(),
}).strict()

function semanticRef(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const ref = value as Record<string, unknown>
  if (typeof ref.documentPath !== 'string' || typeof ref.sectionId !== 'string') return undefined
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

function projectItems<T>(values: unknown[], project: (value: unknown) => T | undefined, label: string): T[] {
  return values.map((value, index) => {
    const projected = project(value)
    if (projected === undefined) throw new Error(`model-facing ${label} item ${index} is invalid`)
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
  if ((includeId && typeof issue.id !== 'string') || typeof issue.expected !== 'string' || typeof issue.actual !== 'string' ||
    !remediation || typeof remediation !== 'object' || Array.isArray(remediation)) return undefined
  const fix = remediation as Record<string, unknown>
  const rawSource = issue.source
  if (!rawSource || typeof rawSource !== 'object' || Array.isArray(rawSource)) return undefined
  const sourceRecord = rawSource as Record<string, unknown>
  if (sourceRecord.scope === 'document') {
    if (typeof sourceRecord.documentPath !== 'string' || fix.kind !== 'patch' || fix.scope !== 'document' ||
      fix.documentPath !== sourceRecord.documentPath || issue.target !== undefined || issue.supportingSections !== undefined) return undefined
    return {
      ...(includeId ? { id: issue.id } : {}),
      ...(typeof issue.severity === 'string' ? { severity: issue.severity } : {}),
      ...(typeof issue.type === 'string' ? { type: issue.type } : {}),
      source: { scope: 'document', documentPath: sourceRecord.documentPath },
      expected: issue.expected, actual: issue.actual,
      remediation: { kind: 'patch', scope: 'document', documentPath: fix.documentPath },
      ...(typeof issue.reasonCode === 'string' ? { reasonCode: issue.reasonCode } : {}),
    }
  }
  const source = semanticRef(rawSource)
  const target = issue.target === undefined ? undefined : semanticRef(issue.target)
  const supporting = issue.supportingSections === undefined ? undefined
    : Array.isArray(issue.supportingSections) ? issue.supportingSections.map(semanticRef) : undefined
  if (source === undefined || fix.kind !== 'patch' || fix.scope !== 'section' || typeof fix.documentPath !== 'string' ||
    !Array.isArray(fix.sectionIds) || fix.sectionIds.some(sectionId => typeof sectionId !== 'string') ||
    (issue.target !== undefined && target === undefined) ||
    (issue.supportingSections !== undefined && (supporting === undefined || supporting.some(ref => ref === undefined)))) return undefined
  return {
    ...(includeId ? { id: issue.id } : {}),
    ...(typeof issue.severity === 'string' ? { severity: issue.severity } : {}),
    ...(typeof issue.type === 'string' ? { type: issue.type } : {}),
    source,
    ...(target ? { target } : {}),
    ...(supporting ? { supportingSections: supporting } : {}),
    expected: issue.expected, actual: issue.actual,
    remediation: { kind: 'patch', scope: 'section', documentPath: fix.documentPath, sectionIds: fix.sectionIds },
    ...(typeof issue.reasonCode === 'string' ? { reasonCode: issue.reasonCode } : {}),
  }
}

/**
 * Projects the private repair packet into the intentionally small model view.
 * Full document text, byte digests, line ranges and execution identities are
 * omitted; documentPath remains because it is the model-facing repair scope.
 */
export function projectRevisionPacketForModel(packet: Record<string, unknown>): Record<string, unknown> {
  revisionCanonicalJson(packet)
  return {
    ...(typeof packet.documentPath === 'string' ? { documentPath: packet.documentPath } : {}),
    ...(Array.isArray(packet.issueIds) ? { issueIds: packet.issueIds } : {}),
    ...(Array.isArray(packet.sectionIds) ? { sectionIds: packet.sectionIds } : {}),
    issues: Array.isArray(packet.issues) ? projectItems(packet.issues, issue => modelIssue(issue, true), 'revision issue') : [],
    sections: Array.isArray(packet.sections) ? projectItems(packet.sections, section => modelSection(section, 'text'), 'revision section') : [],
    normalizedFacts: Array.isArray(packet.normalizedFacts) ? projectItems(packet.normalizedFacts, modelFact, 'revision fact') : [],
    ...(Array.isArray(packet.factConstraints) ? { factConstraints: packet.factConstraints } : {}),
    ...(packet.scope === 'document' && packet.documentContract && typeof packet.documentContract === 'object' && !Array.isArray(packet.documentContract)
      ? { documentContract: packet.documentContract } : {}),
  }
}

/** Pure Revision prompt construction; native execution supplies paths/tools later. */
export function buildRevisionWorkerPrompt(input: {
  scope: 'document' | 'section'
  packet: Record<string, unknown>
  priorFailureReason?: string
}): string {
  // Validate canonical JSON before touching any field, then retain the
  // producer's insertion order so the frozen model-facing JSON bytes remain
  // identical to the established prompt projection.
  revisionCanonicalJson(input)
  const captured = promptInputSchema.parse(structuredClone(input))
  if (captured.packet.scope !== captured.scope) throw new Error('Revision worker packet scope is inconsistent')
  const documentScoped = captured.scope === 'document'
  if (documentScoped && (!('documentContract' in captured.packet) || !captured.packet.documentContract ||
    typeof captured.packet.documentContract !== 'object' || Array.isArray(captured.packet.documentContract)))
    throw new Error('document-scoped foundation revision worker requires one complete canonical documentContract')
  return [
    `Revision evidence: ${JSON.stringify(projectRevisionPacketForModel(captured.packet))}`,
    documentScoped
      ? 'The complete assigned staged document is the write authority because Stage 3 could not establish trustworthy section boundaries. Call ReadAssignedFoundationRevision exactly once with {}, prepare the repair in memory, then return the complete revised document as the visible raw Markdown response. Repair only packet.issues; do not discover or repair unrelated defects. packet.documentContract is preservation authority, not a second review checklist: retain every declared marker and heading in order and preserve substantive content outside the minimum structural collateral required by the admitted Issues. Do not call mutation or submission tools, use Read/Edit/Bash, wrap the Markdown in a code fence, or add terminal JSON or prose.'
      : 'The packet sectionIds and packet.sections[].text are the complete current write authority: only sectionIds may change. Do not read the staged document; the service preserves every unassigned byte. Return only the complete replacement Markdown for every authorized section, in packet.sectionIds order. Each replacement must start with its exact canonical heading and include its complete body exactly like packet.sections[].text; omit protocol markers. Do not include read-only evidence sections, JSON, a wrapper code fence, preface, completion explanation, mutation tool call or submission tool call. Make every admitted Issue expected true and remove its actual. For fact/schema repairs, packet.factConstraints is binding authority: do not substitute a standalone fact declaration for its required semantic structure.',
    ...(captured.priorFailureReason
      ? [`Automatic retry after the previous strict validation failure: ${captured.priorFailureReason}. Correct that failure only inside the assigned staged ${documentScoped ? 'document' : 'sections'}; do not broaden scope.`]
      : []),
  ].join('\n')
}
