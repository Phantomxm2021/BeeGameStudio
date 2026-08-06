import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowCard } from './WorkflowCard';

const toast = vi.hoisted(() => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('../../contexts/ToastContext', () => ({
  useToastContext: () => toast,
}));

describe('WorkflowCard', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders a stage deck with navigation and only exposes the latest action', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_deck',
          status: 'blocked',
          currentPhase: 'IMPLEMENTATION',
          stageSnapshots: [
            {
              stageId: 'DOCUMENT_REVIEW',
              status: 'completed',
              currentPhase: 'DOCUMENT_REVIEW',
              phaseIndex: 1,
              phaseCount: 2,
              thinking: '历史阶段消息',
              block: { message: '历史阶段错误' },
            },
            {
              stageId: 'IMPLEMENTATION',
              status: 'blocked',
              currentPhase: 'IMPLEMENTATION',
              phaseIndex: 2,
              phaseCount: 2,
              thinking: '当前阶段消息',
            },
          ],
          nextAction: 'retry',
        }}
        onAction={onAction}
      />,
    );

    const front = screen.getByTestId('workflow-card-front');
    const frontCard = within(front).getByTestId('beegame-workflow-card-run_deck');
    expect(within(front).getByTestId('workflow-card-controls')).toBeInTheDocument();
    expect(within(front).getByTestId('workflow-card-controls')).toHaveClass('absolute', 'bottom-4', 'right-4');
    expect(frontCard).toHaveClass('relative');
    expect(within(front).getByTestId('workflow-card-deck-counter')).toHaveTextContent('2 / 2');
    expect(screen.getAllByTestId('workflow-card-deck-counter')).toHaveLength(1);
    expect(frontCard).toHaveAttribute('data-opaque-surface', 'true');
    expect(screen.getByText('当前阶段消息')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看上一阶段' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '查看下一阶段' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看上一阶段' }));
    expect(screen.getByTestId('workflow-card-deck-counter')).toHaveTextContent('1 / 2');
    expect(screen.getByText('历史阶段消息')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看下一阶段' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '查看上一阶段' })).toBeDisabled();

    const deck = screen.getByTestId('beegame-workflow-card-deck-run_deck');
    deck.focus();
    fireEvent.keyDown(deck, { key: 'ArrowRight' });
    expect(screen.getByTestId('workflow-card-deck-counter')).toHaveTextContent('2 / 2');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重试' }));
    });
    expect(onAction).toHaveBeenCalledWith('retry');
  });

  it('adapts a legacy payload to one stage without inventing deck history', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'legacy_card',
          status: 'completed',
          currentPhase: 'DELIVERY',
          thinking: '单卡内容',
        }}
      />,
    );

    expect(screen.getByText('单卡内容')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看上一阶段' })).not.toBeInTheDocument();
    expect(screen.queryByText(/1 \/ 1/)).not.toBeInTheDocument();
  });

  it('renders the stage, durable message, execution detail and task progress', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_1',
          status: 'running',
          currentPhase: 'DOCUMENT_REVIEW',
          phaseIndex: 3,
          phaseCount: 9,
          substage: 'INITIAL_REVIEW',
          documentStep: 'FOUNDATION_REVIEW',
          worker: 'document-reviewer',
          thinking: '正在检查当前文档版本。',
          executionStatus: 'working',
          currentItemId: 'docs/UI_UX_SPEC.md',
          completedTaskCount: 1,
          totalTaskCount: 3,
          tasks: [
            { id: 'gdd', title: 'docs/GDD.md', status: 'completed', operation: 'review' },
            { id: 'ui', title: 'docs/UI_UX_SPEC.md', status: 'running', operation: 'review' },
            { id: 'audio', title: 'docs/AUDIO_DESIGN.md', status: 'pending', operation: 'review' },
          ],
        }}
      />,
    );

    expect(screen.getByText('基础文档初审')).toBeInTheDocument();
    expect(screen.getByLabelText('工作流状态：执行中')).toHaveAttribute('data-icon', 'grip');
    expect(screen.getByLabelText('工作流状态：执行中')).toHaveAttribute('data-animation', 'loop');
    expect(screen.getByText('正在检查当前文档版本。')).toBeInTheDocument();
    expect(screen.getByText(/Document Reviewer · 正在执行 · UI \/ UX 规格/)).toBeInTheDocument();
    expect(screen.getByText('3 / 9')).toBeInTheDocument();
    expect(screen.getByText('任务 1 / 3')).toBeInTheDocument();
    expect(screen.getByText('审计：游戏设计文档 GDD')).toBeInTheDocument();
    expect(screen.getByLabelText('任务状态：已审计')).toHaveAttribute('data-task-icon', 'review-completed');
    expect(screen.getByLabelText('任务状态：审计中')).toHaveAttribute('data-task-icon', 'review-running');
    expect(screen.getByLabelText('任务状态：待审计')).toHaveAttribute('data-task-icon', 'review-pending');
    expect(screen.getByText('审计中')).toBeInTheDocument();
    expect(screen.getByText('待审计')).toBeInTheDocument();
    expect(screen.getByRole('list')).not.toHaveClass('border-l');
    expect(screen.queryByText(/verdict|revision|currentMessage/i)).not.toBeInTheDocument();
  });

  it('renders a manually stopped task as stopped instead of failed', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_stopped',
          status: 'cancelled',
          currentPhase: 'DOCUMENT_DRAFTING',
          documentStep: 'FOUNDATION_DRAFTING',
          tasks: [
            {
              id: 'audio',
              title: 'docs/AUDIO_DESIGN.md',
              status: 'stopped',
              operation: 'write',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('已停止')).toBeInTheDocument();
    expect(screen.getByLabelText('任务状态：已停止')).toHaveAttribute('data-task-icon', 'task-stopped');
    expect(screen.queryByText('编写失败')).not.toBeInTheDocument();
  });

  it('renders Closure Review and repair ownership from durable review state', () => {
    const { rerender } = render(
      <WorkflowCard
        workflow={{
          runId: 'run_closure',
          status: 'running',
          currentPhase: 'DOCUMENT_REVIEW',
          documentStep: 'FOUNDATION_REVIEW',
          reviewMode: 'closure',
          reviewTarget: 'foundation',
          phaseIndex: 4,
          phaseCount: 11,
          substage: 'CLOSURE_REVIEW',
          convergencePass: 2,
          tasks: [
            {
              id: 'brief_alignment',
              title: 'brief_alignment',
              status: 'running',
              operation: 'review',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('基础文档收敛')).toBeInTheDocument();
    expect(screen.getByText('第 2 轮 · Closure Review')).toBeInTheDocument();
    expect(screen.getByText('审计：简报一致性')).toBeInTheDocument();

    rerender(
      <WorkflowCard
        workflow={{
          runId: 'run_repair',
          status: 'running',
          currentPhase: 'DOCUMENT_DRAFTING',
          documentStep: 'FOUNDATION_DRAFTING',
          reviewMode: 'initial',
          reviewTarget: 'foundation',
          phaseIndex: 4,
          phaseCount: 11,
          substage: 'REPAIR_PLANNING',
          convergencePass: 1,
        }}
      />,
    );
    expect(screen.getByText('基础文档收敛')).toBeInTheDocument();
    expect(screen.getByText('第 1 轮 · 制定修订方案')).toBeInTheDocument();
  });

  it('renders fixed game-design review tasks as user-facing labels', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_design_review',
          status: 'running',
          currentPhase: 'DOCUMENT_REVIEW',
          tasks: [
            { id: 'strategy', title: 'gameplay_strategy_viability', status: 'completed', operation: 'review' },
            { id: 'economy', title: 'economy_progression_integrity', status: 'completed', operation: 'review' },
            { id: 'numeric', title: 'numeric_balance_feasibility', status: 'running', operation: 'review' },
            { id: 'pacing', title: 'pacing_difficulty_coherence', status: 'pending', operation: 'review' },
            { id: 'level-scene', title: 'level_scene_design_integrity', status: 'pending', operation: 'review' },
          ],
        }}
      />,
    );

    expect(screen.getByText('审计：策略可行性')).toBeInTheDocument();
    expect(screen.getByText('审计：经济与成长闭环')).toBeInTheDocument();
    expect(screen.getByText('审计：数值可行性')).toBeInTheDocument();
    expect(screen.getByText('审计：节奏与难度一致性')).toBeInTheDocument();
    expect(screen.getByText('审计：关卡与场景完整性')).toBeInTheDocument();
  });

  it('renders the balance and level-scene foundation documents', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_eight_documents',
          status: 'running',
          currentPhase: 'DOCUMENT_DRAFTING',
          tasks: [
            { id: 'balance', title: 'docs/BALANCE_DESIGN.md', status: 'completed', operation: 'write' },
            { id: 'level-scene', title: 'docs/LEVEL_SCENE_DESIGN.md', status: 'running', operation: 'write' },
          ],
        }}
      />,
    );

    expect(screen.getByText('数值与平衡设计')).toBeInTheDocument();
    expect(screen.getByText('关卡与场景设计')).toBeInTheDocument();
  });

  it('shows a red failure control, copies the error detail and invokes retry', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
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

    const failureControl = screen.getByRole('button', { name: '复制错误信息' });
    expect(failureControl).toHaveClass('text-rose-400');
    expect(screen.getByRole('tooltip')).toHaveTextContent('文档整改超过最大自动重试次数。');
    fireEvent.click(failureControl);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('文档整改超过最大自动重试次数。'));
    expect(toast.showSuccess).toHaveBeenCalledWith('错误信息已复制');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith('retry'));
  });

  it('shows a recoverable workflow at its proven unit and continues once without internal diagnostics', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_recovery',
          status: 'blocked',
          recoverable: true,
          lastProvenPhase: 'DOCUMENT_REVIEW',
          lastProvenUnitId: 'review:resource_semantic_fitness',
          lastProvenUnitKind: 'review-check',
          lastProvenItemId: 'resource_semantic_fitness',
          thinking: '{"issues":[{"code":"invalid_type"}]}',
          block: { message: 'ZodError: internal diagnostic payload' },
          nextAction: 'resume',
        }}
        onAction={onAction}
      />,
    );

    expect(screen.getByText('工作流需要恢复')).toBeInTheDocument();
    expect(screen.getByText(/资源语义适配/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续' })).toBeEnabled();
    expect(screen.queryByText(/invalid_type|ZodError|internal diagnostic payload/)).not.toBeInTheDocument();
    expect(screen.queryByText('review:resource_semantic_fitness')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    expect(onAction).toHaveBeenCalledWith('resume');
  });

  it('does not render an unknown recovery unit ID', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_unknown_recovery_unit',
          status: 'blocked',
          recoverable: true,
          lastProvenPhase: 'DOCUMENT_REVIEW',
          lastProvenUnitId: 'retired:unknown-unit',
          nextAction: 'resume',
        }}
      />,
    );

    expect(screen.getByText('工作流需要恢复')).toBeInTheDocument();
    expect(screen.queryByText('retired:unknown-unit')).not.toBeInTheDocument();
  });

  it.each([
    ['document', 'docs/GDD.md', '游戏设计文档 GDD'],
    ['review-check', 'resource_semantic_fitness', '资源语义适配'],
    ['checklist', undefined, 'Gameplay Checklist'],
    ['resource-inventory', undefined, '资源清单'],
    ['resource-content', undefined, '资源内容'],
    ['resource-gate', undefined, '资源准入审计'],
    ['atomic-plan', undefined, '原子任务规划'],
    ['implementation-task', undefined, '实现任务'],
    ['implementation-audit', undefined, '实现审计'],
    ['acceptance', undefined, '运行验收'],
  ] as const)('renders the safe title for a %s canonical recovery unit', (kind, itemId, title) => {
    render(
      <WorkflowCard
        workflow={{
          runId: `run_recovery_${kind}`,
          status: 'blocked',
          recoverable: true,
          lastProvenPhase: 'IMPLEMENTATION',
          lastProvenUnitId: 'internal-unit-id-must-not-render',
          lastProvenUnitKind: kind,
          lastProvenItemId: itemId,
          nextAction: 'resume',
        }}
      />,
    );

    expect(screen.getByText(new RegExp(title))).toBeInTheDocument();
    expect(screen.queryByText('internal-unit-id-must-not-render')).not.toBeInTheDocument();
  });

  it('falls back to a DOM copy operation when the Clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_copy_fallback',
          status: 'failed',
          currentPhase: 'IMPLEMENTATION',
          block: { message: '完整错误信息' },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '复制错误信息' }));

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    expect(toast.showSuccess).toHaveBeenCalledWith('错误信息已复制');
  });

  it('keeps message and long task lists in separate scroll regions', () => {
    const tasks = Array.from({ length: 13 }, (_, index) => ({
      id: `task-${index + 1}`,
      title: `任务 ${index + 1}`,
      status: 'pending' as const,
    }));
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_many_tasks',
          status: 'running',
          currentPhase: 'IMPLEMENTATION',
          thinking: '正在处理任务列表。',
          tasks,
        }}
      />,
    );

    const messageRegion = screen.getByTestId('workflow-card-message-region');
    const taskRegion = screen.getByTestId('workflow-card-task-region');
    expect(messageRegion).toHaveClass('scrollbar-premium', 'max-h-20', 'overflow-y-auto');
    expect(messageRegion).not.toHaveClass('scroll-fade');
    expect(taskRegion).toHaveClass(
      'scroll-fade',
      'scroll-fade-y',
      'scroll-fade-6',
      'scrollbar-premium',
      'max-h-[17.5rem]',
      'overflow-y-auto',
    );
    expect(screen.getByText('正在处理任务列表。')).toHaveClass('text-xs');
    expect(screen.getByText('任务 13')).toBeInTheDocument();
  });

  it('does not make a task list of twelve items scroll', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_twelve_tasks',
          status: 'running',
          currentPhase: 'IMPLEMENTATION',
          tasks: Array.from({ length: 12 }, (_, index) => ({
            id: `task-${index + 1}`,
            title: `任务 ${index + 1}`,
            status: 'pending' as const,
          })),
        }}
      />,
    );

    expect(screen.getByTestId('workflow-card-task-region')).not.toHaveClass('scroll-fade', 'overflow-y-auto');
  });

  it('only shows the message fade while its content actually overflows', async () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_long_message',
          status: 'running',
          currentPhase: 'IMPLEMENTATION',
          thinking: '一段需要滚动查看的长消息。',
        }}
      />,
    );
    const messageRegion = screen.getByTestId('workflow-card-message-region');
    Object.defineProperties(messageRegion, {
      clientHeight: { configurable: true, value: 80 },
      scrollHeight: { configurable: true, value: 160 },
    });

    fireEvent(window, new Event('resize'));

    await waitFor(() => expect(messageRegion).toHaveClass('scroll-fade'));
  });

  it('renders the workflow message as compact markdown', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_markdown_message',
          status: 'running',
          currentPhase: 'IMPLEMENTATION',
          thinking: '**正在执行**\n\n- 子任务 A\n- 子任务 B',
        }}
      />,
    );

    const messageRegion = screen.getByTestId('workflow-card-message-region');
    expect(screen.getByText('正在执行').tagName).toBe('STRONG');
    expect(screen.getByText('子任务 A').closest('ul')).toBeInTheDocument();
    expect(messageRegion.querySelector('p')).toHaveClass('text-xs');
    expect(messageRegion).not.toHaveTextContent('**正在执行**');
  });

  it('does not present a user pause as an error', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_paused',
          status: 'cancelled',
          currentPhase: 'DOCUMENT_REVIEW',
          block: { message: 'user stopped workflow' },
          nextAction: 'resume',
        }}
      />,
    );

    expect(screen.getByText('已暂停')).toBeInTheDocument();
    expect(screen.getByLabelText('工作流状态：已暂停')).toHaveAttribute('data-icon', 'pause');
    expect(screen.queryByLabelText('复制错误信息')).not.toBeInTheDocument();
  });

  it.each([
    ['draft', '准备中', 'hourglass'],
    ['running', '执行中', 'grip'],
    ['blocked', '需要处理', 'badge-alert'],
    ['verifying', '验证中', 'scan-text'],
    ['completed', '已完成', 'circle-check'],
    ['failed', '失败', 'x'],
    ['cancelled', '已暂停', 'pause'],
    ['stale', '已过期', 'clock'],
  ] as const)('uses the %s workflow status icon', (status, label, icon) => {
    render(
      <WorkflowCard
        workflow={{
          runId: `run_status_${status}`,
          status,
          currentPhase: 'IMPLEMENTATION',
        }}
      />,
    );

    expect(screen.getByLabelText(`工作流状态：${label}`)).toHaveAttribute('data-icon', icon);
    expect(screen.getByLabelText(`工作流状态：${label}`)).toHaveAttribute(
      'data-animation',
      status === 'running' ? 'loop' : 'once',
    );
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
    expect(card).toHaveClass('w-full', 'max-w-[46rem]', 'border-white/15', 'bg-[#17181d]');
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

  it('resumes from accumulated active time without counting the paused interval', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:10:00.000Z'));
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_resumed',
          status: 'running',
          currentPhase: 'RESOURCE_PREPARATION',
          createdAt: '2026-07-28T00:00:00.000Z',
          elapsedMs: 60_000,
          activeSince: '2026-07-28T00:10:00.000Z',
        }}
      />,
    );

    expect(screen.getByText('00:01:00')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText('00:01:02')).toBeInTheDocument();
  });

  it('moves one stage per horizontal pointer drag while preserving the selected stage identity', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_pointer_drag',
          status: 'completed',
          currentPhase: 'THREE',
          stageSnapshots: [
            { stageId: 'ONE', status: 'completed', currentPhase: 'ONE', phaseIndex: 1, phaseCount: 3 },
            { stageId: 'TWO', status: 'completed', currentPhase: 'TWO', phaseIndex: 2, phaseCount: 3 },
            { stageId: 'THREE', status: 'completed', currentPhase: 'THREE', phaseIndex: 3, phaseCount: 3 },
          ],
        }}
      />,
    );
    const front = screen.getByTestId('workflow-card-front');

    fireEvent.pointerDown(front, { pointerId: 1, clientX: 80, clientY: 40, button: 0 });
    fireEvent.pointerMove(front, { pointerId: 1, clientX: 180, clientY: 42 });
    fireEvent.pointerUp(front, { pointerId: 1, clientX: 180, clientY: 42 });
    expect(front).toHaveAttribute('data-stage-id', 'TWO');

    fireEvent.pointerDown(front, { pointerId: 2, clientX: 180, clientY: 40, button: 0 });
    fireEvent.pointerMove(front, { pointerId: 2, clientX: 70, clientY: 42 });
    fireEvent.pointerUp(front, { pointerId: 2, clientX: 70, clientY: 42 });
    expect(front).toHaveAttribute('data-stage-id', 'THREE');
  });

  it('does not drag from nested controls or links', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_pointer_targets',
          status: 'blocked',
          currentPhase: 'TWO',
          stageSnapshots: [
            { stageId: 'ONE', status: 'completed', currentPhase: 'ONE', phaseIndex: 1, phaseCount: 2 },
            {
              stageId: 'TWO',
              status: 'blocked',
              currentPhase: 'TWO',
              phaseIndex: 2,
              phaseCount: 2,
              thinking: '[阶段链接](https://example.com)',
            },
          ],
          nextAction: 'retry',
        }}
        onAction={vi.fn()}
      />,
    );
    const front = screen.getByTestId('workflow-card-front');
    const action = screen.getByRole('button', { name: '重试' });
    const link = screen.getByRole('link', { name: '阶段链接' });

    for (const [target, pointerId] of [
      [action, 1],
      [link, 2],
    ] as const) {
      fireEvent.pointerDown(target, { pointerId, clientX: 80, clientY: 40, button: 0 });
      fireEvent.pointerMove(target, { pointerId, clientX: 220, clientY: 42 });
      fireEvent.pointerUp(target, { pointerId, clientX: 220, clientY: 42 });
    }
    expect(front).toHaveAttribute('data-stage-id', 'TWO');
  });

  it('renders no more than two inert stepped back layers with a stable footprint', () => {
    render(
      <WorkflowCard
        workflow={{
          runId: 'run_stepped_stack',
          status: 'completed',
          currentPhase: 'FOUR',
          stageSnapshots: [
            { stageId: 'ONE', status: 'completed', currentPhase: 'ONE', phaseIndex: 1, phaseCount: 4 },
            { stageId: 'TWO', status: 'completed', currentPhase: 'TWO', phaseIndex: 2, phaseCount: 4 },
            { stageId: 'THREE', status: 'completed', currentPhase: 'THREE', phaseIndex: 3, phaseCount: 4 },
            { stageId: 'FOUR', status: 'completed', currentPhase: 'FOUR', phaseIndex: 4, phaseCount: 4 },
          ],
        }}
      />,
    );
    const deck = screen.getByTestId('workflow-card-deck');
    const front = screen.getByTestId('workflow-card-front');
    const layers = screen.getAllByTestId(/workflow-card-stack-layer-/);
    expect(deck).toHaveAttribute('aria-label', '工作流阶段卡片组');
    expect(deck.parentElement).toHaveClass('pr-6', 'pb-6');
    expect(deck).toHaveClass('w-full');
    expect(front).toHaveStyle({ width: 'calc(100% + 1.5rem)' });
    expect(front).toHaveAttribute('aria-current', 'true');
    expect(layers).toHaveLength(2);
    expect(layers[0]).toHaveClass('pointer-events-none', 'absolute', 'inset-0', 'bg-[#17181d]');
    expect(layers.every(layer => layer.getAttribute('data-opaque-surface') === 'true')).toBe(true);
    expect(layers[0]).toHaveStyle({ transform: 'translate3d(10px, 8px, 0)' });
    expect(layers[1]).toHaveStyle({ transform: 'translate3d(20px, 16px, 0)' });
    expect(layers.every(layer => layer.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('uses a short modest transition when reduced motion is preferred', () => {
    const previousMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    try {
      render(
        <WorkflowCard
          workflow={{
            runId: 'run_reduced_motion',
            status: 'completed',
            currentPhase: 'TWO',
            stageSnapshots: [
              { stageId: 'ONE', status: 'completed', currentPhase: 'ONE', phaseIndex: 1, phaseCount: 2 },
              { stageId: 'TWO', status: 'completed', currentPhase: 'TWO', phaseIndex: 2, phaseCount: 2 },
            ],
          }}
        />,
      );
      const front = screen.getByTestId('workflow-card-front');
      expect(front).toHaveAttribute('data-reduced-motion', 'true');
      const layers = screen.getAllByTestId(/workflow-card-stack-layer-/);
      expect(layers[0]).toHaveStyle({ transform: 'translate3d(4px, 3px, 0)' });
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: previousMatchMedia });
    }
  });
});
