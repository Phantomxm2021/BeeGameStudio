import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    buildUnauthorizedMessage,
    normalizeArtifactReviewResponse,
    normalizeApprovePlanPayload,
    normalizeInboundReviewBindingPayload,
    normalizePendingUserReviewsResponse,
    normalizeProjectBaselineStatusPayload,
    normalizeReviewBindingPayload,
    resolveAuthToken,
} from './api';

describe('resolveAuthToken', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('prefers Vite auth token over localStorage', () => {
        vi.stubEnv('VITE_API_AUTH_TOKEN', 'env-token');
        localStorage.setItem('auth_token', 'storage-token');

        expect(resolveAuthToken()).toBe('env-token');
    });

    it('falls back to localStorage when no Vite auth token is configured', () => {
        vi.stubEnv('VITE_API_AUTH_TOKEN', '');
        localStorage.setItem('auth_token', 'storage-token');

        expect(resolveAuthToken()).toBe('storage-token');
    });
});

describe('buildUnauthorizedMessage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('uses the backend message when provided', () => {
        vi.stubEnv('VITE_API_AUTH_TOKEN', '');

        expect(buildUnauthorizedMessage('authentication required')).toBe('authentication required');
    });

    it('explains missing token configuration when no auth token is available', () => {
        vi.stubEnv('VITE_API_AUTH_TOKEN', '');

        expect(buildUnauthorizedMessage()).toBe('后端已开启鉴权，但前端未配置 token');
    });

    it('reports invalid token when a token is present', () => {
        vi.stubEnv('VITE_API_AUTH_TOKEN', '');
        localStorage.setItem('auth_token', 'bad-token');

        expect(buildUnauthorizedMessage()).toBe('未授权，token 无效或已失效');
    });
});

describe('normalizeReviewBindingPayload', () => {
    it('normalizes workspace fields into the compact binding shape', () => {
        const payload = normalizeReviewBindingPayload({
            artifact_id: 'art_1',
            artifact_version: 2,
            checkpoint_id: 'chk_1',
            commit_sha: 'sha_1',
            workspace_ref: '/tmp/workspace/specs/GDD.md',
        });

        expect(payload.workspace_ref).toBe('/tmp/workspace/specs/GDD.md');
        expect(payload.workspace_path).toBe('/tmp/workspace/specs/GDD.md');
    });
});

describe('normalizeInboundReviewBindingPayload', () => {
    it('normalizes workspace_path-only payloads into a compact binding view', () => {
        const payload = normalizeInboundReviewBindingPayload({
            artifact_id: 'art_2',
            artifact_version: 4,
            checkpoint_id: 'chk_2',
            commit_sha: 'sha_2',
            workspace_path: '/tmp/workspace/specs/GDD.md',
        });

        expect(payload.workspace_ref).toBe('/tmp/workspace/specs/GDD.md');
        expect(payload.workspace_path).toBe('/tmp/workspace/specs/GDD.md');
    });
});

describe('normalizeArtifactReviewResponse', () => {
    it('preserves artifact_id and verdicts from the backend review payload', () => {
        const payload = normalizeArtifactReviewResponse({
            artifact_id: ' art_1 ',
            verdicts: [
                {
                    reviewer_id: ' logos ',
                    verdict: ' approved ',
                },
            ],
        });

        expect(payload.artifact_id).toBe('art_1');
        expect(payload.verdicts).toEqual([
            {
                reviewer_id: 'logos',
                verdict: 'approved',
            },
        ]);
    });
});

