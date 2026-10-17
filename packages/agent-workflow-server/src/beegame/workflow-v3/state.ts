import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod/v4'

export const V3_PROTOCOL = 'bgs.workflow.v3' as const
export const CHECK_IDS = ['artifact-json', 'content-schema', 'content-structure', 'content-layout', 'content-resources', 'build', 'rule-tests', 'runtime-smoke', 'delivery-package', 'ui-data-consumption', 'scene-data-consumption', 'pixel-data-consumption', 'font-data-consumption', 'audio-data-consumption'] as const
const key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
const path = z.string().min(1).refine(value => !value.startsWith('/') && !value.includes('\\') &&
  !value.split('/').some(part => !part || part === '..' || part === '.' || part === '.git' || part === '.beegame'), 'Use project-relative paths outside host metadata')
export const projectPathSchema = path
export const uiProbeSchema = z.object({ document: path, nodeId: z.string().trim().min(1), selector: z.string().trim().min(1),
  viewport: z.tuple([z.number().int().min(1).max(8192), z.number().int().min(1).max(8192)]),
  deviceScaleFactor: z.number().finite().positive().optional(),
  steps: z.array(z.object({ click: z.string().trim().min(1) }).strict()).optional(),
}).strict()
export const taskSchema = z.object({
  id: key, kind: z.enum(['game.develop', 'game.verify']), goal: z.string().trim().min(1),
  dependsOn: z.array(key), requirementIds: z.array(key).min(1), inputs: z.array(z.string().min(1)),
  writablePaths: z.array(path), expectedOutputs: z.array(path).min(1), checks: z.array(z.enum(CHECK_IDS)).min(1),
  skills: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*:[a-zA-Z0-9][a-zA-Z0-9._-]*$/)).optional(),
  bindingPlan: path.refine(value => value.endsWith('.json'), 'Binding plan must be a saved JSON file').optional(),
  // A static web build, not an arbitrary URL or executable runtime driver.
  runtimeArtifact: path.optional(),
  editableProject: z.literal(true).optional(),
  // Optional independent DOM root of a fixed logical UI canvas. This selects
  // a measurement coordinate space, not a renderer or Agent technology choice.
  uiProbes: z.array(uiProbeSchema.extend({coordinateRoot:z.string().trim().min(1).optional(),
    // Scenario inputs, never claimed observations of the game's private state.
    bindingValues:z.record(z.string().trim().min(1),z.union([z.boolean(),z.number().finite(),z.string(),z.null()])).optional(),
  })).min(1).optional(),
  sceneProbes: z.array(uiProbeSchema).min(1).optional(),
  pixelProbes: z.array(uiProbeSchema.extend({ componentId: z.string().trim().min(1).optional() })).min(1).optional(),
  audioProbes: z.array(uiProbeSchema.extend({
    componentId: z.string().trim().min(1),
    playSteps: z.array(z.object({ click: z.string().trim().min(1) }).strict()).min(1),
    stopSteps: z.array(z.object({ click: z.string().trim().min(1) }).strict()).min(1),
  })).min(1).optional(),
}).strict()
export type TaskSpec = z.infer<typeof taskSchema>
export type FileVersion = { path: string; sha256: string }
export type PackageComposition = {
  artifact: FileVersion; fileCount: number; totalBytes: number;
  directories: { path: string; fileCount: number; bytes: number }[];
  fileTypes: { extension: string; fileCount: number; bytes: number }[];
  largestFiles: { path: string; bytes: number }[];
  duplicateBytes: number;
  duplicates: { sha256: string; bytesPerFile: number; duplicateBytes: number; paths: string[] }[];
  productionMaterials: {
    status: 'manifest-read' | 'unverified'; reason?: string;
    candidates: { path: string; bytes: number }[] | null;
  };
  limitations: string[];
}
export type UiNodeBindingCoverage = {
  document: string; nodeId: string; role: string;
  bindings: { location: string; assetRef: string; member?: string; atlasMember?: string; frame?: string }[];
  resolution: 'not-declared' | 'resolved' | 'invalid' | 'unverified'; issues: string[];
}
export type SceneNodeBindingCoverage = {
  document: string; nodeId: string; parentId?: string; dimension: '2d' | '3d';
  components: { id: string; type: string; bindings: UiNodeBindingCoverage['bindings'] }[];
  behaviors: unknown; bindings: UiNodeBindingCoverage['bindings'];
}
export type CheckResult = { id: string; version: string; status: 'passed' | 'failed' | 'unverified' | 'execution-error';
  inputs: FileVersion[]; observation: string; createdAt: string; artifacts?: FileVersion[];
  coverage?: { files: string[]; limitations: string[]; uiNodeBindings?: UiNodeBindingCoverage[];
    uiSurfaceCompatibility?: ({ document: string } & Pick<ReturnType<typeof import('../../../../scene-editor/src/production-surface').inspectProductionUiSupport>, 'supported' | 'issues' | 'projectSemantics'>)[];
    sceneNodeBindings?: SceneNodeBindingCoverage[];
    assetContract?: import('../asset-contract-audit').AssetContractAudit }; projectBuild?: {
    version: 'v3-editable-build.1'; files: FileVersion[]; excludedReports: string[];
    artifact: FileVersion; dependencySha256?: string; runtime: string; packageComposition?: PackageComposition;
  } }
