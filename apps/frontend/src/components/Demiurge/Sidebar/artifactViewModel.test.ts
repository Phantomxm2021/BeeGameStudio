import { describe, expect, it } from 'vitest';
import { BEEGAME_DOCUMENT_BASELINE } from '../../../utils/documentProgress';
import { buildArtifactViewModel } from './artifactViewModel';

describe('buildArtifactViewModel', () => {
  it('keeps the canonical eight document order and counts unique editor/deliverable entries', () => {
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
    ]);
    expect(view.readyDocumentCount).toBe(1);
    expect(view.additionalArtifacts.map(artifact => artifact.name)).toEqual(['review.zip', 'acceptance.md']);
    expect(view.editorEntries).toEqual(['scene', 'ui']);
    expect(view.displayCount).toBe(12);
  });

  it('removes baseline artifacts and editor duplicates from other deliverables', () => {
    const view = buildArtifactViewModel([
      { id: 'gdd-artifact', path: 'docs/GDD.md', name: 'GDD.md' },
      { id: 'ui-entry', path: 'UI Editor', name: 'UI Editor' },
    ], BEEGAME_DOCUMENT_BASELINE.map(document => ({ ...document, status: 'pending' })));

    expect(view.additionalArtifacts).toEqual([]);
    expect(view.displayCount).toBe(10);
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
