import { createRef, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const blockerResolutionReview: PendingUserReviewItem = {
    ...approvalReview,
    gate_id: 'gate_blockers',
    gate_kind: 'review_blocker_resolution',
    ready_for_user_approval: false,
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
        gddReview: approvalReview,
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

    it('shows blocker resolution gates as revision work, not approval', () => {
        renderChatPanel({ gddReview: blockerResolutionReview });

        expect(screen.getByText('Revision Required')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
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
            gddReview: undefined,
            pendingReviews: [],
        });

        expect(screen.getByPlaceholderText(/ask team/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    });

    it('uses the BeeGame dock styling for the normal composer', () => {
        renderChatPanel({
            gddReview: undefined,
            pendingReviews: [],
            variant: 'beegame',
        });

        expect(screen.getByTestId('beegame-chat-panel')).toBeInTheDocument();
        expect(screen.getByTestId('beegame-chat-composer')).toBeInTheDocument();
    });

    it('renders BeeGame messages as a compact feed with tools after their message', () => {
        renderChatPanel({
            gddReview: undefined,
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
        expect(screen.queryByText('当前任务')).not.toBeInTheDocument();
        expect(screen.getByTestId('beegame-user-message-m_user')).toBeInTheDocument();
        expect(screen.getByText('请构建首个可玩版本')).toBeInTheDocument();
        expect(screen.getByText('BeeGame')).toBeInTheDocument();
        expect(screen.getByText('我会先完成可运行闭环，然后验证构建入口。')).toBeInTheDocument();
        expect(screen.getByText('Write completed')).toBeInTheDocument();
        expect(screen.getAllByText('Bash completed').length).toBeGreaterThan(0);
        expect(screen.getByTestId('beegame-agent-message-m_agent')).toBeInTheDocument();

        const agentCard = screen.getByTestId('beegame-agent-message-m_agent');
        const writeCard = document.querySelector('[data-tool-id="m_write"]')!;
        const bashCard = document.querySelector('[data-tool-id="m_bash"]')!;
        expect(agentCard.compareDocumentPosition(writeCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(writeCard.compareDocumentPosition(bashCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByText('docs/PLAYABLE_SPEC.md')).not.toBeInTheDocument();
        expect(screen.queryByText('bun run build')).not.toBeInTheDocument();
        expect(screen.queryByText('Build passed')).not.toBeInTheDocument();
    });

    it('shows every BeeGame tool call instead of limiting the feed to the last six', () => {
        renderChatPanel({
            gddReview: undefined,
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
            gddReview: undefined,
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
            gddReview: undefined,
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
            gddReview: undefined,
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
            gddReview: undefined,
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
            gddReview: undefined,
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
            gddReview: undefined,
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

    it('keeps the legacy message rendering path outside BeeGame mode', () => {
        renderChatPanel({
            gddReview: undefined,
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
            gddReview: undefined,
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
            gddReview: undefined,
            pendingReviews: [],
            chatInput: 'continue',
            isComposerLocked: true,
        });

        expect(screen.getByPlaceholderText(/AI is processing/i)).toBeDisabled();
        expect(screen.getByRole('button')).toBeDisabled();
    });

    it('does not show stale approval actions after the project has failed', () => {
        renderChatPanel({
            gddReview: approvalReview,
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
