import {
  BEEGAME_DOCUMENT_BASELINE,
  normalizeDocumentPath,
  type DocumentProgressItem,
} from '../../../utils/documentProgress';

export type ArtifactEditorKind = 'scene' | 'ui';

export interface ArtifactListItem {
  artifact_id?: string;
  id?: string;
  name?: string;
  path?: string;
  artifact_type?: string;
  package_download?: boolean;
}

export interface ArtifactViewModel {
  documents: DocumentProgressItem[];
  additionalArtifacts: ArtifactListItem[];
  editorEntries: readonly ArtifactEditorKind[];
  readyDocumentCount: number;
  displayCount: number;
}

const editorEntries: readonly ArtifactEditorKind[] = ['scene', 'ui'];

const artifactKey = (artifact: ArtifactListItem): string => {
  return String(artifact.artifact_id || artifact.id || normalizeDocumentPath(artifact.path || artifact.name) || artifact.name || '').trim();
};

const isEditorEntryArtifact = (artifact: ArtifactListItem): boolean => {
  const value = String(artifact.name || artifact.path || '').trim().replace(/\.[^.]+$/, '').toLowerCase();
  return value === 'scene' || value === 'ui' || value === 'scene editor' || value === 'ui editor';
};

const canonicalDocuments = (
  artifacts: ArtifactListItem[],
  documentProgress?: DocumentProgressItem[],
): DocumentProgressItem[] => {
  const artifactByPath = new Map<string, ArtifactListItem>();
  for (const artifact of artifacts) {
    const path = normalizeDocumentPath(artifact.path || artifact.name);
    if (path) artifactByPath.set(path, artifact);
    const fileName = normalizeDocumentPath(artifact.name);
    const baseline = BEEGAME_DOCUMENT_BASELINE.find(document => document.path.endsWith(`/${fileName}`));
    if (baseline && !artifactByPath.has(baseline.path)) artifactByPath.set(baseline.path, artifact);
  }

  const progressByPath = new Map<string, DocumentProgressItem>();
  for (const item of documentProgress || []) {
    const path = normalizeDocumentPath(item.path);
    if (!BEEGAME_DOCUMENT_BASELINE.some(document => document.path === path)) continue;
    const previous = progressByPath.get(path);
    progressByPath.set(path, {
      ...(previous || {}),
      ...item,
      path,
      artifact: item.artifact || previous?.artifact,
    });
  }

  return BEEGAME_DOCUMENT_BASELINE.map(document => {
    const progress = progressByPath.get(document.path);
    const artifact = progress?.artifact || artifactByPath.get(document.path);
    return {
      ...document,
      ...(progress || {}),
      path: document.path,
      name: document.name,
      stage: document.stage,
      status: progress?.status || (artifact ? 'ready' : 'pending'),
      artifact,
    };
  });
};

export function buildArtifactViewModel(
  artifacts: ArtifactListItem[],
  documentProgress?: DocumentProgressItem[],
): ArtifactViewModel {
  const documents = canonicalDocuments(artifacts, documentProgress);
  const baselineArtifactIds = new Set(
    documents.map(item => item.artifact?.artifact_id || item.artifact?.id).filter(Boolean),
  );
  const baselinePaths = new Set(documents.map(item => normalizeDocumentPath(item.path)));
  const seenArtifacts = new Set<string>();
  const additionalArtifacts = artifacts.filter(artifact => {
    if (isEditorEntryArtifact(artifact)) return false;
    const id = artifact.artifact_id || artifact.id;
    if (id && baselineArtifactIds.has(id)) return false;
    if (baselinePaths.has(normalizeDocumentPath(artifact.path || artifact.name))) return false;
    const key = artifactKey(artifact);
    if (!key || seenArtifacts.has(key)) return false;
    seenArtifacts.add(key);
    return true;
  });

  const readyDocumentCount = documents.filter(item => item.status === 'ready').length;
  return {
    documents,
    additionalArtifacts,
    editorEntries,
    readyDocumentCount,
    displayCount: documents.length + editorEntries.length + additionalArtifacts.length,
  };
}
