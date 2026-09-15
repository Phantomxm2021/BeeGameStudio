import type { ChatDisplayMessage } from '../viewModels/displayModels';

export type DocumentProgressStatus = 'pending' | 'writing' | 'ready' | 'failed';

export interface DocumentProgressItem {
  path: string;
  name: string;
  stage: number;
  status: DocumentProgressStatus;
  artifact?: any;
}

/**
 * The authoring handoff is intentionally a display-only exception to the
 * usual terminal-state mapping.  The server pauses after the complete
 * foundation set and before review; the workflow status is therefore
 * `stopped` (normalized to `cancelled` by the display model), but the user
 * should see a completed document set waiting for acceptance/review.
 */
export interface FoundationAuthoringWorkflowSignal {
  foundationDocuments?: readonly { path?: unknown; status?: unknown }[];
  status?: unknown;
  currentPhase?: unknown;
  documentStep?: unknown;
  tasks?: readonly {
    id?: unknown;
    title?: unknown;
    status?: unknown;
  }[];
  block?: {
    message?: unknown;
    detail?: unknown;
    code?: unknown;
  };
}

export const FOUNDATION_AUTHORING_PAUSE_REASON =
  'foundation authoring complete; paused before review';

export const BEEGAME_DOCUMENT_BASELINE = [
  { path: 'docs/GDD.md', name: 'GDD', stage: 1 },
  { path: 'docs/LEVEL_SCENE_DESIGN.md', name: 'Level / Scene Design', stage: 2 },
  { path: 'docs/BALANCE_DESIGN.md', name: 'Balance Design', stage: 2 },
  { path: 'docs/TECHNICAL_DESIGN.md', name: 'Technical Design', stage: 3 },
  { path: 'docs/ART_DIRECTION.md', name: 'Art Direction', stage: 3 },
  { path: 'docs/UI_UX_SPEC.md', name: 'UI / UX', stage: 3 },
  { path: 'docs/AUDIO_DESIGN.md', name: 'Audio Design', stage: 3 },
  { path: 'docs/ASSET_PLAN.md', name: 'Asset Plan', stage: 3 },
] as const;

export function normalizeDocumentPath(value: unknown): string {
  let normalized = String(value || '').trim().split('\\').join('/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  while (normalized.startsWith('/')) normalized = normalized.slice(1);
  return normalized;
}

export function isBaselineDocumentPath(value: unknown): boolean {
  const path = normalizeDocumentPath(value);
  return BEEGAME_DOCUMENT_BASELINE.some((document) => document.path === path);
}

export function isCompletedFoundationAuthoringPause(
  messages: ChatDisplayMessage[],
  workflow?: FoundationAuthoringWorkflowSignal | null,
): boolean {
  if (!workflow) return false;

  const status = String(workflow.status || '').trim().toLowerCase();
  if (workflow.block?.code === 'public_author_handoff') {
    const phase = String(workflow.currentPhase || '').trim().toUpperCase();
    if (!['needs_action', 'blocked', 'stopped', 'cancelled'].includes(status) ||
      !['DOCUMENT_DRAFTING', 'DOCUMENT_REVIEW'].includes(phase)) return false;
    // A public handoff must carry the complete current result projection.
    // Stale transcript artifacts cannot fill gaps in that result.
    return BEEGAME_DOCUMENT_BASELINE.every(document => workflow.tasks?.some(task =>
      normalizeDocumentPath(task.title ?? task.id) === document.path && task.status === 'completed'));
  }
  if (status !== 'stopped' && status !== 'cancelled') return false;
  if (String(workflow.currentPhase || '').trim().toUpperCase() !== 'DOCUMENT_DRAFTING') {
    return false;
  }

  const hasExplicitPauseReason = [workflow.block?.message, workflow.block?.detail]
    .some(value => String(value || '').trim().toLowerCase() === FOUNDATION_AUTHORING_PAUSE_REASON);
  if (!hasExplicitPauseReason) return false;

  return deriveDocumentProgress(messages, [], workflow).every(item => item.status === 'ready');
}

export function deriveDocumentProgress(
  messages: ChatDisplayMessage[],
  artifacts: any[],
  workflow?: FoundationAuthoringWorkflowSignal | null,
): DocumentProgressItem[] {
  const artifactsByPath = new Map<string, any>();
  for (const artifact of artifacts) {
    const path = normalizeDocumentPath(artifact?.path || artifact?.name);
    if (path) artifactsByPath.set(path, artifact);
    const fileName = normalizeDocumentPath(artifact?.name);
    const baseline = BEEGAME_DOCUMENT_BASELINE.find((document) => document.path.endsWith(`/${fileName}`));
    if (baseline && !artifactsByPath.has(baseline.path)) artifactsByPath.set(baseline.path, artifact);
  }

  const statusByPath = new Map<string, DocumentProgressStatus>();
  for (const message of messages) {
    const path = normalizeDocumentPath(message.artifactPath);
    if (!isBaselineDocumentPath(path)) continue;
    if (message.toolStatus === 'running') statusByPath.set(path, 'writing');
    if (message.toolStatus === 'completed') statusByPath.set(path, 'ready');
    if (message.toolStatus === 'failed') statusByPath.set(path, 'failed');
  }

  // The durable workflow snapshot is available even when a project reload has
  // not restored its transcript yet. Use only canonical document task titles;
  // unrelated workflow tasks must never affect the document counter.
  for (const task of workflow?.tasks || []) {
    const path = normalizeDocumentPath(task.title ?? task.id);
    if (!isBaselineDocumentPath(path)) continue;
    const taskStatus = String(task.status || '').trim().toLowerCase();
    if (taskStatus === 'completed') statusByPath.set(path, 'ready');
    else if (taskStatus === 'running') statusByPath.set(path, 'writing');
    else if (taskStatus === 'failed' || taskStatus === 'blocked') statusByPath.set(path, 'failed');
  }

  // The completed public author result survives switches to review/revision.
  // Do not infer audit acceptance or drive execution from this display field.
  for (const document of workflow?.foundationDocuments || []) {
    const path = normalizeDocumentPath(document.path);
    if (isBaselineDocumentPath(path) && document.status === 'ready') statusByPath.set(path, 'ready');
  }

  return BEEGAME_DOCUMENT_BASELINE.map((document) => {
    const artifact = artifactsByPath.get(document.path);
    return {
      ...document,
      status: statusByPath.get(document.path) || (artifact ? 'ready' : 'pending'),
      artifact,
    };
  });
}