export type SkillUse = { name: string; toolUseID: string; eventId: number; parentToolUseID?: string; status: 'loaded' | 'failed' | 'unverified' }
export type Run = {
  protocol: typeof V3_PROTOCOL; id: string; projectId: string; ownerId: string; workspacePath: string; chatSessionId: string;
  // Identifies runs that receive the two-board visual contract; the historical
  // name does not imply a pause or user-approval milestone.
  visualHandoffVersion?: 1;
  // Host-observed blank-project intake, not a phase or model-authored plan.
  // Absent on existing/imported runs; never infer it from missing content later.
  creation?: { initialDelivery: 'playable-slice' | 'design-led-first-version'; editableContent: boolean; webStarter?: 'react-canvas-2d-v1'; webBoot?: 'react-web-storage-v1' };
  // Actual host-installed startup bytes, pinned once; system upgrades and
  // follow-ups cannot silently rewrite a project's working runtime.
  webBoot?: { version: 'react-web-storage-v1'; files: FileVersion[] };
  version: number; requestKey: string; status: 'planning' | 'running' | 'blocked' | 'completed';
  requirements: { revision: string; text: string; constraints: Record<string, unknown>; ids: string[]; sha256: string };
  // Retained as an optimistic revision for authorized requirement changes and
  // source edits; it no longer implies a host-authored Task plan.
  planRevision: number;
  // Captured by the existing implementation handoff, not model approval or a
  // new workflow phase. A normal follow-up cannot replace this authority.
  designBaseline?: { revision: string; digestVersion: 1 | 2; capturedAt: string; attemptId: string;
    requirementsRevision: string; protectedFiles: FileVersion[]; supportingFiles: Record<string, string>; registryRevision?: string; sourceEditId?: string };
  writer?: { attemptId: string; fence: number; workerId: string }; fence: number;
  // Native goal turns, not host-created Task specifications or release checks.
  agentTurns?: AgentTurn[];
  // User-authorized host saves; these are neither native turns nor Task plans.
  sourceEdits?: SourceEdit[];
  // Automatic quality acceptance remains false. Explicit user publication of
  // measured bytes is a separate authorized operation, not a quality verdict.
  deliveryEligible: false; createdAt: string;
  // Durable user intent; neither settlement, replanning nor restart clears it.
  paused?: { at: string };
  blockedReason?: string;
  requirementChanges?: Array<{ requestKey: string; actorId: string; at: string; before: Run['requirements']; after: Run['requirements'] }>;
}
export class WorkflowError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 | 503 = 409) { super(message) }
}
export type DesignFileChanges = {
  scope: 'design-revision-files'; attemptId: string; requestKey: string;
  status: 'observed' | 'unverified'; files: Array<{ path: string; change: 'added' | 'modified' | 'deleted' }>;
  error?: string;
}
export type AgentTurn = {
  attemptId: string; requestKey: string; sessionId: string; workerId: string; fence: number;
  status: 'running' | 'ended' | 'failed' | 'interrupted'; startedAt: string; finishedAt?: string;
  turnId?: string; nativeSessionId?: string; usage?: unknown; skillUses?: SkillUse[];
  quiescedAt?: string; error?: string;
  designFileChanges?: DesignFileChanges;
  // Original host observed no native submission. Not inferred from missing
  // history/UUID or an error string; permits a separately authorized new work.
  notStarted?: true;
  // Original user request, not a host-authored execution/repair plan.
  message?: AgentMessage;
  requirementsRevision?: string;
  // Optional host-observed source-copy build/smoke facts, never a quality verdict.
  measurements?: AgentMeasurement[];
}
export type AgentMeasurement = {
  id: string; requestKey: string; runtimeArtifact: string; reportPaths: string[];
  requirementsRevision: string; startedAt: string; finishedAt?: string;
  sourceEditId?: string;
  reports: FileVersion[]; checks: CheckResult[]; error?: string;
  // Explicit optional reuse of existing static-Web drivers, not a Task plan.
  consumption?: Pick<TaskSpec, 'uiProbes'|'sceneProbes'|'pixelProbes'|'audioProbes'> & {
    checks: Array<'ui-data-consumption'|'scene-data-consumption'|'pixel-data-consumption'|'font-data-consumption'|'audio-data-consumption'>;
  };
}
export type SourceEdit = {
  attemptId: string; fence: number; workerId: string; sessionId: string; requestKey: string;
  startedAt: string; finishedAt?: string; quiescedAt?: string; error?: string;
  status: 'running' | 'blocked' | 'failed';
  sourceEdit: { path: string; before: string; after: string; archive: string; status: 'reserved' | 'saved' | 'failed' };
  requirementsRevision: string; requestHash: string;
}
export type AgentMessage = {
  requestKey: string; runId: string; chatSessionId: string; expectedVersion: number;
  requirementsRevision: string; intent: 'message' | 'discuss' | 'work' | 'change' | 'continue'; text: string;
  attachmentDigests?: Array<{ filename: string; mediaType: string; sha256: string }>;
  continuationOf?: string;
  contextMode?: 'resume' | 'focused';
}
export function pauseRun(run: Run): Run {
  if (run.paused) return run
  const next = structuredClone(run); next.version++; next.paused = { at: new Date().toISOString() }
  next.status = 'blocked'; next.blockedReason = 'User paused this Run. Partial work is not accepted and no new Agent turn may start until explicit resume.'
  return next
}
export function resumeRun(run: Run): Run {
  if (run.writer) throw new WorkflowError('writer-unresolved', 'Confirm the previous writer stopped before resuming; resume cannot release an unknown writer')
  if (!run.paused) return run
  const next = structuredClone(run); next.version++; delete next.paused
  next.status = 'blocked'
  next.blockedReason = 'Resumed without retrying failed or incomplete work. Send an explicit Agent message to continue.'
  return next
}
export function digest(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex') }
/** Preserve the first assignment across explicit interrupted continuations.
 * A new user work/change/message is its own scope, not a new workflow phase. */
export function isInitialSliceTurn(run: Run, turn: AgentTurn): boolean {
  if (run.creation?.initialDelivery !== 'playable-slice') return false
  if (!turn.message) return true
  const index = run.agentTurns?.findIndex(candidate => candidate.attemptId === turn.attemptId) ?? -1
  return turn.message.intent === 'continue' && index > 0 &&
    run.agentTurns!.slice(0,index).every(candidate => !candidate.message || candidate.message.intent === 'continue')
}
export function createRun(input: { projectId: string; ownerId: string; workspacePath: string; chatSessionId: string;
  requestKey: string; text: string; constraints: Record<string, unknown>; ids: string[] }): Run {
  if (!input.text.trim() || !input.requestKey || !input.ids.length || new Set(input.ids).size !== input.ids.length)
    throw new WorkflowError('invalid-requirements', 'Original requirements, request key and unique requirement IDs are required', 400)
  for (const id of input.ids) key.parse(id)
  return { protocol: V3_PROTOCOL, id: randomUUID(), projectId: input.projectId, ownerId: input.ownerId,
    visualHandoffVersion: 1,
    workspacePath: input.workspacePath, chatSessionId: input.chatSessionId, version: 1, requestKey: input.requestKey,
    requirements: { revision: randomUUID(), text: input.text, constraints: structuredClone(input.constraints), ids: [...input.ids],
      sha256: digest(JSON.stringify({ text: input.text, constraints: input.constraints, ids: input.ids })) },
    planRevision: 0, agentTurns: [], fence: 0, status: 'planning', deliveryEligible: false,
    createdAt: new Date().toISOString() }
}
