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
          workflow_id: 'gdd_v2',
          lane_id: 'internal_board_review',
          lane_status: 'awaiting_approval',
          decision_status: 'awaiting_user',
          message: { message_key: 'review.gdd.internal_board.awaiting_user' },
          requires_user_action: true,
          user_action_kind: 'approve',
        },
      },
      [],
    );

    expect(state.kind).toBe('gdd');
    expect(state.isBlockingChat).toBe(true);
  });

  it('describes blocker resolution gates as blocker work instead of approval', () => {
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
            workflow_id: 'gdd_v2',
            lane_id: 'internal_board_review',
            lane_status: 'awaiting_approval',
            decision_status: 'awaiting_user',
            message: { message_key: 'review.gdd.internal_board.awaiting_user' },
            requires_user_action: true,
            user_action_kind: 'approve',
          },
          open_blocker_ids: ['issue_1'],
        },
      ],
    );

    expect(state.isBlockingChat).toBe(true);
    expect(state.message).toContain('blocker');
    expect(state.placeholder).toContain('blocker');
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

  it('allows chat input when a BeeGame workflow is paused without approval required', () => {
    const state = getWaitingApprovalState(
      {
        project_id: 'proj_1',
        phase: 'paused',
        blocked: true,
        blocked_reason: 'BeeGame paused build: docs/PLAYABLE_SPEC.md is missing',
        approval_required: false,
      },
      [],
    );

    expect(state.isBlockingChat).toBe(false);
    expect(state.message).toContain('docs/PLAYABLE_SPEC.md');
    expect(state.placeholder).toBe('输入修复要求或继续任务...');
  });

  it('keeps chat blocked when a paused workflow is waiting for approval', () => {
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
