import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getObservedNativeAcceptance } from './native-acceptance-evidence'
import { getObservedNativeDocumentReview } from './native-document-review-evidence'
import { getObservedNativeImplementationAudit } from './native-implementation-audit-evidence'
import { auditDocumentReadiness } from './document-readiness-audit'
import { getObservedNativeResourceLibraryEvidence } from './native-resource-library-evidence'
import { auditAssetContract } from './asset-contract-audit'
import { getConfirmedBriefEvidence } from './confirmed-brief-evidence'
import { auditResourceDeliveryReadiness } from './resource-delivery-readiness'

export type NativeDeliveryStateReason =
  | 'document_review_missing'
  | 'document_review_running'
  | 'document_review_stale'
  | 'document_review_needs_revision'
  | 'document_review_blocked'
  | 'resource_exploration_missing'
  | 'resource_exploration_stale'
  | 'resource_import_missing'
  | 'implementation_audit_out_of_order'
  | 'acceptance_missing'
  | 'acceptance_running'
  | 'acceptance_stale'
  | 'acceptance_failed'
  | 'acceptance_blocked'
  | 'acceptance_out_of_order'
  | 'implementation_audit_missing'
  | 'implementation_audit_running'
  | 'implementation_audit_stale'
  | 'implementation_audit_failed'
  | 'implementation_audit_blocked'
  | 'accepted'

export type NativeDeliveryState = {
  status: 'not_run' | 'passed' | 'failed' | 'blocked' | 'stale'
  reason: NativeDeliveryStateReason
  summary: string
  observedAt?: string
}

export type NativeDeliveryEvidenceSummary = {
  documentReview: {
    status: 'not_run' | 'running' | 'ready' | 'needs_revision' | 'blocked' | 'stale'
    summary: string
    observedAt?: string
  }
  implementationAudit: {
    status: 'not_run' | 'running' | 'passed' | 'failed' | 'blocked' | 'stale'
    summary: string
    observedAt?: string
  }
  runtimeAcceptance: {
    status: 'not_run' | 'running' | 'passed' | 'failed' | 'blocked' | 'stale'
    summary: string
    observedAt?: string
  }
}

/**
 * Presents the three independent native evidence streams without combining
 * them into a BeeGame-authored workflow. These are passive observations only.
 */
export function getNativeDeliveryEvidenceSummary(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
}): NativeDeliveryEvidenceSummary {
  const review = getObservedNativeDocumentReview(input)
  const audit = getObservedNativeImplementationAudit(input)
  const acceptance = getObservedNativeAcceptance(input)
  return {
    documentReview: review.state === 'current'
      ? {
          status: review.evidence.verdict === 'READY'
            ? 'ready'
            : review.evidence.verdict === 'BLOCKED'
              ? 'blocked'
              : 'needs_revision',
          summary: review.evidence.summary,
          observedAt: review.evidence.createdAt,
        }
      : review.state === 'running'
        ? { status: 'running', summary: 'The native Document Reviewer is still running.', observedAt: review.createdAt }
        : review.state === 'stale'
          ? { status: 'stale', summary: 'Project documents changed after the latest native review.', observedAt: review.evidence.createdAt }
          : { status: 'not_run', summary: 'No valid native Document Reviewer result has been observed.' },
    implementationAudit: audit.state === 'current'
      ? { status: audit.evidence.status, summary: audit.evidence.summary, observedAt: audit.evidence.createdAt }
      : audit.state === 'running'
        ? { status: 'running', summary: 'The native Implementation Auditor is still running.', observedAt: audit.createdAt }
        : audit.state === 'stale'
          ? { status: 'stale', summary: 'The project changed after the latest native implementation audit.', observedAt: audit.evidence.createdAt }
          : { status: 'not_run', summary: 'No valid native Implementation Auditor result has been observed.' },
    runtimeAcceptance: acceptance.state === 'current'
      ? { status: acceptance.evidence.status, summary: acceptance.evidence.summary, observedAt: acceptance.evidence.createdAt }
      : acceptance.state === 'running'
        ? { status: 'running', summary: 'The native Acceptance Validator is still running.', observedAt: acceptance.createdAt }
        : acceptance.state === 'stale'
          ? { status: 'stale', summary: acceptance.evidence.summary, observedAt: acceptance.evidence.createdAt }
          : { status: 'not_run', summary: 'No valid native Acceptance Validator result has been observed.' },
  }
}

/**
 * Derives delivery state exclusively from passively observed native Claude
 * Code Reviewer and Validator results. It does not infer project semantics,
 * start agents, or advance a workflow.
 */
