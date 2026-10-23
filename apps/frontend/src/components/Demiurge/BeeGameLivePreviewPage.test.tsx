import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BeeGameLivePreviewPage } from './BeeGameLivePreviewPage';

vi.mock('./Landing/SettingsMenu', () => ({ SettingsMenu: () => null }));
vi.mock('./Landing/CreditStoreModal', () => ({ CreditStoreModal: () => null }));
vi.mock('./Landing/ProjectHistoryModal', () => ({ ProjectHistoryModal: () => null }));
vi.mock('./Landing/ProfileModal', () => ({ ProfileModal: () => null }));
vi.mock('./Landing/AccountActionsMenu', () => ({ AccountActionsMenu: () => null }));
vi.mock('./Landing/DotsAvatar', () => ({ DotsAvatar: ({ mood, label }: { mood: string; label: string }) =>
  <div role="img" aria-label={label} data-mood={mood} /> }));
vi.mock('../beui/motion/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('../Workspace/WorkspaceDeploymentDialog', () => ({ WorkspaceDeploymentDialog: ({ isOpen, onDeploy }: {
  isOpen: boolean; onDeploy: (confirmation: unknown) => void;
}) => isOpen ? <button onClick={() => onDeploy({ measurementId: 'measured', requirementsRevision: 'revision',
  discussionConfirmation: { messageRequestKeys: ['question-1'] } })}>test discussion publish</button> : null }));

const props = {
  projectId: 'project',
  lang: 'zh' as const, projectName: '游戏项目', status: 'idle' as const,
  phaseLabel: '就绪', isSyncing: false, onSetLang: vi.fn(),
};
const live = { status: 'passed', build_url: '/previews/session/game/' };

