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
    const props: ComponentProps<typeof ChatPanel> = {
        messages: [],
        isLoading: false,
        chatInput: '',
        onChatInputChange: vi.fn(),
        onSend: vi.fn(),
        onPreviewArtifact: vi.fn(),
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
