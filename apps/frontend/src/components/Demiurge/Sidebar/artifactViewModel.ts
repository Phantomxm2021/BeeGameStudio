export type ArtifactEditorKind = 'scene' | 'ui';

export interface ArtifactListItem {
  artifact_id?: string;
  id?: string;
  name?: string;
  path?: string;
  artifact_type?: string;
  package_download?: boolean;
}

export interface ArtifactDocument {
  id: string;
  name: string;
  path: string;
}

export interface ArtifactViewModel {
  documents: ArtifactDocument[];
  projectPackage?: ArtifactListItem;
  displayCount: number;
}

const assetManifestFileNames = new Set(['asset-manifest.json', 'asset_manifest.json']);

const normalizeDocumentPath = (value: unknown): string => {
  let normalized = String(value || '').trim().split('\\').join('/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  while (normalized.startsWith('/')) normalized = normalized.slice(1);
  return normalized;
};

const artifactFileName = (value: unknown): string =>
  normalizeDocumentPath(value).split('/').filter(Boolean).at(-1) || '';

export const isProjectDocumentPath = (value: unknown): boolean => {
  const path = normalizeDocumentPath(value);
  const lowerPath = path.toLowerCase();
  const fileName = artifactFileName(path).toLowerCase();
  return !assetManifestFileNames.has(fileName)
    && (lowerPath.startsWith('docs/') || fileName.endsWith('.md') || fileName.endsWith('.mdx'));
};

export function buildArtifactViewModel(artifacts: ArtifactListItem[]): ArtifactViewModel {
  const documents: ArtifactDocument[] = [];
  const seenPaths = new Set<string>();
  let projectPackage: ArtifactListItem | undefined;

  for (const artifact of artifacts) {
    if (artifact.package_download) {
      projectPackage ||= artifact;
      continue;
    }
    const path = normalizeDocumentPath(artifact.path || artifact.name);
    const id = String(artifact.artifact_id || artifact.id || '');
    if (!id || !path || !isProjectDocumentPath(path) || seenPaths.has(path)) continue;
    seenPaths.add(path);
    documents.push({ id, name: artifact.name || artifactFileName(path), path });
  }

  return {
    documents: documents.sort((a, b) => a.path.localeCompare(b.path)),
    projectPackage,
    displayCount: 4,
  };
}
