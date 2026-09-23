import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RightSidebar } from './RightSidebar';
import { api } from '../../services/api';
import { beeGameAdapter } from '../../services/beeGameAdapter';
import * as apiClient from '../../services/apiClient';
import { getWaitingPermissionState } from '../../utils/waitingPermission';

vi.mock('../../store/systemStore', () => ({
    useSystemStore: () => ({
        tasks: [],
    }),
}));

vi.mock('../../contexts/ToastContext', () => ({
    useToastContext: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

vi.mock('../../services/api', () => ({
    api: {
        getArtifacts: vi.fn().mockResolvedValue([]),
        getChatHistoryPaginationState: vi.fn(() => ({ initialized: false, hasMore: false })),
        getOlderChatHistory: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
        getArtifactReviewStatus: vi.fn().mockResolvedValue({}),
        getArtifactContent: vi.fn().mockResolvedValue(''),
        downloadProjectPackage: vi.fn().mockResolvedValue({ blob: new Blob(['zip']), filename: 'project.zip' }),
        getProjectAssets: vi.fn().mockResolvedValue({ version: 9, requirements: [], resources: [] }),
        uploadProjectAsset: vi.fn().mockResolvedValue({
            manifest: { version: 9, requirements: [], resources: [] },
      resource: { id: 'user-resource' },
      path: 'assets/resources/user-resource/file.bin',
      message: 'Resource added',
    }),
        requestProjectAction: vi.fn().mockResolvedValue({ task_id: 'beegame_proj_1', state: 'running' }),
    },
}));

vi.mock('../../services/beeGameAdapter', () => ({
    isBeeGameProjectPackageArtifactId: (id: string) => id.startsWith('beegame-project-package:'),
    beeGameAdapter: {
        getProjectGameContent: vi.fn().mockResolvedValue({ state: 'awaiting_content' }),
        getProjectGameContentFileList: vi.fn().mockResolvedValue({ state: 'awaiting_content' }),
        getProjectAssets: vi.fn().mockResolvedValue({ version: 9, requirements: [], resources: [] }),
    },
}));

const getChatInput = () => screen.getByRole('textbox') as HTMLTextAreaElement;

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe('RightSidebar tabs', () => {
    it('locks typing, attachments and send while a child runs after the parent, but keeps stop and details available', async () => {
        const onSendMessage = vi.fn();
        const onStopTask = vi.fn();
        const child = { id: 'active-child', sender: 'beegame', type: 'tool' as const, timestamp: Date.now(),
            content: 'Inspecting', toolName: 'Agent', toolStatus: 'running' as const, isSubagentTool: true };
        const props = { projectId: 'child-running', lang: 'en' as const, progress: 0, messages: [child],
            onSendMessage, onStopTask, isLoading: false, waitingPermission: getWaitingPermissionState(null) };
        const { rerender } = render(<RightSidebar {...props} />);
        expect(getChatInput()).toHaveAttribute('readonly');
        expect(screen.getByTestId('beegame-chat-attach-button')).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
        fireEvent.keyDown(getChatInput(), { key: 'Enter' });
        expect(onSendMessage).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Stop task' }));
        expect(onStopTask).toHaveBeenCalledOnce();
        rerender(<RightSidebar {...props} messages={[{ ...child, toolStatus: 'completed' }]} />);
        expect(getChatInput()).not.toHaveAttribute('readonly');
        expect(getChatInput()).toBeEnabled();
    });

    it('locks and dims a submitted draft immediately, then clears it on acceptance while Stop stays available', async () => {
        const request = deferred<boolean>();
        const onSendMessage = vi.fn(() => request.promise);
        const onStopTask = vi.fn();
        const props = { projectId: 'send-pending', lang: 'en' as const, progress: 0, messages: [],
            onSendMessage, onStopTask, isLoading: false, waitingPermission: getWaitingPermissionState(null) };
        const { rerender } = render(<RightSidebar {...props} />);
        fireEvent.change(getChatInput(), { target: { value: '继续' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(getChatInput()).toHaveValue('继续');
        expect(getChatInput()).toBeDisabled();
        expect(getChatInput()).toHaveAttribute('readonly');
        expect(getChatInput().closest('form')).toHaveClass('[&_textarea:read-only]:opacity-50');
        fireEvent.keyDown(getChatInput(), { key: 'Enter' });
        expect(onSendMessage).toHaveBeenCalledTimes(1);
        rerender(<RightSidebar {...props} isLoading />);
        expect(getChatInput()).toHaveAttribute('readonly');
        expect(screen.getByRole('button', { name: 'Stop task' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Stop task' }));
        expect(onStopTask).toHaveBeenCalledOnce();
        await act(async () => request.resolve(true));
        expect(getChatInput()).toHaveValue('');
    });

    it.each(['rejected', 'failed'])('restores editing and preserves the draft when send is %s', async outcome => {
        const request = deferred<boolean>();
        render(<RightSidebar projectId="send-failure" lang="en" progress={0} messages={[]}
            onSendMessage={() => request.promise} isLoading={false} waitingPermission={getWaitingPermissionState(null)} />);
        fireEvent.change(getChatInput(), { target: { value: '保留这段草稿' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await act(async () => outcome === 'failed' ? request.reject(new Error('Network failed')) : request.resolve(false));
        expect(getChatInput()).toHaveValue('保留这段草稿');
        expect(getChatInput()).toBeEnabled();
        expect(getChatInput()).not.toHaveAttribute('readonly');
        expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
    });

    it('does not clear a different project draft when an earlier send completes', async () => {
        const request = deferred<boolean>();
        const props = { lang: 'en' as const, progress: 0, messages: [], onSendMessage: () => request.promise,
            isLoading: false, waitingPermission: getWaitingPermissionState(null) };
        const { rerender } = render(<RightSidebar {...props} projectId="first" />);
        fireEvent.change(getChatInput(), { target: { value: 'First project' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        rerender(<RightSidebar {...props} projectId="second" />);
        expect(getChatInput()).toBeEnabled();
        fireEvent.change(getChatInput(), { target: { value: 'Second project draft' } });
        await act(async () => request.resolve(true));
        expect(getChatInput()).toHaveValue('Second project draft');
    });
    it('shows a live question even after a completed workflow and submits it as an answer', async () => {
        const onResolveToolPermission = vi.fn().mockResolvedValue(undefined);
        const projectStatus = { project_id: 'p', workflow: { status: 'completed' as const } };
        render(<RightSidebar projectId="p" lang="en" progress={100} isLoading={false}
            onSendMessage={vi.fn()} messages={[]} projectStatus={projectStatus}
            onResolveToolPermission={onResolveToolPermission}
            pendingPermissions={[{ gate_id: 'question', type: 'BEEGAME_PERMISSION', permission_tool_name: 'AskUserQuestion',
                artifact: { input: { questions: [{ question: 'Style?', options: [{ label: 'Pixel' }, { label: 'Vector' }] }] } },
            }]}
            waitingPermission={getWaitingPermissionState(projectStatus)} />);
        expect(screen.getByTestId('beegame-question-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('beegame-permission-panel')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('radio', { name: 'Pixel' }));
        fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
        expect(onResolveToolPermission).toHaveBeenCalledWith({ gate_id: 'question' }, 'allow', 'once', { 'Style?': 'Pixel' });
    });
    it.each(['Bash', 'AskUserQuestion'])('shows only the actionable %s card while waiting for permission', (toolName) => {
        const projectStatus = { project_id: 'p', blocked: true, blocked_reason: 'Bash requires permission.' };
        const pendingPermissions = [{ gate_id: 'gate', type: 'BEEGAME_PERMISSION' as const,
            permission_tool_name: toolName, artifact: { input: { command: 'pwd',
                questions: [{ question: 'Style?', options: [{ label: 'Pixel' }, { label: 'Vector' }] }] } } }];
        render(<RightSidebar projectId="p" lang="zh" progress={0} isLoading={false}
            onSendMessage={vi.fn()} messages={[]} projectStatus={projectStatus}
            pendingPermissions={pendingPermissions}
            waitingPermission={getWaitingPermissionState(projectStatus, pendingPermissions)} />);
        expect(screen.queryByText('当前任务需要处理，原因如下。')).not.toBeInTheDocument();
        expect(screen.queryByText('Bash requires permission.')).not.toBeInTheDocument();
        expect(screen.queryByText(/可在聊天中说明要求/)).not.toBeInTheDocument();
        expect(screen.getByTestId(toolName === 'Bash' ? 'beegame-permission-panel' : 'beegame-question-panel')).toBeInTheDocument();
        expect(screen.getByTestId('beegame-chat-input')).toBeDisabled();
    });
    it('omits the standalone blocker and sends continue as ordinary chat', async () => {
        const onSendMessage = vi.fn();
        const projectStatus = { project_id: 'blocked-project', blocked: true, workflow: {
                runId: 'run', status: 'blocked' as const, nextAction: 'retry' as const,
                block: { message: '验收未通过', detail: 'dist/assets/runtime：缺少验收证据' },
            } };
        render(<RightSidebar projectId="blocked-project" lang="zh" progress={0} onSendMessage={onSendMessage} isLoading={false}
            messages={[]} projectStatus={projectStatus}
            waitingPermission={getWaitingPermissionState(projectStatus)} />);
        expect(screen.queryByText('dist/assets/runtime：缺少验收证据')).toBeNull();
        expect(screen.queryByText('当前任务需要处理，原因如下。')).toBeNull();
        expect(screen.queryByRole('button', { name: /重试工作流|继续工作流/ })).toBeNull();
        expect(getChatInput().disabled).toBe(false);
        fireEvent.change(getChatInput(), { target: { value: '继续' } });
        fireEvent.keyDown(getChatInput(), { key: 'Enter', code: 'Enter' });
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
        expect(onSendMessage.mock.calls[0][0]).toBe('继续');
    });
    it('does not present historical workflow failure as the current conversation blocker', () => {
        render(<RightSidebar projectId="conversation" lang="zh" progress={0} onSendMessage={vi.fn()} isLoading={false}
            messages={[]} projectStatus={{ project_id: 'conversation', phase: 'idle', blocked: false, blocked_reason: null,
                workflow: { runId: 'old-run', status: 'blocked', nextAction: 'retry',
                    block: { message: 'Delivery has unresolved issues: historical verdict' } } }}
            waitingPermission={getWaitingPermissionState()} />);
        expect(screen.queryByText(/Delivery has unresolved issues/)).toBeNull();
        expect(screen.queryByText('当前任务需要处理，原因如下。')).toBeNull();
        expect(getChatInput().disabled).toBe(false);
    });
    it('does not recreate the standalone notice from conversation or historical workflow blockers', () => {
        render(<RightSidebar projectId="conversation" lang="zh" progress={0} onSendMessage={vi.fn()} isLoading={false}
            messages={[]} projectStatus={{ project_id: 'conversation', blocked: true, blocked_reason: 'Model transport disconnected',
                workflow: { runId: 'old-run', status: 'blocked', block: { message: 'Old delivery failed' } } }}
            waitingPermission={getWaitingPermissionState()} />);
        expect(screen.queryByText('Model transport disconnected')).toBeNull();
        expect(screen.queryByText('Old delivery failed')).toBeNull();
    });
    it('does not resurrect the permission notice after its actionable card disappears', () => {
        const projectStatus = { project_id: 'p', blocked: true, blocked_reason: 'Bash requires permission.' };
        const permissions = [{ gate_id: 'gate', type: 'BEEGAME_PERMISSION' as const,
            permission_tool_name: 'Bash', artifact: { input: { command: 'pwd' } } }];
        const props = { projectId: 'p', lang: 'zh' as const, progress: 0, isLoading: false,
            onSendMessage: vi.fn(), messages: [], projectStatus };
        const { rerender } = render(<RightSidebar {...props} pendingPermissions={permissions}
            waitingPermission={getWaitingPermissionState(projectStatus, permissions)} />);
        expect(screen.getByTestId('beegame-permission-panel')).toBeInTheDocument();
        rerender(<RightSidebar {...props} pendingPermissions={[]}
            waitingPermission={getWaitingPermissionState(projectStatus)} />);
        expect(screen.queryByTestId('beegame-permission-panel')).not.toBeInTheDocument();
        expect(screen.queryByText('当前任务需要处理，原因如下。')).not.toBeInTheDocument();
        expect(screen.queryByText('Bash requires permission.')).not.toBeInTheDocument();
        expect(screen.queryByText(/可在聊天中说明要求/)).not.toBeInTheDocument();
    });
    it('keeps loaded Chat images mounted across tab switches and releases them on exit', async () => {
        const fetchImage = vi.spyOn(apiClient, 'authenticatedFetch').mockResolvedValue(new Response(new Blob(['image'], { type:'image/png' })));
        const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:kept-image');
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const view = render(<RightSidebar projectId="image-project" lang="en" progress={0} onSendMessage={vi.fn()} isLoading={false}
            messages={[{id:'image-message',sender:'user',content:'Picture',timestamp:1,attachments:[{
                type:'image',filename:'asset.png',mediaType:'image/png',projectId:'image-project',
                storageId:'00000000-0000-0000-0000-000000000000-image.png',
            }]}]}
            waitingPermission={{kind:'none',isBlockingChat:false,isWaitingStatus:false,message:'',placeholder:'Type...'}} />);
        try {
            const image = await screen.findByRole('img', {name:'asset.png'});
            fireEvent.load(image);
            fireEvent.click(screen.getByRole('tab', {name:'Todo'}));
            expect(image.isConnected).toBe(true);
            expect(screen.queryByRole('img', {name:'asset.png'})).toBeNull();
            fireEvent.click(screen.getByRole('tab', {name:/Artifacts/}));
            fireEvent.click(screen.getByRole('tab', {name:'Chat'}));
            expect(screen.getByRole('img', {name:'asset.png'})).toBe(image);
            expect(fetchImage).toHaveBeenCalledTimes(1);
            expect(revoke).not.toHaveBeenCalled();
            view.unmount();
            expect(revoke).toHaveBeenCalledWith('blob:kept-image');
        } finally { view.unmount(); fetchImage.mockRestore(); create.mockRestore(); revoke.mockRestore(); }
    });
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(api.getChatHistoryPaginationState).mockReturnValue({ initialized: false, hasMore: false });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('loads older history only after reader interaction, not an initial layout scroll', async () => {
        vi.mocked(api.getChatHistoryPaginationState).mockReturnValue({ initialized: true, hasMore: true });
        render(<RightSidebar projectId="history-project" lang="en"
            messages={[{ id: 'latest', sender: 'beegame', content: 'Latest answer', timestamp: 1 }]}
            progress={0} onSendMessage={vi.fn()} isLoading={false}
            waitingPermission={{ kind: 'none', isBlockingChat: false, isWaitingStatus: false, message: '', placeholder: 'Type...' }}
        />);
        const viewport = screen.getByRole('region', { name: 'Conversation' });
        fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
        expect(api.getOlderChatHistory).not.toHaveBeenCalled();
        fireEvent.wheel(viewport, { deltaY: -100 });
        fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
        await waitFor(() => expect(api.getOlderChatHistory).toHaveBeenCalledTimes(1));
    });

    it('shows chat, todo, and artifacts tabs in canonical order', () => {
        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        expect(screen.getByRole('tab', { name: 'Chat' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Todo' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /^Artifacts/ })).toBeInTheDocument();
        expect(screen.getAllByRole('tab').map(tab => tab.textContent?.replace(/\d+$/, ''))).toEqual(['Chat', 'Todo', 'Artifacts']);
        expect(screen.queryByRole('tab', { name: '资源' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '运行时' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '任务看板' })).not.toBeInTheDocument();
    });

    it('shows the latest native TodoWrite snapshot only in the Todo tab', async () => {
        const user = userEvent.setup();
        render(
            <RightSidebar
                projectId="proj_1"
                lang="en"
                messages={[{
                    id: 'todo-1', sender: 'system', content: '', timestamp: 1, type: 'tool', toolName: 'TodoWrite',
                    toolInput: { todos: [{ content: 'Build the scene', status: 'in_progress' }] },
                }]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingPermission={{ kind: 'none', isBlockingChat: false, isWaitingStatus: false, message: '', placeholder: 'Type...' }}
            />
        );

        expect(screen.queryByText('Build the scene')).not.toBeInTheDocument();
        await user.click(screen.getByRole('tab', { name: 'Todo' }));
        expect(screen.getByText('Build the scene')).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /^Tasks/ })).toBeInTheDocument();
    });

    it.each(['scene', 'ui'] as const)('lists %s JSON files before opening the chosen file in a new tab', async kind => {
        const user = userEvent.setup();
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        window.history.replaceState({}, '', '/?project=proj_1');
        vi.mocked(beeGameAdapter.getProjectGameContentFileList).mockResolvedValueOnce({ state: 'ready', documents: [
            { path: 'scenes/a.json', revision: 'a', id: 'scene.a', kind: 'scene-2d' },
            { path: 'scenes/b.json', revision: 'b', id: 'scene.b', kind: 'scene-3d' },
            { path: 'ui/menu.json', revision: 'c', id: 'ui.menu', kind: 'ui-screen' },
            { path: 'ui/hud.json', revision: 'd', id: 'ui.hud', kind: 'ui-hud' },
            { path: 'ui/app-flow.json', revision: 'e', id: 'ui.flow', kind: 'ui-flow' },
        ] });
        const before = window.location.href;
        render(<RightSidebar projectId="proj_1" lang="en" messages={[]} progress={0} onSendMessage={vi.fn()} isLoading={false}
            waitingPermission={{kind:'none',isBlockingChat:false,isWaitingStatus:false,message:'',placeholder:'Type...'}} />);
        await user.click(screen.getByRole('tab', { name: /^Artifacts/ }));
        expect(beeGameAdapter.getProjectGameContentFileList).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: kind === 'scene' ? 'Scene' : 'UI', exact: true }));
        const file = kind === 'scene' ? 'b.json' : 'hud.json';
        await user.click(await screen.findByRole('button', { name: new RegExp(file) }));
        expect(screen.queryByText('app-flow.json')).not.toBeInTheDocument();
        const url = new URL(String(open.mock.calls[0][0]));
        expect(url.searchParams.get('editor')).toBe(kind);
        expect(url.searchParams.get('editorFile')).toBe(kind === 'scene' ? 'scenes/b.json' : 'ui/hud.json');
        expect(open).toHaveBeenCalledWith(expect.any(String), '_blank', 'noopener,noreferrer');
        expect(window.location.href).toBe(before);
        expect(screen.queryByRole('dialog', { name: /Editor/ })).not.toBeInTheDocument();
        open.mockRestore();
    });

    it('shows durable foundation completion in the deliverables tab count before opening it', () => {
        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                projectStatus={{
                    project_id: 'proj_1',
                    workflow: {
                        runId: 'run_foundation_handoff',
                        status: 'cancelled',
                        currentPhase: 'DOCUMENT_DRAFTING',
                        tasks: Array.from({ length: 8 }, (_, index) => ({
                            id: `docs/foundation-${index}.md`,
                            title: `docs/foundation-${index}.md`,
                            status: 'completed' as const,
                        })),
                    },
                }}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        // The fixture above intentionally uses non-canonical names to prove
        // that unrelated workflow tasks do not inflate the document counter.
        expect(screen.getByRole('tab', { name: /^Artifacts/ })).toHaveTextContent('3');
    });

    it('refreshes artifacts when a Level or Balance document event arrives', async () => {
        const first = deferred<any[]>();
        const second = deferred<any[]>();
        vi.mocked(api.getArtifacts)
            .mockImplementationOnce(() => first.promise)
            .mockImplementationOnce(() => second.promise);

        const view = render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        await userEvent.setup().click(screen.getByRole('tab', { name: /^Artifacts/ }));
        await waitFor(() => expect(api.getArtifacts).toHaveBeenCalledTimes(1));

        view.rerender(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[{
                    id: 'level', sender: 'system', content: '', timestamp: 1, type: 'tool',
                    artifactPath: 'docs/LEVEL_SCENE_DESIGN.md', toolStatus: 'completed',
                }]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        await waitFor(() => expect(api.getArtifacts).toHaveBeenCalledTimes(2));
        await act(async () => second.resolve([]));
        await act(async () => first.resolve([]));
    });

    it('shows a user-visible error when artifact refresh fails', async () => {
        vi.mocked(api.getArtifacts).mockRejectedValueOnce(new Error('network down'));

        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        await userEvent.setup().click(screen.getByRole('tab', { name: /^Artifacts/ }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('交付物'));
    });

    it('ignores an older artifact response after a newer refresh completes', async () => {
        const first = deferred<any[]>();
        const second = deferred<any[]>();
        vi.mocked(api.getArtifacts)
            .mockImplementationOnce(() => first.promise)
            .mockImplementationOnce(() => second.promise);

        const view = render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );
        await userEvent.setup().click(screen.getByRole('tab', { name: /^Artifacts/ }));
        await waitFor(() => expect(api.getArtifacts).toHaveBeenCalledTimes(1));

        view.rerender(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[{
                    id: 'gdd', sender: 'system', content: '', timestamp: 1, type: 'tool',
                    artifactPath: 'docs/GDD.md', toolStatus: 'completed',
                }]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );
        await waitFor(() => expect(api.getArtifacts).toHaveBeenCalledTimes(2));

        await act(async () => second.resolve([{ id: 'new', path: 'docs/new.md', name: 'new.md' }]));
        fireEvent.click(screen.getByRole('button', { name: /项目文档/ }));
        await waitFor(() => expect(screen.getByText('new.md')).toBeInTheDocument());
        await act(async () => first.resolve([{ id: 'old', path: 'docs/old.md', name: 'old.md' }]));
        await waitFor(() => expect(screen.queryByText('old.md')).not.toBeInTheDocument());
        expect(screen.getByText('new.md')).toBeInTheDocument();
    });

    it('clears the previous project artifacts while switching projects', async () => {
        const first = deferred<any[]>();
        const second = deferred<any[]>();
        vi.mocked(api.getArtifacts)
            .mockImplementationOnce(() => first.promise)
            .mockImplementationOnce(() => second.promise);

        const view = render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );
        await userEvent.setup().click(screen.getByRole('tab', { name: /^Artifacts/ }));
        await waitFor(() => expect(api.getArtifacts).toHaveBeenCalledTimes(1));
        await act(async () => first.resolve([{ id: 'old', path: 'docs/old.md', name: 'old.md' }]));
        fireEvent.click(screen.getByRole('button', { name: /项目文档/ }));
        await waitFor(() => expect(screen.getByText('old.md')).toBeInTheDocument());

        view.rerender(
            <RightSidebar
                projectId="proj_2"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        expect(screen.queryByText('old.md')).not.toBeInTheDocument();
        await waitFor(() => expect(api.getArtifacts).toHaveBeenCalledTimes(2));
        await act(async () => second.resolve([{ id: 'new', path: 'docs/new.md', name: 'new.md' }]));
        fireEvent.click(screen.getByRole('button', { name: /项目文档/ }));
        await waitFor(() => expect(screen.getByText('new.md')).toBeInTheDocument());
    });

    it('does not send chat input while the runtime is busy', async () => {
        const user = userEvent.setup();
        const onSendMessage = vi.fn();

        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={onSendMessage}
                isLoading={false}
                isRuntimeBusy={true}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        const input = screen.getByPlaceholderText(/AI 正在处理/i);
        expect(input).toBeDisabled();

        await user.click(screen.getByRole('tab', { name: 'Chat' }));
        expect(onSendMessage).not.toHaveBeenCalled();
    });

    it('does not expose runtime thinking controls in the project chat', async () => {
        const user = userEvent.setup();
        const onSendMessage = vi.fn();

        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={onSendMessage}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        expect(screen.queryByLabelText('思考')).not.toBeInTheDocument();
        await waitFor(() => expect(getChatInput()).toHaveStyle({ height: '56px' }));

        await user.type(getChatInput(), '先修复渲染问题');
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSendMessage).toHaveBeenLastCalledWith(
            '先修复渲染问题',
            [],
            undefined,
        );
    });

    it('removes the minimize affordance in BeeGame mode', () => {
        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        expect(screen.getByRole('tab', { name: 'Chat' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '最小化聊天' })).not.toBeInTheDocument();
    });

    it('sends an uploaded screenshot attachment without requiring text', async () => {
        const user = userEvent.setup();
        const onSendMessage = vi.fn();

        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={onSendMessage}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        const image = new File(['png-bytes'], 'screen.png', { type: 'image/png' });
        const attachButton = screen.getByRole('button', { name: '上传附件' });
        const input = document.getElementById('beegame-chat-attachment-upload') as HTMLInputElement;
        const inputClick = vi.spyOn(input, 'click').mockImplementation(() => undefined);
        await user.click(attachButton);
        expect(inputClick).toHaveBeenCalledTimes(1);
        await user.upload(input, image);

        await waitFor(() => expect(screen.getByAltText('screen.png')).toBeInTheDocument());
        const attachmentList = screen.getByTestId('beegame-chat-attachments');
        expect(attachmentList).toHaveClass('justify-start');
        expect(attachmentList).not.toHaveClass('px-4');
        const attachmentPreview = screen.getByAltText('screen.png').closest('.chat-attachment-preview');
        expect(attachmentPreview).toHaveClass('hover:border-[var(--ring)]', 'hover:ring-1', 'focus-within:ring-1');
        expect(screen.getByRole('button', { name: 'Remove attachment' })).toHaveClass('chat-attachment-remove', 'bg-[var(--surface-1)]', 'text-[var(--text-primary)]');
        await user.click(screen.getByRole('button', { name: 'Send message' }));

        expect(onSendMessage).toHaveBeenCalledWith('', [
            expect.objectContaining({
                type: 'image',
                mediaType: 'image/png',
                filename: 'screen.png',
            }),
        ], undefined);
        expect(onSendMessage.mock.calls[0][1][0].data).toEqual(expect.any(String));
    });

    it('sends an uploaded JSONL document attachment without rendering it as an image', async () => {
        const user = userEvent.setup();
        const onSendMessage = vi.fn();

        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={onSendMessage}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        const input = document.getElementById('beegame-chat-attachment-upload') as HTMLInputElement;
        expect(input.accept).toContain('.jsonl');
        expect(input.accept).not.toContain('image/gif');

        await user.upload(input, new File(['{"ok":true}\n'], 'events.jsonl', { type: 'application/jsonl' }));

        await waitFor(() => expect(screen.getByText('events.jsonl')).toBeInTheDocument());
        expect(screen.queryByAltText('events.jsonl')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Send message' }));

        expect(onSendMessage).toHaveBeenCalledWith('', [
            expect.objectContaining({
                type: 'file',
                mediaType: 'application/jsonl',
                filename: 'events.jsonl',
            }),
        ], undefined);
    });

    it('accepts pasted screenshot attachments in the chat composer', async () => {
        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        const image = new File(['png-bytes'], 'pasted-screen.png', { type: 'image/png' });
        fireEvent.paste(getChatInput(), {
            clipboardData: {
                files: [image],
            },
        });

        await waitFor(() => expect(screen.getByAltText('pasted-screen.png')).toBeInTheDocument());
    });

    it('accepts pasted screenshots exposed as clipboard items', async () => {
        const onSendMessage = vi.fn();
        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={onSendMessage}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        const image = new File(['png-bytes'], 'clipboard-screen.png', { type: 'image/png' });
        fireEvent.paste(getChatInput(), {
            clipboardData: {
                files: [],
                items: [{
                    kind: 'file',
                    type: 'image/png',
                    getAsFile: () => image,
                }],
            },
        });

        await waitFor(() => expect(screen.getByAltText('clipboard-screen.png')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSendMessage).toHaveBeenCalledWith('', [
            expect.objectContaining({
                type: 'image',
                mediaType: 'image/png',
                filename: 'clipboard-screen.png',
            }),
        ], undefined);
    });

    it('deduplicates pasted screenshots exposed through both clipboard files and items', async () => {
        const onSendMessage = vi.fn();
        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={onSendMessage}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        const image = new File(['png-bytes'], 'duplicated-screen.png', { type: 'image/png' });
        fireEvent.paste(getChatInput(), {
            clipboardData: {
                files: [image],
                items: [{
                    kind: 'file',
                    type: 'image/png',
                    getAsFile: () => image,
                }],
            },
        });

        await waitFor(() => expect(screen.getAllByAltText('duplicated-screen.png')).toHaveLength(1));
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSendMessage.mock.calls[0][1]).toHaveLength(1);
    });

    it('deduplicates pasted screenshots with identical image data even when clipboard file metadata differs', async () => {
        const onSendMessage = vi.fn();
        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={onSendMessage}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        const clipboardFile = new File(['same-png-bytes'], 'clipboard.png', {
            type: 'image/png',
            lastModified: 1,
        });
        const itemFile = new File(['same-png-bytes'], 'image.png', {
            type: 'image/png',
            lastModified: 2,
        });
        fireEvent.paste(getChatInput(), {
            clipboardData: {
                files: [clipboardFile],
                items: [{
                    kind: 'file',
                    type: 'image/png',
                    getAsFile: () => itemFile,
                }],
            },
        });

        await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1));
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSendMessage.mock.calls[0][1]).toHaveLength(1);
    });

    it('deduplicates the same pasted screenshot if duplicate paste events append it twice', async () => {
        const onSendMessage = vi.fn();
        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={onSendMessage}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        const pasteTarget = getChatInput();
        const image = new File(['same-png-bytes'], 'pasted-again.png', { type: 'image/png' });
        fireEvent.paste(pasteTarget, {
            clipboardData: {
                files: [image],
            },
        });
        fireEvent.paste(pasteTarget, {
            clipboardData: {
                files: [image],
            },
        });

        await waitFor(() => expect(screen.getAllByAltText('pasted-again.png')).toHaveLength(1));
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSendMessage.mock.calls[0][1]).toHaveLength(1);
    });

    it('uploads assets without automatically sending an integration prompt', async () => {
        const user = userEvent.setup();
        const onSendMessage = vi.fn();
        vi.mocked(api.getProjectAssets).mockResolvedValue({
            version: 8,
            project_target: { platform: 'web', runtime: 'react',
        asset_format_capabilities: ['audio/mpeg'],
        runtime_asset_root: 'client/public/assets',
        content_root: 'assets/content',
        generated_asset_root: 'assets/generated',
      },
            requirements: [{
                id: 'bgm_game',
                name: 'Game BGM',
                purpose: 'Game background music',
                status: 'ready',
        },
      ],
      resources: [{ id: 'user-bgm', source: { type: 'user-provided', created_at: '2026-07-22T00:00:00.000Z', filename: 'game.mp3' }, status: 'available', root_path: 'client/public/assets/resources/user-bgm/game.mp3',
          file_paths: ['client/public/assets/resources/user-bgm/game.mp3'],
          provisional: false,
          selected_at: '2026-07-22T00:00:00.000Z', selection_reason: ['User provided this project resource.'] }],
        });
        vi.mocked(api.uploadProjectAsset).mockResolvedValue({
            manifest: {
                version: 8,
                project_target: { platform: 'web', runtime: 'react',
          asset_format_capabilities: ['audio/mpeg'],
          runtime_asset_root: 'client/public/assets',
          content_root: 'assets/content',
          generated_asset_root: 'assets/generated',
        },
                requirements: [{
                    id: 'bgm_game',
                    name: 'Game BGM',
                    purpose: 'Game background music',
                    status: 'ready',
          },
        ],
        resources: [{ id: 'user-bgm', source: { type: 'user-provided', created_at: '2026-07-22T00:00:00.000Z', filename: 'game.mp3' }, status: 'available', root_path: 'client/public/assets/resources/user-bgm/game.mp3',
            file_paths: ['client/public/assets/resources/user-bgm/game.mp3'],
            provisional: false,
            selected_at: '2026-07-22T00:00:00.000Z', selection_reason: ['User provided this project resource.'] }],
            },
      resource: { id: 'user-bgm',
        source: { type: 'user-provided', created_at: '2026-07-22T00:00:00.000Z', filename: 'game.mp3' },
        status: 'available',
        root_path: 'client/public/assets/resources/user-bgm/game.mp3',
        file_paths: ['client/public/assets/resources/user-bgm/game.mp3'],
        provisional: false,
        selected_at: '2026-07-22T00:00:00.000Z',
        selection_reason: ['User provided this project resource.'],
      },
            path: 'client/public/assets/resources/user-bgm/game.mp3',
            message: 'Resource added',
    });

        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={onSendMessage}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        await user.click(screen.getByRole('tab', { name: /^Artifacts/ }));
        await user.click(screen.getByRole('button', { name: '资源' }));
        const file = new File(['audio'], 'game.mp3', { type: 'audio/mpeg' });
        await user.upload(await screen.findByLabelText('添加资源'), file);

        expect(api.uploadProjectAsset).toHaveBeenCalledWith('proj_1', expect.stringMatching(/^user-/), file);
        expect(onSendMessage).not.toHaveBeenCalled();

        expect(screen.queryByRole('button', { name: '让 Agent 探索资源' })).not.toBeInTheDocument();
        expect(api.requestProjectAction).not.toHaveBeenCalled();
        expect(onSendMessage).not.toHaveBeenCalled();
    });

    it('shows an empty asset contract message when a restored project has no manifest', async () => {
        const user = userEvent.setup();
        vi.mocked(api.getProjectAssets).mockResolvedValue({ version: 8, requirements: [],
      resources: [],
    });

        render(
            <RightSidebar
                projectId="proj_empty_assets"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        await user.click(screen.getByRole('tab', { name: /^Artifacts/ }));
        await user.click(screen.getByRole('button', { name: '资源' }));

        expect(await screen.findByText(/还没有资源合同/)).toBeInTheDocument();
    });

    it('stops polling when a project has a retired asset manifest schema', async () => {
        vi.useFakeTimers();
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(api.getProjectAssets).mockRejectedValue(
            Object.assign(new Error('Invalid asset manifest'), {
                code: 'invalid_asset_manifest',
            }),
        );

        render(
            <RightSidebar
                projectId="proj_retired_assets"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        fireEvent.click(screen.getByRole('tab', { name: /^Artifacts/ }));
        fireEvent.click(screen.getByRole('button', { name: '资源' }));
        await act(async () => {
            await Promise.resolve();
        });
        await act(async () => {
            vi.advanceTimersByTime(10_000);
            await Promise.resolve();
        });

        expect(api.getProjectAssets).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/还没有资源合同/)).toBeInTheDocument();
        expect(errorLog).not.toHaveBeenCalled();
        errorLog.mockRestore();
    });

    it('keeps the existing asset contract visible when a refresh request fails', async () => {
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.useFakeTimers();
        vi.mocked(api.getProjectAssets)
            .mockResolvedValueOnce({
                version: 8,
                project_target: {
          asset_format_capabilities: ['audio/ogg'],
          runtime_asset_root: 'public/game-assets',
          content_root: 'assets/content',
          generated_asset_root: 'assets/generated',
        },
                requirements: [{
                    id: 'bgm_game',
                    name: 'Game BGM',
                    purpose: 'Game background music',
                    status: 'ready',
          },
        ],
        resources: [{
                    id: 'bgm_upload',
                    source: { type: 'user-provided', created_at: '2026-07-22T00:00:00.000Z', filename: 'theme.ogg' },
                    status: 'available',
                    root_path: 'public/game-assets/resources/bgm_upload/theme.ogg',
            file_paths: ['public/game-assets/resources/bgm_upload/theme.ogg'],
            provisional: false,
            selected_at: '2026-07-22T00:00:00.000Z',
                    selection_reason: ['User uploaded theme.ogg'],
                }],
      })
            .mockRejectedValueOnce(new Error('Session not found'));

        render(
            <RightSidebar
                projectId="proj_1"
                lang="zh"
                messages={[]}
                progress={0}
                onSendMessage={vi.fn()}
                isLoading={false}
                waitingPermission={{
                    kind: 'none',
                    isBlockingChat: false,
                    isWaitingStatus: false,
                    message: '',
                    placeholder: 'Type...',
                }}
            />
        );

        fireEvent.click(screen.getByRole('tab', { name: /^Artifacts/ }));
        fireEvent.click(screen.getByRole('button', { name: '资源' }));
        await act(async () => {
            await Promise.resolve();
        });
        expect(screen.getByText('Game BGM')).toBeInTheDocument();

        await act(async () => {
            vi.advanceTimersByTime(5000);
            await Promise.resolve();
        });

        expect(screen.getByText('Game BGM')).toBeInTheDocument();
        expect(screen.queryByText(/还没有资源合同/)).not.toBeInTheDocument();
        expect(errorLog).toHaveBeenCalledWith('Failed to load project assets:', expect.any(Error));
        errorLog.mockRestore();
        vi.useRealTimers();
    });

    it('clears the previous project asset manifest when switching projects', async () => {
        const user = userEvent.setup();
        vi.mocked(api.getProjectAssets).mockImplementation(async (projectId: string) => {
            if (projectId === 'proj_1') {
                return {
                    version: 8,
                    requirements: [{
                        id: 'bgm_game',
                        name: 'Game BGM',
                        purpose: 'Game background music',
                        status: 'unresolved',
                    }],
                    resources: [],
                };
            }
            return { version: 8, requirements: [], resources: [] };
        });
        const baseProps = {
            lang: 'zh' as const,
            messages: [],
            progress: 0,
            onSendMessage: vi.fn(),
            isLoading: false,
            waitingPermission: {
                kind: 'none' as const,
                isBlockingChat: false,
                isWaitingStatus: false,
                message: '',
                placeholder: 'Type...',
            },
            variant: 'beegame' as const,
        };

        const { rerender } = render(
            <RightSidebar
                {...baseProps}
                projectId="proj_1"
            />
        );

        await user.click(screen.getByRole('tab', { name: /^Artifacts/ }));
        await user.click(screen.getByRole('button', { name: '资源' }));
        expect(await screen.findByText('Game BGM')).toBeInTheDocument();

        rerender(
            <RightSidebar
                {...baseProps}
                projectId="proj_2"
            />
        );

        await waitFor(() => expect(screen.queryByText('Game BGM')).not.toBeInTheDocument());
        expect(api.getProjectAssets).toHaveBeenCalledWith('proj_2');
    });
});
