import type { FoundationDocumentPath } from './types'
import type { SectionRef } from './foundation-section-index'

export type AuditSeverity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW'
export type AuditIssueType = 'schema' | 'rule' | 'contract' | 'semantic'

export type FoundationDocumentRef = {
  scope: 'document'
  documentPath: FoundationDocumentPath
  digest: string
}

export type FoundationSectionPatchRemediation = {
  kind: 'patch'
  scope: 'section'
  documentPath: FoundationDocumentPath
  sectionIds: string[]
}

export type FoundationDocumentPatchRemediation = {
  kind: 'patch'
  scope: 'document'
  documentPath: FoundationDocumentPath
}

export type AuditIssueRemediation = FoundationSectionPatchRemediation

export type AuditIssue = {
  id: string
  severity: AuditSeverity
  type: AuditIssueType
  source: SectionRef
  target?: SectionRef
  expected: string
  actual: string
  remediation: AuditIssueRemediation
  /** Canonical read-only evidence beyond source/target; never patch authority. */
  supportingSections?: SectionRef[]
  reasonCode?: string
}

export type AuditIssueDraft = {
  checkId: string
  severity: AuditSeverity
  type: AuditIssueType
  source: SectionRef
  target?: SectionRef
  expected: string
  actual: string
  remediation: AuditIssueRemediation
  supportingSections?: SectionRef[]
  reasonCode?: string
  conflictIdentity: Readonly<Record<string, unknown>>
}

export type FoundationDocumentAuditIssue = {
  id: string
  severity: AuditSeverity
  type: 'schema' | 'contract'
  source: FoundationDocumentRef
  expected: string
  actual: string
  remediation: FoundationDocumentPatchRemediation
  reasonCode: 'DOCUMENT_FORMAT_INVALID'
}

export type FoundationReviewIssue = AuditIssue | FoundationDocumentAuditIssue

export type IssueRegistryContext = {
  validated: true
  section(documentPath: string, sectionId: string): SectionRef | undefined
}
