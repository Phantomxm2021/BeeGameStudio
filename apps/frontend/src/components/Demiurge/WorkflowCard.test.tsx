import { describe, expect, it } from 'vitest';
import { WorkflowCard } from './WorkflowCard';

describe('WorkflowCard', () => {
  it('renders only the canonical thinking projection', () => {
    const markup = JSON.stringify(WorkflowCard({
      workflow: {
        runId: 'run_1',
        status: 'running',
        currentPhase: 'DOCUMENT_REVIEW',
        worker: 'document-reviewer',
        thinking: '正在检查当前文档版本。',
      },
    }));

    expect(markup).toContain('正在检查当前文档版本。');
    expect(markup).not.toMatch(/verdict|revision|currentMessage/i);
  });

  it('does not render an absent thinking value as raw fallback content', () => {
    const markup = JSON.stringify(WorkflowCard({
      workflow: {
        runId: 'run_2',
        status: 'verifying',
        currentPhase: 'VERIFYING',
      },
    }));

    expect(markup).toContain('VERIFYING');
    expect(markup).not.toMatch(/raw|JSON|message/i);
  });
});
