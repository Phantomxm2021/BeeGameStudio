import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowCard } from './WorkflowCard';

describe('WorkflowCard', () => {
  it('renders the stage, durable message, execution detail and task progress', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_1',
          status: 'running',
          currentPhase: 'DOCUMENT_REVIEW',
          documentStep: 'FOUNDATION_REVIEW',
          worker: 'document-reviewer',
          thinking: '正在检查当前文档版本。',
          executionStatus: 'working',
          currentItemId: 'docs/UI_UX_SPEC.md',
          completedTaskCount: 1,
          totalTaskCount: 2,
          tasks: [
            { id: 'gdd', title: 'docs/GDD.md', status: 'completed' },
            { id: 'ui', title: 'docs/UI_UX_SPEC.md', status: 'running' },
          ],
        }}
      />,
    );

    expect(screen.getByText('基础文档审计')).toBeInTheDocument();
    expect(screen.getByText('正在检查当前文档版本。')).toBeInTheDocument();
    expect(screen.getByText(/Document Reviewer · 正在执行 · UI \/ UX 规格/)).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('游戏设计文档 GDD')).toBeInTheDocument();
    expect(screen.queryByText(/verdict|revision|currentMessage/i)).not.toBeInTheDocument();
  });

  it('shows an accessible failure detail and invokes retry', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_2',
          status: 'blocked',
          currentPhase: 'DOCUMENT_DRAFTING',
          block: { message: '文档整改超过最大自动重试次数。' },
          nextAction: 'retry',
        }}
        onAction={onAction}
      />,
    );

    expect(screen.getByLabelText('查看错误详情')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('文档整改超过最大自动重试次数。');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('retry'));
  });

  it('does not render token usage in the workflow card', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_3',
          status: 'verifying',
          currentPhase: 'ACCEPTANCE',
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            input_tokens: 10,
            cache_read_tokens: 4,
            output_tokens: 5,
          },
        }}
      />,
    );

    expect(screen.getByText('运行验收')).toBeInTheDocument();
    expect(screen.queryByText(/Token 用量/)).not.toBeInTheDocument();
    expect(screen.queryByText(/输入 10/)).not.toBeInTheDocument();
  });
});
