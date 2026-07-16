import type { ChatDisplayMessage } from '../viewModels/displayModels';

export type DocumentProgressStatus = 'pending' | 'writing' | 'ready' | 'failed';

export interface DocumentProgressItem {
  path: string;
  name: string;
  stage: number;
  status: DocumentProgressStatus;
  artifact?: any;
}

export const BEEGAME_DOCUMENT_BASELINE = [
  { path: 'docs/GDD.md', name: 'GDD', stage: 1 },
  { path: 'docs/ART_DIRECTION.md', name: 'Art Direction', stage: 2 },
  { path: 'docs/UI_UX_SPEC.md', name: 'UI / UX', stage: 2 },
  { path: 'docs/AUDIO_DESIGN.md', name: 'Audio Design', stage: 2 },
  { path: 'docs/TECHNICAL_DESIGN.md', name: 'Technical Design', stage: 3 },
  { path: 'docs/ASSET_PLAN.md', name: 'Asset Plan', stage: 3 },
  { path: 'docs/acceptance/gameplay-checklist.md', name: 'Gameplay Acceptance', stage: 4 },
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

export function deriveDocumentProgress(
  messages: ChatDisplayMessage[],
  artifacts: any[],
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

  return BEEGAME_DOCUMENT_BASELINE.map((document) => {
    const artifact = artifactsByPath.get(document.path);
    return {
      ...document,
      status: statusByPath.get(document.path) || (artifact ? 'ready' : 'pending'),
      artifact,
    };
  });
}
