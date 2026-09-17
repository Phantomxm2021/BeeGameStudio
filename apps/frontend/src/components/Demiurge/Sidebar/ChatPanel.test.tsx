import { createRef, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ChatPanel } from './ChatPanel';
import type { PendingToolPermissionItem } from '../../../services/api';
import { ToastProvider } from '../../../contexts/ToastContext';

const defaultWaitingPermission = {
    kind: 'none' as const,
    isWaitingStatus: false,
    isBlockingChat: false,
    message: '',
    placeholder: 'Ask team (Shift+Enter to new line)...',
};

const beeGamePermissionReview: PendingToolPermissionItem = {
    gate_id: 'gate_beegame_permission',
    type: 'BEEGAME_PERMISSION',
    title: 'Bash permission',
    artifact: {
        input: {
            command: 'npm create vite@latest . -- --template react-ts 2>&1',
        },
    },
};

const renderChatPanel = (overrides: Partial<ComponentProps<typeof ChatPanel>> = {}) => {
    const onResolveToolPermission = vi.fn().mockResolvedValue(undefined);
    const onPreviewArtifact = vi.fn();
    const props: ComponentProps<typeof ChatPanel> = {
        messages: [],
        isLoading: false,
        chatInput: '',
        onChatInputChange: vi.fn(),
        onSend: vi.fn(),
        onPreviewArtifact,
        textareaRef: createRef<HTMLTextAreaElement>(),
        scrollContainerRef: createRef<HTMLDivElement>(),
        isComposing: false,
        setIsComposing: vi.fn(),
        onResolveToolPermission,
        permissionState: {
            gateId: null,
            action: null,
            phase: 'idle',
            message: '',
        },
        actionPermission: beeGamePermissionReview,
        pendingPermissions: [],
        waitingPermission: defaultWaitingPermission,
        ...overrides,
    };

    return {
        onResolveToolPermission,
        onPreviewArtifact,
        ...render(<ToastProvider><ChatPanel {...props} /></ToastProvider>),
    };
};