describe('normalizeProjectBaselineStatusPayload', () => {
    it('normalizes project baseline metadata into the compact baseline field', () => {
        const payload = normalizeProjectBaselineStatusPayload({
            project_id: 'proj_1',
            phase: 'DESIGN_IN_PROGRESS',
            blocked: true,
            approval_required: true,
            next_action: 'approve baseline',
            baseline: {
                artifact_id: 'art_1',
                artifact_version: 2,
                checkpoint_id: 'chk_1',
                workspace_ref: '/tmp/workspace/specs/GDD.md',
                workspace_path: '/tmp/workspace/specs/GDD.md',
            },
            review_status: {
                workflow_id: 'review_flow',
                lane_id: 'internal_board_review',
                lane_status: 'awaiting_approval',
                decision_status: 'awaiting_user',
                message: {
                    message_key: 'review.board.awaiting_user',
                },
                requires_user_action: true,
                user_action_kind: 'approve',
            },
        });

        expect(payload.baseline).toEqual({
            artifact_id: 'art_1',
            artifact_version: 2,
            checkpoint_id: 'chk_1',
            workspace_ref: '/tmp/workspace/specs/GDD.md',
            workspace_path: '/tmp/workspace/specs/GDD.md',
        });
        expect(payload.review_status?.decision_status).toBe('awaiting_user');
        expect(payload.review_status?.message?.message_key).toBe('review.board.awaiting_user');
    });

    it('unwraps operator visibility payloads and preserves expanded runtime fields', () => {
        const payload = normalizeProjectBaselineStatusPayload({
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
                    user_action_kind: 'approve',
                },
                build_report: {
                    status: 'passed',
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
                            path: ' dist/web/index.html ',
                        },
                    ],
                    summary: ' build packaged ',
                    failure_reason: ' ',
                    created_at: '2026-04-21T10:11:12Z',
                },
                document_bundle: {
                    bundle_id: ' bundle_1 ',
                    bundle_type: ' primary_design_approval ',
                    gate_kind: ' blocker_resolution ',
                    user_action_kind: ' resolve_blockers ',
                    artifact_id: ' art_1 ',
                    status: ' waiting ',
                    title: ' Clockwork Garden bundle ',
                    ready_for_user_approval: true,
                    ready_for_promotion: false,
                    open_issue_ids: [' issue_1 '],
                    open_blocker_ids: [' issue_1 '],
                },
                context: {
                    bundle_id: ' ctx_1 ',
                    phase: ' build ',
                    status: ' ready ',
                    summary: ' context prepared ',
                    blackboard_record_count: 1,
                    memory_hits: 2,
                    rag_sources: [' docs/SystemDesign/05.md '],
                    selected_skills: [' synthet_build '],
                },
            },
        } as any);

        expect(payload.project_id).toBe('proj_1');
        expect(payload.build_report).toMatchObject({
            status: 'passed',
            entrypoint: 'dist/web/index.html',
            report_path: 'reports/build-report.json',
            build_url: '/api/projects/proj_1/build/files/index.html',
            agents: ['synthet', 'argus'],
            generated_paths: ['dist/web/index.html', 'reports/build-report.json'],
            summary: 'build packaged',
            failure_reason: '',
            created_at: '2026-04-21T10:11:12Z',
        });
        expect(payload.build_report?.checks?.[0]).toMatchObject({
            name: 'vite build',
            status: 'passed',
            detail: 'build completed',
            path: 'dist/web/index.html',
        });
        expect(payload.document_bundle).toMatchObject({
            bundle_id: 'bundle_1',
            gate_kind: 'blocker_resolution',
            user_action_kind: 'resolve_blockers',
            title: 'Clockwork Garden bundle',
            ready_for_user_approval: true,
            ready_for_promotion: false,
            open_issue_ids: ['issue_1'],
            open_blocker_ids: ['issue_1'],
        });
        expect(payload.context).toMatchObject({
            bundle_id: 'ctx_1',
            phase: 'build',
            status: 'ready',
            summary: 'context prepared',
            blackboard_record_count: 1,
            memory_hits: 2,
            rag_sources: ['docs/SystemDesign/05.md'],
            selected_skills: ['synthet_build'],
        });
        expect(payload).not.toHaveProperty('governance');
    });
});

