import type { ProjectDeliveryPhase } from './phases'
import type { DesignDocumentSnapshot, DesignFinding, DesignReviewStep } from '../design-handoff'
import type { PROJECT_DOCUMENTS } from '../project-content-authority'
import type { DesignUserDecision } from '@bee-game-studio/agent-workflow/design-review-result'

/** Existing design portion of the v1 snapshot, not a second store or workflow. */
export type DesignStageState = {
  objective: string
  status: 'active' | 'paused'
  phase?: ProjectDeliveryPhase
  authorBatch?: number
  lastValidationFailure?: string
  // Saved drafts protect other owners' bytes during dependent writing. They
  // are not a review certificate and cannot authorize downstream production.
  designDrafts?: { batch: number; revision: string; snapshots: Record<string, string>; documentVersions?: Record<string, string>; evidenceHashes: Record<string, string>; digestVersion?: 1 | 2 }
  designReview?: { step: DesignReviewStep; combined?: boolean; revision: string; snapshots: Record<string, string>; documentVersions?: Record<string, string>; findings: DesignFinding[]; changedDocuments?: string[];
    affectedDocuments?: Array<typeof PROJECT_DOCUMENTS[number]>;
    // Retain the actual grant across read-only verification; newly reported
    // consumers cannot silently expand a published-baseline change request.
    revisionDocuments?: Array<typeof PROJECT_DOCUMENTS[number]>;
    pendingCheckIssues?: string[];
    changedSections?: Record<string, string[] | null>;
    userDecisions?: DesignUserDecision[];
    interruptedWrite?: { revision: string; snapshots: Record<string, string>; files?: Record<string, string | null>; before: DesignDocumentSnapshot };
    stopped?: boolean; digestVersion?: 1 | 2; instruction?: string; returnPhase?: ProjectDeliveryPhase; returnAuthorBatch?: number; writableDocuments?: Array<typeof PROJECT_DOCUMENTS[number]> }
  designRepair?: { turn: string; returnPhase: ProjectDeliveryPhase; status: 'pending' | 'resolved' | 'stopped';
    reason: string; changedDocuments: string[]; baselineRevision: string;
    // Exact closed reports at the accepted source revision; not a repair quota.
    resolvedRevision?: string; findings?: DesignFinding[] }
  designBaseline?: { batch: number; combined?: boolean; revision: string; snapshots: Record<string, string>; documentVersions?: Record<string, string>; evidenceHashes: Record<string, string>; followUps: DesignFinding[];
    digestVersion?: 1 | 2; change?: { documents: Array<typeof PROJECT_DOCUMENTS[number]>; instruction?: string } }
  designHistory?: Array<{ step: DesignReviewStep | 'owner-request'; revision: string; findings: DesignFinding[]; resolved: Array<{ id: string; evidence: string; disposition?: 'fixed' | 'not-applicable' }>; instruction?: string; userDecisions?: DesignUserDecision[] }>
}
