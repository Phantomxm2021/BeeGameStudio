import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BeeGameLivePreviewPage } from './BeeGameLivePreviewPage';

vi.mock('./Landing/SettingsMenu', () => ({ SettingsMenu: () => null }));
vi.mock('./Landing/CreditStoreModal', () => ({ CreditStoreModal: () => null }));
vi.mock('./Landing/ProjectHistoryModal', () => ({ ProjectHistoryModal: () => null }));
vi.mock('./Landing/ProfileModal', () => ({ ProfileModal: () => null }));
vi.mock('./Landing/AccountActionsMenu', () => ({ AccountActionsMenu: () => null }));
vi.mock('../beui/motion/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('../Workspace/WorkspaceDeploymentDialog', () => ({ WorkspaceDeploymentDialog: () => null }));

const props = {
  projectId: 'project',
  lang: 'zh' as const, projectName: '游戏项目', status: 'idle' as const,
  phaseLabel: '就绪', isSyncing: false, onSetLang: vi.fn(),
};
const live = { status: 'passed', build_url: '/previews/session/game/' };

describe('dashboard header', () => {
  it('shows an inline loading badge while the project is starting', () => {
    render(<BeeGameLivePreviewPage {...props} status="starting" />);
    expect(screen.getByTestId('beegame-sync-status')).toHaveTextContent('同步中');
  });

  it('locks preview, external window and publishing while the workspace is busy, then unlocks', () => {
    const onStartPreview = vi.fn(), onStopPreview = vi.fn(), onDeployProject = vi.fn(), onOpenExternal = vi.fn();
    const actions = { onStartPreview, onStopPreview, onDeployProject, onOpenExternal };
    const { rerender } = render(<BeeGameLivePreviewPage {...props} {...actions} isWorkspaceBusy />);
    expect(screen.getByRole('button', { name: '播放预览' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '发布游戏' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '播放预览' }));
    fireEvent.click(screen.getByRole('button', { name: '发布游戏' }));
    expect(onStartPreview).not.toHaveBeenCalled();
    expect(onDeployProject).not.toHaveBeenCalled();
    rerender(<BeeGameLivePreviewPage {...props} {...actions} buildReport={live} isWorkspaceBusy />);
    expect(screen.getByRole('button', { name: '停止预览' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '独立窗口预览' })).toBeDisabled();
    rerender(<BeeGameLivePreviewPage {...props} {...actions} buildReport={live} isWorkspaceBusy={false} />);
    expect(screen.getByRole('button', { name: '停止预览' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '独立窗口预览' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '发布游戏' })).toBeEnabled();
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
      expect(within(screen.getByTestId('beegame-preview-split-control')).getByText(label)).toBeInTheDocument();
    },
  );

  it('opens project usage in the BeUI popover with separate token categories', () => {
    render(<BeeGameLivePreviewPage {...props} credits={{ consumedCredits: 1.25 }} tokenUsage={{ prompt_tokens: 123, input_tokens: 100, cache_read_tokens: 200, cached_input_tokens: 250, completion_tokens: 300, total_tokens: 600 }} />);
    const trigger = screen.getByTestId('beegame-project-info-trigger');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(trigger);
    const panel = within(screen.getByTestId('beegame-project-hint'));
    for (const label of ['已消耗 Credit', '输入 Tokens', '缓存输入 Tokens', '输出']) expect(panel.getByText(label)).toBeInTheDocument();
    for (const value of ['1.25', '100', '200', '300']) expect(panel.getByText(value)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not turn unavailable usage into zero', () => {
    render(<BeeGameLivePreviewPage {...props} />);
    fireEvent.click(screen.getByTestId('beegame-project-info-trigger'));
    expect(within(screen.getByTestId('beegame-project-hint')).getAllByText('—')).toHaveLength(4);
  });

  it('labels the external preview separately from a deployed live site', async () => {
    const onOpenExternal = vi.fn();
    render(<BeeGameLivePreviewPage {...props} buildReport={live} onOpenExternal={onOpenExternal} />);
    const button = screen.getByRole('button', { name: '独立窗口预览' });
    expect(button.textContent).toBe('');
    expect(button.querySelector('.lucide-external-link')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '预览操作' })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(onOpenExternal).toHaveBeenCalledWith(expect.stringContaining('/previews/session/game/'));
  });

  it('disables the independent-window button until a preview is available', () => {
    render(<BeeGameLivePreviewPage {...props} onOpenExternal={vi.fn()} />);
    expect(screen.getByRole('button', { name: '独立窗口预览' })).toBeDisabled();
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
