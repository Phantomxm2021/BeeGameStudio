export type DeliveryCheckStatus = 'passed' | 'failed' | 'untested' | 'blocked'

export type DeliveryRequirementStatus =
  | 'planned'
  | 'implemented'
  | 'statically_verified'
  | 'runtime_verified'
  | 'accepted'
  | 'failed'
  | 'blocked'

export type DeliveryEvidenceKind =
  | 'implementation'
  | 'build'
  | 'test'
  | 'runtime'
  | 'asset'
  | 'skill'
  | 'document'

export type DeliveryEvidence = {
  kind: DeliveryEvidenceKind
  eventId?: string
  source?: string
  detail: string
  metrics?: Record<string, number>
  environment?: Record<string, string | number | boolean>
}

export type DeliveryRequirement = {
  id: string
  title: string
  scope: 'mvp' | 'roadmap'
  status: DeliveryRequirementStatus
  evidenceRequired: DeliveryEvidenceKind[]
  evidence: DeliveryEvidence[]
  detail?: string
}

export type DeliveryContract = {
  version: 1
  status: DeliveryCheckStatus
  summary: string
  requirements: DeliveryRequirement[]
  requiredCapabilities: string[]
  verifiedCapabilities: string[]
}

export type DeliveryGateFailure = {
  code: 'delivery_not_accepted'
  message: string
  status: string
  summary?: string
}

export type ParsedDeliveryReview = {
  status: DeliveryCheckStatus
  summary: string
  requirements: DeliveryRequirement[]
  requiredCapabilities: string[]
  findings: Array<{
    requirementId?: string
    requirement: string
    status: DeliveryCheckStatus
    detail: string
    evidence: DeliveryEvidence[]
  }>
}

const CHECK_STATUSES = new Set<DeliveryCheckStatus>([
  'passed',
  'failed',
  'untested',
  'blocked',
])

const REQUIREMENT_STATUSES = new Set<DeliveryRequirementStatus>([
  'planned',
  'implemented',
  'statically_verified',
  'runtime_verified',
  'accepted',
  'failed',
  'blocked',
])

const EVIDENCE_KINDS = new Set<DeliveryEvidenceKind>([
  'implementation',
  'build',
  'test',
  'runtime',
  'asset',
  'skill',
  'document',
])

export function parseDeliveryReview(text: string | undefined): ParsedDeliveryReview | undefined {
  if (!text?.trim()) return undefined
  try {
    const value = JSON.parse(text.trim()) as unknown
    if (!isRecord(value) || !isDeliveryCheckStatus(value.status) || typeof value.summary !== 'string') {
      return undefined
    }
    const requirements = parseRequirements(value.requirements)
    const findings = parseFindings(value.findings)
    if (!requirements || !findings) return undefined
    return {
      status: value.status,
      summary: value.summary,
      requirements,
      requiredCapabilities: stringArray(value.requiredCapabilities),
      findings,
    }
  } catch {
    return undefined
  }
}

export function createDeliveryContract(
  review: ParsedDeliveryReview,
  verifiedCapabilities: string[],
): DeliveryContract {
  const verified = uniqueStrings(verifiedCapabilities)
  const required = uniqueStrings(review.requiredCapabilities)
  const missingCapabilities = required.filter(capability => !verified.includes(capability))
  const requirements = review.requirements.map(requirement => ({
    ...requirement,
    evidenceRequired: uniqueEvidenceKinds(requirement.evidenceRequired),
    evidence: dedupeEvidence(requirement.evidence),
  }))
  const requirementsAcceptable = requirements.length > 0 && requirements.every(requirement => {
    if (requirement.scope === 'roadmap') return true
    if (requirement.status !== 'accepted' && requirement.status !== 'runtime_verified') return false
    return requirement.evidenceRequired.every(kind => requirement.evidence.some(item => item.kind === kind))
  })
  const status: DeliveryCheckStatus = review.status === 'passed' && requirementsAcceptable && missingCapabilities.length === 0
    ? 'passed'
    : review.status === 'blocked'
      ? 'blocked'
      : review.status === 'failed' || requirements.some(item => item.status === 'failed')
        ? 'failed'
        : 'untested'
  return {
    version: 1,
    status,
    summary: missingCapabilities.length > 0
      ? `${review.summary} Missing required validation capabilities: ${missingCapabilities.join(', ')}.`
      : review.summary,
    requirements,
    requiredCapabilities: required,
    verifiedCapabilities: verified,
  }
}

export function buildDeliveryRepairPrompt(contract: DeliveryContract, attempt: number): string {
  const unresolved = contract.requirements
    .filter(requirement => requirement.scope === 'mvp' && requirement.status !== 'accepted' && requirement.status !== 'runtime_verified')
    .map(requirement => ({
      id: requirement.id,
      title: requirement.title,
      status: requirement.status,
      detail: requirement.detail ?? '',
      missingEvidence: requirement.evidenceRequired.filter(kind => !requirement.evidence.some(item => item.kind === kind)),
    }))
  return [
    `Delivery repair attempt ${attempt}.`,
    'Independent delivery validation did not pass. Fix the project-level implementation and evidence gaps listed below.',
    'Do not weaken the acceptance contract, mark unchecked requirements as accepted, or replace runtime evidence with model claims.',
    'Use the project-selected platform adapter and project-native toolchain. Do not bind shared logic to a particular engine or platform.',
    'After fixing, add or update executable regression coverage for the affected player path and run it.',
    JSON.stringify({ status: contract.status, summary: contract.summary, unresolved }, null, 2),
  ].join('\n')
}

