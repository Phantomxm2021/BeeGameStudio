import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceDeploymentDialog } from './WorkspaceDeploymentDialog';
import { api } from '../../services/api';
import zh from '../../i18n/locales/zh.json';

vi.mock('../../services/api', () => ({ api: { getDeploymentReadiness: vi.fn() } }));
const labels = zh.beegame.livePreview;
const props = { projectId: 'project', isOpen: true, deployments: [], labels,
  onClose: vi.fn(), onDeploy: vi.fn(), isDeploying: false, canDeploy: true };

describe('publishing confirmation', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: true, issues: [], destination: 'remote' }); });
  it('checks readiness without publishing and requires an explicit confirmation', async () => {
    render(<WorkspaceDeploymentDialog {...props} />);
    const publish = await screen.findByRole('button', { name: '发布游戏' });
    await waitFor(() => expect(publish).toBeEnabled());
    expect(props.onDeploy).not.toHaveBeenCalled();
    expect(screen.getByText(/上传到 Cloudflare/)).toBeTruthy();
    fireEvent.click(publish);
    await waitFor(() => expect(props.onDeploy).toHaveBeenCalledOnce());
  });
  it('shows the exact acceptance blocker and prevents submission', async () => {
    vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: false, issues: ['Workspace changed after acceptance'], destination: 'remote' });
    render(<WorkspaceDeploymentDialog {...props} />);
    expect(await screen.findByText('Workspace changed after acceptance')).toBeTruthy();
    expect(screen.getByRole('button', { name: '发布游戏' })).toBeDisabled();
    expect(props.onDeploy).not.toHaveBeenCalled();
  });
  it('does not mistake local hosting for a public release', async () => {
    vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: true, issues: [], destination: 'local' });
    render(<WorkspaceDeploymentDialog {...props} />);
    expect(await screen.findByText(/本地预览不等于公网发布/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '发布游戏' })).toBeDisabled();
  });
  it('distinguishes a task PASS from stale release acceptance without starting an Agent', async () => {
    vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: false, issues: ['Workspace changed after acceptance; revalidation is required.'],
      destination: 'remote', workflow: { phase: 'ACCEPTANCE', status: 'needs_action' } });
    render(<WorkspaceDeploymentDialog {...props} />);
    expect(await screen.findByText(/当前版本需要重新验收/)).toBeTruthy();
    expect(screen.getByText(/Chat 的完成或 PASS/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '发布游戏' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
    await waitFor(() => expect(api.getDeploymentReadiness).toHaveBeenCalledTimes(2));
    expect(props.onDeploy).not.toHaveBeenCalled();
  });
  it('keeps request failures visible in the dialog', async () => {
    render(<WorkspaceDeploymentDialog {...props} onDeploy={vi.fn().mockRejectedValue(new Error('Upload rejected'))} />);
    const publish = screen.getByRole('button', { name: '发布游戏' });
    await waitFor(() => expect(publish).toBeEnabled());
    fireEvent.click(publish);
    expect(await screen.findByText('Upload rejected')).toBeTruthy();
  });
  it('can close the progress dialog without canceling the publication', async () => {
    render(<WorkspaceDeploymentDialog {...props} isDeploying deployments={[{ id: 'version', sessionId: 'session', workspacePath: '/test',
      status: 'publishing', url: '', createdAt: '2026-09-22T00:00:00Z', updatedAt: '2026-09-22T00:00:00Z' }]} />);
    expect(await screen.findByText(/发布将在后台继续/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '正在发布' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onDeploy).not.toHaveBeenCalled();
  });
});