describe('dashboard header', () => {
  it('retains a rejected Preview reason across idle polls, clears on retry and does not leak to another project', async () => {
    const reason = 'Exportable sources changed: tests/capture.mjs';
    const onStartPreview = vi.fn().mockRejectedValueOnce(new Error(reason)).mockResolvedValue(undefined);
    const { rerender } = render(<BeeGameLivePreviewPage {...props} onStartPreview={onStartPreview} />);
    fireEvent.click(screen.getByRole('button', { name: '播放预览' }));
    await waitFor(() => expect(screen.getByText(reason)).toBeVisible());
    rerender(<BeeGameLivePreviewPage {...props} buildReport={null} onStartPreview={onStartPreview} />);
    expect(screen.getByText(reason)).toBeVisible();
    rerender(<BeeGameLivePreviewPage {...props} projectId="other" onStartPreview={onStartPreview} />);
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
    rerender(<BeeGameLivePreviewPage {...props} onStartPreview={onStartPreview} />);
    fireEvent.click(screen.getByRole('button', { name: '播放预览' }));
    await waitFor(() => expect(onStartPreview).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
  });

  it('does not expose the retired production-review action', () => {
    render(<BeeGameLivePreviewPage {...props} />);
    expect(screen.queryByRole('button', { name: '制作验收' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '播放预览' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '部署' })).toBeInTheDocument();
  });

  it('shows agent activity and standby without calling either preview preparation', () => {
    const { rerender } = render(<BeeGameLivePreviewPage {...props} status="running" isAgentWorking />);
    expect(screen.getByText('Bee Game Studio工作中')).toBeInTheDocument();
    expect(screen.queryByText('正在准备预览')).not.toBeInTheDocument();

    rerender(<BeeGameLivePreviewPage {...props} status="idle" isAgentWorking={false} />);
    expect(screen.getByText('Bee Game Studio正在候命')).toBeInTheDocument();
  });

  it('shows preview preparation only after the preview action is requested', async () => {
    let finish!: () => void;
    const onStartPreview = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<BeeGameLivePreviewPage {...props} onStartPreview={onStartPreview} />);
    fireEvent.click(screen.getByRole('button', { name: '播放预览' }));
    expect(screen.getByText('正在准备预览')).toBeInTheDocument();
    await act(async () => finish());
    expect(screen.getByText('Bee Game Studio正在候命')).toBeInTheDocument();
  });

  it('keeps agent-working text and ghost state when preview is requested during agent work', async () => {
    let finish!: () => void;
    const onStartPreview = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<BeeGameLivePreviewPage {...props} status="running" isAgentWorking onStartPreview={onStartPreview} />);
    expect(screen.getByText('Bee Game Studio工作中')).toBeInTheDocument();
    const avatar = screen.getByRole('img');
    expect(avatar).toHaveAttribute('data-mood', 'thinking');
    fireEvent.click(screen.getByRole('button', { name: '播放预览' }));
    expect(screen.getByText('Bee Game Studio工作中')).toBeInTheDocument();
    expect(screen.queryByText('正在准备预览')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('beegame-preview-surface'));
    expect(avatar).toHaveAttribute('data-mood', 'thinking');
    await act(async () => finish());
  });

  it('shows an inline loading badge while the project is starting', () => {
    render(<BeeGameLivePreviewPage {...props} status="starting" />);
    expect(screen.getByTestId('beegame-sync-status')).toHaveTextContent('同步中');
  });

  it('transitions the same sync badge from loading to success, then hides it', async () => {
    const { rerender } = render(<BeeGameLivePreviewPage {...props} isSyncing />);
    const badge = screen.getByTestId('beegame-sync-status');
    expect(badge).toHaveTextContent('同步中');
    expect(badge.querySelector('.lucide-loader-circle')).not.toBeNull();

    rerender(<BeeGameLivePreviewPage {...props} isSyncing={false} />);
    expect(screen.getByTestId('beegame-sync-status')).toBe(badge);
    expect(badge).toHaveTextContent('已同步');
    expect(badge.querySelector('.lucide-check')).not.toBeNull();
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 900)); });
    expect(badge).toBeVisible();
    await waitFor(() => expect(screen.queryByTestId('beegame-sync-status')).not.toBeInTheDocument(), { timeout: 1_000 });
  });

  it('locks preview and publishing while the workspace is busy, then unlocks', () => {
    const onStartPreview = vi.fn(), onStopPreview = vi.fn(), onDeployProject = vi.fn(), onOpenExternal = vi.fn();
    const actions = { onStartPreview, onStopPreview, onDeployProject, onOpenExternal };
    const { rerender } = render(<BeeGameLivePreviewPage {...props} {...actions} isWorkspaceBusy />);
    expect(screen.getByRole('button', { name: '播放预览' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '部署' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '播放预览' }));
    fireEvent.click(screen.getByRole('button', { name: '部署' }));
    expect(onStartPreview).not.toHaveBeenCalled();
    expect(onDeployProject).not.toHaveBeenCalled();
    rerender(<BeeGameLivePreviewPage {...props} {...actions} buildReport={live} isWorkspaceBusy />);
    expect(screen.getByRole('button', { name: '停止预览' })).toBeDisabled();
    expect(within(screen.getByTestId('beegame-preview-deploy-control')).getByRole('button', { name: '部署' })).toBeDisabled();
    rerender(<BeeGameLivePreviewPage {...props} {...actions} buildReport={live} isWorkspaceBusy={false} />);
    expect(screen.getByRole('button', { name: '停止预览' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '部署' })).toBeEnabled();
  });
  it('changes the main preview action from play to stop and back', async () => {
    const onStartPreview = vi.fn().mockResolvedValue(undefined);
    const onStopPreview = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<BeeGameLivePreviewPage {...props} onStartPreview={onStartPreview} onStopPreview={onStopPreview} />);
    fireEvent.click(screen.getByRole('button', { name: '播放预览' }));
    await waitFor(() => expect(onStartPreview).toHaveBeenCalledOnce());
    rerender(<BeeGameLivePreviewPage {...props} buildReport={live} onStartPreview={onStartPreview} onStopPreview={onStopPreview} />);
    const stop = await screen.findByRole('button', { name: '停止预览' });
    expect(stop).toBeEnabled();
    expect(stop.querySelector('.lucide-square')).not.toBeNull();
    fireEvent.click(stop);
    await waitFor(() => expect(onStopPreview).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: '播放预览' })).toBeEnabled();
  });

  it('disables the main action while a preview request is pending', async () => {
    let finish!: () => void;
    const onStartPreview = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<BeeGameLivePreviewPage {...props} onStartPreview={onStartPreview} />);
    fireEvent.click(screen.getByRole('button', { name: '播放预览' }));
    const button = screen.getByRole('button', { name: '播放预览' });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('预览');
    expect(button).not.toHaveTextContent('正在准备');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('.animate-spin')).not.toBeNull();
    fireEvent.click(button);
    expect(onStartPreview).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(button).toHaveAttribute('aria-busy', 'false');
  });

  it.each([['zh', '预览'], ['en', 'Preview'], ['ja', 'プレビュー']] as const)(
    'localizes the preview label for %s', (lang, label) => {
      render(<BeeGameLivePreviewPage {...props} lang={lang} />);
      expect(within(screen.getByTestId('beegame-preview-deploy-control')).getByText(label)).toBeInTheDocument();
    },
  );

  it('opens project usage in the BeUI popover with separate token categories', () => {
    render(<BeeGameLivePreviewPage {...props} projectExecutionTime={{ elapsed_ms: 2 * 60 * 60_000, running: false }} credits={{ consumedCredits: 1.25 }} tokenUsage={{ prompt_tokens: 123, input_tokens: 100, cache_read_tokens: 200, cached_input_tokens: 250, completion_tokens: 300, total_tokens: 600 }} />);
    const trigger = screen.getByTestId('beegame-project-info-trigger');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(trigger);
    const panel = within(screen.getByTestId('beegame-project-hint'));
    for (const label of ['项目运行时间', '已消耗 Credit', '输入 Tokens', '缓存输入 Tokens', '输出']) expect(panel.getByText(label)).toBeInTheDocument();
    for (const value of ['2小时 0分钟', '1.25', '100', '250', '300']) expect(panel.getByText(value)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('advances live execution time, freezes while paused, and resets the local tick on resume', () => {
    vi.useFakeTimers();
    const view = render(<BeeGameLivePreviewPage {...props} projectExecutionTime={{ elapsed_ms: 59_000, running: true }} />);
    try {
      fireEvent.click(screen.getByTestId('beegame-project-info-trigger'));
      const panel = within(screen.getByTestId('beegame-project-hint'));
      expect(panel.getByText('0分钟')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1_000));
      expect(panel.getByText('1分钟')).toBeInTheDocument();
      view.rerender(<BeeGameLivePreviewPage {...props} projectExecutionTime={{ elapsed_ms: 60_000, running: false }} />);
      act(() => vi.advanceTimersByTime(2 * 60_000));
      expect(panel.getByText('1分钟')).toBeInTheDocument();
      view.rerender(<BeeGameLivePreviewPage {...props} projectExecutionTime={{ elapsed_ms: 61_000, running: true }} />);
      expect(panel.getByText('1分钟')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(59_000));
      expect(panel.getByText('2分钟')).toBeInTheDocument();
      view.rerender(<BeeGameLivePreviewPage {...props} projectExecutionTime={null} />);
      expect(panel.queryByText('2分钟')).not.toBeInTheDocument();
      expect(panel.getAllByText('—')).toHaveLength(5);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('labels live session tokens separately from settled project totals', () => {
    render(<BeeGameLivePreviewPage {...props} tokenUsageScope="session" settledProjectTokens={900}
      credits={{ consumedCredits: 0.5 }} tokenUsage={{ input_tokens: 12, cached_input_tokens: 34, output_tokens: 5, total_tokens: 51 }} />);
    fireEvent.click(screen.getByTestId('beegame-project-info-trigger'));
    const panel = within(screen.getByTestId('beegame-project-hint'));
    expect(panel.getByText('输入 Tokens（当前会话）')).toBeInTheDocument();
    expect(panel.getByText('项目已结算 Tokens')).toBeInTheDocument();
    expect(panel.getByText('900')).toBeInTheDocument();
  });

  it('does not round a small confirmed credit debit down to zero', () => {
    render(<BeeGameLivePreviewPage {...props} credits={{ consumedCredits: 0.0001 }} />);
    fireEvent.click(screen.getByTestId('beegame-project-info-trigger'));
    expect(within(screen.getByTestId('beegame-project-hint')).getByText('0.0001')).toBeInTheDocument();
  });

  it('identifies partial receipts even when no tokens have been confirmed', () => {
    const view = render(<BeeGameLivePreviewPage {...props} tokenUsage={{ prompt_tokens: 0, completion_tokens: 0,
      total_tokens: 0, providerUsageIncomplete: true }} />);
    fireEvent.click(screen.getByTestId('beegame-project-info-trigger'));
    expect(screen.getByText('用量回执不完整，以上仅为已确认 Tokens。')).toBeInTheDocument();
    view.rerender(<BeeGameLivePreviewPage {...props} tokenUsage={{ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }} />);
    expect(screen.queryByText('用量回执不完整，以上仅为已确认 Tokens。')).not.toBeInTheDocument();
  });

  it('does not turn unavailable usage into zero', () => {
    render(<BeeGameLivePreviewPage {...props} />);
    fireEvent.click(screen.getByTestId('beegame-project-info-trigger'));
    expect(within(screen.getByTestId('beegame-project-hint')).getAllByText('—')).toHaveLength(5);
  });

  it('copies the displayed project name from the project info popover', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      render(<BeeGameLivePreviewPage {...props} />);
      fireEvent.click(screen.getByTestId('beegame-project-info-trigger'));
      fireEvent.click(within(screen.getByTestId('beegame-project-hint')).getByRole('button', { name: '复制项目名称' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('游戏项目'));
      expect(screen.getByRole('button', { name: '已复制项目名称' })).toBeInTheDocument();
    } finally {
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('groups preview and deploy actions in one segmented control', () => {
    render(<BeeGameLivePreviewPage {...props} buildReport={live} onStopPreview={vi.fn()} onDeployProject={vi.fn()} />);
    const control = within(screen.getByTestId('beegame-preview-deploy-control'));
    expect(control.getByRole('button', { name: '停止预览' })).toBeEnabled();
    expect(control.getByRole('button', { name: '部署' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '独立窗口预览' })).not.toBeInTheDocument();
  });

  it('forwards post-measurement discussion confirmation through the page deploy handler', async () => {
    const onDeployProject = vi.fn();
    render(<BeeGameLivePreviewPage {...props} onDeployProject={onDeployProject} />);
    fireEvent.click(screen.getByRole('button', { name: '部署' }));
    fireEvent.click(screen.getByRole('button', { name: 'test discussion publish' }));
    await waitFor(() => expect(onDeployProject).toHaveBeenCalledWith({
      measurementId: 'measured', requirementsRevision: 'revision',
      discussionConfirmation: { messageRequestKeys: ['question-1'] },
    }));
  });

  it('disables deploy in the segmented control when publishing is unavailable', () => {
    render(<BeeGameLivePreviewPage {...props} />);
    expect(within(screen.getByTestId('beegame-preview-deploy-control')).getByRole('button', { name: '部署' })).toBeDisabled();
  });

  it('uses a chevron-left icon for dashboard back navigation', () => {
    const onBack = vi.fn();
    render(<BeeGameLivePreviewPage {...props} onBack={onBack} />);
    const back = screen.getByRole('button', { name: '返回主页' });
    expect(back.querySelector('.lucide-chevron-left')).not.toBeNull();
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });
});
