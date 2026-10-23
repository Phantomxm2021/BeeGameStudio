import { describe, expect, it } from 'vitest';
import { buildArtifactViewModel } from './artifactViewModel';

describe('buildArtifactViewModel', () => {
  it('lists only discovered project documents without fixed pending rows', () => {
    const view = buildArtifactViewModel([
      { id: 'review', path: 'docs/review/notes.md', name: 'Review notes.md' },
      { id: 'gdd', path: 'docs/GDD.md', name: 'GDD.md' },
      { id: 'duplicate', path: './docs/GDD.md', name: 'GDD duplicate.md' },
      { id: 'manifest', path: 'assets/asset-manifest.json', name: 'asset-manifest.json' },
    ]);

    expect(view.documents).toEqual([
      { id: 'gdd', path: 'docs/GDD.md', name: 'GDD.md' },
      { id: 'review', path: 'docs/review/notes.md', name: 'Review notes.md' },
    ]);
    expect(view.displayCount).toBe(4);
  });

  it('keeps the project export separate and drops unrelated deliverables', () => {
    const view = buildArtifactViewModel([
      { id: 'package', name: 'game.zip', package_download: true },
      { id: 'asset', path: 'assets/player.png', name: 'player.png' },
      { id: 'document', name: 'acceptance.md' },
    ]);

    expect(view.projectPackage).toMatchObject({ id: 'package', name: 'game.zip' });
    expect(view.documents).toEqual([{ id: 'document', path: 'acceptance.md', name: 'acceptance.md' }]);
  });

  it('does not invent documents when the artifact index is empty', () => {
    expect(buildArtifactViewModel([]).documents).toEqual([]);
  });

  it('keeps different nested paths and case-distinct filenames', () => {
    const view = buildArtifactViewModel([
      { id: 'one', path: 'docs/Readme.md', name: 'Readme.md' },
      { id: 'two', path: 'docs/readme.md', name: 'readme.md' },
      { id: 'three', path: 'docs/review/Readme.md', name: 'Readme.md' },
    ]);
    expect(view.documents.map(document => document.id)).toHaveLength(3);
  });
});
