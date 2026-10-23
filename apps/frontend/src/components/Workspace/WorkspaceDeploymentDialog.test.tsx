import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceDeploymentDialog } from './WorkspaceDeploymentDialog';
import { api } from '../../services/api';
import zh from '../../i18n/locales/zh.json';
const { showError } = vi.hoisted(() => ({ showError: vi.fn() }));
vi.mock('../../contexts/ToastContext', () => ({ useToastContext: () => ({ showError }) }));

vi.mock('../../services/api', () => ({ api: { getDeploymentReadiness: vi.fn() } }));
const labels = zh.beegame.livePreview;
const props = { projectId: 'project', projectName: '磁轨调度', isOpen: true, deployments: [], labels,
  onClose: vi.fn(), onDeploy: vi.fn(), isDeploying: false, canDeploy: true };

describe('publishing confirmation', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: true, issues: [], destination: 'remote' }); });
  it('checks readiness without publishing and requires an explicit confirmation', async () => {
    render(<WorkspaceDeploymentDialog {...props} />);
    const publish = await screen.findByRole('button', { name: labels.deploymentPublishAction });
    await waitFor(() => expect(publish).toBeEnabled());
    expect(screen.getByText('磁轨调度')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
    expect(props.onDeploy).not.toHaveBeenCalled();
    expect(screen.queryByText(/上传到 Cloudflare/)).toBeNull();
    fireEvent.click(publish);
    await waitFor(() => expect(props.onDeploy).toHaveBeenCalledOnce());
  });
  it('shows the exact acceptance blocker and prevents submission', async () => {
    vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: false, issues: ['Workspace changed after acceptance'], destination: 'remote' });
    render(<WorkspaceDeploymentDialog {...props} />);
    expect(await screen.findByText('Workspace changed after acceptance')).toBeTruthy();
    expect(screen.getByRole('button', { name: labels.deploymentPublishAction })).toBeDisabled();
    expect(props.onDeploy).not.toHaveBeenCalled();
  });
  it('requires a deliberate publication-only confirmation for post-measurement chat', async () => {
    vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: false, issues: ['Confirm discussion'], destination: 'remote',
      confirmationRequired: { measurementId: 'measurement-1', requirementsRevision: 'revision-2',
        messages: [{ requestKey: 'question-1', text: 'What was tested?' }] } });
    render(<WorkspaceDeploymentDialog {...props} />);
    expect(await screen.findByText('What was tested?')).toBeTruthy();
    const publish = screen.getByRole('button', { name: labels.deploymentPublishAction });
    expect(publish).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: labels.deploymentDiscussionConfirm }));
    expect(publish).toBeEnabled();
    fireEvent.click(publish);
    await waitFor(() => expect(props.onDeploy).toHaveBeenCalledWith({ measurementId: 'measurement-1',
      requirementsRevision: 'revision-2', discussionConfirmation: { messageRequestKeys: ['question-1'] } }));
  });
  it('shows a completed publication without exposing its republish confirmation until requested', async () => {
    vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: false, issues: ['Confirm discussion'], destination: 'remote',
      confirmationRequired: { measurementId: 'measurement-1', requirementsRevision: 'revision-2',
        messages: [{ requestKey: 'question-1', text: 'What was tested?' }] } });
    const onDeploy = vi.fn();
    const live = { id: 'version-1', sessionId: 'session', workspacePath: '/test', status: 'succeeded' as const,
      url: 'https://game.example/', createdAt: '', updatedAt: '' };
    const { rerender } = render(<WorkspaceDeploymentDialog {...props} onDeploy={onDeploy} deployments={[]} />);
    expect(await screen.findByText('What was tested?')).toBeTruthy();
    rerender(<WorkspaceDeploymentDialog {...props} onDeploy={onDeploy} deployments={[live]} />);
    expect(screen.getByText('磁轨调度已发布')).toBeTruthy();
    expect(screen.queryByText('What was tested?')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: labels.deploymentDiscussionConfirm })).toBeNull();
    const republish = screen.getByRole('button', { name: labels.redeploy });
    fireEvent.click(republish);
    expect(screen.getByText('What was tested?')).toBeTruthy();
    expect(onDeploy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: labels.deploymentDiscussionConfirm }));
    fireEvent.click(republish);
    await waitFor(() => expect(onDeploy).toHaveBeenCalledWith({ measurementId: 'measurement-1',
      requirementsRevision: 'revision-2', discussionConfirmation: { messageRequestKeys: ['question-1'] } }));
    rerender(<WorkspaceDeploymentDialog {...props} onDeploy={onDeploy} deployments={[{ ...live, id: 'version-2' }, live]} />);
    expect(screen.queryByText('What was tested?')).toBeNull();
  });
  it('does not mistake local hosting for a public release', async () => {
    vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: true, issues: [], destination: 'local' });
    render(<WorkspaceDeploymentDialog {...props} />);
    expect(await screen.findByText(/本地预览不等于公网发布/)).toBeTruthy();
    expect(screen.getByRole('button', { name: labels.deploymentPublishAction })).toBeDisabled();
  });
  it('distinguishes a task PASS from stale release acceptance without starting an Agent', async () => {
    vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: false, issues: ['Workspace changed after acceptance; revalidation is required.'],
      destination: 'remote', workflow: { phase: 'ACCEPTANCE', status: 'needs_action' } });
    render(<WorkspaceDeploymentDialog {...props} />);
    expect(await screen.findByText(/Workspace changed after acceptance/)).toBeTruthy();
    expect(screen.getByText(/Chat 的完成或 PASS/)).toBeTruthy();
    expect(screen.getByRole('button', { name: labels.deploymentPublishAction })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
    await waitFor(() => expect(api.getDeploymentReadiness).toHaveBeenCalledTimes(2));
    expect(props.onDeploy).not.toHaveBeenCalled();
  });
  it('keeps a failed request visible in the dialog as well as the global toast', async () => {
    render(<WorkspaceDeploymentDialog {...props} onDeploy={vi.fn().mockRejectedValue(new Error('Upload rejected'))} />);
    const publish = screen.getByRole('button', { name: labels.deploymentPublishAction });
    await waitFor(() => expect(publish).toBeEnabled());
    fireEvent.click(publish);
    await waitFor(() => expect(showError).toHaveBeenCalledWith('Upload rejected'));
    expect(screen.getByRole('alert')).toHaveTextContent('Upload rejected');
    expect(screen.getByRole('button', { name: labels.deploymentPublishAction })).toBeEnabled();
  });
  it('scrolls long deployment errors inside the content instead of stretching the dialog', async () => {
    const longError = 'Upload rejected: ' + 'A'.repeat(1000);
    render(<WorkspaceDeploymentDialog {...props} onDeploy={vi.fn().mockRejectedValue(new Error(longError))} />);
    const publish = screen.getByRole('button', { name: labels.deploymentPublishAction });
    await waitFor(() => expect(publish).toBeEnabled());
    fireEvent.click(publish);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(longError);
    expect(alert.className).toContain('max-h-32');
    expect(alert.className).toContain('overflow-y-auto');
    expect(screen.getByRole('dialog').className).toContain('max-h-[calc(100dvh-32px)]');
    expect(publish).toBeVisible();
  });
  it('can close the progress dialog without canceling the publication', async () => {
    render(<WorkspaceDeploymentDialog {...props} isDeploying deployments={[{ id: 'version', sessionId: 'session', workspacePath: '/test',
      status: 'publishing', url: '', createdAt: '2026-09-22T00:00:00Z', updatedAt: '2026-09-22T00:00:00Z' }]} />);
    expect(await screen.findByText(/发布将在后台继续/)).toBeTruthy();
    expect(screen.getAllByText('正在上传')).toHaveLength(1);
    expect(screen.getByRole('button', { name: labels.deploying })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onDeploy).not.toHaveBeenCalled();
  });
  it('uses the center morph modal dismissal without submitting a deployment', async () => {
    render(<WorkspaceDeploymentDialog {...props} />);
    expect(await screen.findByRole('dialog', { name: labels.deploy })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onDeploy).not.toHaveBeenCalled();
  });
  it('shows the published game and keeps history in a secondary view', async () => {
    const onOpenExternal = vi.fn();
    render(<WorkspaceDeploymentDialog {...props} deployments={[{ id: 'version', sessionId: 'session', workspacePath: '/test',
      status: 'succeeded', url: 'https://game.example', createdAt: '2026-09-22T00:00:00Z', updatedAt: '2026-09-22T00:00:00Z' }]} onOpenExternal={onOpenExternal} />);
    expect(screen.getByText('磁轨调度已发布')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentOpenGame }));
    expect(onOpenExternal).toHaveBeenCalledWith('https://game.example/');
    const republish = screen.getByRole('button', { name: labels.redeploy });
    await waitFor(() => expect(republish).toBeEnabled());
    fireEvent.click(republish);
    await waitFor(() => expect(props.onDeploy).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentVersions }));
    expect(await screen.findByText('版本 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentBack }));
    expect(screen.getByText('磁轨调度已发布')).toBeTruthy();
  });
  it('reports rollback failures through the global toast', async () => {
    render(<WorkspaceDeploymentDialog {...props} onRollback={vi.fn().mockRejectedValue(new Error('Rollback rejected'))} deployments={[
      { id: 'latest', sessionId: 'session', workspacePath: '/test', status: 'succeeded', url: '', createdAt: '', updatedAt: '' },
      { id: 'previous', sessionId: 'session', workspacePath: '/test', status: 'succeeded', url: '', createdAt: '', updatedAt: '' },
    ]} />);
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentVersions }));
    fireEvent.click(screen.getByRole('button', { name: labels.rollback }));
    await waitFor(() => expect(showError).toHaveBeenCalledWith('Rollback rejected'));
  });
  it('keeps a compact dialog and shows a quiet history empty state', async () => {
    render(<WorkspaceDeploymentDialog {...props} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('min-h-[365px]');

    fireEvent.click(screen.getByRole('button', { name: labels.deploymentVersions }));
    expect((await screen.findByRole('status')).textContent).toContain(labels.deploymentNoVersions);
  });
});
