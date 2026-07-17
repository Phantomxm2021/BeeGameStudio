import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createJSONStorage } from 'zustand/middleware';

const { getPendingUserReviews, getProjectStatus, getProjectRuntimeState, getProjects, openProject, chatActions } = vi.hoisted(() => ({
    getPendingUserReviews: vi.fn(),
    getProjectStatus: vi.fn(),
    getProjectRuntimeState: vi.fn(),
    getProjects: vi.fn(),
    openProject: vi.fn(),
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
            getPendingUserReviews,
            getProjectStatus,
            getProjectRuntimeState,
            getProjects,
            openProject,
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
    let storageData: Map<string, string>;

    beforeEach(() => {
        localStorage.clear();
        getPendingUserReviews.mockReset();
        getProjectStatus.mockReset();
        getProjectRuntimeState.mockReset();
        getProjects.mockReset();
        getProjectRuntimeState.mockImplementation(async (projectId: string) => ({
            status: await getProjectStatus(projectId),
            pendingReviews: (await getPendingUserReviews(projectId)).items || [],
        }));
        openProject.mockReset();
        openProject.mockResolvedValue({});
        chatActions.clearMessages.mockReset();
        chatActions.addMessage.mockReset();
        storageData = new Map<string, string>();
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
            isOpeningProject: false,
            pendingReviews: [],
            projectStatus: null,
            showToastError: null,
            showToastSuccess: null,
        });
        useProjectStore.persist.clearStorage();
    });

    it('persists the last active project id while a cloud session is active for validated restoration', () => {
        localStorage.setItem('beegame_supabase_session', JSON.stringify({
            accessToken: 'cloud-token',
            expiresAt: Date.now() + 60_000,
            user: { id: 'cloud-user' },
        }));

        useProjectStore.setState({ activeProjectId: 'project_from_other_account' });

        expect(JSON.parse(storageData.get('project-storage') || '{}')).toEqual({
            state: { activeProjectId: 'project_from_other_account' },
            version: 0,
        });
    });

    it('tracks project opening while switching projects', async () => {
        let resolveOpen: (value: unknown) => void = () => undefined;
        openProject.mockReturnValue(new Promise(resolve => {
            resolveOpen = resolve;
        }));
        useProjectStore.setState({ activeProjectId: 'proj_old' });

        const promise = useProjectStore.getState().setActiveProject('proj_new');
        await vi.waitFor(() => expect(useProjectStore.getState().isOpeningProject).toBe(true));

        expect(openProject).toHaveBeenCalledWith('proj_new');
        expect(useProjectStore.getState().activeProjectId).toBe('proj_old');

        resolveOpen({});
        await promise;

        expect(useProjectStore.getState().isOpeningProject).toBe(false);
        expect(useProjectStore.getState().activeProjectId).toBe('proj_new');
        expect(useProjectStore.getState().projectStatus).toBeNull();
        expect(useProjectStore.getState().pendingReviews).toEqual([]);
        expect(chatActions.clearMessages).toHaveBeenCalled();
    });

    it('times out project opening and releases the opening lock', async () => {
        vi.useFakeTimers();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            openProject.mockReturnValue(new Promise(() => undefined));
            useProjectStore.setState({ activeProjectId: 'proj_old' });

            const promise = useProjectStore.getState().setActiveProject('proj_timeout');
            const rejection = promise.catch((error) => error);
            expect(useProjectStore.getState().isOpeningProject).toBe(true);

            await vi.advanceTimersByTimeAsync(10_000);

            const error = await rejection;
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toBe('Project open timed out');
            expect(useProjectStore.getState().isOpeningProject).toBe(false);
            expect(useProjectStore.getState().activeProjectId).toBe('proj_old');
        } finally {
            consoleError.mockRestore();
            vi.useRealTimers();
        }
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

    it('updates project status and pending reviews from one runtime snapshot', async () => {
        getProjectRuntimeState.mockResolvedValueOnce({
            status: {
                project_id: 'proj_1',
                phase: 'running',
                blocked: false,
            },
            pendingReviews: [{ gate_id: 'permission_1' }],
        });

        await useProjectStore.getState().loadProjectRuntimeState('proj_1');

        expect(getProjectRuntimeState).toHaveBeenCalledTimes(1);
        expect(getProjectRuntimeState).toHaveBeenCalledWith('proj_1');
        expect(useProjectStore.getState().projectStatus?.phase).toBe('running');
        expect(useProjectStore.getState().pendingReviews).toEqual([{ gate_id: 'permission_1' }]);
    });

    it('coalesces concurrent runtime snapshot loads for the same project', async () => {
        let resolveRequest!: (value: {
            status: { project_id: string; phase: string; blocked: boolean };
            pendingReviews: Array<{ gate_id: string }>;
        }) => void;
        getProjectRuntimeState.mockReturnValueOnce(new Promise((resolve) => {
            resolveRequest = resolve;
        }));

        const first = useProjectStore.getState().loadProjectRuntimeState('proj_1');
        const second = useProjectStore.getState().loadProjectRuntimeState('proj_1');
        expect(getProjectRuntimeState).toHaveBeenCalledTimes(1);

        resolveRequest({
            status: { project_id: 'proj_1', phase: 'running', blocked: false },
            pendingReviews: [{ gate_id: 'permission_1' }],
        });
        await Promise.all([first, second]);

        expect(useProjectStore.getState().projectStatus?.phase).toBe('running');
        expect(useProjectStore.getState().pendingReviews).toEqual([{ gate_id: 'permission_1' }]);
    });

    it('does not flood the console when authentication context is temporarily unavailable', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        getProjectRuntimeState.mockRejectedValueOnce(Object.assign(
            new Error('Authentication service is temporarily unavailable'),
            {
                status: 503,
                code: 'authentication_unavailable',
                recoverable: true,
                retryAfterMs: 2_000,
            },
        ));

        await expect(useProjectStore.getState().loadProjectRuntimeState('proj_1'))
            .rejects.toMatchObject({ code: 'authentication_unavailable' });

        expect(consoleError).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it('does not let a stale runtime response overwrite the newly active project', async () => {
        let resolveRequest!: (value: {
            status: { project_id: string; phase: string; blocked: boolean };
            pendingReviews: Array<{ gate_id: string }>;
        }) => void;
        useProjectStore.setState({ activeProjectId: 'proj_1' });
        getProjectRuntimeState.mockReturnValueOnce(new Promise((resolve) => {
            resolveRequest = resolve;
        }));

        const request = useProjectStore.getState().loadProjectRuntimeState('proj_1');
        useProjectStore.setState({ activeProjectId: 'proj_2', projectStatus: null, pendingReviews: [] });
        resolveRequest({
            status: { project_id: 'proj_1', phase: 'running', blocked: false },
            pendingReviews: [{ gate_id: 'stale_permission' }],
        });
        await request;

        expect(useProjectStore.getState().projectStatus).toBeNull();
        expect(useProjectStore.getState().pendingReviews).toEqual([]);
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
