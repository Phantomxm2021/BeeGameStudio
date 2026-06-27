import { createRef, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ChatPanel } from './ChatPanel';
import type { PendingUserReviewItem } from '../../../services/api';

const defaultWaitingApproval = {
    kind: 'none' as const,
    isWaitingStatus: false,
    isBlockingChat: false,
    message: '',
    placeholder: 'Ask team (Shift+Enter to new line)...',
};

const approvalReview: PendingUserReviewItem = {
    gate_id: 'gate_approval',
    artifact_id: 'art_1',
    current_review_artifact_id: 'art_1',
    current_review_iteration: 2,
    ready_for_user_approval: true,
    review_status: {
        workflow_id: 'gdd_v2',
        lane_id: 'internal_board_review',
        lane_status: 'awaiting_approval',
        decision_status: 'awaiting_user',
        current_review_round: 2,
        requires_user_action: true,
        user_action_kind: 'approve',
    },
    open_issue_ids: [],
    open_blocker_ids: [],
};

const legacyGateReview: PendingUserReviewItem = {
    ...approvalReview,
    gate_id: 'gate_blockers',
    gate_kind: 'review_blocker_resolution',
    ready_for_user_approval: true,
    ready_for_promotion: false,
    review_status: {
        ...approvalReview.review_status!,
        user_action_kind: 'approve',
    },
    open_issue_ids: ['issue_1'],
    open_blocker_ids: ['issue_1'],
};

const renderChatPanel = (overrides: Partial<ComponentProps<typeof ChatPanel>> = {}) => {
    const onApprovePlan = vi.fn().mockResolvedValue(undefined);
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
        onApprovePlan,
        approvalState: {
            gateId: null,
            action: null,
            phase: 'idle',
            message: '',
        },
        actionReview: approvalReview,
        pendingReviews: [],
        onUploadManifestCsv: vi.fn(),
        onApproveManifest: vi.fn(),
        waitingApproval: defaultWaitingApproval,
        ...overrides,
    };

    return {
        onApprovePlan,
        onPreviewArtifact,
        ...render(<ChatPanel {...props} />),
    };
};

