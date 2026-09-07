/** Private authoring types.  Deliberately does not import DeliveryRun or any
 * other stage's state; the public stage adapter translates to these values. */
export const CANONICAL_FOUNDATION_DOCUMENTS = [
  'docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md', 'docs/BALANCE_DESIGN.md',
  'docs/TECHNICAL_DESIGN.md', 'docs/ART_DIRECTION.md', 'docs/UI_UX_SPEC.md',
  'docs/AUDIO_DESIGN.md', 'docs/ASSET_PLAN.md',
] as const
export type FoundationDocumentPath = (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]
export type FoundationAuthoringStatus = 'pending' | 'drafting' | 'committed' | 'needs_action'
export type DispatchStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'interrupted' | 'invalid'
export type WorkflowStatus = 'running' | 'needs_action' | 'completed' | 'failed' | 'stopped'
export type AuthoringPhase = 'DOCUMENT_DRAFTING' | 'DOCUMENT_REVIEW'
export type DispatchRecord = {
  dispatchId: string; workerType: 'document-author'; phase: 'DOCUMENT_DRAFTING'; taskId?: string
  revision: string; status: DispatchStatus; request?: WorkerDispatchRequest
  terminalResult?: Record<string, unknown>; failureReason?: string; startedAt: string; finishedAt?: string
}
export type FoundationDocumentCheckpoint = { path: FoundationDocumentPath; status: FoundationAuthoringStatus; upstreamDigests?: Record<string,string>; dispatch?: DispatchRecord; failureReason?: string }
export type FoundationDraftState = { completedPaths: FoundationDocumentPath[]; documents?: FoundationDocumentCheckpoint[] }
export type AuthoringContract = {
  confirmedBriefDigest: string; confirmedBriefContext?: string; documentSet: 'foundation'
  authoringMode: 'initial' | 'parallel-draft'; foundationDocumentPath: FoundationDocumentPath
  availableUpstreamPaths?: FoundationDocumentPath[]; completeDocumentContract?: unknown
  systemDeliveryContract?: unknown; authoringDeliveryContract?: unknown
  previousDocumentMetadata?: Record<string, unknown>; changeRequest?: unknown; priorFailureReason?: string
}
export type WorkerDispatchRequest = {
  runId: string; dispatchId?: string; ownerId: string; projectId: string; workspacePath: string
  workerType: 'document-author'; phase: 'DOCUMENT_DRAFTING'; taskId?: string; revision: string
  allowedPaths?: string[]; contract: AuthoringContract
}
export type AuthorTerminalResult = { workerType: 'document-author'; status: 'completed' | 'failed'; writtenPaths: string[]; resolvedFindingIds?: string[] }
export type FoundationAuthoringContext = {
  runId: string; ownerId: string; projectId: string; confirmedBriefDigest: string; confirmedBriefContext: string
  phase: AuthoringPhase; documentStep: 'FOUNDATION_DRAFTING' | 'FOUNDATION_REVIEW'; status: WorkflowStatus
  foundationDraftState: FoundationDraftState; activeDispatch?: DispatchRecord; changeRequest?: unknown
  currentItemId?: string; blockedReason?: string; updatedAt: string
  revision: { document: string; workspace: string }
}
export const CANONICAL_ASSET_MANIFEST = 'assets/asset-manifest.json' as const
export const CURRENT_ASSET_MANIFEST_VERSION = 8 as const
