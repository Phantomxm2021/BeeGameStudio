import { describe, expect, it } from 'vitest';
import { toProjectRuntimeDisplayModel, toReviewDisplayModel } from './displayModels';
import type {
  OperatorVisibilityPayload,
  PendingUserReviewItem,
  ProjectBaselineStatusPayload,
} from '../services/api';

describe('displayModels', () => {
  it('maps pending review to review display model with only runtime-required fields', () => {
    const review: PendingUserReviewItem = {
      gate_id: 'gate_1',
      type: 'DOCUMENT_APPROVAL_REVIEW',
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
        workflow_id: 'review_flow',
        lane_id: 'internal_board_review',
        lane_status: 'awaiting_user',
        decision_status: 'awaiting_user',
        requires_user_action: true,
        user_action_kind: 'resolve_blockers',
        message: {
          message_key: 'review.awaiting_user',
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
      workflow_id: 'review_flow',
      lane_id: 'internal_board_review',
      lane_status: 'awaiting_user',
      decision_status: 'awaiting_user',
      requires_user_action: true,
      user_action_kind: 'resolve_blockers',
      message: {
        message_key: 'review.awaiting_user',
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

  it('maps project status to compact runtime display model without raw diagnostics', () => {
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
        workflow_id: 'review_flow',
        lane_id: 'internal_board_review',
        lane_status: 'awaiting_user',
        decision_status: 'awaiting_user',
        requires_user_action: true,
        user_action_kind: 'resolve_blockers',
        message: { message_key: 'review.awaiting_user' },
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
        phase: ' review ',
        status: ' ready ',
        summary: ' context prepared ',
        blackboard_record_count: 1,
        memory_hits: 2,
        rag_sources: [' docs/SystemDesign/18.md '],
        selected_skills: [' review_contract '],
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

    expect(display).toMatchObject({
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
        workflow_id: 'review_flow',
        lane_id: 'internal_board_review',
        lane_status: 'awaiting_user',
        decision_status: 'awaiting_user',
        requires_user_action: true,
        user_action_kind: 'resolve_blockers',
        message: { message_key: 'review.awaiting_user' },
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
            path: undefined,
          },
        ],
        summary: undefined,
        failure_reason: undefined,
        created_at: undefined,
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
        phase: 'review',
        status: 'ready',
        summary: 'context prepared',
        failure_reason: undefined,
        blackboard_record_count: 1,
        memory_hits: 2,
        rag_sources: ['docs/SystemDesign/18.md'],
        selected_skills: ['review_contract'],
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
    });
    expect(display).not.toHaveProperty('governance');
  });

  it('unwraps operator visibility payloads before building runtime display models', () => {
    const display = toProjectRuntimeDisplayModel({
      operator_visibility: {
        project_id: 'proj_1',
        phase: 'build',
        blocked: true,
        blocked_reason: 'runtime_blocked',
        approval_required: true,
        next_action: 'resolve blockers',
        review_status: {
          workflow_id: 'review_flow',
          lane_id: 'internal_board_review',
          lane_status: 'awaiting_user',
          decision_status: 'awaiting_user',
          requires_user_action: true,
          message: { message_key: 'review.awaiting_user' },
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
    } satisfies OperatorVisibilityPayload);

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
    expect(display).not.toHaveProperty('governance');
  });

  it('projects workflow progress to thinking and never exposes raw progress message', () => {
    const display = toProjectRuntimeDisplayModel({
      project_id: 'proj_1',
      phase: 'running',
      blocked: false,
      workflow: {
        runId: 'run_1',
        status: 'running',
        currentPhase: 'DOCUMENT_REVIEW',
        worker: 'document-reviewer',
        thinking: '正在检查当前文档版本。',
        lastProgress: {
          phase: 'DOCUMENT_REVIEW',
          worker: 'document-reviewer',
          message: JSON.stringify({ verdict: 'READY', revision: 'internal-only' }),
          thinking: JSON.stringify({ verdict: 'SHOULD_NOT_RENDER' }),
        },
      },
    });

    expect(display?.workflow).toMatchObject({
      runId: 'run_1',
      status: 'running',
      currentPhase: 'DOCUMENT_REVIEW',
      worker: 'document-reviewer',
      thinking: '正在检查当前文档版本。',
    });
    expect(JSON.stringify(display?.workflow)).not.toContain('READY');
    expect(JSON.stringify(display?.workflow)).not.toContain('internal-only');
  });

  it('does not expose a complete worker protocol object as workflow copy', () => {
    const display = toProjectRuntimeDisplayModel({
      project_id: 'proj_1',
      phase: 'running',
      blocked: false,
      workflow: {
        runId: 'run_protocol',
        status: 'running',
        currentPhase: 'RESOURCE_PREPARATION',
        message: JSON.stringify({
          workerType: 'resource-preparer',
          status: 'completed',
          revision: 'resource-revision',
        }),
        thinking: 'working',
      },
    });

    expect(display?.workflow?.thinking).toBeUndefined();
    expect(JSON.stringify(display?.workflow)).not.toContain('resource-revision');
  });

  it('projects workflow tasks, recovery actions and timing without raw state leakage', () => {
    const display = toProjectRuntimeDisplayModel({
      project_id: 'proj_1',
      workflow: {
        runId: 'run_2',
        status: 'needs_action',
        phase: 'DOCUMENT_DRAFTING',
        documentStep: 'FOUNDATION_DRAFTING',
        message: '正在修正文档审计问题。',
        thinking: 'waiting',
        failureReason: '整改未覆盖所有 finding。',
        nextAction: 'retry',
        completedTaskCount: 1,
        totalTaskCount: 2,
        createdAt: '2026-07-28T00:00:00.000Z',
        completedAt: '2026-07-28T00:00:45.000Z',
        updatedAt: '2026-07-28T00:01:00.000Z',
        activeDispatch: {
          workerType: 'document-author',
          status: 'failed',
          startedAt: '2026-07-28T00:00:30.000Z',
        },
        tasks: [
          { id: 'gdd', title: 'docs/GDD.md', status: 'completed' },
          { id: 'ui', title: 'docs/UI_UX_SPEC.md', status: 'failed', failureReason: 'missing spec' },
        ],
      },
    });

    expect(display?.workflow).toMatchObject({
      runId: 'run_2',
      status: 'blocked',
      currentPhase: 'DOCUMENT_DRAFTING',
      documentStep: 'FOUNDATION_DRAFTING',
      thinking: '正在修正文档审计问题。',
      executionStatus: 'waiting',
      worker: 'document-author',
      nextAction: 'retry',
      completedTaskCount: 1,
      totalTaskCount: 2,
      completedAt: '2026-07-28T00:00:45.000Z',
      stageStartedAt: '2026-07-28T00:00:30.000Z',
      block: { message: '整改未覆盖所有 finding。' },
      tasks: [
        { id: 'gdd', status: 'completed' },
        { id: 'ui', status: 'failed', failureReason: 'missing spec' },
      ],
    });
  });
});
