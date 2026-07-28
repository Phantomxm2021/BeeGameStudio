import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowCard } from './WorkflowCard';

describe('WorkflowCard', () => {
  afterEach(() => vi.useRealTimers());

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
    expect(screen.getByRole('list')).not.toHaveClass('border-l');
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

  it('keeps the bounded card width and black background while showing only elapsed time', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_4',
          status: 'completed',
          currentPhase: 'DELIVERY',
          createdAt: '2026-07-28T00:00:00.000Z',
          completedAt: '2026-07-28T00:01:05.000Z',
          updatedAt: '2026-07-28T00:02:00.000Z',
        }}
      />,
    );

    const card = screen.getByTestId('beegame-workflow-card-run_4');
    expect(card).toHaveClass('w-full', 'max-w-[46rem]', 'border-white/15', 'bg-white/[0.04]');
    expect(card).not.toHaveClass('border-sky-300/20', 'bg-black/40');
    expect(card).not.toHaveClass('bg-sky-300/[0.055]');
    expect(screen.getByText('00:01:05')).toBeInTheDocument();
    expect(screen.queryByText(/本阶段/)).not.toBeInTheDocument();
  });

  it('freezes elapsed time at the durable update when the workflow fails', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:01:05.000Z'));
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_5',
          status: 'failed',
          currentPhase: 'DOCUMENT_REVIEW',
          createdAt: '2026-07-28T00:00:00.000Z',
          updatedAt: '2026-07-28T00:01:02.000Z',
          stageStartedAt: '2026-07-28T00:01:00.000Z',
        }}
      />,
    );

    expect(screen.getByText('00:01:02')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText('00:01:02')).toBeInTheDocument();
  });

  it.each(['blocked', 'cancelled', 'stale'] as const)('does not keep ticking while %s', status => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:02:00.000Z'));
    render(
      <WorkflowCard
        workflow={{
          runId: `run_${status}`,
          status,
          currentPhase: 'DOCUMENT_REVIEW',
          createdAt: '2026-07-28T00:00:00.000Z',
          updatedAt: '2026-07-28T00:01:00.000Z',
        }}
      />,
    );

    expect(screen.getByText('00:01:00')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText('00:01:00')).toBeInTheDocument();
  });

  it('continues ticking while the workflow is running', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:01:00.000Z'));
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_active',
          status: 'running',
          currentPhase: 'DOCUMENT_REVIEW',
          createdAt: '2026-07-28T00:00:00.000Z',
          updatedAt: '2026-07-28T00:00:55.000Z',
        }}
      />,
    );

    expect(screen.getByText('00:01:00')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText('00:01:02')).toBeInTheDocument();
  });
});
