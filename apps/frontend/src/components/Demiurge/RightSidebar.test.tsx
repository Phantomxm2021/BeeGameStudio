import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RightSidebar } from './RightSidebar';
import { api } from '../../services/api';
import { beeGameAdapter } from '../../services/beeGameAdapter';
import * as apiClient from '../../services/apiClient';
import { getWaitingPermissionState } from '../../utils/waitingPermission';

const showErrorMock = vi.hoisted(() => vi.fn());

vi.mock('../../store/systemStore', () => ({
    useSystemStore: () => ({
        tasks: [],
    }),
}));

vi.mock('../../contexts/ToastContext', () => ({
    useToastContext: () => ({ showSuccess: vi.fn(), showError: showErrorMock }),
}));

vi.mock('../../services/api', () => ({
    api: {
        getTaskRecovery: vi.fn().mockResolvedValue(null),
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
        listQueuedMessages: vi.fn().mockResolvedValue([]),
        steerQueuedMessage: vi.fn().mockResolvedValue(undefined),
        deleteQueuedMessage: vi.fn().mockResolvedValue(undefined),
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
    it('places the retry capsule beside the model error and keeps historical errors manual', async () => {
        vi.useFakeTimers();
        const onContinueTask = vi.fn().mockResolvedValue(undefined);
        const props = { projectId: 'inline-retry', lang: 'en' as const, progress: 0, isLoading: false,
            messages: [{ id: 'model-failure', sender: 'system', type: 'error' as const, taskKind: 'runtime_error',
                turnId: 'failed-turn', content: 'Selected model is at capacity.', timestamp: Date.now() }],
            onSendMessage: vi.fn(), onContinueTask, waitingPermission: getWaitingPermissionState([]),
            projectStatus: { project_id: 'inline-retry', phase: 'paused', blocked: true } };
        const view = render(<RightSidebar {...props} />);
        await act(async () => vi.advanceTimersByTime(20_000));
        expect(onContinueTask).not.toHaveBeenCalled();
        const error = screen.getByRole('alert');
        expect(within(error).getByRole('button', { name: 'Retry now' })).toHaveTextContent('Retry');
        view.rerender(<RightSidebar {...props} autoRetryTurnId="failed-turn" />);
        expect(within(error).getByRole('button', { name: 'Retry now' })).toHaveTextContent('Retry in 10s');
        await act(async () => vi.advanceTimersByTime(10_000));
        expect(onContinueTask).toHaveBeenCalledExactlyOnceWith('failed-turn', true);
    });

    it('does not start the countdown while failed execution ownership is unknown', async () => {
        vi.useFakeTimers();
        const pending = deferred<null>();
        vi.mocked(api.getTaskRecovery).mockReturnValueOnce(pending.promise);
        const onContinueTask = vi.fn();
        render(<RightSidebar projectId="waiting-for-cleanup" lang="en" progress={0} isLoading={false}
            messages={[{ id: 'failed', sender: 'system', type: 'error', turnId: 'failed-turn',
                content: 'API Error: Connection error.', timestamp: Date.now() }]}
            projectStatus={{ project_id: 'waiting-for-cleanup', phase: 'paused', blocked: true }}
            autoRetryTurnId="failed-turn" onContinueTask={onContinueTask} onSendMessage={vi.fn()}
            waitingPermission={getWaitingPermissionState([])} />);
        await act(async () => vi.advanceTimersByTime(20_000));
        expect(onContinueTask).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Retry now' })).toBeDisabled();
        await act(async () => { pending.resolve(null); await pending.promise; });
        expect(screen.getByRole('button', { name: 'Retry now' })).toHaveTextContent('Retry in 10s');
    });

    it('does not add a separate continuation panel to a paused task', async () => {
        const onContinueTask = vi.fn().mockResolvedValue(undefined);
        const onSendMessage = vi.fn();
        const props = { projectId: 'provider-refusal', lang: 'zh' as const, progress: 0, isLoading: false,
            messages: [], onSendMessage, onContinueTask, waitingPermission: getWaitingPermissionState([]),
            projectStatus: { project_id: 'provider-refusal', phase: 'paused', blocked: true } };
        const view = render(<RightSidebar {...props} />);
        expect(screen.queryByRole('button', { name: '继续原任务' })).not.toBeInTheDocument();
        expect(screen.queryByText('任务未完成，已有进度保留。继续会发起新的模型请求。')).not.toBeInTheDocument();
        expect(onContinueTask).not.toHaveBeenCalled();
        expect(onSendMessage).not.toHaveBeenCalled();
        view.rerender(<RightSidebar {...props} lang="en" />);
        expect(screen.queryByRole('button', { name: 'Continue task' })).not.toBeInTheDocument();
        expect(screen.getByTestId('beegame-chat-input')).toBeEnabled();
        expect(onContinueTask).not.toHaveBeenCalled();
    });

    it('preserves sent V3 messages and accepts a new correction instead of rewriting history', async () => {
        const onSendMessage = vi.fn().mockResolvedValue(true);
        render(<RightSidebar projectId="inline-edit" lang="en" progress={0} isLoading={false}
            messages={[{ id: 'user-edit-target', sender: 'user', content: 'Original request', timestamp: 1, rewindAvailable: true }]}
            onSendMessage={onSendMessage} waitingPermission={getWaitingPermissionState([])} />);

        const composerInput = screen.getByTestId('beegame-chat-input');
        expect(screen.queryByLabelText('Message intent')).not.toBeInTheDocument();
        fireEvent.change(composerInput, { target: { value: 'Independent new prompt' } });
        expect(composerInput).toHaveClass('type-chat-body');
        expect(screen.getByTestId('beegame-chat-composer').parentElement).toHaveClass('shrink-0');
        expect(screen.getByTestId('beegame-chat-composer').parentElement).not.toHaveClass('pt-3', 'pb-3');
        const message = screen.getByTestId('beegame-user-message-user-edit-target');
        expect(within(message).getByText('Original request').closest('p')).toHaveClass('type-chat-body');
        expect(screen.queryByRole('button', { name: 'Edit message' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
        await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith('Independent new prompt', [], undefined));
        expect(within(message).getByText('Original request')).toBeInTheDocument();
    });

    it('hides the edit action while the Agent is running', () => {
        render(<RightSidebar projectId="busy-edit" lang="en" progress={0} isLoading
            messages={[{ id: 'original-request', sender: 'user', content: 'Original request', timestamp: 1 }]}
            onSendMessage={vi.fn()} waitingPermission={getWaitingPermissionState([])} />);

        expect(screen.getByText('Original request')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit message' })).not.toBeInTheDocument();
    });

    it('does not treat a historical running child record as a live Agent', () => {
        const child = { id: 'active-child', sender: 'beegame', type: 'tool' as const, timestamp: Date.now(),
            content: 'Inspecting', toolName: 'Agent', toolStatus: 'running' as const, isSubagentTool: true };
        render(<RightSidebar projectId="child-history" lang="en" progress={0} messages={[child]}
            onSendMessage={vi.fn().mockResolvedValue(true)} onStopTask={vi.fn()}
            isLoading={false} waitingPermission={getWaitingPermissionState()} />);
        expect(getChatInput()).not.toHaveAttribute('readonly');
        expect(screen.getByTestId('beegame-chat-attach-button')).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Stop task' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
    });

    it('uses the runtime busy state for Stop even before chat streaming begins', () => {
        render(<RightSidebar projectId="runtime-starting" lang="en" progress={0} messages={[]}
            onSendMessage={vi.fn().mockResolvedValue(true)} onStopTask={vi.fn()}
            isLoading={false} isRuntimeBusy waitingPermission={getWaitingPermissionState()} />);
        expect(screen.getByRole('button', { name: 'Stop task' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
    });

    it('locks and dims a submitted draft immediately, then clears it on acceptance while Stop stays available', async () => {
        const request = deferred<boolean>();
        const onSendMessage = vi.fn(() => request.promise);
        const onStopTask = vi.fn();
        const props = { projectId: 'send-pending', lang: 'en' as const, progress: 0, messages: [],
            onSendMessage, onStopTask, isLoading: false, waitingPermission: getWaitingPermissionState() };
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
            onSendMessage={() => request.promise} isLoading={false} waitingPermission={getWaitingPermissionState()} />);
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
            isLoading: false, waitingPermission: getWaitingPermissionState() };
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
            waitingPermission={getWaitingPermissionState()} />);
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
            waitingPermission={getWaitingPermissionState(pendingPermissions)} />);
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
            waitingPermission={getWaitingPermissionState()} />);
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
            waitingPermission={getWaitingPermissionState(permissions)} />);
        expect(screen.getByTestId('beegame-permission-panel')).toBeInTheDocument();
        rerender(<RightSidebar {...props} pendingPermissions={[]}
            waitingPermission={getWaitingPermissionState()} />);
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
        vi.mocked(beeGameAdapter.listQueuedMessages).mockResolvedValue([]);
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

    it('keeps the first visible message anchored when older history is prepended', async () => {
        vi.mocked(api.getChatHistoryPaginationState).mockReturnValue({ initialized: true, hasMore: true });
        const page = deferred<{ messages: Array<Record<string, unknown>>; hasMore: boolean }>();
        vi.mocked(api.getOlderChatHistory).mockReturnValue(page.promise);
        const earlierResponse = { id: 'earlier-response', sender: 'beegame' as const, type: 'text' as const, content: 'Earlier response', timestamp: 100, turnId: 'same-turn' };
        const turnSeparator = { id: 'turn-separator', sender: 'user' as const, content: 'Follow-up', timestamp: 150 };
        const latest = { id: 'latest-visible', sender: 'beegame' as const, type: 'text' as const, content: 'Latest visible response', timestamp: 200, turnId: 'same-turn' };
        const older = { id: 'older-page-item', sender: 'user' as const, content: 'Older message', timestamp: 100 };
        const view = render(<RightSidebar projectId="history-anchor" lang="en" progress={0}
            messages={[earlierResponse, turnSeparator, latest]} onSendMessage={vi.fn()} isLoading={false}
            waitingPermission={{ kind: 'none', isBlockingChat: false, isWaitingStatus: false, message: '', placeholder: 'Type...' }}
        />);
        const viewport = screen.getByRole('region', { name: 'Conversation' });
        const visibleMessage = viewport.querySelector<HTMLElement>('[data-history-anchor-id="response:latest-visible"]');
        if (!visibleMessage) throw new Error('Expected the latest message anchor');
        expect(viewport.querySelectorAll('[data-message-id="same-turn"]')).toHaveLength(2);
        expect(viewport.querySelectorAll('[data-history-anchor-id^="response:"]')).toHaveLength(2);
        let hasPrepended = false;
        viewport.getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 500, width: 500, height: 500, x: 0, y: 0, toJSON: () => ({}) });
        visibleMessage.getBoundingClientRect = () => ({
            top: hasPrepended ? 130 : 30, bottom: hasPrepended ? 190 : 90,
            left: 0, right: 500, width: 500, height: 60, x: 0, y: hasPrepended ? 130 : 30, toJSON: () => ({}),
        });
        Object.defineProperty(viewport, 'scrollHeight', { configurable: true, get: () => hasPrepended ? 1200 : 1000 });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
        viewport.scrollTop = 0;

        fireEvent.wheel(viewport, { deltaY: -100 });
        fireEvent.scroll(viewport, { target: { scrollTop: 0 } });
        await waitFor(() => expect(api.getOlderChatHistory).toHaveBeenCalledTimes(1));
        hasPrepended = true;
        await act(async () => {
            page.resolve({ messages: [older], hasMore: true });
            await page.promise;
        });
        // The API response can arrive before the parent commits the external-store
        // history update. Keep auto-follow paused until that DOM commit is anchored.
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
        expect(screen.getByRole('button', { name: /Loading earlier messages/i })).toBeDisabled();
        await act(async () => {
            view.rerender(<RightSidebar projectId="history-anchor" lang="en" progress={0}
                messages={[older, earlierResponse, turnSeparator, latest]} onSendMessage={vi.fn()} isLoading={false}
                waitingPermission={{ kind: 'none', isBlockingChat: false, isWaitingStatus: false, message: '', placeholder: 'Type...' }}
            />);
        });
        await waitFor(() => expect(viewport.scrollTop).toBe(100));
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
        expect(screen.queryByRole('region', { name: /Document delivery/ })).not.toBeInTheDocument();
    });

    it('does not turn the author milestone into a second eight-document todo list', () => {
        render(<RightSidebar projectId="document-author-phase" lang="zh" progress={0} isLoading
            messages={[{ id: 'author-phase', sender: 'system', content: 'author', taskKind: 'delivery_phase', timestamp: 1 }]}
            onSendMessage={vi.fn()} waitingPermission={getWaitingPermissionState([])} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Todo' }));
        expect(screen.queryByRole('region', { name: /文档交付进度/ })).not.toBeInTheDocument();
        expect(screen.getByTestId('beegame-todo-empty')).toBeInTheDocument();
    });

    it('shows only the Agent todo when a document write and author milestone are also visible', () => {
        render(<RightSidebar projectId="document-author-todo" lang="zh" progress={0} isLoading
            messages={[
                { id: 'author-phase', sender: 'system', content: 'author', taskKind: 'delivery_phase', timestamp: 1 },
                { id: 'author-writing', sender: 'system', content: '', timestamp: 2, type: 'tool',
                    toolName: 'Write', artifactPath: 'docs/GDD.md', toolStatus: 'running' },
                { id: 'author-todo', sender: 'system', content: '', timestamp: 3, type: 'tool',
                    toolName: 'TodoWrite', toolInput: { todos: [{ content: '编写 GDD.md 游戏设计文档', status: 'in_progress' }] } },
            ]}
            onSendMessage={vi.fn()} waitingPermission={getWaitingPermissionState([])} />);
        fireEvent.click(screen.getByRole('tab', { name: 'Todo' }));
        expect(screen.getByRole('region', { name: /^任务/ })).toBeInTheDocument();
        expect(screen.getAllByText('编写 GDD.md 游戏设计文档')).toHaveLength(1);
        expect(screen.queryByRole('region', { name: /文档交付进度/ })).not.toBeInTheDocument();
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

    it('shows the actual file-list failure reason instead of hiding it behind a generic error', async () => {
        vi.mocked(beeGameAdapter.getProjectGameContentFileList).mockRejectedValueOnce(
            new Error('Saved content changed while loading'),
        );
        render(<RightSidebar projectId="proj_1" lang="zh" messages={[]} progress={0} onSendMessage={vi.fn()} isLoading={false}
            waitingPermission={getWaitingPermissionState([])} />);
        fireEvent.click(screen.getByRole('tab', { name: /^Artifacts/ }));
        fireEvent.click(screen.getByRole('button', { name: 'UI', exact: true }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Saved content changed while loading');
    });

    it('passes per-file validation errors through without hiding healthy Scene and UI entries', async () => {
        vi.mocked(beeGameAdapter.getProjectGameContentFileList).mockResolvedValueOnce({ state: 'draft', documents: [
            { path: 'scenes/main.json', revision: 'a', id: 'scene', kind: 'scene-2d' },
            { path: 'ui/menu.json', revision: 'b', id: 'menu', kind: 'ui-screen' },
            { path: 'ui/hud.json', revision: 'c', id: 'hud', kind: 'ui-hud', error: 'data.nodes.5.responsive.compact.layout: Unrecognized key: "gap"' },
        ] });
        render(<RightSidebar projectId="proj_1" lang="zh" messages={[]} progress={0} onSendMessage={vi.fn()} isLoading={false}
            waitingPermission={getWaitingPermissionState([])} />);
        fireEvent.click(screen.getByRole('tab', { name: /^Artifacts/ }));
        fireEvent.click(screen.getByRole('button', { name: 'UI', exact: true }));
        expect(await screen.findByRole('button', { name: /menu.json/ })).toBeEnabled();
        expect(screen.getByRole('button', { name: /hud.json/ })).toBeDisabled();
        expect(screen.getByRole('alert')).toHaveTextContent('data.nodes.5.responsive.compact.layout');
        expect(screen.getByRole('alert')).toHaveTextContent('gap');
        vi.mocked(beeGameAdapter.getProjectGameContentFileList).mockResolvedValueOnce({ state: 'draft', documents: [
            { path: 'scenes/main.json', revision: 'a', id: 'scene', kind: 'scene-2d' },
            { path: 'ui/hud.json', revision: 'c', id: 'hud', kind: 'ui-hud', error: 'Invalid UI' },
        ] });
        fireEvent.click(screen.getByRole('button', { name: '返回产物' }));
        fireEvent.click(screen.getByRole('button', { name: 'Scene', exact: true }));
        expect(await screen.findByRole('button', { name: /main.json/ })).toBeEnabled();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('retains discovered source rows and index diagnostics when the registry itself is invalid', async () => {
        vi.mocked(beeGameAdapter.getProjectGameContentFileList).mockResolvedValueOnce({ state: 'draft',
            indexIssues: ['content/index.json: entryScene: expected string'], documents: [
                { path: 'ui/menu.json', revision: 'a', id: 'menu', kind: 'ui-screen' },
                { path: 'ui/broken.json', revision: 'b', id: 'broken', kind: 'ui', error: 'Invalid JSON' },
            ] });
        render(<RightSidebar projectId="proj_1" lang="zh" messages={[]} progress={0} onSendMessage={vi.fn()} isLoading={false}
            waitingPermission={getWaitingPermissionState([])} />);
        fireEvent.click(screen.getByRole('tab', { name: /^Artifacts/ }));
        fireEvent.click(screen.getByRole('button', { name: 'UI', exact: true }));
        expect(await screen.findByRole('button', { name: /menu.json/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /broken.json/ })).toBeDisabled();
        expect(screen.getAllByRole('alert').map(item => item.textContent).join('\n')).toContain('content/index.json: entryScene');
        expect(screen.getAllByRole('alert').map(item => item.textContent).join('\n')).toContain('不代表内容包合格');
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

        // The four visible categories do not count historical workflow tasks.
        expect(screen.getByRole('tab', { name: /^Artifacts/ })).toHaveTextContent('4');
    });

    it('refreshes artifacts when a dynamically named project document event arrives', async () => {
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
                    artifactPath: 'docs/README.md', toolStatus: 'completed',
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

    it('shows a queued message above the composer with Steer and delete actions', async () => {
        vi.mocked(beeGameAdapter.listQueuedMessages).mockResolvedValue([
            { id: 'queued-1', text: 'Adjust player speed', state: 'pending', attachmentCount: 2 },
        ] as never);
        render(<RightSidebar projectId="proj_1" lang="en" messages={[]} progress={0}
            onSendMessage={vi.fn()} isLoading waitingPermission={getWaitingPermissionState()} />);
        const row = await screen.findByTestId('beegame-queued-messages');
        expect(within(row).getByText('Adjust player speed')).toBeInTheDocument();
        expect(within(row).getByLabelText('2 attachments')).toBeInTheDocument();
        fireEvent.click(within(row).getByRole('button', { name: 'Steer queued message' }));
        await waitFor(() => expect(beeGameAdapter.steerQueuedMessage).toHaveBeenCalledWith('proj_1', 'queued-1'));
    });

    it('does not show another project’s queued messages during project switching', async () => {
        vi.mocked(beeGameAdapter.listQueuedMessages).mockImplementation(async project => project === 'first'
            ? [{ id: 'first-queued', text: 'First project request', state: 'pending', attachmentCount: 0 } as never]
            : []);
        const props = { lang: 'en' as const, messages: [], progress: 0,
            onSendMessage: vi.fn(), isLoading: false, waitingPermission: getWaitingPermissionState() };
        const view = render(<RightSidebar {...props} projectId="first" />);
        expect(await screen.findByText('First project request')).toBeInTheDocument();
        view.rerender(<RightSidebar {...props} projectId="second" />);
        expect(screen.queryByText('First project request')).not.toBeInTheDocument();
    });

    it('does not carry an unfinished queue action or its error into another project', async () => {
        const oldDelete = deferred<void>();
        vi.mocked(beeGameAdapter.listQueuedMessages).mockImplementation(async project => [{
            id: `${project}-queued`, text: `${project} request`, state: 'pending', attachmentCount: 0,
        }] as never);
        vi.mocked(beeGameAdapter.deleteQueuedMessage).mockReturnValueOnce(oldDelete.promise);
        const props = { lang: 'en' as const, messages: [], progress: 0,
            onSendMessage: vi.fn(), isLoading: false, waitingPermission: getWaitingPermissionState() };
        const view = render(<RightSidebar {...props} projectId="first" />);
        expect(await screen.findByText('first request')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Delete queued message' }));
        expect(beeGameAdapter.deleteQueuedMessage).toHaveBeenCalledWith('first', 'first-queued');

        view.rerender(<RightSidebar {...props} projectId="second" />);
        expect(await screen.findByText('second request')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Steer queued message' })).toBeEnabled();
        await act(async () => oldDelete.reject(new Error('first project failed')));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Steer queued message' })).toBeEnabled();
    });

    it('does not revive a deleted queue item from an older polling response', async () => {
        const stale = deferred<Awaited<ReturnType<typeof beeGameAdapter.listQueuedMessages>>>();
        const item = { id: 'to-delete', text: 'Remove this', state: 'pending', attachmentCount: 0 } as never;
        let calls = 0;
        vi.mocked(beeGameAdapter.listQueuedMessages).mockImplementation(async () => {
            calls += 1;
            if (calls === 1) return [item];
            if (calls === 2) return stale.promise;
            return [];
        });
        render(<RightSidebar projectId="queue-race" lang="en" messages={[]} progress={0}
            onSendMessage={vi.fn()} isLoading waitingPermission={getWaitingPermissionState()} />);
        expect(await screen.findByText('Remove this')).toBeInTheDocument();
        await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
        fireEvent.click(screen.getByRole('button', { name: 'Delete queued message' }));
        await waitFor(() => expect(screen.queryByText('Remove this')).not.toBeInTheDocument());
        await act(async () => stale.resolve([item]));
        expect(screen.queryByText('Remove this')).not.toBeInTheDocument();
    });

    it('queues chat input while the runtime is busy', async () => {
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

        const input = getChatInput();
        expect(input).toBeEnabled();
        await user.type(input, 'Queue this request');
        await user.click(screen.getByRole('button', { name: 'Send message' }));
        expect(onSendMessage).toHaveBeenCalledWith('Queue this request', [], undefined);
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

    it('offers attachments in the ordinary V3 composer', async () => {
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

        const attachButton = screen.getByRole('button', { name: '上传附件' });
        expect(attachButton).toBeEnabled();
        await user.click(attachButton);
        expect(onSendMessage).not.toHaveBeenCalled();
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

    it('shows a global error when a project resource upload fails', async () => {
        vi.mocked(api.uploadProjectAsset).mockRejectedValueOnce(new Error('Upload failed'));
        render(<RightSidebar
            projectId="proj_upload_error"
            lang="zh"
            messages={[]}
            progress={0}
            onSendMessage={vi.fn()}
            isLoading={false}
            waitingPermission={getWaitingPermissionState([])}
        />);

        fireEvent.click(screen.getByRole('tab', { name: /^Artifacts/ }));
        fireEvent.click(screen.getByRole('button', { name: '资源' }));
        const file = new File(['audio'], 'game.mp3', { type: 'audio/mpeg' });
        await userEvent.setup().upload(await screen.findByLabelText('添加资源'), file);

        await waitFor(() => expect(showErrorMock).toHaveBeenCalledWith('资源上传失败，请重试。'));
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