describe('ChatPanel approval bar', () => {
    it('replaces the composer with a bottom approval bar', () => {
        renderChatPanel();

        expect(screen.queryByPlaceholderText(/ask team/i)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^revise$/i })).toBeInTheDocument();
    });

    it('does not give legacy blocker gate kinds custom approval behavior', () => {
        renderChatPanel({ actionReview: legacyGateReview });

        expect(screen.getByText('Approval Required')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^revise$/i })).toBeInTheDocument();
    });

    it('keeps approval buttons clickable while global loading is true', async () => {
        const user = userEvent.setup();
        const { onApprovePlan } = renderChatPanel({ isLoading: true });

        const approveButton = screen.getByRole('button', { name: /^approve$/i });
        const reviseButton = screen.getByRole('button', { name: /^revise$/i });

        expect(approveButton).toBeEnabled();
        expect(reviseButton).toBeEnabled();

        await user.click(approveButton);
        expect(onApprovePlan).toHaveBeenCalledWith(approvalReview);
    });

    it('only disables the submitting action and preserves the compact two-column bar layout', () => {
        renderChatPanel({
            approvalState: {
                gateId: 'gate_approval',
                action: 'approve',
                phase: 'submitting',
                message: '已提交批准，系统正在进入下一阶段。',
            },
        });

        expect(screen.getByRole('button', { name: /^submitting$/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /^revise$/i })).toBeEnabled();

        const approveButton = screen.getByRole('button', { name: /^submitting$/i });
        expect(approveButton.parentElement).toHaveClass('min-[360px]:grid-cols-2');
    });

    it('restores interaction after a failed approval attempt', async () => {
        const user = userEvent.setup();
        const { onApprovePlan } = renderChatPanel({
            approvalState: {
                gateId: 'gate_approval',
                action: 'approve',
                phase: 'failed',
                message: '审批操作失败，请重试',
            },
        });

        const approveButton = screen.getByRole('button', { name: /^approve$/i });
        expect(approveButton).toBeEnabled();
        expect(screen.getByText('审批操作失败，请重试')).toBeInTheDocument();

        await user.click(approveButton);
        expect(onApprovePlan).toHaveBeenCalledWith(approvalReview);
    });

    it('restores the normal composer when no approval gate is active', () => {
        renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
        });

        expect(screen.getByPlaceholderText(/ask team/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    });

    it('uses the BeeGame dock styling for the normal composer', () => {
        renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
            variant: 'beegame',
        });

        expect(screen.getByTestId('beegame-chat-panel')).toBeInTheDocument();
        expect(screen.getByTestId('beegame-chat-composer')).toBeInTheDocument();
    });

    it('renders BeeGame messages as a compact feed with tools after their message', () => {
        renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
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
                },
            ],
            projectStatus: {
                project_id: 'proj_1',
                phase: 'running',
                blocked: false,
                next_action: 'running',
            } as any,
        });

        expect(screen.getByTestId('beegame-collaboration-feed')).toBeInTheDocument();
        expect(screen.getByTestId('beegame-conversation-axis')).toBeInTheDocument();
        expect(screen.queryByText('当前任务')).not.toBeInTheDocument();
        const userMessage = screen.getByTestId('beegame-user-message-m_user');
        expect(userMessage).toBeInTheDocument();
        expect(userMessage).toHaveClass('bg-zinc-800/45');
        expect(userMessage).not.toHaveClass('bg-zinc-100');
        expect(userMessage).not.toHaveClass('bg-sky-950/20');
        expect(screen.getByText('请构建首个可玩版本')).toBeInTheDocument();
        expect(screen.getByText('BeeGame')).toBeInTheDocument();
        expect(screen.getByAltText('BeeGame')).toHaveAttribute('src', '/assets/beegame_avatar.png');
        expect(screen.getByText('我会先完成可运行闭环，然后验证构建入口。')).toBeInTheDocument();
        expect(screen.getByText('Write completed')).toBeInTheDocument();
        expect(screen.getAllByText('Bash completed').length).toBeGreaterThan(0);
        expect(screen.getByTestId('beegame-agent-message-m_agent')).toBeInTheDocument();

        const agentCard = screen.getByTestId('beegame-agent-message-m_agent');
        expect(agentCard).toHaveClass('bg-orange-950/15');
        expect(agentCard).not.toHaveClass('bg-sky-950/20');
        const writeCard = document.querySelector('[data-tool-id="m_write"]')!;
        const bashCard = document.querySelector('[data-tool-id="m_bash"]')!;
        expect(agentCard.compareDocumentPosition(writeCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(writeCard.compareDocumentPosition(bashCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByText('docs/PLAYABLE_SPEC.md')).not.toBeInTheDocument();
        expect(screen.queryByText('bun run build')).not.toBeInTheDocument();
        expect(screen.queryByText('Build passed')).not.toBeInTheDocument();
    });

    it('uses the BeeGame conversation axis as a sticky message navigator', () => {
        const scrollIntoView = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoView;

        const { container } = renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_user_axis',
                    sender: 'user',
                    content: '让蛇移动更灵敏',
                    timestamp: 1,
                },
                {
                    id: 'm_agent_axis',
                    sender: 'beegame',
                    content: '我会调整输入响应并重新验证。',
                    timestamp: 2,
                },
            ],
        });

        const axis = screen.getByTestId('beegame-conversation-axis');
        const feed = screen.getByTestId('beegame-collaboration-feed');
        expect(feed).not.toContainElement(axis);
        expect(axis).toHaveClass('sticky');
        expect(axis).toHaveClass('top-1/2');
        expect(feed).toHaveClass('pl-12');
        expect(feed).not.toHaveClass('pl-28');
        expect(screen.getByTestId('beegame-conversation-axis-shell')).toHaveClass('left-0');
        expect(screen.getByTestId('beegame-conversation-axis-shell')).toHaveClass('-translate-y-1/2');
        expect(screen.getByTestId('beegame-conversation-axis-shell')).not.toHaveClass('left-[calc(100vw-420px)]');
        const rail = screen.getByTestId('beegame-conversation-axis-rail');
        expect(rail).toHaveClass('overflow-y-auto');
        expect(rail).toHaveClass('py-12');
        expect(rail).not.toHaveClass('py-8');

        const firstTick = screen.getByRole('button', { name: 'Jump to message 1' });
        expect(firstTick).toHaveAttribute('data-active', 'true');
        expect(firstTick.querySelector('[data-testid="beegame-conversation-axis-line"]')).toHaveAttribute('data-length', 'short');
        fireEvent.mouseEnter(firstTick);
        expect(firstTick.querySelector('[data-testid="beegame-conversation-axis-line"]')).toHaveAttribute('data-length', 'full');
        expect(screen.getByTestId('beegame-conversation-axis-preview')).toHaveTextContent('让蛇移动更灵敏');

        const wheelEvent = new WheelEvent('wheel', { bubbles: true, deltaY: 80 });
        const stopPropagation = vi.spyOn(wheelEvent, 'stopPropagation');
        rail.dispatchEvent(wheelEvent);
        expect(stopPropagation).toHaveBeenCalled();

        const scrollContainer = container.querySelector('[data-testid="beegame-chat-panel"] > div') as HTMLDivElement;
        const target = document.querySelector('[data-beegame-message-anchor="m_agent_axis"]') as HTMLDivElement;
        Object.defineProperties(scrollContainer, {
            scrollTop: { configurable: true, writable: true, value: 120 },
            clientHeight: { configurable: true, value: 400 },
        });
        const scrollTo = vi.fn();
        Object.defineProperty(scrollContainer, 'scrollTo', { configurable: true, value: scrollTo });
        const performanceNowSpy = vi.spyOn(performance, 'now').mockReturnValue(500);
        let animationFrameTime = 500;
        const requestAnimationFrameSpy = vi
            .spyOn(window, 'requestAnimationFrame')
            .mockImplementation((callback: FrameRequestCallback) => {
                animationFrameTime += 300;
                callback(animationFrameTime);
                return 1;
            });
        const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        Object.defineProperty(target, 'offsetHeight', { configurable: true, value: 80 });
        scrollContainer.getBoundingClientRect = vi.fn(() => ({
            top: 100,
            bottom: 500,
            left: 0,
            right: 400,
            width: 400,
            height: 400,
            x: 0,
            y: 100,
            toJSON: () => ({}),
        }));
        target.getBoundingClientRect = vi.fn(() => ({
            top: 500,
            bottom: 580,
            left: 0,
            right: 400,
            width: 400,
            height: 80,
            x: 0,
            y: 500,
            toJSON: () => ({}),
        }));

        scrollIntoView.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Jump to message 2' }));
        expect(requestAnimationFrameSpy).toHaveBeenCalled();
        expect(scrollContainer.scrollTop).toBe(360);
        expect(scrollTo).not.toHaveBeenCalled();
        expect(scrollIntoView).not.toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
        expect(scrollIntoView).not.toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
        requestAnimationFrameSpy.mockRestore();
        cancelAnimationFrameSpy.mockRestore();
        performanceNowSpy.mockRestore();
    });

    it('keeps BeeGame axis ticks compact and expands nearby ticks on hover', () => {
        renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
            variant: 'beegame',
            messages: Array.from({ length: 7 }, (_, index) => ({
                id: `m_axis_${index + 1}`,
                sender: index % 2 === 0 ? 'user' : 'beegame',
                content: `message ${index + 1}`,
                timestamp: index + 1,
            })),
        });

        const lines = screen.getAllByTestId('beegame-conversation-axis-line');
        expect(lines).toHaveLength(7);
        expect(lines.every((line) => line.getAttribute('data-length') === 'short')).toBe(true);

        const shell = screen.getByTestId('beegame-conversation-axis-shell');
        const fourthTick = screen.getByRole('button', { name: 'Jump to message 4' });
        shell.getBoundingClientRect = vi.fn(() => ({
            top: 200,
            bottom: 488,
            left: 0,
            right: 40,
            width: 40,
            height: 288,
            x: 0,
            y: 200,
            toJSON: () => ({}),
        }));
        fourthTick.getBoundingClientRect = vi.fn(() => ({
            top: 260,
            bottom: 270,
            left: 0,
            right: 40,
            width: 40,
            height: 10,
            x: 0,
            y: 260,
            toJSON: () => ({}),
        }));
        Object.defineProperties(fourthTick, {
            offsetTop: { configurable: true, value: 180 },
            offsetHeight: { configurable: true, value: 10 },
        });

        fireEvent.mouseEnter(fourthTick);

        expect(lines[0]).toHaveAttribute('data-cascade', '3');
        expect(lines[1]).toHaveAttribute('data-cascade', '2');
        expect(lines[2]).toHaveAttribute('data-cascade', '1');
        expect(lines[3]).toHaveAttribute('data-cascade', '0');
        expect(lines[4]).toHaveAttribute('data-cascade', '1');
        expect(lines[5]).toHaveAttribute('data-cascade', '2');
        expect(lines[6]).toHaveAttribute('data-cascade', '3');
        expect(lines[3]).toHaveAttribute('data-length', 'full');
        expect(screen.getByTestId('beegame-conversation-axis-preview')).toHaveAttribute('data-anchor-index', '3');
        expect(screen.getByTestId('beegame-conversation-axis-preview')).toHaveStyle({ top: '65px' });
    });

    it('highlights the final BeeGame axis tick when scrolled to the bottom', async () => {
        const { container } = renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_axis_bottom_1',
                    sender: 'beegame',
                    content: 'first message',
                    timestamp: 1,
                },
                {
                    id: 'm_axis_bottom_2',
                    sender: 'beegame',
                    content: 'second message',
                    timestamp: 2,
                },
                {
                    id: 'm_axis_bottom_3',
                    sender: 'beegame',
                    content: 'last message',
                    timestamp: 3,
                },
            ],
        });

        const scrollContainer = container.querySelector('[data-testid="beegame-chat-panel"] > div') as HTMLDivElement;
        Object.defineProperties(scrollContainer, {
            scrollTop: { configurable: true, value: 700 },
            clientHeight: { configurable: true, value: 300 },
            scrollHeight: { configurable: true, value: 1000 },
        });

        fireEvent.scroll(scrollContainer);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Jump to message 3' })).toHaveAttribute('data-active', 'true');
        });
        expect(screen.getByRole('button', { name: 'Jump to message 2' })).toHaveAttribute('data-active', 'false');
    });

    it('shows every BeeGame tool call instead of limiting the feed to the last six', () => {
        renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_agent',
                    sender: 'beegame',
                    content: '我会连续执行验证。',
                    timestamp: 1,
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
                })),
            ],
        });

        expect(screen.getAllByTestId(/beegame-tool-timeline-card/)).toHaveLength(8);
        expect(screen.getAllByText('Bash completed')).toHaveLength(8);
    });

    it('normalizes BeeGame tool messages from snake_case fields and structured content', async () => {
        const user = userEvent.setup();
        renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
            variant: 'beegame',
            messages: [
                {
                    id: 'm_snake',
                    sender: 'system',
                    content: 'Tool: Write\nStatus: completed\nTarget: docs/GDD.md',
                    timestamp: 1,
                    type: 'tool',
                    tool: 'Write',
                    tool_status: 'completed',
                    tool_detail: 'Target: docs/GDD.md',
                } as any,
                {
                    id: 'm_content',
                    sender: 'system',
                    content: 'Bash completed\nCommand: bun run build\nOutput: Build passed',
                    timestamp: 2,
                    type: 'tool',
                },
            ],
        });

        expect(screen.getByText('Write completed')).toBeInTheDocument();
        expect(screen.getAllByText('Bash completed').length).toBeGreaterThan(0);
        expect(screen.queryByText('docs/GDD.md')).not.toBeInTheDocument();
        expect(screen.queryByText('bun run build')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /Write completed/i }));
        expect(screen.getByText('docs/GDD.md')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /Bash completed/i }));
        expect(screen.getByText('bun run build')).toBeInTheDocument();
        expect(screen.queryByText(/^Tool$/)).not.toBeInTheDocument();
    });

    it('keeps long BeeGame final summaries compact inside the collaboration feed', async () => {
        const user = userEvent.setup();
        renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
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
                        '这行应该还可见。',
                        '这一行之后的详细清单不应该继续撑满整个右侧面板。',
                        'docs/GDD.md',
                        'docs/TECH_SPEC.md',
                        'docs/VERIFICATION.md',
                    ].join('\n'),
                    timestamp: 1,
                },
            ],
        });

        const feed = screen.getByTestId('beegame-collaboration-feed');
        expect(screen.getByRole('heading', { name: '项目完成总结', level: 2 })).toBeInTheDocument();
        expect(feed.textContent).not.toContain('docs/VERIFICATION.md');
        await user.click(screen.getByRole('button', { name: 'View summary details' }));
        expect(feed.textContent).toContain('docs/VERIFICATION.md');
        expect(screen.getByRole('button', { name: 'Hide summary details' })).toBeInTheDocument();
    });

    it('allows BeeGame messages to collapse and expand', async () => {
        const user = userEvent.setup();
        renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
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

        const toggle = screen.getByRole('button', { name: 'Collapse BeeGame message' });
        expect(screen.getByText('这是一条可以折叠的消息。')).toBeInTheDocument();
        expect(screen.getByText('Bash completed')).toBeInTheDocument();

        await user.click(toggle);

        expect(screen.queryByText('这是一条可以折叠的消息。')).not.toBeInTheDocument();
        expect(screen.queryByText('Bash completed')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Expand BeeGame message' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Expand BeeGame message' }));

        expect(screen.getByText('这是一条可以折叠的消息。')).toBeInTheDocument();
        expect(screen.getByText('Bash completed')).toBeInTheDocument();
    });

    it('renders BeeGame agent summaries as markdown instead of raw markdown text', () => {
        renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
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
        expect(screen.getByText('交付内容')).toHaveClass('font-bold');
        expect(screen.queryByText(/### 项目完成总结/)).not.toBeInTheDocument();
        expect(screen.queryByText(/\*\*交付内容\*\*/)).not.toBeInTheDocument();
    });

    it('opens tool cards on demand and wires Open and Diff actions to previews', async () => {
        const user = userEvent.setup();
        const { onPreviewArtifact } = renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
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

        const toolToggle = screen.getByRole('button', { name: /Write completed/i });
        expect(toolToggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('docs/GDD.md')).not.toBeInTheDocument();

        await user.click(toolToggle);
        expect(toolToggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('docs/GDD.md')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Open docs/GDD.md' }));
        expect(onPreviewArtifact).toHaveBeenCalledWith('artifact_docs_gdd', 'docs/GDD.md', undefined);

        await user.click(screen.getByRole('button', { name: 'Diff docs/GDD.md' }));
        expect(onPreviewArtifact).toHaveBeenCalledWith(
            'artifact_docs_gdd:diff',
            'Diff: docs/GDD.md',
            expect.stringContaining('Created successfully'),
        );
    });

    it('does not draw a timeline connector below the final BeeGame tool card', () => {
        renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
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
                },
            ],
        });

        const toolCards = screen.getAllByTestId('beegame-tool-timeline-card');
        expect(toolCards[0].querySelector('[data-testid="beegame-tool-connector"]')).not.toBeNull();
        expect(toolCards[1].querySelector('[data-testid="beegame-tool-connector"]')).toBeNull();
    });

    it('uses plain BeeGame tool status icons without circular badges', () => {
        renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
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
                },
            ],
        });

        const statusIcons = screen.getAllByTestId('beegame-tool-status-icon');
        expect(statusIcons).toHaveLength(3);
        statusIcons.forEach((statusIcon) => {
            expect(statusIcon).not.toHaveClass('rounded-full');
            expect(statusIcon).not.toHaveClass('border');
        });
        expect(statusIcons[0].querySelector('svg')).toHaveClass('animate-spin');
        expect(statusIcons[1]).toHaveClass('text-emerald-400');
        expect(statusIcons[2]).toHaveClass('text-red-400');
    });

    it('keeps the legacy message rendering path outside BeeGame mode', () => {
        renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
            messages: [
                {
                    id: 'm_agent',
                    sender: 'beegame',
                    content: 'Legacy chat message',
                    timestamp: 2,
                },
            ],
        });

        expect(screen.queryByTestId('beegame-collaboration-feed')).not.toBeInTheDocument();
        expect(screen.queryByText('当前任务')).not.toBeInTheDocument();
        expect(screen.getByText('Legacy chat message')).toBeInTheDocument();
    });

    it('restores the normal composer after approval state idles and the pending review is removed', () => {
        renderChatPanel({
            actionReview: undefined,
            pendingReviews: [],
            approvalState: {
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
            actionReview: undefined,
            pendingReviews: [],
            chatInput: 'continue',
            isComposerLocked: true,
        });

        expect(screen.getByPlaceholderText(/AI is processing/i)).toBeDisabled();
        expect(screen.getByRole('button')).toBeDisabled();
    });

    it('does not show stale approval actions after the project has failed', () => {
        renderChatPanel({
            actionReview: approvalReview,
            projectStatus: {
                project_id: 'proj_1',
                phase: 'gdd',
                blocked: true,
                blocked_reason: 'pipeline_failed',
                approval_required: false,
            } as any,
        });

        expect(screen.getByPlaceholderText(/ask team/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    });
});
