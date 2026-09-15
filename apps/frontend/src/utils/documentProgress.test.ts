import { describe, expect, it } from 'vitest';

import {
  BEEGAME_DOCUMENT_BASELINE,
  deriveDocumentProgress,
  isCompletedFoundationAuthoringPause,
} from './documentProgress';

describe('documentProgress', () => {
  it('retains completed author artifacts while the document agent owns the active task', () => {
    const workflow = {
      status: 'running', currentPhase: 'DOCUMENT_REVIEW',
      tasks: [{ id: 'foundation-public-stage', title: 'Foundation Reviewer', status: 'running' }],
      foundationDocuments: BEEGAME_DOCUMENT_BASELINE.map(document => ({ path: document.path, status: 'ready' })),
    };
    expect(deriveDocumentProgress([], [], workflow).every(document => document.status === 'ready')).toBe(true);
    expect(isCompletedFoundationAuthoringPause([], workflow)).toBe(false);
    expect(deriveDocumentProgress([], [], { foundationDocuments: [{ path: 'docs/GDD.md', status: 'pending' }] })
      .every(document => document.status === 'pending')).toBe(true);
  });
  it('recognizes a complete public result handoff without matching an English reason', () => {
    const workflow = {
      status: 'blocked', currentPhase: 'DOCUMENT_REVIEW',
      block: { code: 'public_author_handoff', message: '八份文档已完成，等待交接验收。' },
      tasks: BEEGAME_DOCUMENT_BASELINE.map(document => ({ id: document.path, title: document.path, status: 'completed' })),
    };
    expect(isCompletedFoundationAuthoringPause([], workflow)).toBe(true);
    expect(deriveDocumentProgress([], [], workflow).filter(item => item.status === 'ready')).toHaveLength(8);
    expect(isCompletedFoundationAuthoringPause([], { ...workflow, tasks: workflow.tasks.slice(0, 7) })).toBe(false);
    expect(isCompletedFoundationAuthoringPause([], { ...workflow, status: 'failed' })).toBe(false);
    expect(isCompletedFoundationAuthoringPause([], { ...workflow, currentPhase: 'IMPLEMENTATION' })).toBe(false);
  });
  it('derives live baseline state from structured artifact paths and discovered files', () => {
    const progress = deriveDocumentProgress([
      {
        id: 'tool-gdd',
        sender: 'system',
        content: '',
        timestamp: 1,
        type: 'tool',
        artifactPath: '/docs/GDD.md',
        toolStatus: 'completed',
      },
      {
        id: 'tool-art',
        sender: 'system',
        content: '',
        timestamp: 2,
        type: 'tool',
        artifactPath: './docs/ART_DIRECTION.md',
        toolStatus: 'running',
      },
    ], [{ id: 'gdd', path: 'docs/GDD.md', name: 'GDD.md' }]);

    expect(progress).toHaveLength(8);
    expect(progress.map(item => item.path)).toEqual([
      'docs/GDD.md',
      'docs/LEVEL_SCENE_DESIGN.md',
      'docs/BALANCE_DESIGN.md',
      'docs/TECHNICAL_DESIGN.md',
      'docs/ART_DIRECTION.md',
      'docs/UI_UX_SPEC.md',
      'docs/AUDIO_DESIGN.md',
      'docs/ASSET_PLAN.md',
    ]);
    expect(progress.find(item => item.path === 'docs/GDD.md')).toEqual(expect.objectContaining({ status: 'ready' }));
    expect(progress.find(item => item.path === 'docs/ART_DIRECTION.md')).toEqual(expect.objectContaining({ status: 'writing' }));
    expect(progress.find(item => item.path === 'docs/TECHNICAL_DESIGN.md')).toEqual(expect.objectContaining({ status: 'pending' }));
    expect(progress.find(item => item.path === 'docs/acceptance/gameplay-checklist.md')).toBeUndefined();
  });

  it('keeps the latest native file event as the visible state', () => {
    const progress = deriveDocumentProgress([
      {
        id: 'tool-tech', sender: 'system', content: '', timestamp: 1, type: 'tool',
        artifactPath: 'docs/TECHNICAL_DESIGN.md', toolStatus: 'running',
      },
      {
        id: 'tool-tech', sender: 'system', content: '', timestamp: 2, type: 'tool',
        artifactPath: 'docs/TECHNICAL_DESIGN.md', toolStatus: 'failed',
      },
    ], []);

    expect(progress.find(item => item.path === 'docs/TECHNICAL_DESIGN.md')?.status).toBe('failed');
  });

  it('recognizes the explicit complete-authoring pause as ready for review', () => {
    const messages = BEEGAME_DOCUMENT_BASELINE.map((document, index) => ({
      id: `tool-${index}`,
      sender: 'system',
      content: '',
      timestamp: index,
      type: 'tool' as const,
      artifactPath: document.path,
      toolStatus: 'completed' as const,
    }));

    expect(isCompletedFoundationAuthoringPause(messages, {
      status: 'cancelled',
      currentPhase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      block: { detail: 'foundation authoring complete; paused before review' },
    })).toBe(true);
  });

  it('uses durable canonical workflow tasks when transcript artifacts are absent', () => {
    const progress = deriveDocumentProgress([], [], {
      status: 'cancelled',
      currentPhase: 'DOCUMENT_DRAFTING',
      tasks: BEEGAME_DOCUMENT_BASELINE.map(document => ({
        id: document.path,
        title: document.path,
        status: 'completed',
      })),
    });

    expect(progress.every(item => item.status === 'ready')).toBe(true);
    expect(progress).toHaveLength(8);
  });

  it('does not treat an ordinary stopped authoring run as ready for review', () => {
    expect(isCompletedFoundationAuthoringPause([], {
      status: 'cancelled',
      currentPhase: 'DOCUMENT_DRAFTING',
      block: { message: 'Workflow stopped by user.' },
    })).toBe(false);
  });

  it('requires the exact server handoff marker', () => {
    const messages = BEEGAME_DOCUMENT_BASELINE.map((document, index) => ({
      id: `tool-${index}`,
      sender: 'system',
      content: '',
      timestamp: index,
      type: 'tool' as const,
      artifactPath: document.path,
      toolStatus: 'completed' as const,
    }));

    expect(isCompletedFoundationAuthoringPause(messages, {
      status: 'cancelled',
      currentPhase: 'DOCUMENT_DRAFTING',
      block: { detail: 'foundation authoring complete; paused before review (retry)' },
    })).toBe(false);
  });
});
