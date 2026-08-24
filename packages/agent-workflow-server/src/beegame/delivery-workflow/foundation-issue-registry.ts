import type { FoundationDocumentPath } from './types'
import type { SectionRef } from './foundation-section-index'

export type AuditSeverity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW'
export type AuditIssueType = 'schema' | 'rule' | 'contract' | 'semantic'

export type AuditIssue = {
  id: string
  severity: AuditSeverity
  type: AuditIssueType
  source: SectionRef
  target?: SectionRef
  expected: string
  actual: string
  fixDocument: FoundationDocumentPath
  fixSectionId: string
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
  fixDocument: FoundationDocumentPath
  fixSectionId: string
  reasonCode?: string
  conflictIdentity: Readonly<Record<string, unknown>>
}

export type IssueRegistryContext = {
  validated: true
  section(documentPath: string, sectionId: string): SectionRef | undefined
}
