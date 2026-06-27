import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createJSONStorage } from 'zustand/middleware';

const { bootstrapProjectFromIdea, getPendingUserReviews, getProjectStatus, getProjects, chatActions } = vi.hoisted(() => ({
    bootstrapProjectFromIdea: vi.fn(),
    getPendingUserReviews: vi.fn(),
    getProjectStatus: vi.fn(),
    getProjects: vi.fn(),
    chatActions: {
        clearMessages: vi.fn(),
        addMessage: vi.fn(),
    },
}));

vi.mock('../services/api', async () => {
    const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
    return {
        ...actual,
        api: {
            bootstrapProjectFromIdea,
            getPendingUserReviews,
            getProjectStatus,
            getProjects,
        },
    };
});

vi.mock('./chatStore', () => ({
    useChatStore: {
        getState: () => chatActions,
    },
}));

import { useProjectStore } from './projectStore';

describe('projectStore pending review normalization', () => {
    beforeEach(() => {
        bootstrapProjectFromIdea.mockReset();
        getPendingUserReviews.mockReset();
        getProjectStatus.mockReset();
        getProjects.mockReset();
        chatActions.clearMessages.mockReset();
        chatActions.addMessage.mockReset();
        const storageData = new Map<string, string>();
        useProjectStore.persist.setOptions({
            storage: createJSONStorage(() => ({
                getItem: (name: string) => storageData.get(name) ?? null,
                setItem: (name: string, value: string) => {
                    storageData.set(name, value);
                },
                removeItem: (name: string) => {
                    storageData.delete(name);
                },
            })),
        });
        useProjectStore.setState({
            projects: [],
            activeProjectId: null,
            isLoading: false,
            pendingReviews: [],
            projectStatus: null,
            showToastError: null,
            showToastSuccess: null,
        });
        useProjectStore.persist.clearStorage();
    });

    it('returns bootstrap clarification from a 409 response without creating an active project', async () => {
        const showToastError = vi.fn();
        bootstrapProjectFromIdea.mockRejectedValue(Object.assign(new Error('请求失败 (409)'), {
            status: 409,
            originalError: {
                response: {
                    status: 409,
                    data: {
                        detail: {
                            error: {
                                code: 'idea_intake_clarification_required',
                                message: 'Logos requires clarification before creating a project.',
                            },
                            phase: 'idea_intake',
                            agent: 'logos',
                            clarification: {
                                clarification_required: true,
                                answered_slots: {
                                    gameplay_direction: 'Classic Snake',
                                },
                                pending_slots: ['mvp_focus'],
                                clarification_questions: ['What should the first playable prototype prove?'],
                                clarification_suggestions: [
                                    {
                                        id: 'classic_survival_snake',
                                        label: 'Classic Survival Snake',
                                        description: 'Grow longer, avoid collisions, and chase a higher score.',
                                        clarification_patch: {
                                            gameplay_direction: 'Classic survival snake',
                                            mvp_focus: 'Movement, collision, and score display',
                                        },
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        }));
        useProjectStore.setState({ showToastError });

        await expect(useProjectStore.getState().bootstrapProject({ idea: '做一个好玩的游戏' })).resolves.toEqual({
            status: 'clarification_required',
            analysis: expect.objectContaining({
                clarification_required: true,
                pending_slots: ['mvp_focus'],
                clarification_questions: ['What should the first playable prototype prove?'],
            }),
        });

        expect(showToastError).not.toHaveBeenCalled();
        expect(useProjectStore.getState().activeProjectId).toBeNull();
        expect(chatActions.clearMessages).not.toHaveBeenCalled();
        expect(chatActions.addMessage).not.toHaveBeenCalled();
    });

    it('opens bootstrapped project before project list refresh completes', async () => {
        let resolveProjects: (projects: unknown[]) => void = () => undefined;
        bootstrapProjectFromIdea.mockResolvedValue({
            clarification_required: false,
            clarification_pending: true,
            auto_start_queued: true,
            project: {
                id: 'proj_1',
                project_id: 'proj_1',
                name: 'Snake Web',
                status: 'created',
                created_at: Date.now(),
            },
            pipeline: {
                pipeline_id: 'pipe_1',
                project_id: 'proj_1',
                status: 'running',
            },
            task_id: 'pipe_1',
            status: 'running',
        });
        getProjects.mockReturnValue(new Promise((resolve) => {
            resolveProjects = resolve;
        }));
        getProjectStatus.mockResolvedValue({ project_id: 'proj_1', next_action: 'running' });
        getPendingUserReviews.mockResolvedValue({ items: [] });

        const promise = useProjectStore.getState().bootstrapProject({ idea: '贪吃蛇 Web 像素风' });
        await vi.waitFor(() => expect(useProjectStore.getState().activeProjectId).toBe('proj_1'));

        expect(useProjectStore.getState().projects).toEqual([
            expect.objectContaining({ id: 'proj_1', name: 'Snake Web' }),
        ]);
        expect(useProjectStore.getState().isLoading).toBe(false);
        expect(chatActions.addMessage).toHaveBeenCalledWith(expect.objectContaining({
            sender: 'system',
            content: expect.stringContaining('准备可选方向'),
        }));

        resolveProjects([{ id: 'proj_1', name: 'Snake Web', created_at: Date.now() }]);
        await expect(promise).resolves.toEqual({ status: 'started', projectId: 'proj_1' });
    });

    it('passes selected clarification answers through bootstrap', async () => {
        const clarification = {
            platform: 'Web (Desktop)',
            visual_style: '复古像素风格',
            gameplay_direction: '经典贪吃蛇玩法',
            input_mode: '键盘方向键',
            mvp_focus: '基础移动、吃豆变长、碰撞检测',
        };
        bootstrapProjectFromIdea.mockResolvedValue({
            clarification_required: false,
            clarification_pending: true,
            auto_start_queued: true,
            project: {
                id: 'proj_1',
                project_id: 'proj_1',
                name: '贪吃蛇',
                status: 'created',
                created_at: Date.now(),
            },
            pipeline: {
                pipeline_id: 'pipe_1',
                project_id: 'proj_1',
                status: 'running',
            },
            task_id: 'pipe_1',
            status: 'running',
        });
        getProjects.mockResolvedValue([{ id: 'proj_1', name: '贪吃蛇', created_at: Date.now() }]);
        getProjectStatus.mockResolvedValue({ project_id: 'proj_1', next_action: 'running' });
        getPendingUserReviews.mockResolvedValue({ items: [] });

        await expect(useProjectStore.getState().bootstrapProject({ idea: '贪吃蛇', clarification })).resolves.toEqual({ status: 'started', projectId: 'proj_1' });

        expect(bootstrapProjectFromIdea).toHaveBeenCalledWith({ idea: '贪吃蛇', clarification });
        expect(useProjectStore.getState().activeProjectId).toBe('proj_1');
    });

    it('keeps current status and shows a toast when project status loading fails', async () => {
        const showToastError = vi.fn();
        useProjectStore.setState({
            showToastError,
            projectStatus: { project_id: 'proj_1', next_action: 'running' } as any,
        });
        getProjectStatus.mockRejectedValue(new Error('database unavailable'));

        await useProjectStore.getState().loadProjectStatus('proj_1');

        expect(useProjectStore.getState().projectStatus?.next_action).toBe('running');
        expect(showToastError).toHaveBeenCalledWith(expect.stringContaining('后端状态不可用'));
    });

    it('stores api-normalized pending review payloads with compact pipeline fields', async () => {
        getPendingUserReviews.mockResolvedValue({
            items: [
                {
                    gate_id: 'gate_1',
                    artifact_id: 'art_1',
                    artifact_version: 2,
                    checkpoint_id: 'chk_1',
                    commit_sha: 'sha_1',
                    workspace_ref: '/tmp/workspace/specs/GDD.md',
                    workspace_path: '/tmp/workspace/specs/GDD.md',
                    binding: {
                        checkpoint_id: 'chk_1',
                        workspace_ref: '/tmp/workspace/specs/GDD.md',
                        workspace_path: '/tmp/workspace/specs/GDD.md',
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
                        legacy_decision_source: true,
                    },
                    quorum: {
                        approval_count: 2,
                        reviewer_count: 3,
                        threshold_percentage: 0.67,
                    },
                },
            ],
        });

        await useProjectStore.getState().loadPendingReviews('proj_1');

        const [review] = useProjectStore.getState().pendingReviews;
        expect(review.binding?.workspace_ref).toBe('/tmp/workspace/specs/GDD.md');
        expect(review.binding?.checkpoint_id).toBe('chk_1');
        expect(review.summary?.current_snapshot).toEqual({ snapshot_id: 'snap_1' });
        expect(review.summary?.next_action).toBe('approve');
        expect(review.verification?.verification_run_id).toBe('vr_1');
        expect(review.quorum).toMatchObject({
            approval_count: 2,
            reviewer_count: 3,
            threshold_percentage: 0.67,
        });
    });

    it('stores normalized project baseline status with a compact baseline ref', async () => {
        getProjectStatus.mockResolvedValue({
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
                requires_user_action: true,
                user_action_kind: 'approve',
            },
            build_report: {
                status: ' passed ',
                entrypoint: ' dist/web/index.html ',
                report_path: ' reports/build-report.json ',
                agents: [' synthet ', ' argus '],
                generated_paths: [' dist/web/index.html '],
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
                artifact_id: ' art_1 ',
                status: ' waiting ',
                ready_for_user_approval: false,
                ready_for_promotion: false,
                open_issue_ids: [' issue_1 '],
                open_blocker_ids: [' issue_1 '],
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
        await useProjectStore.getState().loadProjectStatus('proj_1');

        expect(useProjectStore.getState().projectStatus).toMatchObject({
            project_id: 'proj_1',
            approval_required: true,
            next_action: 'approve baseline',
            review_status: {
                workflow_id: 'review_flow',
                lane_id: 'internal_board_review',
                lane_status: 'awaiting_approval',
                decision_status: 'awaiting_user',
                requires_user_action: true,
                user_action_kind: 'approve',
            },
            build_report: {
                status: 'passed',
                entrypoint: 'dist/web/index.html',
                report_path: 'reports/build-report.json',
                agents: ['synthet', 'argus'],
                generated_paths: ['dist/web/index.html'],
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
                ready_for_user_approval: false,
                ready_for_promotion: false,
                open_issue_ids: ['issue_1'],
                open_blocker_ids: ['issue_1'],
            },
            execution_evidence: [
                expect.objectContaining({
                    agent: 'argus',
                    status: 'failed',
                    failure_reason: 'syntax error',
                }),
            ],
            baseline: {
                artifact_id: 'art_1',
                artifact_version: 2,
                checkpoint_id: 'chk_1',
                workspace_ref: '/tmp/workspace/specs/GDD.md',
                workspace_path: '/tmp/workspace/specs/GDD.md',
            },
        });
    });

    it('unwraps operator visibility payloads when loading project status', async () => {
        getProjectStatus.mockResolvedValue({
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
                    artifact_id: ' art_1 ',
                    status: ' waiting ',
                    title: ' Clockwork Garden bundle ',
                    ready_for_user_approval: true,
                    ready_for_promotion: false,
                    open_issue_ids: [' issue_1 '],
                    open_blocker_ids: [' issue_1 '],
                },
            },
        });

        await useProjectStore.getState().loadProjectStatus('proj_1');

        expect(useProjectStore.getState().projectStatus).toMatchObject({
            project_id: 'proj_1',
            blocked_reason: 'runtime_blocked',
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
                entrypoint: 'dist/web/index.html',
                report_path: 'reports/build-report.json',
                agents: ['synthet', 'argus'],
                generated_paths: ['dist/web/index.html', 'reports/build-report.json'],
                checks: [
                    {
                        name: 'vite build',
                        status: 'passed',
                        detail: 'build completed',
                        path: 'dist/web/index.html',
                    },
                ],
                summary: 'build packaged',
                failure_reason: '',
                created_at: '2026-04-21T10:11:12Z',
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
        });
        expect(useProjectStore.getState().projectStatus).not.toHaveProperty('governance');
    });

    it('removes and restores pending reviews by gate id', () => {
        useProjectStore.setState({
            pendingReviews: [
                { gate_id: 'gate_1', artifact_id: 'art_1' } as any,
                { gate_id: 'gate_2', artifact_id: 'art_2' } as any,
            ],
        });

        useProjectStore.getState().removePendingReview('gate_1');

        expect(useProjectStore.getState().pendingReviews).toEqual([
            expect.objectContaining({ gate_id: 'gate_2' }),
        ]);

        useProjectStore.getState().upsertPendingReview({ gate_id: 'gate_1', artifact_id: 'art_1' } as any);

        expect(useProjectStore.getState().pendingReviews).toEqual([
            expect.objectContaining({ gate_id: 'gate_1' }),
            expect.objectContaining({ gate_id: 'gate_2' }),
        ]);
    });
});
