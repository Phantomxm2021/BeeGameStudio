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
const artifactCategoryCount = 3;
const projectDocumentStage = Math.max(...BEEGAME_DOCUMENT_BASELINE.map(document => document.stage)) + 1;
const assetManifestFileNames = new Set(['asset-manifest.json', 'asset_manifest.json']);

const artifactFileName = (value: unknown): string => {
  const normalized = normalizeDocumentPath(value);
  return normalized.split('/').filter(Boolean).at(-1)?.toLowerCase() || '';
};

const isAssetManifestArtifact = (artifact: ArtifactListItem): boolean => {
  return [artifact.path, artifact.name].some(value => assetManifestFileNames.has(artifactFileName(value)));
};

const isProjectDocumentArtifact = (artifact: ArtifactListItem): boolean => {
  const path = normalizeDocumentPath(artifact.path || artifact.name);
  const lowerPath = path.toLowerCase();
  const fileName = artifactFileName(path);
  return lowerPath.startsWith('docs/') || fileName.endsWith('.md') || fileName.endsWith('.mdx');
};

const canonicalBaselinePathForArtifact = (artifact: ArtifactListItem): string | undefined => {
  const path = normalizeDocumentPath(artifact.path);
  const value = path || normalizeDocumentPath(artifact.name);
  if (!value) return undefined;
  const exact = BEEGAME_DOCUMENT_BASELINE.find(document => document.path === value);
  if (exact) return exact.path;
  if (value.includes('/')) return undefined;
  return BEEGAME_DOCUMENT_BASELINE.find(document => document.path.split('/').at(-1) === value)?.path;
};

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
    if (isAssetManifestArtifact(artifact)) continue;
    const path = normalizeDocumentPath(artifact.path || artifact.name);
    if (path) artifactByPath.set(path, artifact);
    const baselinePath = canonicalBaselinePathForArtifact(artifact);
    if (baselinePath && !artifactByPath.has(baselinePath)) artifactByPath.set(baselinePath, artifact);
  }

  const progressByPath = new Map<string, DocumentProgressItem>();
  for (const item of documentProgress || []) {
    const path = normalizeDocumentPath(item.path);
    if (!BEEGAME_DOCUMENT_BASELINE.some(document => document.path === path)) continue;
    const previous = progressByPath.get(path);
    const artifact = item.artifact && !isAssetManifestArtifact(item.artifact)
      ? item.artifact
      : undefined;
    progressByPath.set(path, {
      ...(previous || {}),
      ...item,
      path,
      artifact: artifact || previous?.artifact,
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
  const visibleArtifacts = artifacts.filter(artifact => !isAssetManifestArtifact(artifact));
  const canonical = canonicalDocuments(visibleArtifacts, documentProgress);
  const baselineArtifactIds = new Set(
    canonical.map(item => item.artifact?.artifact_id || item.artifact?.id).filter(Boolean),
  );
  const baselinePaths = new Set(canonical.map(item => normalizeDocumentPath(item.path)));
  const seenDocumentKeys = new Set<string>();
  const additionalDocuments: DocumentProgressItem[] = [];
  for (const artifact of visibleArtifacts) {
    if (!isProjectDocumentArtifact(artifact)) continue;
    const path = normalizeDocumentPath(artifact.path || artifact.name);
    const key = path || artifactKey(artifact);
    const id = artifact.artifact_id || artifact.id;
    if (!key || (id && baselineArtifactIds.has(id)) || canonicalBaselinePathForArtifact(artifact) || baselinePaths.has(path) || seenDocumentKeys.has(key)) continue;
    seenDocumentKeys.add(key);
    additionalDocuments.push({
      path,
      name: artifact.name || path.split('/').filter(Boolean).at(-1) || path,
      stage: projectDocumentStage,
      status: 'ready',
      artifact,
    });
  }
  const documents = [...canonical, ...additionalDocuments];
  const seenArtifacts = new Set<string>();
  const additionalArtifacts = visibleArtifacts.filter(artifact => {
    if (isEditorEntryArtifact(artifact)) return false;
    if (isProjectDocumentArtifact(artifact)) return false;
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
    displayCount: artifactCategoryCount + additionalArtifacts.length,
  };
}