export function getNativeDeliveryState(input: {
  dataRoot: string
  sessionId: string
  workspacePath: string
}): NativeDeliveryState {
  const review = getObservedNativeDocumentReview(input)
  if (review.state === 'missing') {
    return {
      status: 'not_run',
      reason: 'document_review_missing',
      summary:
        'Document review has not produced a valid native terminal result.',
    }
  }
  if (review.state === 'running') {
    return {
      status: 'not_run',
      reason: 'document_review_running',
      summary: 'The native Document Reviewer is still running.',
      observedAt: review.createdAt,
    }
  }
  if (review.state === 'stale') {
    return {
      status: 'stale',
      reason: 'document_review_stale',
      summary: 'Project documents changed after the latest native review.',
      observedAt: review.evidence.createdAt,
    }
  }
  if (review.evidence.verdict === 'NEEDS_REVISION') {
    return {
      status: 'failed',
      reason: 'document_review_needs_revision',
      summary: review.evidence.summary,
      observedAt: review.evidence.createdAt,
    }
  }
  if (review.evidence.verdict === 'BLOCKED') {
    return {
      status: 'blocked',
      reason: 'document_review_blocked',
      summary: review.evidence.summary,
      observedAt: review.evidence.createdAt,
    }
  }

  const readiness = auditDocumentReadiness(input.workspacePath)
  if (!readiness.valid) {
    return {
      status: 'failed',
      reason: 'document_review_needs_revision',
      summary: [
        'Document review cannot be READY because deterministic project-contract checks failed.',
        ...readiness.issues,
      ].join(' '),
      observedAt: review.evidence.createdAt,
    }
  }

  const confirmedBrief = getConfirmedBriefEvidence(input)
  const confirmedResourcePolicy = confirmedBrief?.resourceLibraryUsage ??
    review.evidence.confirmedResourceLibraryUsage
  if (
    confirmedBrief &&
    review.evidence.confirmedResourceLibraryUsage !== confirmedResourcePolicy
  ) {
    return {
      status: 'failed',
      reason: 'document_review_needs_revision',
      summary: `The native Document Reviewer resource policy (${review.evidence.confirmedResourceLibraryUsage}) does not preserve the user-confirmed policy (${confirmedResourcePolicy}).`,
      observedAt: review.evidence.createdAt,
    }
  }
  const resourcePolicy = readResourceLibraryPolicy(input.workspacePath)
  if (resourcePolicy !== confirmedResourcePolicy) {
    return {
      status: 'failed',
      reason: 'document_review_needs_revision',
      summary: `The asset manifest resource_library_usage (${resourcePolicy ?? 'missing'}) does not preserve the confirmed brief policy (${confirmedResourcePolicy}).`,
      observedAt: review.evidence.createdAt,
    }
  }
  let resourceObservedAt: string | undefined
  if (resourcePolicy === 'preferred' || resourcePolicy === 'required') {
    const resourceEvidence = getObservedNativeResourceLibraryEvidence(input)
    if (resourceEvidence.state === 'missing') {
      return {
        status: 'not_run',
        reason: 'resource_exploration_missing',
        summary: 'The current resource policy requires an observed native Resource Library exploration, but none was recorded.',
        observedAt: review.evidence.createdAt,
      }
    }
    if (resourceEvidence.state === 'stale') {
      return {
        status: 'stale',
        reason: 'resource_exploration_stale',
        summary: 'The art direction, asset plan, or project target changed after Resource Library exploration.',
        observedAt: resourceEvidence.observedAt,
      }
    }
    if (!resourceEvidence.actions.includes('browse_packs')) {
      return {
        status: 'not_run',
        reason: 'resource_exploration_missing',
        summary: 'Resource Library provenance exists, but no completed Pack exploration was observed for the current resource context.',
        observedAt: resourceEvidence.observedAt,
      }
    }
    resourceObservedAt = resourceEvidence.observedAt
    const resourceReadiness = auditResourceDeliveryReadiness({
      workspacePath: input.workspacePath,
      confirmedPolicy: confirmedResourcePolicy,
      resourceEvidence,
    })
    if (!resourceReadiness.valid) {
      return {
        status: 'failed',
        reason: 'resource_import_missing',
        summary: resourceReadiness.issues.join(' '),
        observedAt: resourceEvidence.observedAt,
      }
    }
    const hasUsableImport = hasUsableResourceLibraryImport(input.workspacePath)
    if (
      resourceEvidence.failedActions.includes('import_elements') &&
      !hasUsableImport
    ) {
      return {
        status: 'failed',
        reason: 'resource_import_missing',
        summary: 'The Resource Library import completed without producing a usable project file.',
        observedAt: resourceEvidence.observedAt,
      }
    }
    if (!hasUsableImport) {
      return {
        status: 'failed',
        reason: 'resource_import_missing',
        summary: `The ${resourcePolicy} Resource Library policy has no usable imported project file.`,
        observedAt: resourceEvidence.observedAt,
      }
    }
  }

  const audit = getObservedNativeImplementationAudit(input)
  if (audit.state === 'missing') {
    return {
      status: 'not_run',
      reason: 'implementation_audit_missing',
      summary: 'Implementation audit has not produced a valid native terminal result.',
      observedAt: review.evidence.createdAt,
    }
  }
  if (audit.state === 'running') {
    return {
      status: 'not_run',
      reason: 'implementation_audit_running',
      summary: 'The native Implementation Auditor is still running.',
      observedAt: audit.createdAt,
    }
  }
  if (audit.state === 'stale') {
    return {
      status: 'stale',
      reason: 'implementation_audit_stale',
      summary: 'The project changed after the latest native implementation audit.',
      observedAt: audit.evidence.createdAt,
    }
  }
  if (audit.evidence.status !== 'passed') {
    return {
      status: audit.evidence.status,
      reason: audit.evidence.status === 'blocked'
        ? 'implementation_audit_blocked'
        : 'implementation_audit_failed',
      summary: audit.evidence.summary,
      observedAt: audit.evidence.createdAt,
    }
  }
  const auditStarted = Date.parse(audit.evidence.startedAt)
  if (
    !Number.isFinite(auditStarted) ||
    auditStarted < Date.parse(review.evidence.createdAt) ||
    (resourceObservedAt && auditStarted < Date.parse(resourceObservedAt))
  ) {
    return {
      status: 'stale',
      reason: 'implementation_audit_out_of_order',
      summary: 'The Implementation Auditor started before its current document and resource prerequisites completed.',
      observedAt: audit.evidence.createdAt,
    }
  }

  const acceptance = getObservedNativeAcceptance(input)
  if (acceptance.state === 'missing') {
    return {
      status: 'not_run',
      reason: 'acceptance_missing',
      summary: 'Acceptance has not produced a valid native Validator result.',
      observedAt: audit.evidence.createdAt,
    }
  }
  if (acceptance.state === 'running') {
    return {
      status: 'not_run',
      reason: 'acceptance_running',
      summary: 'The native acceptance Validator is still running.',
      observedAt: acceptance.createdAt,
    }
  }
  if (acceptance.state === 'stale') {
    return {
      status: 'stale',
      reason: 'acceptance_stale',
      summary: acceptance.evidence.summary,
      observedAt: acceptance.evidence.createdAt,
    }
  }
  if (acceptance.evidence.status !== 'passed') {
    return {
      status: acceptance.evidence.status,
      reason: acceptance.evidence.status === 'blocked'
        ? 'acceptance_blocked'
        : 'acceptance_failed',
      summary: acceptance.evidence.summary,
      observedAt: acceptance.evidence.createdAt,
    }
  }
  if (Date.parse(acceptance.evidence.startedAt) < Date.parse(audit.evidence.createdAt)) {
    return {
      status: 'stale',
      reason: 'acceptance_out_of_order',
      summary: 'The Acceptance Validator started before the current Implementation Auditor completed.',
      observedAt: acceptance.evidence.createdAt,
    }
  }
  return {
    status: 'passed',
    reason: 'accepted',
    summary: acceptance.evidence.summary,
    observedAt: acceptance.evidence.createdAt,
  }
}

function hasUsableResourceLibraryImport(workspacePath: string): boolean {
  const audit = auditAssetContract(workspacePath)
  if (!audit.valid || !audit.imports?.length) return false
  const path = join(workspacePath, 'assets', 'asset-manifest.json')
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isRecord(manifest) || !Array.isArray(manifest.imports)) return false
    return manifest.imports.some(resourceImport =>
      isRecord(resourceImport) &&
      isRecord(resourceImport.source) &&
      resourceImport.source.type === 'resource-library' &&
      (resourceImport.status === 'available' || resourceImport.status === 'referenced')
    )
  } catch {
    return false
  }
}

function readResourceLibraryPolicy(
  workspacePath: string,
): 'optional' | 'preferred' | 'required' | undefined {
  const path = join(workspacePath, 'assets', 'asset-manifest.json')
  if (!existsSync(path)) return undefined
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isRecord(manifest) || !isRecord(manifest.project_target)) return undefined
    const value = manifest.project_target.resource_library_usage
    return value === 'optional' || value === 'preferred' || value === 'required'
      ? value
      : undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
