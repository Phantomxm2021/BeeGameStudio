import { describe, expect, it } from 'vitest';
import { BEEGAME_DOCUMENT_BASELINE } from '../../../utils/documentProgress';
import { buildArtifactViewModel } from './artifactViewModel';

describe('buildArtifactViewModel', () => {
  it('keeps canonical documents first and places project markdown in the document list', () => {
    const view = buildArtifactViewModel([
      { id: 'scene-entry', name: 'Scene' },
      { id: 'other-1', name: 'review.zip', package_download: true },
      { id: 'other-1', name: 'review.zip', package_download: true },
      { id: 'other-2', name: 'acceptance.md' },
    ], BEEGAME_DOCUMENT_BASELINE.map((document, index) => ({
      ...document,
      status: index === 0 ? 'ready' : 'pending',
      artifact: index === 0 ? { id: 'gdd-artifact', name: 'GDD.md' } : undefined,
    })));

    expect(view.documents.map(document => document.name)).toEqual([
      'GDD',
      'Level / Scene Design',
      'Balance Design',
      'Technical Design',
      'Art Direction',
      'UI / UX',
      'Audio Design',
      'Asset Plan',
      'acceptance.md',
    ]);
    expect(view.documents).toHaveLength(9);
    expect(view.documents.at(-1)).toMatchObject({
      name: 'acceptance.md',
      path: 'acceptance.md',
      status: 'ready',
      artifact: { id: 'other-2' },
    });
    expect(view.readyDocumentCount).toBe(2);
    expect(view.additionalArtifacts.map(artifact => artifact.name)).toEqual(['review.zip']);
    expect(view.editorEntries).toEqual(['scene', 'ui']);
    expect(view.displayCount).toBe(4);
  });

  it('removes baseline artifacts and editor duplicates from other deliverables', () => {
    const view = buildArtifactViewModel([
      { id: 'gdd-artifact', path: 'docs/GDD.md', name: 'GDD.md' },
      { id: 'ui-entry', path: 'UI Editor', name: 'UI Editor' },
    ], BEEGAME_DOCUMENT_BASELINE.map(document => ({ ...document, status: 'pending' })));

    expect(view.additionalArtifacts).toEqual([]);
    expect(view.displayCount).toBe(3);
  });

  it('does not append a name-only canonical document a second time', () => {
    const view = buildArtifactViewModel([
      { id: 'gdd-artifact', name: 'GDD.md' },
    ]);

    expect(view.documents).toHaveLength(8);
    expect(view.documents[0]).toMatchObject({
      path: 'docs/GDD.md',
      status: 'ready',
      artifact: { id: 'gdd-artifact' },
    });
  });

  it('keeps a nested document with a canonical basename as an additional document', () => {
    const view = buildArtifactViewModel([
      { id: 'nested-gdd', path: 'docs/review/GDD.md', name: 'GDD.md' },
    ]);

    expect(view.documents).toHaveLength(9);
    expect(view.documents[0].status).toBe('pending');
    expect(view.documents.at(-1)).toMatchObject({
      path: 'docs/review/GDD.md',
      name: 'GDD.md',
      status: 'ready',
      artifact: { id: 'nested-gdd' },
    });
  });

  it('hides canonical and legacy asset manifests while retaining other deliverables', () => {
    const view = buildArtifactViewModel([
      { artifact_id: 'manifest', path: './assets/asset-manifest.json', name: 'asset-manifest.json' },
      { artifact_id: 'legacy-manifest', path: 'assets/asset_manifest.json', name: 'asset_manifest.json' },
      { artifact_id: 'readme', path: './docs/README.md', name: 'README.md' },
      { artifact_id: 'package', name: 'game.zip', package_download: true },
    ]);

    expect(view.documents.map(document => document.path)).toEqual([
      ...BEEGAME_DOCUMENT_BASELINE.map(document => document.path),
      'docs/README.md',
    ]);
    expect(view.documents.some(document => document.path.includes('manifest'))).toBe(false);
    expect(view.documents.at(-1)).toMatchObject({ artifact: { artifact_id: 'readme' }, status: 'ready' });
    expect(view.additionalArtifacts).toEqual([
      expect.objectContaining({ artifact_id: 'package', name: 'game.zip' }),
    ]);
    expect(view.displayCount).toBe(4);
  });

  it('deduplicates additional documents by normalized path', () => {
    const view = buildArtifactViewModel([
      { artifact_id: 'doc-1', path: 'docs/README.md', name: 'README.md' },
      { artifact_id: 'doc-2', path: './docs/README.md', name: 'README.md' },
      { artifact_id: 'package-1', path: 'build/game.zip', name: 'game.zip', package_download: true },
      { artifact_id: 'package-1', path: 'build/game.zip', name: 'game.zip', package_download: true },
    ]);

    expect(view.documents.filter(document => document.path === 'docs/README.md')).toHaveLength(1);
    expect(view.additionalArtifacts).toHaveLength(1);
    expect(view.displayCount).toBe(4);
  });

  it('keeps document paths distinct when only their case differs', () => {
    const view = buildArtifactViewModel([
      { artifact_id: 'doc-1', path: 'docs/Readme.md', name: 'Readme.md' },
      { artifact_id: 'doc-2', path: 'docs/readme.md', name: 'readme.md' },
    ]);

    expect(view.documents.filter(document => document.path.toLowerCase().includes('readme'))).toHaveLength(2);
  });

  it('normalizes partial, unordered and duplicate progress into the canonical eight rows', () => {
    const view = buildArtifactViewModel([], [
      { path: './docs/UI_UX_SPEC.md', name: 'stale UI name', stage: 99, status: 'pending' },
      { path: 'docs/GDD.md', name: 'old GDD name', stage: 9, status: 'writing' },
      { path: 'docs/GDD.md', name: 'GDD.md', stage: 1, status: 'ready', artifact: { id: 'gdd-1' } },
    ]);

    expect(view.documents).toHaveLength(8);
    expect(view.documents.map(document => document.path)).toEqual(BEEGAME_DOCUMENT_BASELINE.map(document => document.path));
    expect(view.documents[0]).toMatchObject({ name: 'GDD', status: 'ready', artifact: { id: 'gdd-1' } });
    expect(view.documents[5]).toMatchObject({ name: 'UI / UX', status: 'pending' });
    expect(view.readyDocumentCount).toBe(1);
  });
});
