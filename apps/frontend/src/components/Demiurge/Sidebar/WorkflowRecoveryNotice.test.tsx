import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkflowRecoveryNotice } from './WorkflowRecoveryNotice';
import { api } from '../../../services/api';

vi.mock('../../../services/api', () => ({ api: { getTaskRecovery: vi.fn(), recoverTask: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());

it('offers recovery only for trusted exit evidence and keeps continuation explicit', async () => {
    vi.mocked(api.getTaskRecovery).mockResolvedValue({ state: 'recoverable', code: 'host-reboot', message: '旧执行已退出，等待结算。' });
    vi.mocked(api.recoverTask).mockResolvedValue({ recovered: true, paused: true });
    const blocked = vi.fn();
    render(<WorkflowRecoveryNotice projectId="project" lang="zh" refreshKey="idle" onBlockedChange={blocked} />);
    fireEvent.click(await screen.findByRole('button', { name: '清理遗留执行占用' }));
    await screen.findByText('遗留执行占用已清理，任务保持暂停。请明确继续后再执行。');
    expect(api.recoverTask).toHaveBeenCalledExactlyOnceWith({ project_id: 'project' });
    expect(blocked).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('button', { name: /继续任务/ })).toBeNull();
});

it('does not expose unlock for an unknown same-boot writer', async () => {
    vi.mocked(api.getTaskRecovery).mockResolvedValue({ state: 'blocked', code: 'same-boot', message: '旧执行退出未确认。' });
    const blocked = vi.fn();
    render(<WorkflowRecoveryNotice projectId="project" lang="zh" refreshKey="idle" onBlockedChange={blocked} />);
    await screen.findByText('旧执行退出未确认。');
    expect(screen.queryByRole('button', { name: '清理遗留执行占用' })).toBeNull();
    expect(blocked).toHaveBeenLastCalledWith(true);
    expect(api.recoverTask).not.toHaveBeenCalled();
});

it('discards a previous project response after switching projects', async () => {
    let finish!: (value: Awaited<ReturnType<typeof api.getTaskRecovery>>) => void;
    vi.mocked(api.getTaskRecovery).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
        .mockResolvedValue(null);
    const blocked = vi.fn();
    const view = render(<WorkflowRecoveryNotice projectId="old" lang="zh" refreshKey="idle" onBlockedChange={blocked} />);
    view.rerender(<WorkflowRecoveryNotice projectId="new" lang="zh" refreshKey="idle" onBlockedChange={blocked} />);
    await waitFor(() => expect(blocked).toHaveBeenLastCalledWith(false));
    finish({ state: 'blocked', code: 'old', message: '旧项目状态' });
    await waitFor(() => expect(screen.queryByText('旧项目状态')).toBeNull());
});
