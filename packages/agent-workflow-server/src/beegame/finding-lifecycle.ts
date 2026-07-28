import { createHash } from 'node:crypto'

export type FindingLifecycleStatus = 'open' | 'resolved' | 'reopened'

export type CanonicalFinding = {
  id: string
  source: string
  detail: string
  status: FindingLifecycleStatus
  firstObservedAt: string
  lastObservedAt: string
  revision: string
}

type FindingInput = {
  source: string
  detail: string
}

/**
 * Converts an agent-reported finding into a durable fact. Identity is based
 * on the finding's semantic fields and evidence stream, never on display
 * text, message order, or a feedback payload.
 */
export function materializeFindings(input: {
  stream: string
  revision: string
  observedAt: string
  findings: FindingInput[]
}): CanonicalFinding[] {
  const seen = new Set<string>()
  const materialized: CanonicalFinding[] = []
  for (const finding of input.findings) {
    const source = finding.source.trim()
    const detail = finding.detail.trim()
    if (!source || !detail) continue
    const id = createHash('sha256')
      .update(`${input.stream}\u0000${source}\u0000${detail}`)
      .digest('hex')
    if (seen.has(id)) continue
    seen.add(id)
    materialized.push({
      id,
      source,
      detail,
      status: 'open',
      firstObservedAt: input.observedAt,
      lastObservedAt: input.observedAt,
      revision: input.revision,
    })
  }
  return materialized
}

/**
 * Reconciles one evidence stream against its previous terminal observation.
 * Missing findings are retained as resolved history; findings that return
 * after being resolved are explicitly reopened instead of receiving a new
 * identity.
 */
export function reconcileFindings(input: {
  previous: CanonicalFinding[]
  current: CanonicalFinding[]
  observedAt: string
  revision: string
}): CanonicalFinding[] {
  const currentIds = new Set(input.current.map(finding => finding.id))
  const current = input.current.map(finding => {
    const previous = input.previous.find(candidate => candidate.id === finding.id)
    return {
      ...finding,
      status: previous?.status === 'resolved' ? 'reopened' : 'open',
      firstObservedAt: previous?.firstObservedAt ?? finding.firstObservedAt,
      lastObservedAt: input.observedAt,
      revision: input.revision,
    } satisfies CanonicalFinding
  })
  const resolved = input.previous
    .filter(finding => !currentIds.has(finding.id))
    .map(finding => ({
      ...finding,
      status: 'resolved' as const,
      lastObservedAt: input.observedAt,
      revision: input.revision,
    }))
  return [...current, ...resolved]
}