export function createDeliveryGateFailure(review: unknown): DeliveryGateFailure | null {
  if (isRecord(review) && review.status === 'passed') return null
  const status = isRecord(review) && typeof review.status === 'string' ? review.status : 'unreviewed'
  const summary = isRecord(review) && typeof review.summary === 'string' ? review.summary : undefined
  return {
    code: 'delivery_not_accepted',
    message: 'Project deployment requires a passed evidence-backed delivery review.',
    status,
    ...(summary ? { summary } : {}),
  }
}

function parseRequirements(value: unknown): DeliveryRequirement[] | undefined {
  if (!Array.isArray(value)) return undefined
  const requirements: DeliveryRequirement[] = []
  const ids = new Set<string>()
  for (const item of value) {
    if (!isRecord(item)) return undefined
    const id = normalizedString(item.id)
    const title = normalizedString(item.title)
    if (!id || !title || ids.has(id) || (item.scope !== 'mvp' && item.scope !== 'roadmap')) return undefined
    if (!isDeliveryRequirementStatus(item.status)) return undefined
    const evidenceRequired = evidenceKindArray(item.evidenceRequired)
    const evidence = parseEvidence(item.evidence)
    if (!evidenceRequired || !evidence) return undefined
    ids.add(id)
    requirements.push({
      id,
      title,
      scope: item.scope,
      status: item.status,
      evidenceRequired,
      evidence,
      ...(normalizedString(item.detail) ? { detail: normalizedString(item.detail) } : {}),
    })
  }
  return requirements
}

function parseFindings(value: unknown): ParsedDeliveryReview['findings'] | undefined {
  if (!Array.isArray(value)) return undefined
  const findings: ParsedDeliveryReview['findings'] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.requirement !== 'string' || typeof item.detail !== 'string') return undefined
    if (!isDeliveryCheckStatus(item.status)) return undefined
    const evidence = item.evidence === undefined ? [] : parseEvidence(item.evidence)
    if (!evidence) return undefined
    findings.push({
      ...(normalizedString(item.requirementId) ? { requirementId: normalizedString(item.requirementId) } : {}),
      requirement: item.requirement,
      status: item.status,
      detail: item.detail,
      evidence,
    })
  }
  return findings
}

function parseEvidence(value: unknown): DeliveryEvidence[] | undefined {
  if (!Array.isArray(value)) return undefined
  const evidence: DeliveryEvidence[] = []
  for (const item of value) {
    if (!isRecord(item) || !isDeliveryEvidenceKind(item.kind) || typeof item.detail !== 'string') return undefined
    evidence.push({
      kind: item.kind,
      detail: item.detail,
      ...(normalizedString(item.eventId) ? { eventId: normalizedString(item.eventId) } : {}),
      ...(normalizedString(item.source) ? { source: normalizedString(item.source) } : {}),
      ...(numberRecord(item.metrics) ? { metrics: numberRecord(item.metrics) } : {}),
      ...(scalarRecord(item.environment) ? { environment: scalarRecord(item.environment) } : {}),
    })
  }
  return evidence
}

function evidenceKindArray(value: unknown): DeliveryEvidenceKind[] | undefined {
  if (!Array.isArray(value) || value.some(item => !isDeliveryEvidenceKind(item))) return undefined
  return value
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? uniqueStrings(value.filter(item => typeof item === 'string')) : []
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function uniqueEvidenceKinds(values: DeliveryEvidenceKind[]): DeliveryEvidenceKind[] {
  return [...new Set(values)]
}

function dedupeEvidence(values: DeliveryEvidence[]): DeliveryEvidence[] {
  const seen = new Set<string>()
  return values.filter(value => {
    const key = `${value.kind}\u0000${value.eventId ?? ''}\u0000${value.source ?? ''}\u0000${value.detail}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function numberRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
  if (entries.some(([, item]) => typeof item !== 'number' || !Number.isFinite(item))) return undefined
  return Object.fromEntries(entries) as Record<string, number>
}

function scalarRecord(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
  if (entries.some(([, item]) => typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean')) return undefined
  return Object.fromEntries(entries) as Record<string, string | number | boolean>
}

function isDeliveryCheckStatus(value: unknown): value is DeliveryCheckStatus {
  return CHECK_STATUSES.has(value as DeliveryCheckStatus)
}

function isDeliveryRequirementStatus(value: unknown): value is DeliveryRequirementStatus {
  return REQUIREMENT_STATUSES.has(value as DeliveryRequirementStatus)
}

function isDeliveryEvidenceKind(value: unknown): value is DeliveryEvidenceKind {
  return EVIDENCE_KINDS.has(value as DeliveryEvidenceKind)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
