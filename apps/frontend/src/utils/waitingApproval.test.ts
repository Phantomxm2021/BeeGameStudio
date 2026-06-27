import { describe, expect, it } from 'vitest';

import { deriveDashboardStatus, getWaitingApprovalState } from './waitingApproval';

describe('waitingApproval helpers', () => {
  it('prefers structured review status over pipeline stage strings', () => {
    const state = getWaitingApprovalState(
      {
        project_id: 'proj_1',
        phase: 'DESIGN_IN_PROGRESS',
        blocked: false,
        review_status: {
          workflow_id: 'review_flow',
          lane_id: 'internal_board_review',
          lane_status: 'awaiting_approval',
          decision_status: 'awaiting_user',
          message: { message_key: 'review.awaiting_user' },
          requires_user_action: true,
          user_action_kind: 'approve',
        },
      },
      [],
    );

    expect(state.kind).toBe('review');
    expect(state.isBlockingChat).toBe(true);
  });

  it('handles legacy blocker resolution gates through generic review status', () => {
    const state = getWaitingApprovalState(
      {
        project_id: 'proj_1',
        phase: 'DESIGN_IN_PROGRESS',
        blocked: false,
      },
      [
        {
          gate_id: 'gate_blockers',
          gate_kind: 'review_blocker_resolution',
          review_status: {
            workflow_id: 'review_flow',
            lane_id: 'internal_board_review',
            lane_status: 'awaiting_approval',
            decision_status: 'awaiting_user',
            message: { message_key: 'review.awaiting_user' },
            requires_user_action: true,
            user_action_kind: 'approve',
          },
          open_blocker_ids: ['issue_1'],
        },
      ],
    );

    expect(state.kind).toBe('review');
    expect(state.isBlockingChat).toBe(true);
    expect(state.message).not.toContain('blocker');
    expect(state.placeholder).toBe('请先处理当前请求...');
  });

  it('returns default state when structured review status is absent', () => {
    const state = getWaitingApprovalState(
      {
        project_id: 'proj_1',
        phase: 'DESIGN_IN_PROGRESS',
        blocked: false,
      },
      [],
    );

    expect(state.kind).toBe('none');
    expect(state.isBlockingChat).toBe(false);
  });

  it('allows chat input when BeeGame is paused without approval required', () => {
    const state = getWaitingApprovalState(
      {
        project_id: 'proj_1',
        phase: 'paused',
        blocked: true,
        blocked_reason: 'BeeGame paused after the runtime stopped.',
        approval_required: false,
      },
      [],
    );

    expect(state.isBlockingChat).toBe(false);
    expect(state.message).toContain('BeeGame paused after the runtime stopped.');
    expect(state.placeholder).toBe('输入修复要求或继续任务...');
  });

  it('keeps chat blocked when a paused turn is waiting for approval', () => {
    const state = getWaitingApprovalState(
      {
        project_id: 'proj_1',
        phase: 'paused',
        blocked: true,
        blocked_reason: 'Permission required',
        approval_required: true,
      },
      [],
    );

    expect(state.isBlockingChat).toBe(true);
    expect(state.message).toContain('Permission required');
  });

  it('derives waiting_approval dashboard state from waiting approval flags', () => {
    const status = deriveDashboardStatus({
      isOffline: false,
      isLoading: false,
      canContinue: false,
      hasWaitingApproval: true,
      messages: [],
    });

    expect(status).toBe('waiting_approval');
  });
});
