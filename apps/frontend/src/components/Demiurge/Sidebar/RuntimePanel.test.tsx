import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RuntimePanel } from './RuntimePanel';

const baseProps = {
    tasks: [],
    runtimeQueues: {
        discoverable: [],
        review: [],
        verification: [],
        blocked: [],
        released: [],
    },
    runtimeStatusCounts: {},
    runtimeSwarmTasks: [],
    runtimeAttentionTasks: [],
    pendingReviews: [],
    projectStatus: null,
    approvalState: {
        gateId: null,
        action: null,
        phase: 'idle' as const,
        message: '',
    },
};

describe('RuntimePanel document-pipeline rendering', () => {
    it('renders module readiness evidence', () => {
        render(
            <RuntimePanel
                {...baseProps}
                readiness={{
                    status: 'degraded',
                    degraded_modules: ['rag'],
                    modules: {
                        rag: { status: 'ready', details: { model: 'all-MiniLM-L6-v2' } },
                        contracts: { status: 'blocked', details: { missing: ['ui_protocol.v1'] } },
                    },
                }}
            />
        );

        expect(screen.getByText('Runtime Readiness')).toBeInTheDocument();
        expect(screen.getByText('rag')).toBeInTheDocument();
        expect(screen.getByText(/all-MiniLM-L6-v2/i)).toBeInTheDocument();
        expect(screen.getByText(/ui_protocol.v1/i)).toBeInTheDocument();
    });

    it('renders compact project baseline metadata', () => {
        render(
            <RuntimePanel
                {...baseProps}
                projectStatus={{
                    project_id: 'proj_1',
                    phase: 'DESIGN_IN_PROGRESS',
                    blocked: true,
                    approval_required: true,
                    next_action: 'approve baseline',
                    baseline: {
                        artifact_id: 'art_proj',
                        artifact_version: 2,
                        checkpoint_id: 'chk_proj',
                        workspace_ref: '/tmp/workspace/specs/GDD.md',
                        workspace_path: '/tmp/workspace/specs/GDD.md',
                    },
                }}
            />
        );

        expect(screen.getByText('Project Baseline')).toBeInTheDocument();
        expect(screen.getByText('Baseline: checkpoint chk_proj')).toBeInTheDocument();
        expect(screen.getByText('art_proj')).toBeInTheDocument();
        expect(screen.getByText('/tmp/workspace/specs/GDD.md')).toBeInTheDocument();
        expect(screen.getByText('approve baseline')).toBeInTheDocument();
    });

    it('renders governance blocker conflicts and implementation evidence', () => {
        render(
            <RuntimePanel
                {...baseProps}
                projectStatus={{
                    project_id: 'proj_1',
                    phase: 'gdd',
                    blocked: true,
                    blocked_reason: 'open blockers remain',
                    next_action: 'resolve_blockers',
                    governance: {
                        blocked: true,
                        blocked_phase: 'gdd',
                        open_blocker_ids: ['issue_1'],
                        unresolved_conflict_ids: ['conflict_1'],
                        promotion_status_by_phase: { gdd: 'blocked', ui: 'promoted' },
                        latest_revalidation_by_phase: {},
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
                }}
            />
        );

        expect(screen.getByText('Governance Gate')).toBeInTheDocument();
        expect(screen.getByText('Blocked phase: gdd')).toBeInTheDocument();
        expect(screen.getByText('issue_1')).toBeInTheDocument();
        expect(screen.getByText('conflict_1')).toBeInTheDocument();
        expect(screen.getByText('gdd: blocked')).toBeInTheDocument();
        expect(screen.getByText('Implementation Evidence')).toBeInTheDocument();
        expect(screen.getByText('argus failed')).toBeInTheDocument();
        expect(screen.getByText('syntax error')).toBeInTheDocument();
    });

    it('renders successful implementation evidence without red governance wording', () => {
        render(
            <RuntimePanel
                {...baseProps}
                projectStatus={{
                    project_id: 'proj_1',
                    phase: 'build',
                    blocked: false,
                    governance: {
                        blocked: false,
                        blocked_phase: '',
                        open_blocker_ids: [],
                        unresolved_conflict_ids: [],
                        promotion_status_by_phase: { gdd: 'promoted' },
                        latest_revalidation_by_phase: {},
                    },
                    execution_evidence: [
                        {
                            execution_id: 'exec_1',
                            agent: 'synthet',
                            status: 'passed',
                            generated_paths: ['reports/build-report.json', 'dist/web/index.html'],
                            summary: 'Build packaged',
                        },
                    ],
                }}
            />
        );

        expect(screen.getByText('Implementation Evidence')).toBeInTheDocument();
        expect(screen.queryByText('Governance Gate')).not.toBeInTheDocument();
        expect(screen.getByText('synthet passed')).toBeInTheDocument();
        expect(screen.getByText('Build packaged')).toBeInTheDocument();
        expect(screen.getByText('dist/web/index.html')).toBeInTheDocument();
    });

    it('renders agent trace details as markdown sections', () => {
        render(
            <RuntimePanel
                {...baseProps}
                projectStatus={{
                    project_id: 'proj_1',
                    phase: 'build',
                    blocked: false,
                    execution_evidence: [
                        {
                            execution_id: 'exec_1',
                            agent: 'hephaestus',
                            status: 'passed',
                            generated_paths: ['engine/web/src/gameplay/runtime.ts'],
                            summary: 'Runtime generated',
                            details: {
                                attempts_detail: [
                                    {
                                        attempt_id: 1,
                                        prompt_kind: 'initial',
                                        prompt: 'Build the runtime contract.',
                                        response: 'Implemented runtime state.',
                                        token_usage: {
                                            prompt_tokens: 11,
                                            completion_tokens: 7,
                                            total_tokens: 18,
                                        },
                                        changed_paths: ['engine/web/src/gameplay/runtime.ts'],
                                        verification_result: { passed: true },
                                    },
                                ],
                            },
                        },
                    ],
                }}
            />
        );

        expect(screen.getByText('Agent Trace')).toBeInTheDocument();
        expect(screen.getByText('@hephaestus · passed')).toBeInTheDocument();
        expect(screen.getByText('Attempt 1 · initial')).toBeInTheDocument();
        expect(screen.getByText('Prompt')).toBeInTheDocument();
        expect(screen.getByText('Build the runtime contract.')).toBeInTheDocument();
        expect(screen.getByText('Response')).toBeInTheDocument();
        expect(screen.getByText('Implemented runtime state.')).toBeInTheDocument();
        expect(screen.getByText('Tokens')).toBeInTheDocument();
        expect(screen.getByText(/prompt_tokens: 11/)).toBeInTheDocument();
        expect(screen.getByText(/completion_tokens: 7/)).toBeInTheDocument();
        expect(screen.getByText(/total_tokens: 18/)).toBeInTheDocument();
        expect(screen.queryByText(/"attempts_detail"/)).not.toBeInTheDocument();
    });

    it('renders typed build report and document bundle status', () => {
        render(
            <RuntimePanel
                {...baseProps}
                projectStatus={{
                    project_id: 'proj_1',
                    phase: 'build',
                    blocked: false,
                    next_action: 'review build visibility',
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
                        ready_for_user_approval: false,
                        ready_for_promotion: false,
                        open_issue_ids: ['issue_1'],
                        open_blocker_ids: ['issue_1'],
                    },
                    context: {
                        bundle_id: 'ctx_1',
                        phase: 'build',
                        status: 'ready',
                        summary: 'Context bundle ready',
                        blackboard_record_count: 1,
                        memory_hits: 2,
                        rag_sources: ['docs/SystemDesign/05-工作流程.md'],
                        selected_skills: ['synthet_build'],
                    },
                }}
            />
        );

        expect(screen.getByText('Build Report')).toBeInTheDocument();
        expect(screen.getByText('passed')).toBeInTheDocument();
        expect(screen.getAllByText('dist/web/index.html')).toHaveLength(2);
        expect(screen.getByRole('link', { name: /open build/i })).toHaveAttribute('href', '/api/projects/proj_1/build/files/index.html');
        expect(screen.getByText('Document Bundle')).toBeInTheDocument();
        expect(screen.getByText('bundle_1')).toBeInTheDocument();
        expect(screen.getByText('waiting')).toBeInTheDocument();
        expect(screen.getAllByText('issue_1')).toHaveLength(2);
        expect(screen.getByText('Context Bundle')).toBeInTheDocument();
        expect(screen.getByText('ctx_1')).toBeInTheDocument();
        expect(screen.getByText('synthet_build')).toBeInTheDocument();
    });

    it('renders build summary, failure reason, document bundle readiness, and latest revalidation metadata', () => {
        render(
            <RuntimePanel
                {...baseProps}
                projectStatus={{
                    project_id: 'proj_1',
                    phase: 'build',
                    blocked: true,
                    build_report: {
                        status: 'failed',
                        entrypoint: 'dist/web/index.html',
                        report_path: 'reports/build-report.json',
                        agents: ['synthet', 'argus'],
                        generated_paths: ['dist/web/index.html', 'reports/build-report.json'],
                        checks: [
                            {
                                name: 'vite build',
                                status: 'failed',
                                detail: 'build failed',
                            },
                        ],
                        summary: 'build packaged',
                        failure_reason: 'synthetic failure',
                        created_at: '2026-04-21T10:11:12Z',
                    },
                    governance: {
                        blocked: true,
                        blocked_phase: 'build',
                        open_blocker_ids: ['issue_1'],
                        unrevalidated_blocker_ids: [],
                        unresolved_conflict_ids: [],
                        promotion_status_by_phase: { build: 'blocked' },
                        latest_revalidation_by_phase: {
                            build: {
                                revalidation_id: 'reval_1',
                                phase: 'build',
                                status: 'passed',
                                summary: 'revalidated build outputs',
                                created_at: '2026-04-21T10:11:12Z',
                            },
                        },
                    },
                    document_bundle: {
                        bundle_id: 'bundle_1',
                        bundle_type: 'primary_design_approval',
                        artifact_id: 'art_1',
                        status: 'waiting',
                        title: 'Clockwork Garden bundle',
                        ready_for_user_approval: true,
                        ready_for_promotion: false,
                        open_issue_ids: ['issue_1'],
                        open_blocker_ids: ['issue_1'],
                    },
                }}
            />
        );

        expect(screen.getByText('Build Report')).toBeInTheDocument();
        expect(screen.getByText('build packaged')).toBeInTheDocument();
        expect(screen.getByText('synthetic failure')).toBeInTheDocument();
        expect(screen.getByText('Clockwork Garden bundle')).toBeInTheDocument();
        expect(screen.getByText((_, element) => element?.textContent === 'Ready for approval: yes')).toBeInTheDocument();
        expect(screen.getByText((_, element) => element?.textContent === 'Ready for promotion: no')).toBeInTheDocument();
        expect(screen.getByText('Latest Revalidation')).toBeInTheDocument();
        expect(screen.getByText('build: passed')).toBeInTheDocument();
        expect(screen.getByText('revalidated build outputs')).toBeInTheDocument();
        expect(screen.getAllByText('dist/web/index.html')).toHaveLength(2);
    });

    it('hides the open build link when the build url is missing', () => {
        render(
            <RuntimePanel
                {...baseProps}
                projectStatus={{
                    project_id: 'proj_1',
                    phase: 'build',
                    blocked: false,
                    build_report: {
                        status: 'passed',
                        entrypoint: 'dist/web/index.html',
                        report_path: 'reports/build-report.json',
                        agents: ['synthet'],
                        generated_paths: ['dist/web/index.html'],
                    },
                }}
            />
        );

        expect(screen.queryByRole('link', { name: /open build/i })).not.toBeInTheDocument();
    });

    it('renders compact pending review summary and verification metadata', () => {
        render(
            <RuntimePanel
                {...baseProps}
                pendingReviews={[
                    {
                        gate_id: 'gate_1',
                        artifact_id: 'art_new',
                        current_review_artifact_id: 'art_new',
                        current_review_iteration: 2,
                        revised_from_artifact_id: 'art_old',
                        ready_for_promotion: true,
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
                        open_blocker_ids: ['missing requirements'],
                        binding: {
                            checkpoint_id: 'chk_1',
                            workspace_ref: '/tmp/workspace/specs/GDD.md',
                        },
                        summary: {
                            current_run: { run_id: 'run_1' },
                            current_snapshot: { snapshot_id: 'snap_1' },
                            latest_validation: { status: 'pass' },
                            latest_review: { verdict: 'pass' },
                            block_reason: 'none',
                            next_action: 'approve',
                        },
                        verification: {
                            verification_run_id: 'vr_1',
                            verification_decision: 'warning',
                            policy_bundle_version: 'verification.v1',
                            attestation_ref: 'att_1',
                            blocking_finding_count: 1,
                            blocking_findings: [{ claim: 'Renderer binding missing' }],
                        },
                        quorum: {
                            approval_count: 2,
                            reviewer_count: 3,
                            threshold_percentage: 0.67,
                        },
                    },
                ]}
            />
        );

        expect(screen.getByText('GDD 第 2 轮内部评审已通过，当前待用户确认的是 artifact art_new')).toBeInTheDocument();
        expect(screen.getByText('Baseline: checkpoint chk_1')).toBeInTheDocument();
        expect(screen.getByText('Document Pipeline Snapshot')).toBeInTheDocument();
        expect(screen.getByText('run_1')).toBeInTheDocument();
        expect(screen.getByText('snap_1')).toBeInTheDocument();
        expect(screen.getByText('Verification Summary')).toBeInTheDocument();
        expect(screen.getByText('Warning')).toBeInTheDocument();
        expect(screen.getByText('vr_1')).toBeInTheDocument();
        expect(screen.getByText('verification.v1')).toBeInTheDocument();
        expect(screen.getByText('att_1')).toBeInTheDocument();
        expect(screen.getByText('Renderer binding missing')).toBeInTheDocument();
    });

    it('renders blocker resolution gates as revision required without approval action', () => {
        render(
            <RuntimePanel
                {...baseProps}
                onApprovePlan={vi.fn().mockResolvedValue(undefined)}
                pendingReviews={[
                    {
                        gate_id: 'gate_blockers',
                        type: 'GDD_APPROVAL_REVIEW',
                        gate_kind: 'blocker_resolution',
                        user_action_kind: 'resolve_blockers',
                        artifact_id: 'art_blocked',
                        current_review_artifact_id: 'art_blocked',
                        current_review_iteration: 2,
                        ready_for_user_approval: false,
                        ready_for_promotion: false,
                        review_status: {
                            workflow_id: 'gdd_v2',
                            lane_id: 'internal_board_review',
                            lane_status: 'awaiting_approval',
                            decision_status: 'awaiting_user',
                            current_review_round: 2,
                            requires_user_action: true,
                            user_action_kind: 'resolve_blockers',
                        },
                        open_issue_ids: ['issue_1'],
                        open_blocker_ids: ['issue_1'],
                    },
                ]}
            />
        );

        expect(screen.getAllByText('Revision Required').length).toBeGreaterThan(0);
        expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^revise$/i })).toBeInTheDocument();
    });

    it('prefers final needs-revision state over generic blocked wording', () => {
        render(
            <RuntimePanel
                {...baseProps}
                pendingReviews={[
                    {
                        gate_id: 'gate_2',
                        artifact_id: 'art_revision',
                        current_review_artifact_id: 'art_revision',
                        current_review_iteration: 3,
                        ready_for_promotion: false,
                        review_status: {
                            workflow_id: 'gdd_v2',
                            lane_id: 'internal_board_review',
                            lane_status: 'completed',
                            decision_status: 'revision_required',
                            current_review_round: 3,
                        },
                        open_issue_ids: ['issue_1'],
                        open_blocker_ids: ['issue_1'],
                        summary: {
                            current_run: { run_id: 'run_2', status: 'NEEDS_REVISION' },
                            next_action: 'phase_retry_required',
                        },
                    },
                ]}
            />
        );

        expect(screen.getByText('GDD 第 3 轮内部评审已完成，当前需按 blocker 修订 artifact art_revision')).toBeInTheDocument();
        expect(screen.getByText('Revision Required')).toBeInTheDocument();
    });

    it('shows revision application and re-review states ahead of reviewer activity hints', () => {
        const { rerender } = render(
            <RuntimePanel
                {...baseProps}
                pendingReviews={[
                    {
                        gate_id: 'gate_3',
                        artifact_id: 'art_revision_apply',
                        current_review_artifact_id: 'art_revision_apply',
                        current_review_iteration: 4,
                        ready_for_promotion: false,
                        review_status: {
                            workflow_id: 'gdd_v2',
                            lane_id: 'internal_board_review',
                            lane_status: 'revision_applying',
                            decision_status: 'revision_required',
                            current_review_round: 4,
                        },
                        open_issue_ids: ['issue_1'],
                        open_blocker_ids: ['issue_1'],
                        summary: {
                            current_run: { run_id: 'run_3', status: 'VALIDATING' },
                            next_action: 'phase_retry_required',
                        },
                    },
                ]}
            />
        );

        expect(screen.getByText('GDD 第 4 轮修订请求已生成，Metis 正在根据 blocker 修订 artifact art_revision_apply')).toBeInTheDocument();
        expect(screen.getByText('Applying Internal Review Revisions')).toBeInTheDocument();

        rerender(
            <RuntimePanel
                {...baseProps}
                pendingReviews={[
                    {
                        gate_id: 'gate_3',
                        artifact_id: 'art_revision_rerun',
                        current_review_artifact_id: 'art_revision_rerun',
                        current_review_iteration: 5,
                        ready_for_promotion: false,
                        review_status: {
                            workflow_id: 'gdd_v2',
                            lane_id: 'internal_board_review',
                            lane_status: 'revision_review_running',
                            decision_status: 'running',
                            current_review_round: 5,
                        },
                        open_issue_ids: ['issue_1'],
                        open_blocker_ids: ['issue_1'],
                        summary: {
                            current_run: { run_id: 'run_4', status: 'REVIEWING' },
                            next_action: 'pipeline_running',
                        },
                    },
                ]}
            />
        );

        expect(screen.getByText('GDD 第 5 轮修订已提交，正在重新进行内部评审，当前 artifact art_revision_rerun')).toBeInTheDocument();
        expect(screen.getByText('Re-reviewing Revised GDD')).toBeInTheDocument();
    });

    it('routes clarification skip through approvePlan instead of generic continue controls', async () => {
        const user = userEvent.setup();
        const onApprovePlan = vi.fn().mockResolvedValue(undefined);

        render(
            <RuntimePanel
                {...baseProps}
                onApprovePlan={onApprovePlan}
                pendingReviews={[
                    {
                        gate_id: 'gate_clarify_1',
                        type: 'INTENT_CLARIFICATION',
                        title: 'Intent clarification',
                    },
                ]}
            />
        );

        await user.click(screen.getByRole('button', { name: /^continue$/i }));

        expect(onApprovePlan).toHaveBeenCalledTimes(1);
        expect(onApprovePlan.mock.calls[0][0]).toMatchObject({ gate_id: 'gate_clarify_1', type: 'INTENT_CLARIFICATION' });
        expect(onApprovePlan.mock.calls[0][2]).toBeUndefined();
    });

    it('keeps runtime approval actions clickable while no gate action is pending', async () => {
        const user = userEvent.setup();
        const onApprovePlan = vi.fn().mockResolvedValue(undefined);

        render(
            <RuntimePanel
                {...baseProps}
                onApprovePlan={onApprovePlan}
                pendingReviews={[
                    {
                        gate_id: 'gate_human_gdd',
                        artifact_id: 'art_runtime',
                        artifact_version: 2,
                        checkpoint_id: 'chk_runtime',
                        commit_sha: 'sha_runtime',
                        workspace_path: '/tmp/workspace/specs/GDD.md',
                        current_review_artifact_id: 'art_runtime',
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
                    },
                ]}
            />
        );

        const approveButton = screen.getByRole('button', { name: /^approve$/i });
        const reviseButton = screen.getByRole('button', { name: /^revise$/i });

        expect(approveButton).toBeEnabled();
        expect(reviseButton).toBeEnabled();
        expect(approveButton.parentElement).toHaveClass('min-[420px]:grid-cols-2');

        await user.click(approveButton);
        expect(onApprovePlan).toHaveBeenCalledWith(expect.objectContaining({ gate_id: 'gate_human_gdd' }));
    });

    it('hides the approval card once the pending review is removed after approval', () => {
        const { rerender } = render(
            <RuntimePanel
                {...baseProps}
                onApprovePlan={vi.fn().mockResolvedValue(undefined)}
                pendingReviews={[
                    {
                        gate_id: 'gate_human_gdd',
                        type: 'GDD_APPROVAL_REVIEW',
                        artifact_id: 'art_gdd',
                        ready_for_user_approval: true,
                        review_status: {
                            workflow_id: 'gdd_v2',
                            lane_status: 'awaiting_approval',
                            decision_status: 'awaiting_user',
                            requires_user_action: true,
                        },
                    } as any,
                ]}
            />
        );

        expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument();

        rerender(
            <RuntimePanel
                {...baseProps}
                onApprovePlan={vi.fn().mockResolvedValue(undefined)}
                pendingReviews={[]}
            />
        );

        expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    });

    it('disables only the active runtime approval action while submission is in flight', () => {
        render(
            <RuntimePanel
                {...baseProps}
                onApprovePlan={vi.fn().mockResolvedValue(undefined)}
                approvalState={{
                    gateId: 'gate_human_gdd',
                    action: 'approve',
                    phase: 'awaiting_runtime',
                    message: '审批请求已被后端接受，正在启动下一阶段。',
                }}
                pendingReviews={[
                    {
                        gate_id: 'gate_human_gdd',
                        artifact_id: 'art_runtime',
                        artifact_version: 2,
                        checkpoint_id: 'chk_runtime',
                        commit_sha: 'sha_runtime',
                        workspace_path: '/tmp/workspace/specs/GDD.md',
                        current_review_artifact_id: 'art_runtime',
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
                    },
                ]}
            />
        );

        expect(screen.getByRole('button', { name: /^starting$/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /^revise$/i })).toBeEnabled();
        expect(screen.getByText('审批请求已被后端接受，正在启动下一阶段。')).toBeInTheDocument();
    });

    it('shows the GDD reset button only when enabled by props', () => {
        const { rerender } = render(
            <RuntimePanel
                {...baseProps}
                canResetGddApproval={false}
                onResetGddApproval={vi.fn()}
            />
        );

        expect(screen.queryByRole('button', { name: /reset to gdd approval/i })).not.toBeInTheDocument();

        rerender(
            <RuntimePanel
                {...baseProps}
                canResetGddApproval
                onResetGddApproval={vi.fn()}
            />
        );

        expect(screen.getByRole('button', { name: /reset to gdd approval/i })).toBeInTheDocument();
    });

    it('invokes the reset callback when the GDD reset button is clicked', async () => {
        const user = userEvent.setup();
        const onResetGddApproval = vi.fn().mockResolvedValue(undefined);

        render(
            <RuntimePanel
                {...baseProps}
                canResetGddApproval
                onResetGddApproval={onResetGddApproval}
            />
        );

        await user.click(screen.getByRole('button', { name: /reset to gdd approval/i }));

        expect(onResetGddApproval).toHaveBeenCalledTimes(1);
    });
});