describe('ChatPanel approval bar', () => {
    it('shows a single stop action while the AI is processing', async () => {
        const user = userEvent.setup();
        const onStop = vi.fn().mockResolvedValue(undefined);

        renderChatPanel({
            isLoading: true,
            actionPermission: undefined,
            onStop,
            isStopping: false,
        });

        const stopButton = screen.getByRole('button', { name: 'Stop task' });
        expect(stopButton).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();

        await user.click(stopButton);
        expect(onStop).toHaveBeenCalledTimes(1);
    });

    it('disables the stop action while the stop request is in flight', () => {
        const onStop = vi.fn().mockResolvedValue(undefined);

        renderChatPanel({
            isLoading: true,
            actionPermission: undefined,
            onStop,
            isStopping: true,
        });

        expect(screen.getByRole('button', { name: 'Stopping task' })).toBeDisabled();
    });

    it('restores the normal composer when no approval gate is active', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
        });

        expect(screen.getByRole('textbox')).toBeInTheDocument();
        expect(screen.queryByTestId('beegame-permission-panel')).not.toBeInTheDocument();
    });

    it('shows BeeGame permission requests in a panel above the composer instead of replacing the input', async () => {
        renderChatPanel({
            actionPermission: beeGamePermissionReview,
            pendingPermissions: [beeGamePermissionReview],
            variant: 'beegame',
            lang: 'zh',
        });

        expect(screen.getByTestId('beegame-permission-panel')).toBeInTheDocument();
        expect(screen.getAllByText('BeeGame 想运行 Bash 命令').length).toBeGreaterThan(0);
        await userEvent.setup().click(screen.getByRole('button', { name: 'View details' }));
        expect(screen.getAllByText((_, element) => element?.textContent === 'npm create vite@latest . -- --template react-ts 2>&1').length).toBeGreaterThan(0);
        expect(screen.queryByText('/Projects/BeeGameStudio/generated-game')).not.toBeInTheDocument();
        expect(screen.queryByText('作用范围')).not.toBeInTheDocument();
        expect(screen.getByText(/可能创建文件、安装依赖或访问网络/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '允许本次' })).toBeInTheDocument();
        expect(screen.getByPlaceholderText('等待权限确认')).toBeInTheDocument();
        expect(screen.queryByPlaceholderText('询问团队（Shift+Enter 换行）...')).not.toBeInTheDocument();
    });

    it('maps Tool Approval actions to the existing permission resolver', async () => {
        const user = userEvent.setup();
        const { onResolveToolPermission } = renderChatPanel({
            actionPermission: beeGamePermissionReview,
            pendingPermissions: [beeGamePermissionReview],
            variant: 'beegame',
            lang: 'zh',
        });

        await user.click(screen.getByRole('button', { name: '允许本次' }));
        expect(onResolveToolPermission).toHaveBeenCalledWith(
            expect.objectContaining({ gate_id: beeGamePermissionReview.gate_id }),
            'allow',
            'once',
        );

        const second = {
            ...beeGamePermissionReview,
            gate_id: 'gate_beegame_deny',
        } satisfies PendingToolPermissionItem;
        const { onResolveToolPermission: onSecondResolve } = renderChatPanel({
            actionPermission: second,
            pendingPermissions: [second],
            variant: 'beegame',
            lang: 'zh',
        });
        await user.click(screen.getAllByRole('button', { name: '拒绝' }).at(-1)!);
        expect(onSecondResolve).toHaveBeenCalledWith(
            expect.objectContaining({ gate_id: 'gate_beegame_deny' }),
            'deny',
        );
    });

    it('renders pending approvals in arrival order', async () => {
        const secondPermission = {
            ...beeGamePermissionReview,
            gate_id: 'gate_second_permission',
            title: 'Write permission',
            artifact: { input: { path: 'docs/GDD.md' } },
        } satisfies PendingToolPermissionItem;

        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [beeGamePermissionReview, secondPermission],
            variant: 'beegame',
            lang: 'zh',
        });

        expect(screen.getAllByTestId('beegame-permission-panel')).toHaveLength(2);
        const detailButtons = screen.getAllByRole('button', { name: 'View details' });
        await userEvent.setup().click(detailButtons[0]);
        await userEvent.setup().click(detailButtons[1]);
        expect(screen.getAllByText((_, element) => element?.textContent === 'npm create vite@latest . -- --template react-ts 2>&1').length).toBeGreaterThan(0);
        expect(screen.getByText('GDD.md')).toBeInTheDocument();
    });

    it('shows only the file name for file permission targets', () => {
        renderChatPanel({
            actionPermission: {
                ...beeGamePermissionReview,
                title: 'Edit permission',
                artifact: {
                    input: {
                        file_path: '/Projects/BeeGameStudio/generated-game/src/game/Player.tsx',
                    },
                },
            },
            variant: 'beegame',
            lang: 'zh',
        });

        expect(screen.getByText('Player.tsx')).toBeInTheDocument();
        expect(screen.queryByText('/Projects/BeeGameStudio/generated-game/src/game/Player.tsx')).not.toBeInTheDocument();
        expect(screen.queryByText('作用范围')).not.toBeInTheDocument();
    });

    it('offers an explicit session-scoped choice for sandbox network access', async () => {
        const user = userEvent.setup();
        const networkReview: PendingToolPermissionItem = {
            ...beeGamePermissionReview,
            gate_id: 'network_permission',
            title: 'SandboxNetworkAccess permission',
            permission_tool_name: 'SandboxNetworkAccess',
            artifact: { input: { host: 'registry.example', port: 443 } },
        };
        const { onResolveToolPermission } = renderChatPanel({
            actionPermission: networkReview,
            pendingPermissions: [networkReview],
            variant: 'beegame',
            lang: 'zh',
        });

        expect(screen.getByText('registry.example:443')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: '当前会话允许' }));
        expect(onResolveToolPermission).toHaveBeenCalledWith(
            expect.objectContaining({ gate_id: 'network_permission' }),
            'allow',
            'session',
        );
    });

    it('offers a scoped session grant for Resource Library mutations', async () => {
        const user = userEvent.setup();
        const resourceReview: PendingToolPermissionItem = {
            ...beeGamePermissionReview,
            gate_id: 'resource_library_permission',
            title: 'ResourceLibrary permission',
            permission_tool_name: 'ResourceLibrary',
            artifact: { input: { action: 'browse_packs' } },
        };
        const { onResolveToolPermission } = renderChatPanel({
            actionPermission: resourceReview,
            pendingPermissions: [resourceReview],
            variant: 'beegame',
            lang: 'zh',
        });

        await user.click(screen.getByRole('button', { name: '当前会话允许' }));
        expect(onResolveToolPermission).toHaveBeenCalledWith(
            expect.objectContaining({ gate_id: 'resource_library_permission' }),
            'allow',
            'session',
        );
    });

    it('uses the BeeGame dock styling for the normal composer', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
        });

        expect(screen.getByTestId('beegame-chat-panel')).toBeInTheDocument();
        expect(screen.getByTestId('beegame-chat-composer')).toHaveClass('min-w-0');
        expect(screen.getByTestId('beegame-chat-composer')).not.toHaveClass('min-h-[60px]', 'rounded-[10px]');
        expect(screen.getByPlaceholderText(/ask team/i)).toHaveClass(
            'bg-transparent',
            'px-2',
            'pt-1.5',
            'type-input',
            'scrollbar-hide',
        );
        expect(screen.getByPlaceholderText(/ask team/i)).not.toHaveClass('pb-14');
        expect(screen.getByPlaceholderText(/ask team/i)).not.toHaveClass('pl-14', 'pr-40');

        expect(screen.getByTestId('beegame-chat-toolbar')).toHaveClass('flex', 'items-center', 'gap-1');
        expect(screen.getByTestId('beegame-chat-attach-button')).not.toHaveClass('absolute');
        expect(screen.getByTestId('beegame-chat-attach-button')).toHaveAttribute('type', 'button');
        expect(screen.getByRole('textbox', { name: /ask team/i })).toBeInTheDocument();
        expect(screen.getByTestId('beegame-chat-attach-button').querySelector('svg')).toHaveAttribute('viewBox', '0 0 24 24');
        expect(screen.getByRole('button', { name: 'Send message' })).toHaveClass('size-8', 'rounded-full');
    });

    it('localizes the BeeGame chat composer placeholder', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            lang: 'zh',
        });

        expect(screen.getByPlaceholderText('询问团队（Shift+Enter 换行）...')).toBeInTheDocument();
        expect(screen.getByLabelText('上传附件')).toBeInTheDocument();
    });

    it('keeps BeeGame image attachments in a padded preview strip', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            attachments: [{
                type: 'image',
                mediaType: 'image/png',
                data: 'iVBORw0KGgo=',
                filename: 'preview.png',
            }],
        });

        expect(screen.getByTestId('beegame-chat-attachments')).toHaveClass('px-4', 'pt-4', 'pb-2');
        expect(screen.getByAltText('preview.png')).toBeInTheDocument();
    });

    it('uses the beUI activity shimmer for the active AI thinking state', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            streamingMessageId: 'thinking_1',
            messages: [
                {
                    id: 'thinking_1',
                    sender: 'system',
                    content: 'Thinking...',
                    timestamp: Date.now(),
                    type: 'thought',
                    taskKind: 'assistant_thinking',
                },
            ],
            projectStatus: {
                project_id: 'proj_1',
                phase: 'running',
                blocked: false,
                next_action: 'running',
                workflow: {
                    runId: 'run_thinking',
                    status: 'running',
                },
            },
        });

        const thinkingMessage = screen.getByTestId('beegame-agent-activity-group');
        expect(thinkingMessage).toBeInTheDocument();
        expect(thinkingMessage.querySelector('[data-state="working"]')).not.toBeNull();
        expect(thinkingMessage.querySelector('[role="status"]')).toHaveTextContent('Reasoning…');
    });

    it('matches a streamed content block to its parent assistant message id', () => {
        renderChatPanel({
            actionPermission: undefined,
            variant: 'beegame',
            streamingMessageId: 'assistant-parent-1',
            messages: [{
                id: 'assistant-parent-1',
                messageId: 'assistant-parent-1',
                sender: 'beegame',
                content: '',
                timestamp: Date.now(),
                contentBlocks: [{ type: 'thinking', text: 'Still reasoning' }],
            }],
        });

        const turn = screen.getByTestId(/^beegame-agent-turn-/);
        expect(turn.querySelector('[data-state="streaming"]')).toBeInTheDocument();
        expect(turn.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    });

    it('keeps an unassociated historical thought complete while a workflow is running', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            streamingMessageId: null,
            messages: [{
                id: 'historical_thought',
                sender: 'system',
                content: 'Earlier reasoning',
                timestamp: Date.now(),
                type: 'thought',
                taskKind: 'assistant_thinking',
            }],
            projectStatus: {
                project_id: 'proj_1',
                phase: 'running',
                blocked: false,
                workflow: { runId: 'run_thinking', status: 'running' },
            },
        });

        const thought = screen.getByTestId('beegame-agent-activity-group');
        expect(thought.querySelector('[data-state="working"]')).toBeNull();
        expect(thought.querySelector('[data-state="closed"], [data-state="open"]')).not.toBeNull();
    });

    it('does not synthesize a permanent thinking message for a running workflow', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [],
            projectStatus: {
                project_id: 'proj_1',
                phase: 'running',
                blocked: false,
                next_action: 'Bee Game Studio is processing',
                workflow: {
                    runId: 'proj_1',
                    status: 'running',
                },
            },
        });

        expect(screen.queryByTestId('beegame-thinking-message-beegame-runtime-activity')).not.toBeInTheDocument();
        expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
        expect(screen.queryByTestId('beegame-workflow-plan-proj_1')).not.toBeInTheDocument();
    });

    it('does not turn workflow state into a synthetic chat card', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                { id: 'user_before_run', sender: 'user', content: '开始构建', timestamp: 1_000 },
                { id: 'agent_after_run', sender: 'beegame', content: '开始处理。', timestamp: 2_000 },
            ],
            projectStatus: {
                project_id: 'proj_1',
                phase: 'running',
                blocked: false,
                workflow: {
                    runId: 'run_timeline',
                    status: 'running',
                    currentPhase: 'DOCUMENT_DRAFTING',
                    createdAt: '1970-01-01T00:00:01.500Z',
                },
            },
        });

        expect(document.querySelector('[data-message-id="beegame-workflow-run_timeline"]')).toBeNull();
        expect(screen.getByText('开始处理。')).toBeInTheDocument();
    });

    it('keeps the completed thought summary after the workflow finishes', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [{
                id: 'stale_thinking',
                sender: 'system',
                content: 'Thinking',
                thought: 'Reviewed the preview entry and confirmed the interaction path.',
                timestamp: Date.now(),
                type: 'thought',
                taskKind: 'assistant_thinking',
            }],
            projectStatus: {
                project_id: 'proj_1',
                phase: 'completed',
                blocked: false,
                workflow: {
                    runId: 'run_completed',
                    status: 'completed',
                    currentPhase: 'DOCUMENT_REVIEW',
                    updatedAt: '2026-07-28T00:01:00.000Z',
                },
            },
        });

        const thought = screen.getByTestId('beegame-agent-activity-group');
        expect(thought).toHaveTextContent('Reviewed the preview entry and confirmed the interaction path.');
        expect(thought.querySelector('[data-state="working"]')).toBeNull();
        expect(thought.querySelector('[data-state="closed"], [data-state="open"]')).not.toBeNull();
    });

    it('renders BeeGame messages as a compact feed with tools after their message', async () => {
        const user = userEvent.setup();
        const onEditMessage = vi.fn();
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_user',
                    sender: 'user',
                    content: '请构建首个可玩版本',
                    timestamp: 1,
                },
                {
                    id: 'm_agent',
                    sender: 'beegame',
                    content: '我会先完成可运行闭环，然后验证构建入口。',
                    timestamp: 2,
                    turnId: 'turn-compact',
                },
                {
                    id: 'm_write',
                    sender: 'system',
                    content: 'Write completed\nTarget: docs/PLAYABLE_SPEC.md',
                    timestamp: 3,
                    type: 'tool',
                    toolName: 'Write',
                    toolStatus: 'completed',
                    toolDetail: 'docs/PLAYABLE_SPEC.md',
                    turnId: 'turn-compact',
                },
                {
                    id: 'm_bash',
                    sender: 'system',
                    content: 'Bash completed\nbun run build',
                    timestamp: 4,
                    type: 'tool',
                    toolName: 'Bash',
                    toolStatus: 'completed',
                    toolDetail: 'bun run build',
                    toolOutput: 'Build passed',
                    turnId: 'turn-compact',
                },
            ],
            projectStatus: {
                project_id: 'proj_1',
                phase: 'running',
                blocked: false,
                next_action: 'running',
                workflow: {
                    runId: 'proj_1',
                    status: 'running',
                    createdAt: '1970-01-01T00:00:00.001Z',
                },
            } as any,
            onEditMessage,
        });

        expect(screen.getByTestId('beegame-message-scroller')).toBeInTheDocument();
        expect(screen.getByTestId('beegame-message-scroller-viewport')).toHaveClass(
            'overscroll-contain',
        );
        expect(screen.getByTestId('beegame-message-scroller-content')).toBeInTheDocument();
        expect(screen.queryByTestId('message-scroller-outline')).not.toBeInTheDocument();
        expect(document.querySelector('[data-message-id="m_user"]')).toBeInTheDocument();
        expect(document.querySelector('[data-message-id="m_user"]')).toHaveAttribute('data-scroll-anchor', 'false');
        expect(document.querySelector('[data-message-id="m_user"]')).toHaveClass('min-w-0');
        expect(document.querySelector('[data-message-id="m_user"]')).not.toHaveClass('px-3');
        expect(screen.getByTestId('beegame-agent-turn-m_agent')).toBeInTheDocument();
        expect(screen.getByTestId('beegame-agent-turn-m_agent')).toHaveAttribute('data-scroll-anchor', 'false');
        expect(document.querySelector('[data-message-id="beegame-workflow-proj_1"]')).toBeNull();
        expect(screen.queryByText('当前任务')).not.toBeInTheDocument();
        const userMessage = screen.getByTestId('beegame-user-message-m_user');
        expect(userMessage).toBeInTheDocument();
        expect(userMessage.querySelector('[data-slot="message-bubble-content"]')).toBeInTheDocument();
        expect(userMessage.querySelector('[data-slot="message-avatar"]')).toBeNull();
        expect(userMessage.querySelector('[data-slot="message-header"]')).toBeNull();
        expect(userMessage.querySelector('[data-variant="solid"]')).toBeInTheDocument();
        await user.click(within(userMessage).getByRole('button', { name: 'Edit message' }));
        expect(onEditMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'm_user', content: '请构建首个可玩版本' }));
        expect(userMessage).toHaveAttribute('data-slot', 'message-content');
        expect(userMessage).toHaveClass('min-w-0');
        expect(userMessage).not.toHaveClass('max-w-[46rem]');
        expect(userMessage).not.toHaveClass('ml-auto');
        expect(userMessage).not.toHaveClass('backdrop-blur-2xl');
        expect(userMessage).not.toHaveClass('bg-zinc-100');
        expect(userMessage).not.toHaveClass('bg-sky-950/20');
        expect(userMessage).toHaveTextContent('请构建首个可玩版本');
        expect(userMessage).not.toHaveTextContent('You');
        expect(screen.queryByText('BeeGame')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Collapse BeeGame message|折叠 BeeGame 消息/i })).not.toBeInTheDocument();
        expect(screen.getByText('我会先完成可运行闭环，然后验证构建入口。')).toBeInTheDocument();
        expect(screen.getByTestId('beegame-agent-message-m_agent')).toBeInTheDocument();

        const agentMessage = screen.getByTestId('beegame-agent-message-m_agent');
        expect(screen.getByTestId('beegame-agent-message-m_agent')).toHaveClass('min-w-0');
        expect(screen.getByTestId('beegame-agent-message-m_agent').querySelector('[data-slot="message-bubble"]')).toBeNull();
        expect(agentMessage).toHaveAttribute('data-slot', 'message-content');
        expect(agentMessage).not.toHaveClass('rounded-3xl');
        expect(agentMessage).not.toHaveClass('bg-orange-950/15');
        expect(agentMessage).not.toHaveClass('bg-sky-950/20');

        const activity = screen.getByTestId('beegame-agent-activity-group');
        expect(activity).toBeInTheDocument();
        expect(activity.querySelector('[data-content="tool"]')).toBeInTheDocument();
        expect(activity.querySelector('[aria-expanded="false"]')).toBeInTheDocument();
        await user.click(activity.querySelector('button')!);
        expect(within(activity).getByText('docs/PLAYABLE_SPEC.md')).toBeInTheDocument();
        expect(within(activity).getByText('bun run build')).toBeInTheDocument();
        expect(screen.queryByTestId('beegame-tool-output-m_bash')).not.toBeInTheDocument();
        expect(screen.queryByTestId('beegame-tool-group')).not.toBeInTheDocument();
    });

    it('renders contiguous mixed AgentActivity segments in event order without result groups', async () => {
        const user = userEvent.setup();
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'mixed-thinking',
                    sender: 'beegame',
                    content: 'Thinking',
                    thought: 'Check the preview entry.',
                    timestamp: 1,
                    type: 'thought',
                    taskKind: 'assistant_thinking',
                    turnId: 'turn-mixed',
                },
                {
                    id: 'mixed-read',
                    sender: 'system',
                    content: 'Read completed',
                    timestamp: 2,
                    type: 'tool',
                    toolName: 'Read',
                    toolStatus: 'completed',
                    toolDetail: 'src/StartScreen.tsx',
                    turnId: 'turn-mixed',
                },
                {
                    id: 'mixed-agent',
                    sender: 'beegame',
                    content: 'I found the preview entry.',
                    timestamp: 3,
                    turnId: 'turn-mixed',
                },
                {
                    id: 'mixed-edit',
                    sender: 'system',
                    content: 'Edit completed',
                    timestamp: 4,
                    type: 'tool',
                    toolName: 'Edit',
                    toolStatus: 'completed',
                    toolDetail: 'src/StartScreen.tsx',
                    toolDiff: '--- a/src/StartScreen.tsx\n+++ b/src/StartScreen.tsx\n@@\n-old\n+new',
                    turnId: 'turn-mixed',
                },
            ],
        });

        const activities = screen.getAllByTestId('beegame-agent-activity-group');
        expect(activities).toHaveLength(2);
        expect(activities[0].querySelector('[data-content="mixed"]')).toBeInTheDocument();
        expect(activities[1].querySelector('[data-content="tool"]')).toBeInTheDocument();
        expect(activities[0].querySelector('[data-state="closed"]')).toBeInTheDocument();

        await user.click(activities[0].querySelector('button')!);
        const activityRows = within(activities[0]).getAllByRole('listitem');
        expect(activityRows.map((row) => row.textContent)).toEqual([
            'Check the preview entry.',
            expect.stringContaining('Read'),
        ]);
        const diff = screen.getByTestId('beegame-file-diff');
        await user.click(diff.querySelector('button')!);
        expect(diff).toHaveTextContent('old');
        expect(diff).toHaveTextContent('new');
        expect(screen.queryByTestId('beegame-tool-group')).not.toBeInTheDocument();
        expect(screen.queryByTestId('beegame-tool-timeline-card')).not.toBeInTheDocument();

        const agentMessage = screen.getByTestId('beegame-agent-message-mixed-agent');
        expect(activities[0].compareDocumentPosition(agentMessage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(agentMessage.compareDocumentPosition(activities[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders one activity when a turn starts with consecutive tool invocations', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                { id: 'leading-tool-1', sender: 'system', content: 'Read completed', timestamp: 1, type: 'tool', toolName: 'Read', toolStatus: 'completed', toolDetail: 'src/one.ts', turnId: 'turn-leading-tools' },
                { id: 'leading-tool-2', sender: 'system', content: 'Bash completed', timestamp: 2, type: 'tool', toolName: 'Bash', toolStatus: 'completed', toolDetail: 'bun test', turnId: 'turn-leading-tools' },
            ],
        });

        expect(screen.getAllByTestId('beegame-agent-activity-group')).toHaveLength(1);
        expect(screen.getByTestId('beegame-agent-activity-group').querySelector('[data-content="tool"]')).toBeInTheDocument();
    });

    it('merges a later tool result into its tool_use activity row', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'tool-use-message',
                    sender: 'beegame',
                    content: '',
                    timestamp: 1,
                    turnId: 'turn-paired-tool',
                    contentBlocks: [{ type: 'tool_use', toolUseId: 'tool-1', toolName: 'Read', toolInput: { path: 'src/App.tsx' } }],
                },
                {
                    id: 'tool-result-message',
                    sender: 'system',
                    content: 'Read completed\nTarget: src/App.tsx\nOutput: export default App',
                    timestamp: 2,
                    type: 'tool',
                    toolName: 'Read',
                    toolUseId: 'tool-1',
                    toolStatus: 'completed',
                    toolDetail: 'src/App.tsx',
                    toolOutput: 'export default App',
                    turnId: 'turn-paired-tool',
                },
            ],
        });

        const activity = screen.getByTestId('beegame-agent-activity-group');
        expect(screen.getAllByTestId('beegame-agent-activity-group')).toHaveLength(1);
        expect(activity.querySelector('[data-content="tool"]')).toHaveAttribute('data-state', 'closed');
        expect(activity).toHaveTextContent('Ran 1 tool');
        expect(activity).not.toHaveAttribute('aria-busy', 'true');
    });

    it('renders one activity when a turn starts with consecutive thinking events', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                { id: 'leading-thought-1', sender: 'beegame', content: 'Thinking', thought: 'First thought', timestamp: 1, type: 'thought', taskKind: 'assistant_thinking', turnId: 'turn-leading-thoughts' },
                { id: 'leading-thought-2', sender: 'beegame', content: 'Thinking', thought: 'Second thought', timestamp: 2, type: 'thought', taskKind: 'assistant_thinking', turnId: 'turn-leading-thoughts' },
            ],
        });

        expect(screen.getAllByTestId('beegame-agent-activity-group')).toHaveLength(1);
        expect(screen.getByTestId('beegame-agent-activity-group').querySelector('[data-content="text"]')).toBeInTheDocument();
    });

    it('keeps adjacent thinking from separate turns in separate activities', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                { id: 'thought-turn-a', sender: 'beegame', content: 'Thinking', thought: 'First task', timestamp: 1, type: 'thought', taskKind: 'assistant_thinking', turnId: 'turn-a' },
                { id: 'thought-turn-b', sender: 'beegame', content: 'Thinking', thought: 'Second task', timestamp: 2, type: 'thought', taskKind: 'assistant_thinking', turnId: 'turn-b' },
            ],
        });

        expect(screen.getAllByTestId('beegame-agent-activity-group')).toHaveLength(2);
    });

    it('keeps activity segments around markdown and todo parts in response order', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            projectStatus: {
                project_id: 'proj_order',
                phase: 'running',
                blocked: false,
                next_action: 'running',
                workflow: {
                    runId: 'turn-order-workflow',
                    status: 'running',
                    createdAt: '1970-01-01T00:00:00.002Z',
                },
            },
            messages: [
                { id: 'order-thought', sender: 'beegame', content: 'Thinking', thought: 'Inspect first', timestamp: 1, type: 'thought', taskKind: 'assistant_thinking', turnId: 'turn-order' },
                { id: 'order-agent', sender: 'beegame', content: 'Here is the first update.', timestamp: 3, turnId: 'turn-order' },
                { id: 'order-tool', sender: 'system', content: 'Read completed', timestamp: 4, type: 'tool', toolName: 'Read', toolStatus: 'completed', toolDetail: 'src/after.ts', turnId: 'turn-order' },
            ],
        });

        const activities = screen.getAllByTestId('beegame-agent-activity-group');
        const agent = screen.getByTestId('beegame-agent-message-order-agent');
        expect(activities).toHaveLength(2);
        expect(activities[0].compareDocumentPosition(agent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(agent.compareDocumentPosition(activities[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('uses the store streaming message id instead of promoting an arbitrary latest agent row', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            isLoading: true,
            messages: [{ id: 'm_old_agent', sender: 'beegame', content: 'Previous answer', timestamp: 1 }],
        });

        expect(screen.getByTestId('beegame-loading-message')).toBeInTheDocument();
        expect(screen.getByTestId('beegame-agent-message-m_old_agent')).toHaveTextContent('Previous answer');
        expect(screen.queryByText('Stop streaming')).not.toBeInTheDocument();
    });

    it('opens structured subagent details in a dedicated view', async () => {
        const prompt = 'Prompt '.repeat(80);
        const output = 'Output '.repeat(80);
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [{ id: 'm_subagent', sender: 'system', type: 'tool', toolName: 'Task', toolStatus: 'completed', isSubagentTool: true, subagentPrompt: prompt, subagentOutput: output, content: 'Task completed', timestamp: 1 }],
        });

        const disclosure = screen.getByTestId('beegame-subagent-disclosure-m_subagent');
        const trigger = within(disclosure).getByRole('button', { name: /Subagent/ });
        expect(screen.queryByTestId('beegame-agent-activity-group')).not.toBeInTheDocument();
        expect(screen.queryByTestId('beegame-tool-output-m_subagent')).not.toBeInTheDocument();

        await userEvent.setup().click(trigger);
        const drawer = screen.getByRole('dialog', { name: 'Agent run details' });
        expect(drawer).toHaveClass('z-[401]');
        expect(within(drawer).getByTestId('beegame-agent-run-detail')).toBeInTheDocument();
        expect(within(drawer).getByText(/Prompt Prompt/)).toBeInTheDocument();
        expect(within(drawer).getByText(/Output Output/)).toBeInTheDocument();

        await userEvent.setup().click(screen.getByRole('button', { name: 'Back to chat' }));
        expect(screen.getByTestId('beegame-subagent-disclosure-m_subagent')).toBeInTheDocument();
    });

    it('renders a subagent task as Markdown inside its detail drawer', async () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [{
                id: 'm_markdown_subagent', sender: 'system', type: 'tool', toolName: 'Task', toolStatus: 'completed', isSubagentTool: true,
                subagentPrompt: '## Verify IR\n\n- Read `game-ir.json`\n- Confirm the schema',
                content: 'Task completed', timestamp: 1,
            }],
        });

        await userEvent.setup().click(within(screen.getByTestId('beegame-subagent-disclosure-m_markdown_subagent')).getByRole('button', { name: /Subagent/ }));
        const drawer = screen.getByRole('dialog', { name: 'Agent run details' });
        expect(within(drawer).getByRole('heading', { name: 'Verify IR' })).toBeInTheDocument();
        expect(within(drawer).getByText('game-ir.json')).toBeInTheDocument();
        expect(within(drawer).getByRole('list')).toHaveTextContent('Confirm the schema');
    });

    it('renders legacy worker history as its workflow stage without hiding the response', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [{
                id: 'm_resource_worker',
                sender: 'beegame',
                content: '正在生成资源。',
                timestamp: 1,
                taskKind: 'workflow_worker:resource-planner',
                turnId: 'turn-resource',
            }],
        });

        expect(screen.getByTestId('beegame-stage-separator-resources')).toHaveTextContent('Resource preparation');
        expect(screen.getByText('正在生成资源。')).toBeInTheDocument();
        expect(screen.queryByTestId('beegame-workflow-worker-disclosure')).not.toBeInTheDocument();
    });

    it('keeps oversized messages inside the dedicated scroll viewport', () => {
        const scrollContainerRef = createRef<HTMLDivElement>();
        const uninterruptedContent = 'x'.repeat(12_000);

        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            scrollContainerRef,
            messages: [
                {
                    id: 'm_oversized_user',
                    sender: 'user',
                    content: uninterruptedContent,
                    timestamp: 1,
                },
                {
                    id: 'm_oversized_agent',
                    sender: 'beegame',
                    content: `\`\`\`text\n${uninterruptedContent}\n\`\`\``,
                    timestamp: 2,
                },
            ],
        });

        expect(screen.getByTestId('beegame-chat-panel')).toHaveClass(
            'min-h-0',
            'min-w-0',
            'overflow-hidden',
        );
        const scroller = screen.getByTestId('beegame-message-scroller');
        const viewport = screen.getByTestId('beegame-message-scroller-viewport');
        const content = screen.getByTestId('beegame-message-scroller-content');
        expect(scroller).toHaveClass('min-w-0', 'overflow-hidden');
        expect(viewport).toBe(scrollContainerRef.current);
        expect(viewport).toHaveClass('min-h-0', 'overflow-y-auto', 'overflow-x-hidden');
        expect(content).toHaveClass('min-w-0', 'max-w-full');

        const userItem = document.querySelector('[data-message-id="m_oversized_user"]');
        const agentItem = document.querySelector('[data-message-id="m_oversized_agent"]');
        expect(userItem).toHaveClass('min-w-0');
        expect(userItem).not.toHaveClass('max-w-full');
        expect(agentItem).toHaveClass('min-w-0');
        expect(agentItem).not.toHaveClass('max-w-full');
        expect(screen.getByTestId('beegame-user-message-m_oversized_user')).toHaveClass('min-w-0');
        expect(screen.getByTestId('beegame-agent-message-m_oversized_agent')).toHaveClass('min-w-0');
        expect(screen.getByTestId('beegame-agent-message-m_oversized_agent')).not.toHaveClass('max-w-[46rem]');
        expect(screen.getByTestId('beegame-agent-message-m_oversized_agent').querySelector('pre')).toHaveClass(
            'max-w-full',
            'overflow-x-auto',
        );
    });

    it('does not render passive status copy above the composer', () => {
        const onCancelEdit = vi.fn();
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            chatInput: 'updated request',
            editingMessageId: 'm_editing',
            onCancelEdit,
            waitingPermission: {
                kind: 'review',
                isWaitingStatus: true,
                isBlockingChat: true,
                message: 'Waiting for the current workflow stage to finish',
                placeholder: 'Workflow is running',
            },
        });

        expect(screen.queryByText('Waiting for the current workflow stage to finish')).not.toBeInTheDocument();
        expect(screen.queryByText('Editing message')).not.toBeInTheDocument();
        expect(screen.queryByTestId('beegame-editing-message-banner')).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId('beegame-cancel-edit-button'));
        expect(onCancelEdit).toHaveBeenCalledOnce();
    });



    it('requests an older history page when the BeeGame transcript reaches the top', () => {
        const onLoadOlderHistory = vi.fn();
        renderChatPanel({
            variant: 'beegame',
            actionPermission: undefined,
            pendingPermissions: [],
            hasOlderHistory: true,
            onLoadOlderHistory,
            messages: [{
                id: 'm_history_current',
                sender: 'beegame',
                content: 'Current history page',
                timestamp: 2,
            }],
        });

        const viewport = screen.getByTestId('beegame-message-scroller-viewport');
        Object.defineProperty(viewport, 'scrollTop', {
            configurable: true,
            writable: true,
            value: 0,
        });
        fireEvent.scroll(viewport);

        expect(onLoadOlderHistory).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Load earlier messages' })).toBeInTheDocument();
    });

    it('renders multiple BeeGame tool calls in one activity', async () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            lang: 'zh',
            messages: [
                {
                    id: 'm_agent',
                    sender: 'beegame',
                    content: '我会连续执行验证。',
                    timestamp: 1,
                    turnId: 'turn-many-tools',
                },
                ...Array.from({ length: 8 }, (_, index) => ({
                    id: `m_tool_${index + 1}`,
                    sender: 'system',
                    content: `Bash completed\nCommand: check ${index + 1}`,
                    timestamp: index + 2,
                    type: 'tool' as const,
                    toolName: 'Bash',
                    toolStatus: 'completed' as const,
                    toolDetail: `check ${index + 1}`,
                    turnId: 'turn-many-tools',
                })),
            ],
        });

        const activity = screen.getByTestId('beegame-agent-activity-group');
        expect(screen.getAllByTestId('beegame-agent-activity-group')).toHaveLength(1);
        expect(activity.querySelector('[data-content="tool"]')).toBeInTheDocument();
        expect(activity).not.toHaveTextContent('5 results');
        expect(screen.queryByTestId('beegame-tool-group')).not.toBeInTheDocument();
        await userEvent.setup().click(activity.querySelector('button')!);
        expect(activity).toHaveTextContent('check 1');
        expect(activity).toHaveTextContent('check 8');
    });

    it('expands one contiguous activity and renders a real write diff', async () => {
        const user = userEvent.setup();
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_write_diff',
                    sender: 'system',
                    content: 'Write completed\nTarget: src/pages/StartScreen.tsx',
                    timestamp: 2,
                    type: 'tool',
                    toolName: 'Write',
                    toolStatus: 'completed',
                    toolDetail: 'src/pages/StartScreen.tsx',
                    toolDiff: '--- a/src/pages/StartScreen.tsx\n+++ b/src/pages/StartScreen.tsx\n@@\n-<button>Start round</button>\n+<button type="button">Start round</button>',
                    turnId: 'turn-diff',
                },
                {
                    id: 'm_read_after_diff',
                    sender: 'system',
                    content: 'Read completed\nTarget: src/pages/StartScreen.tsx',
                    timestamp: 1,
                    type: 'tool',
                    toolName: 'Read',
                    toolStatus: 'completed',
                    toolDetail: 'src/pages/StartScreen.tsx',
                    turnId: 'turn-diff',
                },
            ],
        });

        const diff = screen.getByTestId('beegame-file-diff');
        await user.click(diff.querySelector('button')!);
        expect(diff).toHaveTextContent('<button>Start round</button>');
        expect(diff).toHaveTextContent('<button type="button">Start round</button>');
    });

    it('keeps turnId-bearing agent parts in separate response containers', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                { id: 'turn-unknown', sender: 'beegame', content: 'Fallback response', timestamp: 1 },
                { id: 'turn-known-a', sender: 'system', type: 'tool', content: 'Read completed', timestamp: 2, turnId: 'turn-a', toolName: 'Read', toolStatus: 'completed' },
                { id: 'turn-known-b', sender: 'beegame', content: 'New response', timestamp: 3, turnId: 'turn-b' },
            ],
        });

        const turns = screen.getAllByTestId(/^beegame-agent-turn-/);
        expect(turns).toHaveLength(3);
        expect(turns.map((turn) => turn.getAttribute('data-message-id'))).toEqual([
            'turn-unknown',
            'turn-a',
            'turn-b',
        ]);
        expect(turns[1]).toContainElement(screen.getByTestId('beegame-agent-activity-group'));
    });

    it('renders BeeGame context updates as marker separators', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            lang: 'zh',
            messages: [
                {
                    id: 'm_context',
                    sender: 'system',
                    content: 'Context compacted after transcript exceeded budget.',
                    timestamp: 1,
                    taskKind: 'context_update',
                },
            ],
        });

        const separator = screen.getByTestId('beegame-context-separator');
        expect(separator).toHaveTextContent('上下文已自动压缩');
        expect(separator).toHaveAttribute('data-slot', 'marker');
        expect(separator).toHaveAttribute('data-variant', 'separator');
        expect(separator).not.toHaveAttribute('role', 'separator');
    });

    it('labels local BeeGame search tool calls as file searches', async () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            lang: 'zh',
            messages: [
                {
                    id: 'm_search',
                    sender: 'system',
                    content: 'Search completed\nOutput: found 4 files',
                    timestamp: 1,
                    type: 'tool',
                    toolName: 'Search',
                    toolStatus: 'completed',
                    toolDetail: 'found 4 files',
                },
            ],
        });

        const activity = screen.getByTestId('beegame-agent-activity-group');
        expect(activity.querySelector('[data-content="search"]')).toBeInTheDocument();
        await userEvent.setup().click(activity.querySelector('button')!);
        expect(activity).toHaveTextContent('已搜索文件');
        expect(activity).toHaveTextContent('found 4 files');
    });

    it('groups consecutive anonymous tool calls into one collapsed activity', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                { id: 'read-a', sender: 'system', type: 'tool', content: 'Read completed', timestamp: 1, toolName: 'Read', toolStatus: 'completed', toolDetail: 'docs/GDD.md' },
                { id: 'read-b', sender: 'system', type: 'tool', content: 'Read completed', timestamp: 2, toolName: 'Read', toolStatus: 'completed', toolDetail: 'docs/Art.md' },
                { id: 'write-a', sender: 'system', type: 'tool', content: 'Write completed', timestamp: 3, toolName: 'Write', toolStatus: 'completed', toolDetail: 'docs/Tech.md' },
            ],
        });

        const activity = screen.getByTestId('beegame-agent-activity-group');
        expect(screen.getAllByTestId(/^beegame-agent-turn-/)).toHaveLength(1);
        expect(screen.getAllByTestId('beegame-agent-activity-group')).toHaveLength(1);
        expect(activity).toHaveTextContent('Ran 3 tools');
        expect(activity.querySelector('[data-state="closed"]')).toBeInTheDocument();
    });

    it('hides StructuredOutput plumbing from the visible transcript', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [{
                id: 'structured-output',
                sender: 'system',
                type: 'tool',
                content: 'StructuredOutput completed',
                timestamp: 1,
                toolName: 'StructuredOutput',
                toolStatus: 'completed',
            }],
        });

        expect(screen.queryByTestId('beegame-agent-activity-group')).not.toBeInTheDocument();
        expect(screen.queryByText(/StructuredOutput/)).not.toBeInTheDocument();
    });

    it('shows internal workflow stages as lightweight separators and hides storage paths', async () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            lang: 'zh',
            messages: [{
                id: 'author-read',
                sender: 'system',
                type: 'tool',
                content: 'Read completed',
                timestamp: 1,
                toolName: 'Read',
                toolStatus: 'completed',
                toolDetail: '.beegame/workflow/foundation-authoring/run-1/workspace/docs/GDD.md',
            }],
        });

        expect(screen.getByTestId('beegame-stage-separator-author')).toHaveTextContent('文档编写');
        const activity = screen.getByTestId('beegame-agent-activity-group');
        await userEvent.setup().click(activity.querySelector('button')!);
        expect(activity).toHaveTextContent('GDD.md');
        expect(activity).not.toHaveTextContent('.beegame/workflow');
    });

    it('shows BeeGame read tool calls as activity items', async () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_read',
                    sender: 'system',
                    content: 'Read completed\nTarget: src/components/PlayerView.tsx',
                    timestamp: 1,
                    type: 'tool',
                    toolName: 'Read',
                    toolStatus: 'completed',
                    toolDetail: 'src/components/PlayerView.tsx',
                },
            ],
        });

        const activity = screen.getByTestId('beegame-agent-activity-group');
        expect(activity).toHaveTextContent('PlayerView.tsx');
        await userEvent.setup().click(activity.querySelector('button')!);
        expect(activity).toHaveTextContent('src/components/PlayerView.tsx');
    });


    it('normalizes BeeGame tool messages from snake_case fields and structured content', async () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_sample',
                    sender: 'system',
                    content: 'Tool: Write\nStatus: completed\nTarget: docs/GDD.md',
                    timestamp: 1,
                    type: 'tool',
                    tool: 'Write',
                    tool_status: 'completed',
                    tool_detail: 'Target: docs/GDD.md',
                    turnId: 'turn-normalized-tools',
                } as any,
                {
                    id: 'm_content',
                    sender: 'system',
                    content: 'Bash completed\nCommand: bun run build\nOutput: Build passed',
                    timestamp: 2,
                    type: 'tool',
                    turnId: 'turn-normalized-tools',
                },
            ],
        });

        const activity = screen.getByTestId('beegame-agent-activity-group');
        await userEvent.setup().click(activity.querySelector('button')!);
        expect(activity).toHaveTextContent('Edit');
        expect(activity).toHaveTextContent('Run');
        expect(activity).toHaveTextContent('docs/GDD.md');
        expect(activity).toHaveTextContent('bun run build');
        expect(screen.queryByText(/^Tool$/)).not.toBeInTheDocument();
    });

    it('collapses long completed Markdown in place and can reveal the full response', async () => {
        const longSection = '这是需要保留的文章正文，用来验证长内容不会持续撑高整个聊天窗口。'.repeat(45);
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_agent_long',
                    sender: 'beegame',
                    content: [
                        '## 项目完成总结',
                        '',
                        '我已成功实现了一个完整的体素生存游戏。',
                        '以下是交付内容。',
                        longSection,
                        'docs/GDD.md',
                        'docs/TECH_SPEC.md',
                        'docs/VERIFICATION.md',
                    ].join('\n'),
                    timestamp: 1,
                },
            ],
        });

        expect(screen.getByRole('heading', { name: '项目完成总结', level: 2 })).toBeInTheDocument();
        expect(document.body.textContent).toContain('docs/VERIFICATION.md');
        const expand = screen.getByRole('button', { name: /Show full response/ });
        expect(expand).toHaveAttribute('aria-expanded', 'false');
        await userEvent.setup().click(expand);
        expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
    });

    it('does not add article controls to short Markdown responses', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [{ id: 'short-markdown', sender: 'beegame', content: '## 完成\n\n场景已经准备好。', timestamp: 1 }],
        });

        expect(screen.queryByRole('button', { name: /Show full response/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show less' })).not.toBeInTheDocument();
    });

    it('renders BeeGame messages without an avatar header or collapse control', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_agent_collapsible',
                    sender: 'beegame',
                    content: '这是一条可以折叠的消息。',
                    timestamp: 1,
                },
                {
                    id: 'm_collapsible_tool',
                    sender: 'system',
                    content: 'Bash completed\nCommand: bun run build',
                    timestamp: 2,
                    type: 'tool',
                    toolName: 'Bash',
                    toolStatus: 'completed',
                    toolDetail: 'bun run build',
                },
            ],
        });

        expect(screen.getByText('这是一条可以折叠的消息。')).toBeInTheDocument();
        expect(screen.getByTestId('beegame-agent-activity-group')).toBeInTheDocument();
        expect(screen.queryByText('BeeGame')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Collapse BeeGame message' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Expand BeeGame message' })).not.toBeInTheDocument();
    });

    it('renders BeeGame agent summaries as markdown instead of raw markdown text', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_agent_markdown',
                    sender: 'beegame',
                    content: [
                        '### 项目完成总结',
                        '',
                        '以下是 **交付内容**：',
                        '',
                        '- **GDD.md** - 游戏设计文档',
                    ].join('\n'),
                    timestamp: 1,
                },
            ],
        });

        const heading = screen.getByRole('heading', { name: '项目完成总结', level: 3 });
        expect(heading).toBeInTheDocument();
	        expect(screen.getByText('交付内容')).toBeInTheDocument();
        expect(screen.queryByText(/### 项目完成总结/)).not.toBeInTheDocument();
        expect(screen.queryByText(/\*\*交付内容\*\*/)).not.toBeInTheDocument();
    });

    it('uses explicit presentation hints for detailed content and project artifacts', async () => {
        const { onPreviewArtifact } = renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_chat_reply',
                    sender: 'beegame',
                    content: '这是正常的聊天回复，即使它包含 Markdown 也不应被猜成文章。',
                    timestamp: 1,
                },
                {
                    id: 'm_article_reply',
                    sender: 'beegame',
                    content: '### 详细设计\n\n这是明确标记的详细内容。',
                    timestamp: 2,
                    renderHint: 'article',
                },
                {
                    id: 'm_artifact_reply',
                    sender: 'beegame',
                    content: '# 游戏设计文档\n\n已写入项目文件。',
                    timestamp: 3,
                    renderHint: 'artifact_card',
                    artifactId: 'artifact_gdd',
                    documentTitle: 'GDD.md',
                    artifactType: 'GDD',
                },
            ],
        });

        expect(screen.queryByTestId('beegame-article-message-m_chat_reply')).not.toBeInTheDocument();
        expect(screen.getByTestId('beegame-article-message-m_article_reply')).toBeInTheDocument();
        const artifact = screen.getByRole('button', { name: /GDD\.md/i });
        await userEvent.setup().click(artifact);
        expect(onPreviewArtifact).toHaveBeenCalledWith('artifact_gdd', 'GDD.md', '# 游戏设计文档\n\n已写入项目文件。');
    });

    it('renders write tool calls and preview actions inside the activity', async () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_write',
                    sender: 'system',
                    content: 'Write completed\nTarget: docs/GDD.md\nOutput: Created successfully',
                    timestamp: 1,
                    type: 'tool',
                    toolName: 'Write',
                    toolStatus: 'completed',
                    toolDetail: 'docs/GDD.md',
                    toolOutput: 'Created successfully',
                    artifactId: 'artifact_docs_gdd',
                },
            ],
        });

        const activity = screen.getByTestId('beegame-agent-activity-group');
        await userEvent.setup().click(activity.querySelector('button')!);
        expect(activity).toHaveTextContent('docs/GDD.md');
        expect(screen.queryByTestId('beegame-tool-output-m_write')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Open/i })).not.toBeInTheDocument();
    });

    it('renders BeeGame user messages without user identity chrome', async () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            currentUserDisplayName: 'NSWells',
            currentUserEmail: 'xmcz1996@gmail.com',
            currentUserAvatarUrl: '/avatar.png',
            messages: [
                {
                    id: 'm_user_identity',
                    sender: 'user',
                    content: '做一个我的世界风格类CS的FPS游戏',
                    timestamp: 1,
                },
            ],
        });

        const userMessage = screen.getByTestId('beegame-user-message-m_user_identity');
        expect(userMessage).toHaveClass('min-w-0');
        expect(userMessage).not.toHaveClass('max-w-[46rem]');
        expect(userMessage).not.toHaveClass('ml-auto');
        expect(userMessage).toHaveTextContent('做一个我的世界风格类CS的FPS游戏');
        expect(userMessage.querySelector('[data-slot="message-bubble-content"]')).toBeInTheDocument();
        expect(userMessage.querySelector('[data-variant="solid"]')).toBeInTheDocument();
        expect(userMessage.querySelector('[data-slot="message-avatar"]')).toBeNull();
        expect(userMessage.querySelector('[data-slot="message-header"]')).toBeNull();
        expect(userMessage).not.toHaveTextContent('NSWells');
        expect(within(userMessage.closest('[data-slot="message"]')!).queryByAltText('')).not.toBeInTheDocument();
    });

    it('keeps the official solid bubble foreground readable in dark mode', () => {
        document.documentElement.classList.add('dark');
        try {
            renderChatPanel({
                actionPermission: undefined,
                pendingPermissions: [],
                variant: 'beegame',
                messages: [{
                    id: 'm_user_dark',
                    sender: 'user',
                    content: 'Dark mode message',
                    timestamp: 1,
                }],
            });

            const userMessage = screen.getByTestId('beegame-user-message-m_user_dark');
            const bubble = userMessage.querySelector('[data-slot="message-bubble-content"]');
            expect(userMessage.querySelector('[data-slot="message-bubble"]')).toHaveAttribute('data-variant', 'solid');
            expect(bubble).toHaveClass('text-background');
            expect(userMessage).not.toHaveClass('text-[var(--text-primary)]');
            expect(bubble).toHaveTextContent('Dark mode message');
        } finally {
            document.documentElement.classList.remove('dark');
        }
    });

    it('does not draw timeline connectors for BeeGame activity rows', async () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_write',
                    sender: 'system',
                    content: 'Write completed\nTarget: docs/GDD.md',
                    timestamp: 1,
                    type: 'tool',
                    toolName: 'Write',
                    toolStatus: 'completed',
                    toolDetail: 'docs/GDD.md',
                    turnId: 'turn-timeline-tools',
                },
                {
                    id: 'm_bash',
                    sender: 'system',
                    content: 'Bash completed\nCommand: bun run build',
                    timestamp: 2,
                    type: 'tool',
                    toolName: 'Bash',
                    toolStatus: 'completed',
                    toolDetail: 'bun run build',
                    turnId: 'turn-timeline-tools',
                },
            ],
        });

        const activity = screen.getByTestId('beegame-agent-activity-group');
        expect(activity.querySelector('[data-testid="beegame-tool-connector"]')).toBeNull();
        expect(screen.queryByTestId('beegame-tool-timeline-card')).not.toBeInTheDocument();
    });

    it('uses activity status icons for running, completed, and failed tools', async () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_running',
                    sender: 'system',
                    content: 'Bash running\nCommand: bun run build',
                    timestamp: 1,
                    type: 'tool',
                    toolName: 'Bash',
                    toolStatus: 'running',
                    toolDetail: 'bun run build',
                    turnId: 'turn-status-tools',
                },
                {
                    id: 'm_completed',
                    sender: 'system',
                    content: 'Write completed\nTarget: docs/GDD.md',
                    timestamp: 2,
                    type: 'tool',
                    toolName: 'Write',
                    toolStatus: 'completed',
                    toolDetail: 'docs/GDD.md',
                    turnId: 'turn-status-tools',
                },
                {
                    id: 'm_failed',
                    sender: 'system',
                    content: 'Bash failed\nCommand: bun test',
                    timestamp: 3,
                    type: 'tool',
                    toolName: 'Bash',
                    toolStatus: 'failed',
                    toolDetail: 'bun test',
                    turnId: 'turn-status-tools',
                },
            ],
        });

        const activity = screen.getByTestId('beegame-agent-activity-group');
        expect(activity.querySelector('[data-state="working"]')).toBeInTheDocument();
        expect(activity.querySelector('[role="region"]')).toHaveStyle({ height: '0px' });
        expect(activity).toHaveTextContent('Running command');
        expect(within(activity).getByText('Edit')).toBeInTheDocument();
        expect(within(activity).getAllByText('Run').length).toBeGreaterThan(0);
    });

    it('uses the canonical BeeGame message rendering path without a mode switch', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            messages: [
                {
                    id: 'm_agent',
                    sender: 'beegame',
                    content: 'Canonical chat message',
                    timestamp: 2,
                },
            ],
        });

        expect(screen.getByTestId('beegame-agent-message-m_agent')).toBeInTheDocument();
        expect(screen.getByTestId('beegame-agent-message-m_agent').querySelector('[data-slot="message-bubble"]')).toBeNull();
        expect(screen.getByText('Canonical chat message')).toBeInTheDocument();
    });

    it('shows the vendored completion footer for a real assistant response', () => {
        renderChatPanel({
            actionPermission: undefined,
            messages: [
                { id: 'footer-user', sender: 'user', content: 'Please inspect the scene.', timestamp: 1 },
                { id: 'footer-agent', sender: 'beegame', content: 'The scene is ready.', timestamp: 2 },
            ],
        });

        expect(screen.getByRole('button', { name: 'Copy response' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Helpful' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Not helpful' })).toBeInTheDocument();
    });

    it('shows response actions only on the final assistant reply before the next user message', () => {
        renderChatPanel({
            actionPermission: undefined,
            onSendMessage: vi.fn(),
            messages: [
                { id: 'user-a', sender: 'user', content: 'Do the work.', timestamp: 1 },
                { id: 'agent-progress', sender: 'beegame', content: 'I am inspecting the files.', timestamp: 2 },
                { id: 'agent-final', sender: 'beegame', content: 'The work is complete.', timestamp: 3 },
            ],
        });

        expect(screen.getAllByRole('button', { name: 'Copy response' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Retry response' })).toHaveLength(1);
    });

    it('retries a completed response with its nearest preceding user message', () => {
        const onSendMessage = vi.fn();
        renderChatPanel({
            actionPermission: undefined,
            onSendMessage,
            messages: [
                { id: 'retry-user', sender: 'user', content: 'Retry this request.', timestamp: 1 },
                { id: 'retry-agent', sender: 'beegame', content: 'Completed answer.', timestamp: 2 },
            ],
        });

        fireEvent.click(screen.getByRole('button', { name: 'Retry response' }));
        expect(onSendMessage).toHaveBeenCalledWith('Retry this request.');
    });

    it('hides completion actions while the assistant response is streaming', () => {
        renderChatPanel({
            actionPermission: undefined,
            streamingMessageId: 'streaming-agent',
            messages: [{ id: 'streaming-agent', sender: 'beegame', content: 'Still writing…', timestamp: 2 }],
        });

        expect(screen.queryByRole('button', { name: 'Copy response' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Helpful' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Not helpful' })).not.toBeInTheDocument();
    });

    it('does not render an empty completion footer for an activity-only turn', () => {
        renderChatPanel({
            actionPermission: undefined,
            messages: [{
                id: 'activity-only-tool',
                sender: 'system',
                content: 'Read completed\nTarget: src/App.tsx',
                timestamp: 1,
                type: 'tool',
                toolName: 'Read',
                toolStatus: 'completed',
                toolDetail: 'src/App.tsx',
            }],
        });

        expect(screen.queryByRole('button', { name: 'Copy response' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Helpful' })).not.toBeInTheDocument();
    });

    it('renders structured assistant citations through StreamingResponse', async () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            messages: [{
                id: 'm_citations',
                sender: 'beegame',
                content: 'Response with sources',
                timestamp: 2,
                sources: [{ id: 'source-1', title: 'BeeGame docs', domain: 'beegame.test' }],
                citations: [
                    { id: 'source-1', title: 'BeeGame docs', domain: 'beegame.test' },
                    { id: 'source-2', title: 'Transcript citation', domain: 'transcript.test' },
                ],
            }],
        });

        const sourceButton = screen.getByRole('button', { name: /2 sources/i });
        expect(sourceButton).toBeInTheDocument();
        await userEvent.click(sourceButton);
        expect(screen.getByText('BeeGame docs')).toBeInTheDocument();
        expect(screen.getByText('Transcript citation')).toBeInTheDocument();
    });

    it('restores the normal composer after approval state idles and the pending review is removed', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            permissionState: {
                gateId: null,
                action: null,
                phase: 'idle',
                message: '',
            },
        });

        expect(screen.getByPlaceholderText(/ask team/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    });

    it('locks the normal composer while the runtime is busy', () => {
        renderChatPanel({
            actionPermission: undefined,
            pendingPermissions: [],
            chatInput: 'continue',
            isComposerLocked: true,
        });

        expect(screen.getByPlaceholderText(/AI is processing/i)).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    });

    it('does not show stale approval actions after the project has failed', () => {
        renderChatPanel({
            actionPermission: beeGamePermissionReview,
            projectStatus: {
                project_id: 'proj_1',
                phase: 'gdd',
                blocked: true,
                blocked_reason: 'pipeline_failed',
                workflow: {
                    runId: 'run_failed',
                    status: 'failed',
                    block: {
                        message: 'Pipeline failed',
                    },
                },
            } as any,
        });

        expect(screen.getByRole('textbox')).toBeInTheDocument();
        expect(screen.queryByTestId('beegame-permission-panel')).not.toBeInTheDocument();
    });
});
