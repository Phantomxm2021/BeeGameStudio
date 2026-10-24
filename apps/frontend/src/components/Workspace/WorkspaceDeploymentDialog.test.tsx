import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceDeploymentDialog } from './WorkspaceDeploymentDialog';
import { api } from '../../services/api';
import zh from '../../i18n/locales/zh.json';
const { showError } = vi.hoisted(() => ({ showError: vi.fn() }));
vi.mock('../../contexts/ToastContext', () => ({ useToastContext: () => ({ showError }) }));

vi.mock('../../services/api', () => ({ api: { getDeploymentReadiness: vi.fn(), generatePublicationDescription: vi.fn(), capturePublicationCover: vi.fn() } }));
const labels = zh.beegame.livePreview;
const props = { projectId: 'project', projectName: '磁轨调度', isOpen: true, deployments: [], labels,
  onClose: vi.fn(), onDeploy: vi.fn(), isDeploying: false, canDeploy: true };

describe('publishing confirmation', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: true, issues: [], destination: 'remote' }); });
  it('shows the reviewed public title instead of the internal project name', async () => {
    const live = { id: 'version-1', sessionId: 'session', workspacePath: '/test', status: 'succeeded' as const,
      url: 'https://game.example/', createdAt: '', updatedAt: '', publicDescription: '# 《星港夜航》\n\n## 操作\nE：补给' };
    render(<WorkspaceDeploymentDialog {...props} deployments={[live]} />);
    expect(await screen.findByText('星港夜航已发布')).toBeTruthy();
    expect(screen.queryByText('磁轨调度已发布')).toBeNull();
    expect(screen.getByRole('textbox', { name: labels.deploymentDescription })).toHaveValue(live.publicDescription);
    expect(api.generatePublicationDescription).not.toHaveBeenCalled();
  });
  it('checks readiness without publishing and requires an explicit confirmation', async () => {
    render(<WorkspaceDeploymentDialog {...props} />);
    const publish = await screen.findByRole('button', { name: labels.deploymentPublishAction });
    await waitFor(() => expect(publish).toBeEnabled());
    expect(screen.getByText('磁轨调度')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
    expect(props.onDeploy).not.toHaveBeenCalled();
    fireEvent.click(publish);
    await waitFor(() => expect(props.onDeploy).toHaveBeenCalledOnce());
  });
  it('shows the exact acceptance blocker and prevents submission', async () => {
    vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: false, issues: ['Workspace changed after acceptance'], destination: 'remote' });
    render(<WorkspaceDeploymentDialog {...props} />);
    await waitFor(() => expect(showError).toHaveBeenCalledWith(labels.deploymentVerificationScope + '\nWorkspace changed after acceptance'));
    expect(screen.queryByText('Workspace changed after acceptance')).toBeNull();
    expect(screen.queryByRole('button', { name: labels.deploymentRecheck })).toBeNull();
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
    const republish = screen.getByRole('button', { name: labels.deploymentPublishUpdate });
    fireEvent.click(republish);
    expect(screen.getByText('What was tested?')).toBeTruthy();
    expect(onDeploy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: labels.deploymentDiscussionConfirm }));
    fireEvent.click(republish);
    await waitFor(() => expect(onDeploy).toHaveBeenCalledWith({ measurementId: 'measurement-1',
      requirementsRevision: 'revision-2', discussionConfirmation: { messageRequestKeys: ['question-1'] } }));
    rerender(<WorkspaceDeploymentDialog {...props} onDeploy={onDeploy} deployments={[{ ...live, id: 'version-2' }, live]} />);
    await waitFor(() => expect(screen.queryByText('What was tested?')).toBeNull());
    expect(await screen.findByText('版本 2 已上线。')).toBeTruthy();
  });
  it('does not mistake local hosting for a public release', async () => {
    vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: true, issues: [], destination: 'local' });
    render(<WorkspaceDeploymentDialog {...props} />);
    expect(await screen.findByText(/本地预览不等于公网发布/)).toBeTruthy();
    expect(screen.getByRole('button', { name: labels.deploymentPublishAction })).toBeDisabled();
  });
  it('uses a global notification for stale evidence and checks again when reopened', async () => {
    vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: false, issues: ['Workspace changed after acceptance; revalidation is required.'],
      destination: 'remote', workflow: { phase: 'ACCEPTANCE', status: 'needs_action' } });
    const { rerender } = render(<WorkspaceDeploymentDialog {...props} />);
    await waitFor(() => expect(showError).toHaveBeenCalledWith(expect.stringContaining('Workspace changed after acceptance')));
    expect(showError).toHaveBeenCalledWith(expect.stringContaining(labels.deploymentVerificationScope));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: labels.deploymentRecheck })).toBeNull();
    expect(screen.getByRole('button', { name: labels.deploymentPublishAction })).toBeDisabled();
    rerender(<WorkspaceDeploymentDialog {...props} isOpen={false} />);
    rerender(<WorkspaceDeploymentDialog {...props} />);
    await waitFor(() => expect(api.getDeploymentReadiness).toHaveBeenCalledTimes(2));
    expect(props.onDeploy).not.toHaveBeenCalled();
  });
  it('notifies about blocked republishing only after the user requests an update', async () => {
    vi.mocked(api.getDeploymentReadiness).mockResolvedValue({ allowed: false, issues: ['Build evidence is outdated'], destination: 'remote' });
    render(<WorkspaceDeploymentDialog {...props} deployments={[{ id: 'live', sessionId: 'session', workspacePath: '/test',
      status: 'succeeded', url: 'https://game.example/', createdAt: '', updatedAt: '' }]} />);
    const update = screen.getByRole('button', { name: labels.deploymentPublishUpdate });
    await waitFor(() => expect(update).toBeEnabled());
    expect(showError).not.toHaveBeenCalled();
    fireEvent.click(update);
    await waitFor(() => expect(showError).toHaveBeenCalledExactlyOnceWith(labels.deploymentVerificationScope + '\nBuild evidence is outdated'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: labels.deploymentRecheck })).toBeNull();
    expect(update).toBeDisabled();
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
    expect(screen.getByRole('progressbar', { name: labels.deploymentProgress })).toHaveAttribute('aria-valuetext', labels.deploymentUploadVerify);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByRole('button', { name: labels.deploymentShare })).toBeNull();
    expect(screen.queryByRole('button', { name: labels.deploymentVersions })).toBeNull();
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
  it('opens history from the editor and preserves edited copy when returning', async () => {
    vi.stubEnv('VITE_BEEGAME_GAME_PORTAL_BASE_URL', 'https://portal.beegame.studio');
    const onOpenExternal = vi.fn();
    const record = { id: 'release', sessionId: 'session', workspacePath: '/test', status: 'succeeded' as const,
      url: 'https://game.example/deployments/release/files/index.html', portalPublishedAt: '2026-10-24T00:00:00Z', createdAt: '', updatedAt: '' };
    render(<WorkspaceDeploymentDialog {...props} onOpenExternal={onOpenExternal} deployments={[record]} />);
    fireEvent.change(screen.getByRole('textbox', { name: labels.deploymentDescription }), {target:{value:'Keep this draft'}});
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentVersions }));
    expect(await screen.findByText('版本 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: labels.open }));
    expect(onOpenExternal).toHaveBeenCalledWith('https://portal.beegame.studio/deployments/release/files/index.html');
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentBack }));
    expect(await screen.findByRole('textbox', { name: labels.deploymentDescription })).toHaveValue('Keep this draft');
    expect(screen.getByRole('button', { name: labels.deploymentVersions })).toBeTruthy();
    expect(props.onDeploy).not.toHaveBeenCalled();
  });
  it('keeps rollback available in history and reports a rollback failure', async () => {
    const onRollback=vi.fn().mockRejectedValue(new Error('Rollback rejected'));
    const record={sessionId:'session',workspacePath:'/test',status:'succeeded' as const,url:'https://game.example/',createdAt:'',updatedAt:''};
    render(<WorkspaceDeploymentDialog {...props} onRollback={onRollback} deployments={[{...record,id:'latest'},{...record,id:'previous'}]} />);
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentVersions }));
    fireEvent.click(await screen.findByRole('button', { name: labels.rollback }));
    await waitFor(() => expect(onRollback).toHaveBeenCalledExactlyOnceWith('previous'));
    await waitFor(() => expect(showError).toHaveBeenCalledWith('Rollback rejected'));
    expect(screen.getByRole('heading', { name: labels.deploymentVersions })).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
  it('shows a history empty state before the first publication', async () => {
    render(<WorkspaceDeploymentDialog {...props} />);
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentVersions }));
    expect(await screen.findByText(labels.deploymentNoVersions)).toBeTruthy();
  });

  it('copies only the stable Portal URL from the editor, retaining history without the old link menu', async () => {
    vi.stubEnv('VITE_BEEGAME_GAME_PORTAL_BASE_URL', 'https://portal.beegame.studio');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<WorkspaceDeploymentDialog {...props} deployments={[{ id: 'version', sessionId: 'session', workspacePath: '/test',
      status: 'succeeded', portalPublishedAt: '2026-10-24T00:00:00Z', url: 'https://game.example/deployments/version/files/index.html', createdAt: '', updatedAt: '' }]} />);
    expect(screen.getByText('磁轨调度已发布')).toBeTruthy();
    expect(screen.getByRole('button', { name: labels.deploymentVersions })).toBeEnabled();
    expect(screen.queryByRole('button', { name: labels.deploymentLinkActions })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentShare }));
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith('https://portal.beegame.studio/g/project'));
    expect(await screen.findByRole('button', { name: labels.deploymentCopied })).toBeTruthy();
    const republish = screen.getByRole('button', { name: labels.deploymentPublishUpdate });
    await waitFor(() => expect(republish).toBeEnabled());
    fireEvent.click(republish);
    await waitFor(() => expect(props.onDeploy).toHaveBeenCalledOnce());
  });
  it('shares the current release after completion, keeps its version, and only returns to editing after reopening', async () => {
    vi.stubEnv('VITE_BEEGAME_GAME_PORTAL_BASE_URL', 'https://portal.beegame.studio');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const previous = { id: 'old', sessionId: 'session', workspacePath: '/test', status: 'succeeded' as const,
      url: 'https://game.example/deployments/old/files/index.html', createdAt: '', updatedAt: '' };
    const pending = { ...previous, id: 'new', status: 'publishing' as const, url: '' };
    const { rerender } = render(<WorkspaceDeploymentDialog {...props} deployments={[pending, previous]} />);
    expect(screen.queryByRole('button', { name: labels.deploymentShare })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    const complete = { ...pending, status: 'succeeded' as const, url: 'https://game.example/deployments/new/files/index.html', portalPublishedAt: '2026-10-24T00:00:00Z' };
    rerender(<WorkspaceDeploymentDialog {...props} deployments={[complete, previous]} />);
    expect(await screen.findByText('版本 2 已上线。')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: labels.deploymentPublishUpdate })).toBeNull();
    expect(screen.queryByRole('button', { name: labels.deploymentVersions })).toBeNull();
    const share = screen.getByRole('button', { name: labels.deploymentShare });
    expect(share.className).toContain('rounded-full');
    expect(share.className).toContain('bg-primary');
    fireEvent.click(share);
    await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith('https://portal.beegame.studio/g/project'));
    expect(await screen.findByRole('button', { name: labels.deploymentCopied })).toBeTruthy();
    // Another polling response must not return the user to the editor.
    rerender(<WorkspaceDeploymentDialog {...props} deployments={[{ ...complete }, { ...previous }]} />);
    expect(screen.getByText('版本 2 已上线。')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    rerender(<WorkspaceDeploymentDialog {...props} isOpen={false} deployments={[complete, previous]} />);
    rerender(<WorkspaceDeploymentDialog {...props} deployments={[complete, previous]} />);
    expect(await screen.findByRole('textbox', { name: labels.deploymentDescription })).toBeTruthy();
    expect(await screen.findByRole('button', { name: labels.deploymentPublishUpdate })).toBeTruthy();
  });
  it('keeps pre-Portal releases on their working raw link when sharing', async () => {
    vi.stubEnv('VITE_BEEGAME_GAME_PORTAL_BASE_URL', 'https://portal.beegame.studio');
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<WorkspaceDeploymentDialog {...props} deployments={[{ id: 'legacy', sessionId: 'session', workspacePath: '/test',
      status: 'succeeded', url: 'https://game.example/deployments/legacy/files/index.html', createdAt: '', updatedAt: '' }]} />);
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentShare }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://game.example/deployments/legacy/files/index.html'));
  });
  it('reports a clipboard failure without claiming the share was copied', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    render(<WorkspaceDeploymentDialog {...props} deployments={[{ id: 'live', sessionId: 'session', workspacePath: '/test',
      status: 'succeeded', url: 'https://game.example/', createdAt: '', updatedAt: '' }]} />);
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentShare }));
    await waitFor(() => expect(showError).toHaveBeenCalledWith(labels.deploymentShareFailed));
    expect(screen.queryByRole('button', { name: labels.deploymentCopied })).toBeNull();
    expect(screen.getByRole('button', { name: labels.deploymentShare })).toBeEnabled();
  });

  it('publishes edited three-line copy through the existing request without generation or a second confirmation', async () => {
    const onDeploy = vi.fn();
    render(<WorkspaceDeploymentDialog {...props} onDeploy={onDeploy} />);
    expect(screen.queryByText(labels.deploymentUrlPending)).toBeNull();
    expect(screen.queryByRole('button', { name: labels.deploymentLinkActions })).toBeNull();
    expect(screen.queryByRole('button', { name: labels.deploymentDescriptionGenerate })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: labels.deploymentDescriptionConfirm })).toBeNull();
    const editor = screen.getByRole('textbox', { name: labels.deploymentDescription });
    expect(editor).toHaveAttribute('rows', '3');
    fireEvent.change(editor, { target: { value: '方向键移动。' } });
    const publish = screen.getByRole('button', { name: labels.deploymentPublishAction });
    await waitFor(() => expect(publish).toBeEnabled());
    fireEvent.click(publish);
    await waitFor(() => expect(onDeploy).toHaveBeenCalledWith({ publicationDescription: { text: '方向键移动。', confirmed: true } }));
    expect(api.generatePublicationDescription).not.toHaveBeenCalled();
  });

  it.each([[160, 90, true], [160, 100, false]])('checks cover dimensions %s × %s and retains the published cover on rejection', async (width, height, valid) => {
    vi.stubGlobal('Image', class {
      naturalWidth = width; naturalHeight = height; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    const onDeploy = vi.fn();
    const existing = { id: 'version', sessionId: 'session', workspacePath: '/test', status: 'succeeded' as const,
      url: 'https://game.example/', publicCoverUrl: 'https://game.example/cover.webp', createdAt: '', updatedAt: '' };
    render(<WorkspaceDeploymentDialog {...props} onDeploy={onDeploy} deployments={[existing]} />);
    const file = new File(['image-fixture'], 'cover.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(labels.deploymentCoverUpload, { selector: 'input' }), { target: { files: [file] } });
    if (valid) {
      await waitFor(() => expect(screen.getByAltText(labels.deploymentCover)).toHaveAttribute('src', expect.stringContaining('data:image/png;base64,')));
    } else {
      expect(await screen.findByRole('alert')).toHaveTextContent('160 × 100');
      expect(screen.getByAltText(labels.deploymentCover)).toHaveAttribute('src', existing.publicCoverUrl);
    }
    const publish = screen.getByRole('button', { name: labels.deploymentPublishUpdate });
    await waitFor(() => expect(publish).toBeEnabled());
    fireEvent.click(publish);
    await waitFor(() => expect(onDeploy).toHaveBeenCalledWith(valid ? {
      publicationCover: { mediaType: 'image/png', filename: 'cover.png', data: btoa('image-fixture') },
    } : undefined));
  });

  it('fills both fields from the current project without publishing and allows later editing', async () => {
    const picture = { mediaType: 'image/webp' as const, filename: 'game-preview.webp', data: 'fixture' };
    vi.mocked(api.generatePublicationDescription).mockResolvedValue({ description: 'Project-derived introduction' });
    vi.mocked(api.capturePublicationCover).mockResolvedValue(picture);
    render(<WorkspaceDeploymentDialog {...props} />);
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentAutofill }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: labels.deploymentDescription })).toHaveValue('Project-derived introduction'));
    expect(api.generatePublicationDescription).toHaveBeenCalledExactlyOnceWith('project');
    expect(api.capturePublicationCover).toHaveBeenCalledExactlyOnceWith('project');
    expect(screen.getByAltText(labels.deploymentCover)).toHaveAttribute('src', 'data:image/webp;base64,fixture');
    expect(props.onDeploy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: labels.deploymentDescription }), { target: { value: 'Creator revision' } });
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentPublishAction }));
    await waitFor(() => expect(props.onDeploy).toHaveBeenCalledWith({
      publicationDescription: { text: 'Creator revision', confirmed: true }, publicationCover: picture,
    }));
  });

  it('retains the existing cover when capture fails but keeps a successful description draft', async () => {
    vi.mocked(api.generatePublicationDescription).mockResolvedValue({ description: 'Saved project description' });
    vi.mocked(api.capturePublicationCover).mockRejectedValue(new Error('Current build unavailable'));
    render(<WorkspaceDeploymentDialog {...props} deployments={[{ id: 'old', sessionId: 'session', workspacePath: '/test',
      status: 'succeeded', url: 'https://game.example/', publicCoverUrl: 'https://game.example/cover.webp', createdAt: '', updatedAt: '' }]} />);
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentAutofill }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Current build unavailable');
    expect(screen.getByRole('textbox', { name: labels.deploymentDescription })).toHaveValue('Saved project description');
    expect(screen.getByAltText(labels.deploymentCover)).toHaveAttribute('src', 'https://game.example/cover.webp');
    expect(props.onDeploy).not.toHaveBeenCalled();
  });

  it('disables editing and publication while filling and ignores results after the dialog closes', async () => {
    let finish!: (value: { description: string }) => void;
    vi.mocked(api.generatePublicationDescription).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.mocked(api.capturePublicationCover).mockResolvedValue({ mediaType: 'image/webp', filename: 'capture.webp', data: 'fixture' });
    const { rerender } = render(<WorkspaceDeploymentDialog {...props} />);
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentAutofill }));
    expect(screen.getByRole('button', { name: labels.deploymentAutofilling })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: labels.deploymentDescription })).toBeDisabled();
    expect(screen.getByRole('button', { name: labels.deploymentPublishAction })).toBeDisabled();
    rerender(<WorkspaceDeploymentDialog {...props} isOpen={false} />);
    finish({ description: 'Late result' });
    rerender(<WorkspaceDeploymentDialog {...props} />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: labels.deploymentDescription })).toHaveValue(''));
    expect(screen.queryByAltText(labels.deploymentCover)).toBeNull();
    expect(props.onDeploy).not.toHaveBeenCalled();
  });

  it('advances from real server status to the completion page without restoring the editor', async () => {
    const record = { id: 'new', sessionId: 'session', workspacePath: '/test', createdAt: '', updatedAt: '', url: '' };
    const { rerender } = render(<WorkspaceDeploymentDialog {...props} deployments={[{ ...record, status: 'queued' }]} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', labels.deploymentQueued);
    rerender(<WorkspaceDeploymentDialog {...props} deployments={[{ ...record, status: 'publishing' }]} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', labels.deploymentUploadVerify);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    rerender(<WorkspaceDeploymentDialog {...props} deployments={[{ ...record, status: 'publishing',
      uploadProgress: { uploadedBytes: 37, totalBytes: 100, phase: 'uploading' } }]} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '37');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '正在上传 · 37%');
    rerender(<WorkspaceDeploymentDialog {...props} deployments={[{ ...record, status: 'publishing',
      uploadProgress: { uploadedBytes: 100, totalBytes: 100, phase: 'verifying' } }]} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', labels.deploymentVerifying);
    expect(screen.queryByRole('heading', { name: labels.deploymentCompleteTitle })).toBeNull();
    expect(screen.queryByRole('textbox', { name: labels.deploymentDescription })).toBeNull();
    expect(screen.queryByText('Markdown')).toBeNull();
    expect(screen.queryByRole('button', { name: labels.deploymentAutofill })).toBeNull();
    rerender(<WorkspaceDeploymentDialog {...props} deployments={[{ ...record, status: 'succeeded', url: 'https://game.example/' }]} />);
    expect(await screen.findByText('版本 1 已上线。')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
    expect(screen.getByRole('heading', { name: labels.deploymentCompleteTitle })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: labels.deploymentDescription })).toBeNull();
    expect(screen.queryByText('Markdown')).toBeNull();
    expect(props.onDeploy).not.toHaveBeenCalled();
  });

  it('does not show the previous successful release as completion when a new request fails', async () => {
    let reject!: (error: Error) => void;
    const onDeploy = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const previous = { id: 'old', sessionId: 'session', workspacePath: '/test', status: 'succeeded' as const,
      url: 'https://game.example/old', createdAt: '', updatedAt: '' };
    render(<WorkspaceDeploymentDialog {...props} onDeploy={onDeploy} deployments={[previous]} />);
    const update = screen.getByRole('button', { name: labels.deploymentPublishUpdate });
    await waitFor(() => expect(update).toBeEnabled());
    fireEvent.click(update);
    expect(await screen.findByRole('progressbar')).toBeTruthy();
    expect(screen.queryByText('版本 1 已上线。')).toBeNull();
    reject(new Error('Publication rejected'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Publication rejected');
    expect(await screen.findByRole('textbox', { name: labels.deploymentDescription })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: labels.deploymentCompleteTitle })).toBeNull();
  });
  it('shows the new completion even if the response skips queued and publishing snapshots', async () => {
    const previous = { id: 'old', sessionId: 'session', workspacePath: '/test', status: 'succeeded' as const,
      url: 'https://game.example/old', createdAt: '', updatedAt: '' };
    const { rerender } = render(<WorkspaceDeploymentDialog {...props} deployments={[previous]} />);
    const update = screen.getByRole('button', { name: labels.deploymentPublishUpdate });
    await waitFor(() => expect(update).toBeEnabled());
    fireEvent.click(update);
    await waitFor(() => expect(props.onDeploy).toHaveBeenCalledOnce());
    rerender(<WorkspaceDeploymentDialog {...props} deployments={[{...previous,id:'new',url:'https://game.example/new'},previous]} />);
    expect(await screen.findByText('版本 2 已上线。')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('previews Markdown and publishes the original editable Markdown source', async () => {
    render(<WorkspaceDeploymentDialog {...props} />);
    const text = '## How to play\n\n- Move with **arrows**';
    fireEvent.change(screen.getByRole('textbox', { name: labels.deploymentDescription }), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentDescriptionPreview }));
    expect(screen.getByRole('heading', { name: 'How to play', level: 2 })).toBeTruthy();
    expect(screen.getByText('arrows').tagName).toBe('STRONG');
    fireEvent.click(screen.getByRole('button', { name: labels.deploymentDescriptionEdit }));
    expect(screen.getByRole('textbox', { name: labels.deploymentDescription })).toHaveValue(text);
    const publish = screen.getByRole('button', { name: labels.deploymentPublishAction });
    await waitFor(() => expect(publish).toBeEnabled());
    fireEvent.click(publish);
    await waitFor(() => expect(props.onDeploy).toHaveBeenCalledWith({ publicationDescription: { text, confirmed: true } }));
  });

});