describe('normalizeApprovePlanPayload', () => {
    it('preserves only compact approval binding fields', () => {
        const payload = normalizeApprovePlanPayload({
            project_id: 'proj_1',
            gate_id: 'gate_1',
            action: 'approve',
            artifact_id: 'art_1',
            artifact_version: 2,
            checkpoint_id: 'chk_1',
            commit_sha: 'sha_1',
            workspace_ref: '/tmp/workspace/specs/GDD.md',
            feedback: 'looks good',
        });

        expect(payload).toEqual({
            project_id: 'proj_1',
            gate_id: 'gate_1',
            action: 'approve',
            artifact_id: 'art_1',
            artifact_version: 2,
            checkpoint_id: 'chk_1',
            commit_sha: 'sha_1',
            workspace_ref: '/tmp/workspace/specs/GDD.md',
            workspace_path: '/tmp/workspace/specs/GDD.md',
            feedback: 'looks good',
        });
    });
});

describe('normalizePendingUserReviewsResponse', () => {
    it('normalizes compact document-pipeline fields for pending approvals', () => {
        const payload = normalizePendingUserReviewsResponse({
            items: [
                {
                    gate_id: 'gate_human_gdd',
                    gate_kind: ' phase_promotion_approval ',
                    user_action_kind: ' approval ',
                    gate_reason: ' phase_promoted_requires_user_approval ',
                    promotion_status: ' promoted ',
                    open_defect_count: 0,
                    artifact_id: 'art_1',
                    artifact_version: 2,
                    checkpoint_id: 'chk_1',
                    commit_sha: 'sha_1',
                    workspace_path: '/tmp/workspace/specs/GDD.md',
                    binding: {
                        artifact_id: 'art_1',
                        artifact_version: 2,
                        checkpoint_id: 'chk_1',
                        commit_sha: 'sha_1',
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
                        bundle_id: 'bundle_1',
                        verification_run_id: 'vr_1',
                        verification_decision: 'warning',
                        policy_bundle_version: 'verification.v1',
                        attestation_ref: 'att_1',
                        blocking_finding_count: 2,
                        decision_logs: ['compact'],
                    },
                    quorum: {
                        approval_count: 2,
                        reviewer_count: 3,
                        threshold_percentage: 0.67,
                    },
                    review_status: {
                    workflow_id: 'review_flow',
                        lane_id: 'internal_board_review',
                        lane_status: 'awaiting_approval',
                        decision_status: 'awaiting_user',
                        message: {
                            message_key: 'review.awaiting_user',
                        },
                        requires_user_action: true,
                        user_action_kind: 'approve',
                    },
                },
            ],
        });

        const item = payload.items[0];
        expect(item.gate_id).toBe('gate_human_gdd');
        expect(item.gate_kind).toBe('phase_promotion_approval');
        expect(item.user_action_kind).toBe('approval');
        expect(item.gate_reason).toBe('phase_promoted_requires_user_approval');
        expect(item.promotion_status).toBe('promoted');
        expect(item.open_defect_count).toBe(0);
        expect(item.artifact_version).toBe(2);
        expect(item.checkpoint_id).toBe('chk_1');
        expect(item.binding?.workspace_ref).toBe('/tmp/workspace/specs/GDD.md');
        expect(item.binding?.checkpoint_id).toBe('chk_1');
        expect(item.summary?.current_snapshot).toEqual({ snapshot_id: 'snap_1' });
        expect(item.summary?.next_action).toBe('approve');
        expect(item.verification?.verification_run_id).toBe('vr_1');
        expect(item.verification?.policy_bundle_version).toBe('verification.v1');
        expect(item.quorum).toMatchObject({
            approval_count: 2,
            reviewer_count: 3,
            threshold_percentage: 0.67,
        });
        expect(item.review_status?.decision_status).toBe('awaiting_user');
        expect(item.review_status?.message?.message_key).toBe('review.awaiting_user');
    });
});
