import { describe, expect, it } from 'vitest';
import { toChatDisplayMessage, toProjectRuntimeDisplayModel, toReviewDisplayModel } from './displayModels';
import type { Message } from '../types/message';
import type { PendingUserReviewItem, ProjectBaselineStatusPayload } from '../services/api';

describe('displayModels', () => {
  it('does not expose legacy governance snapshots in chat display messages', () => {
    const message: Message = {
      id: 'msg_1',
      sender: 'logos',
      content: 'review pending',
      timestamp: 123,
      type: 'revision_request',
      governanceSnapshot: {
        kind: 'review',
        status: 'blocked',
        scope: 'gdd',
        reason: 'needs_revision',
        convergence_status: 'not_converged',
        blocking_issue_count: 2,
        open_issue_count: 3,
        validator_blocker_ids: ['a', 'b'],
        source_of_truth_chain: [{ canonical_issue_key: 'ISSUE_1' }],
      },
    } as Message;

    const display = toChatDisplayMessage(message);

    expect(display).not.toHaveProperty('governanceSnapshot');
    expect(display).not.toHaveProperty('diagnostic');
  });

  it('maps pending review to review display model with only runtime-required fields', () => {
    const review: PendingUserReviewItem = {
      gate_id: 'gate_1',
      type: 'GDD_APPROVAL_REVIEW',
      gate_kind: 'blocker_resolution',
      user_action_kind: 'resolve_blockers',
      task_id: 'task_1',
      artifact_id: 'art_1',
      current_review_artifact_id: 'art_2',
      current_review_iteration: 4,
      revised_from_artifact_id: 'art_1',
      open_issue_ids: ['issue_1', 'issue_2'],
      open_blocker_ids: ['blocker_1'],
      ready_for_user_approval: true,
      review_status: {
        workflow_id: 'gdd_v2',
        lane_id: 'internal_board_review',
        lane_status: 'awaiting_user',
        decision_status: 'awaiting_user',
        requires_user_action: true,
        user_action_kind: 'resolve_blockers',
        message: {
          message_key: 'review.gdd.internal_board.awaiting_user',
          message_params: { unused: 'x' },
        },
        reason_codes: ['unused'],
      },
      binding: {
        artifact_id: 'art_2',
        artifact_version: 4,
        checkpoint_id: 'chk_1',
        workspace_ref: '/tmp/workspace/GDD.md',
      },
      summary: {
        next_action: 'approve',
      },
      verification: {
        verification_decision: 'warning',
        verification_run_id: 'vr_1',
        policy_bundle_version: 'verification.v1',
        blocking_finding_count: 1,
      },
    };

    const display = toReviewDisplayModel(review);

    expect(display.review_status).toEqual({
      workflow_id: 'gdd_v2',
      lane_id: 'internal_board_review',
      lane_status: 'awaiting_user',
      decision_status: 'awaiting_user',
      requires_user_action: true,
      user_action_kind: 'resolve_blockers',
      message: {
        message_key: 'review.gdd.internal_board.awaiting_user',
      },
    });
    expect(display.gate_kind).toBe('blocker_resolution');
    expect(display.user_action_kind).toBe('resolve_blockers');
    expect(display.binding).toEqual({
      artifact_id: 'art_2',
      artifact_version: 4,
      checkpoint_id: 'chk_1',
      workspace_ref: '/tmp/workspace/GDD.md',
      workspace_path: '/tmp/workspace/GDD.md',
    });
    expect(display.raw).toBe(review);
  });

  it('maps project status to compact runtime display model and preserves raw diagnostics', () => {
    const status: ProjectBaselineStatusPayload = {
      project_id: 'proj_1',
      phase: 'DESIGN_IN_PROGRESS',
      blocked: true,
      blocked_reason: 'legacy',
      approval_required: true,
      next_action: 'approve baseline',
      baseline: {
        artifact_id: 'art_1',
        artifact_version: 2,
        checkpoint_id: 'chk_1',
        workspace_ref: '/tmp/workspace/GDD.md',
      },
      review_status: {
        workflow_id: 'gdd_v2',
        lane_id: 'internal_board_review',
        lane_status: 'awaiting_user',
        decision_status: 'awaiting_user',
        requires_user_action: true,
        user_action_kind: 'resolve_blockers',
        message: { message_key: 'review.gdd.internal_board.awaiting_user' },
      },
      governance: {
        blocked: true,
        blocked_phase: 'gdd',
        open_blocker_ids: ['issue_1'],
        unrevalidated_blocker_ids: [],
        unresolved_conflict_ids: ['conflict_1'],
        promotion_status_by_phase: { gdd: 'blocked' },
        latest_revalidation_by_phase: {},
      },
      build_report: {
        status: ' passed ',
        entrypoint: ' dist/web/index.html ',
        report_path: ' reports/build-report.json ',
        build_url: ' /api/projects/proj_1/build/files/index.html ',
        agents: [' synthet ', ' argus '],
        generated_paths: [' dist/web/index.html ', ' reports/build-report.json '],
        checks: [
          {
            name: ' vite build ',
            status: ' passed ',
            detail: ' build completed ',
          },
        ],
      },
      document_bundle: {
        bundle_id: ' bundle_1 ',
        bundle_type: ' primary_design_approval ',
        gate_kind: ' blocker_resolution ',
        user_action_kind: ' resolve_blockers ',
        artifact_id: ' art_1 ',
        status: ' waiting ',
        title: ' Clockwork Garden bundle ',
        ready_for_user_approval: false,
        ready_for_promotion: false,
        open_issue_ids: [' issue_1 '],
        open_blocker_ids: [' issue_1 '],
      },
      context: {
        bundle_id: ' ctx_1 ',
        phase: ' gdd ',
        status: ' ready ',
        summary: ' context prepared ',
        blackboard_record_count: 1,
        memory_hits: 2,
        rag_sources: [' docs/SystemDesign/18.md '],
        selected_skills: [' gdd_contract '],
      },
      execution_evidence: [
        {
          execution_id: 'exec_1',
          agent: 'argus',
          status: 'failed',
          generated_paths: ['reports/qa-report.json'],
          summary: 'QA failed',
          failure_reason: 'syntax error',
        },
      ],
    };

    const display = toProjectRuntimeDisplayModel(status);

    expect(display).toEqual({
      project_id: 'proj_1',
      phase: 'DESIGN_IN_PROGRESS',
      blocked: true,
      blocked_reason: 'legacy',
      baseline: {
        artifact_id: 'art_1',
        artifact_version: 2,
        checkpoint_id: 'chk_1',
        workspace_ref: '/tmp/workspace/GDD.md',
        workspace_path: '/tmp/workspace/GDD.md',
      },
      next_action: 'approve baseline',
      review_status: {
        workflow_id: 'gdd_v2',
        lane_id: 'internal_board_review',
        lane_status: 'awaiting_user',
        decision_status: 'awaiting_user',
        requires_user_action: true,
        user_action_kind: 'resolve_blockers',
        message: { message_key: 'review.gdd.internal_board.awaiting_user' },
      },
      governance: {
        blocked: true,
        blocked_phase: 'gdd',
        open_blocker_ids: ['issue_1'],
        unrevalidated_blocker_ids: [],
        unresolved_conflict_ids: ['conflict_1'],
        promotion_status_by_phase: { gdd: 'blocked' },
        latest_revalidation_by_phase: {},
      },
      build_report: {
        status: 'passed',
        entrypoint: 'dist/web/index.html',
        report_path: 'reports/build-report.json',
        build_url: '/api/projects/proj_1/build/files/index.html',
        agents: ['synthet', 'argus'],
        generated_paths: ['dist/web/index.html', 'reports/build-report.json'],
        checks: [
          {
            name: 'vite build',
            status: 'passed',
            detail: 'build completed',
          },
        ],
      },
      document_bundle: {
        bundle_id: 'bundle_1',
        bundle_type: 'primary_design_approval',
        artifact_id: 'art_1',
        status: 'waiting',
        title: 'Clockwork Garden bundle',
        gate_kind: 'blocker_resolution',
        user_action_kind: 'resolve_blockers',
        ready_for_user_approval: false,
        ready_for_promotion: false,
        open_issue_ids: ['issue_1'],
        open_blocker_ids: ['issue_1'],
      },
      context: {
        bundle_id: 'ctx_1',
        phase: 'gdd',
        status: 'ready',
        summary: 'context prepared',
        failure_reason: undefined,
        blackboard_record_count: 1,
        memory_hits: 2,
        rag_sources: ['docs/SystemDesign/18.md'],
        selected_skills: ['gdd_contract'],
      },
      execution_evidence: [
        {
          execution_id: 'exec_1',
          agent: 'argus',
          status: 'failed',
          generated_paths: ['reports/qa-report.json'],
          summary: 'QA failed',
          failure_reason: 'syntax error',
        },
      ],
      diagnostic: {
        raw: status,
      },
    });
  });

  it('unwraps operator visibility payloads before building runtime display models', () => {
    const display = toProjectRuntimeDisplayModel({
      operator_visibility: {
        project_id: 'proj_1',
        phase: 'build',
        blocked: true,
        blocked_reason: 'governance',
        approval_required: true,
        next_action: 'resolve blockers',
        review_status: {
          workflow_id: 'gdd_v2',
          lane_id: 'internal_board_review',
          lane_status: 'awaiting_user',
          decision_status: 'awaiting_user',
          requires_user_action: true,
          message: { message_key: 'review.gdd.internal_board.awaiting_user' },
        },
        governance: {
          blocked: true,
          blocked_phase: 'build',
          open_blocker_ids: ['issue_1'],
          unrevalidated_blocker_ids: ['issue_2'],
          unresolved_conflict_ids: ['conflict_1'],
          promotion_status_by_phase: { build: 'blocked' },
          latest_revalidation_by_phase: {
            build: {
              revalidation_id: 'reval_1',
              phase: 'build',
              status: 'passed',
              summary: 'build outputs revalidated',
              created_at: '2026-04-21T10:11:12Z',
            },
          },
        },
        build_report: {
          status: 'passed',
          entrypoint: 'dist/web/index.html',
          report_path: 'reports/build-report.json',
          build_url: '/api/projects/proj_1/build/files/index.html',
          agents: ['synthet', 'argus'],
          generated_paths: ['dist/web/index.html', 'reports/build-report.json'],
          checks: [
            {
              name: 'vite build',
              status: 'passed',
              detail: 'build completed',
            },
          ],
          summary: 'build packaged',
          failure_reason: 'synthetic failure',
          created_at: '2026-04-21T10:11:12Z',
        },
        document_bundle: {
          bundle_id: 'bundle_1',
          bundle_type: 'primary_design_approval',
          gate_kind: 'phase_promotion_approval',
          user_action_kind: 'approval',
          artifact_id: 'art_1',
          status: 'waiting',
          title: 'Clockwork Garden bundle',
          ready_for_user_approval: true,
          ready_for_promotion: false,
          open_issue_ids: ['issue_1'],
          open_blocker_ids: ['issue_1'],
        },
      },
    } as any);

    expect(display?.build_report).toMatchObject({
      summary: 'build packaged',
      failure_reason: 'synthetic failure',
      created_at: '2026-04-21T10:11:12Z',
      build_url: '/api/projects/proj_1/build/files/index.html',
      generated_paths: ['dist/web/index.html', 'reports/build-report.json'],
    });
    expect(display?.document_bundle).toMatchObject({
      title: 'Clockwork Garden bundle',
      gate_kind: 'phase_promotion_approval',
      user_action_kind: 'approval',
      ready_for_user_approval: true,
      ready_for_promotion: false,
    });
    expect(display?.governance?.latest_revalidation_by_phase).toMatchObject({
      build: {
        revalidation_id: 'reval_1',
        status: 'passed',
        summary: 'build outputs revalidated',
      },
    });
  });
});
