import { memo } from 'react';
import { ExternalLink } from 'lucide-react';
import { formatTaskId } from '../../../utils/formatters';
import type { ProjectTask } from '../../../store/systemStore';
import type { ReviewBindingPayload } from '../../../services/api';
import {
    TASK_STATUS_COLORS,
    formatVerificationDecisionLabel,
    getCanonicalTaskStatus,
    getTaskStatusLabel,
    formatReviewTitle,
    formatChangeTypeLabel,
    formatRollbackPhaseLabel,
    formatGddReviewSummary,
    getGddReviewReadinessLabel,
    getCurrentReviewArtifactId,
    getCurrentReviewIteration,
    getReviewBindingSummary,
    getVerificationSummary,
    getProjectBaselineSummary,
    isBeeGamePermissionReview,
    isReviewAwaitingUserAction,
    isStructuredDocumentApprovalReview,
    verificationDecisionClasses,
} from './SidebarUtils';
import { ApprovalActionCard, isApprovalActionPending, isApprovalActionFailed } from './ApprovalActionCard';
import { MarkdownRenderer } from './ChatComponents';
import type { ProjectRuntimeDisplayModel, ReviewDisplayModel } from '../../../viewModels/displayModels';
import type { ProductReadinessView } from '../../../types/message';

interface RuntimePanelProps {
    tasks: ProjectTask[];
    runtimeQueues: {
        discoverable: ProjectTask[];
        review: ProjectTask[];
        verification: ProjectTask[];
        blocked: ProjectTask[];
        released: ProjectTask[];
    };
    runtimeStatusCounts: Record<string, number>;
    runtimeSwarmTasks: ProjectTask[];
    runtimeAttentionTasks: ProjectTask[];
    pendingReviews: ReviewDisplayModel[];
    projectStatus?: ProjectRuntimeDisplayModel | null;
    readiness?: ProductReadinessView | null;
    onApprovePlan?: (
        review: ReviewBindingPayload & { gate_id: string },
        feedback?: string,
        action?: 'approve' | 'revise' | 'reject'
    ) => Promise<void>;
    approvalState: {
        gateId: string | null;
        action: 'approve' | 'revise' | 'reject' | null;
        phase: 'idle' | 'submitting' | 'awaiting_runtime' | 'failed';
        message: string;
    };
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const codeFence = (value: unknown): string => {
    const text = String(value ?? '').trim();
    if (!text) return '_Not captured._';
    let fence = '```';
    while (text.includes(fence)) {
        fence += '`';
    }
    return `${fence}\n${text}\n${fence}`;
};

const tokenUsageLines = (value: unknown): string[] => {
    if (!isRecord(value)) return ['- usage unavailable'];
    const lines = ['prompt_tokens', 'completion_tokens', 'total_tokens']
        .map((key) => `- ${key}: ${Number(value[key] ?? 0)}`);
    const metadata = isRecord(value.provider_metadata) ? value.provider_metadata : {};
    const model = String(metadata.model ?? '').trim();
    if (model) {
        lines.push(`- model: ${model}`);
    }
    return lines;
};

const agentTraceMarkdown = (evidence: NonNullable<ProjectRuntimeDisplayModel['execution_evidence']>[number]): string => {
    const details = isRecord(evidence.details) ? evidence.details : {};
    const attempts = Array.isArray(details.attempts_detail) ? details.attempts_detail.filter(isRecord) : [];
    if (attempts.length === 0) return '';
    const lines = [`## @${evidence.agent} · ${evidence.status}`];
    attempts.forEach((attempt, index) => {
        const attemptId = String(attempt.attempt_id ?? index + 1).trim() || String(index + 1);
        const promptKind = String(attempt.prompt_kind ?? 'attempt').trim() || 'attempt';
        const prompt = attempt.prompt ?? attempt.repair_prompt ?? '';
        const response = attempt.response ?? attempt.response_summary ?? '';
        lines.push(
            '',
            '---',
            '',
            `### Attempt ${attemptId} · ${promptKind}`,
            '',
            '#### Prompt',
            '',
            codeFence(prompt),
            '',
            '#### Response',
            '',
            codeFence(response),
            '',
            '#### Tokens',
            '',
            ...tokenUsageLines(attempt.token_usage),
        );
    });
    return lines.join('\n');
};

export const RuntimePanel = memo(({
    tasks,
    runtimeQueues,
    runtimeStatusCounts,
    runtimeSwarmTasks,
    runtimeAttentionTasks,
    pendingReviews,
    projectStatus,
    readiness,
    onApprovePlan,
    approvalState
}: RuntimePanelProps) => {
    const toApprovalPayload = (review: ReviewDisplayModel): ReviewBindingPayload & { gate_id: string } => {
        if (review.raw) {
            return review.raw;
        }
        return review as unknown as ReviewBindingPayload & { gate_id: string };
    };

    const reviewActionLabel = (
        review: ReviewDisplayModel,
        action: 'approve' | 'revise' | 'reject',
    ): string => {
        if (Boolean(review?.gate_id) && isApprovalActionPending(approvalState, review.gate_id, action)) {
            if (action === 'approve') {
                return approvalState.phase === 'submitting' ? 'Submitting' : 'Starting';
            }
            return approvalState.phase === 'submitting' ? 'Submitting' : 'Refreshing';
        }
        if (action === 'approve') {
            if (isBeeGamePermissionReview(review)) return 'Allow';
            return review?.type === 'INTENT_CLARIFICATION' ? 'Continue' : 'Approve';
        }
        if (action === 'revise') {
            if (isBeeGamePermissionReview(review)) return 'Deny';
            return 'Revise';
        }
        return 'Reject';
    };

    const reviewApproveLabel = (review: ReviewDisplayModel): string => {
        return reviewActionLabel(review, 'approve');
    };

    const reviewReviseLabel = (review: ReviewDisplayModel): string => {
        return reviewActionLabel(review, 'revise');
    };

    const executionEvidence = projectStatus?.execution_evidence || [];
    const buildReport = projectStatus?.build_report;
    const documentBundle = projectStatus?.document_bundle;
    const contextEvidence = projectStatus?.context;
    const isBeeGameRuntimeContext = Boolean(contextEvidence?.bundle_id?.startsWith('beegame-runtime'));
    const latestRevalidationEntries = Object.entries((projectStatus?.governance?.latest_revalidation_by_phase || {}) as Record<string, Record<string, unknown>>);
    const hasExecutionFailure = executionEvidence.some((evidence) => evidence.status === 'failed');
    const hasGovernanceBlock = Boolean(projectStatus?.blocked || projectStatus?.governance?.blocked);
    const showGovernanceOrExecution = hasGovernanceBlock || executionEvidence.length > 0 || Boolean(contextEvidence);

    const describeSnapshotValue = (value: unknown): string => {
        if (value == null) return '';
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (Array.isArray(value)) {
            return value.map((item) => describeSnapshotValue(item)).filter(Boolean).join(', ');
        }
        if (typeof value === 'object') {
            const record = value as Record<string, unknown>;
            return String(
                record.snapshot_id
                ?? record.current_snapshot_id
                ?? record.current_run_id
                ?? record.run_id
                ?? record.artifact_id
                ?? record.id
                ?? record.title
                ?? record.name
                ?? record.stage
                ?? record.status
                ?? ''
            ).trim();
        }
        return String(value).trim();
    };

    return (
        <div className="h-full overflow-y-auto p-8 scrollbar-hide">
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Team OS Runtime Console</div>
                    <div className="flex items-center gap-2">
                        <div className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-[9px] font-bold text-zinc-900 dark:text-zinc-100">{tasks.length} Tasks</div>
                    </div>
                </div>

                {readiness ? (
                    <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                                Runtime Readiness
                            </div>
                            <div className="rounded-full bg-zinc-900 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-white dark:bg-zinc-100 dark:text-zinc-950">
                                {readiness.status}
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                            {Object.entries(readiness.modules).map(([name, module]) => (
                                <div key={name} className="rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-200">{name}</span>
                                        <span className="text-[10px] font-bold uppercase text-zinc-500 dark:text-zinc-400">{module.status}</span>
                                    </div>
                                    <div className="mt-1 break-words font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                                        {JSON.stringify(module.details)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}

                {projectStatus?.baseline ? (
                    <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-4 space-y-2">
                        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                            Project Baseline
                        </div>
                        <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {getProjectBaselineSummary(projectStatus)}
                        </div>
                        {projectStatus?.baseline?.artifact_id ? (
                            <div className="text-[11px] text-zinc-600 dark:text-zinc-300">
                                Artifact: <span className="font-mono text-zinc-800 dark:text-zinc-100">{projectStatus?.baseline?.artifact_id}</span>
                            </div>
                        ) : null}
                        {projectStatus?.baseline?.workspace_ref ? (
                            <div className="text-[11px] text-zinc-600 dark:text-zinc-300">
                                Workspace: <span className="font-mono text-zinc-800 dark:text-zinc-100">{projectStatus?.baseline?.workspace_ref}</span>
                            </div>
                        ) : null}
                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                            {projectStatus?.next_action || 'idle'}
                        </div>
                    </div>
                ) : null}

                {buildReport ? (
                    <div className="rounded-3xl border border-zinc-200 bg-white p-4 space-y-3 dark:border-zinc-800 dark:bg-zinc-900/60">
                        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                            Build Report
                        </div>
                        {buildReport.status ? (
                            <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{buildReport.status}</div>
                        ) : null}
                        {buildReport.entrypoint ? (
                            <div className="text-[11px] text-zinc-600 dark:text-zinc-300">
                                Entrypoint: <span className="font-mono text-zinc-800 dark:text-zinc-100">{buildReport.entrypoint}</span>
                            </div>
                        ) : null}
                        {buildReport.report_path ? (
                            <div className="text-[11px] text-zinc-600 dark:text-zinc-300">
                                Report: <span className="font-mono text-zinc-800 dark:text-zinc-100">{buildReport.report_path}</span>
                            </div>
                        ) : null}
                        {buildReport.build_url ? (
                            <a
                                href={buildReport.build_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            >
                                <ExternalLink className="h-3 w-3" />
                                <span>Open Build</span>
                            </a>
                        ) : null}
                        {buildReport.summary ? (
                            <div className="text-[11px] text-zinc-600 dark:text-zinc-300">
                                Summary: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{buildReport.summary}</span>
                            </div>
                        ) : null}
                        {buildReport.failure_reason ? (
                            <div className="text-[11px] text-rose-700 dark:text-rose-200">
                                Failure: <span className="font-semibold">{buildReport.failure_reason}</span>
                            </div>
                        ) : null}
                        {buildReport.created_at ? (
                            <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                Created: <span className="font-mono text-zinc-700 dark:text-zinc-200">{buildReport.created_at}</span>
                            </div>
                        ) : null}
                        {(buildReport.agents?.length || 0) > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {buildReport.agents.map((agent) => (
                                    <span key={agent} className="rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                        {agent}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        {(buildReport.generated_paths?.length || 0) > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {buildReport.generated_paths.map((path) => (
                                    <span key={path} className="rounded-full bg-zinc-100 px-2 py-1 font-mono text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                        {path}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        {(buildReport.checks?.length || 0) > 0 ? (
                            <div className="space-y-1">
                                {buildReport.checks.map((check, index) => (
                                    <div key={`${check.name || 'check'}-${index}`} className="rounded-2xl bg-zinc-50 px-3 py-2 text-[11px] text-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-200">
                                        <div className="font-bold text-zinc-900 dark:text-zinc-100">
                                            {check.name || 'Check'} {check.status ? `- ${check.status}` : ''}
                                        </div>
                                        {check.detail ? <div>{check.detail}</div> : null}
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {documentBundle ? (
                    <div className="rounded-3xl border border-zinc-200 bg-white p-4 space-y-3 dark:border-zinc-800 dark:bg-zinc-900/60">
                        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                            Document Bundle
                        </div>
                        {documentBundle.bundle_id ? (
                            <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{documentBundle.bundle_id}</div>
                        ) : null}
                        {documentBundle.title ? (
                            <div className="text-[11px] text-zinc-600 dark:text-zinc-300">
                                Title: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{documentBundle.title}</span>
                            </div>
                        ) : null}
                        {documentBundle.status ? (
                            <div className="text-[11px] text-zinc-600 dark:text-zinc-300">
                                Status: <span className="font-bold text-zinc-800 dark:text-zinc-100">{documentBundle.status}</span>
                            </div>
                        ) : null}
                        {documentBundle.bundle_type ? (
                            <div className="text-[11px] text-zinc-600 dark:text-zinc-300">
                                Type: <span className="font-mono text-zinc-800 dark:text-zinc-100">{documentBundle.bundle_type}</span>
                            </div>
                        ) : null}
                        {documentBundle.artifact_id ? (
                            <div className="text-[11px] text-zinc-600 dark:text-zinc-300">
                                Artifact: <span className="font-mono text-zinc-800 dark:text-zinc-100">{documentBundle.artifact_id}</span>
                            </div>
                        ) : null}
                        <div className="space-y-1 text-[11px] text-zinc-600 dark:text-zinc-300">
                            <div>
                                Ready for approval: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{documentBundle.ready_for_user_approval ? 'yes' : 'no'}</span>
                            </div>
                            <div>
                                Ready for promotion: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{documentBundle.ready_for_promotion ? 'yes' : 'no'}</span>
                            </div>
                        </div>
                        {(documentBundle.open_issue_ids?.length || 0) > 0 ? (
                            <div className="space-y-1">
                                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Open Issues</div>
                                {documentBundle.open_issue_ids.map((issueId) => (
                                    <div key={issueId} className="font-mono text-[11px] text-zinc-800 dark:text-zinc-100">{issueId}</div>
                                ))}
                            </div>
                        ) : null}
                        {(documentBundle.open_blocker_ids?.length || 0) > 0 ? (
                            <div className="space-y-1">
                                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Open Blockers</div>
                                {documentBundle.open_blocker_ids.map((blockerId) => (
                                    <div key={blockerId} className="font-mono text-[11px] text-zinc-800 dark:text-zinc-100">{blockerId}</div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {showGovernanceOrExecution ? (
                    <div className={`rounded-3xl border p-4 space-y-3 ${hasGovernanceBlock || hasExecutionFailure ? 'border-rose-200 bg-rose-50/70 dark:border-rose-900/60 dark:bg-rose-950/20' : 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60'}`}>
                        <div className={`text-[10px] font-black uppercase tracking-widest ${hasGovernanceBlock || hasExecutionFailure ? 'text-rose-700 dark:text-rose-300' : 'text-zinc-500 dark:text-zinc-400'}`}>
                            {hasGovernanceBlock || hasExecutionFailure ? 'Governance Gate' : (executionEvidence.length > 0 ? 'Implementation Evidence' : 'Context Evidence')}
                        </div>
                        {contextEvidence ? (
                            <div className="space-y-2 rounded-2xl bg-white/70 p-3 dark:bg-zinc-900/60">
                                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                                    {isBeeGameRuntimeContext ? 'BeeGame Runtime Observability' : 'Context Bundle'}
                                </div>
                                <div className="font-mono text-[11px] text-zinc-800 dark:text-zinc-100">{contextEvidence.bundle_id || 'pending-context'}</div>
                                <div className="text-[11px] text-zinc-600 dark:text-zinc-300">
                                    {contextEvidence.phase || 'phase'} · {contextEvidence.status || 'unknown'}
                                    {isBeeGameRuntimeContext
                                        ? ` · events ${contextEvidence.blackboard_record_count ?? 0} · tools ${contextEvidence.memory_hits ?? 0}`
                                        : ` · memory ${contextEvidence.memory_hits ?? 0} · blackboard ${contextEvidence.blackboard_record_count ?? 0}`}
                                </div>
                                {contextEvidence.token_budget ? (
                                    <div className="grid grid-cols-3 gap-2">
                                        <div className="rounded-xl bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                                            <div className="text-[8px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Prompt</div>
                                            <div className="font-mono text-[11px] font-bold text-zinc-900 dark:text-zinc-100">{contextEvidence.token_budget.prompt_tokens ?? 0}</div>
                                        </div>
                                        <div className="rounded-xl bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                                            <div className="text-[8px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Output</div>
                                            <div className="font-mono text-[11px] font-bold text-zinc-900 dark:text-zinc-100">{contextEvidence.token_budget.completion_tokens ?? 0}</div>
                                        </div>
                                        <div className="rounded-xl bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                                            <div className="text-[8px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Total</div>
                                            <div className="font-mono text-[11px] font-bold text-zinc-900 dark:text-zinc-100">{contextEvidence.token_budget.total_tokens ?? 0}</div>
                                        </div>
                                    </div>
                                ) : null}
                                {contextEvidence.summary ? (
                                    <div className="text-[11px] text-zinc-600 dark:text-zinc-300">{contextEvidence.summary}</div>
                                ) : null}
                                {(contextEvidence.rag_sources?.length || 0) > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                        {contextEvidence.rag_sources?.slice(0, 4).map((source) => (
                                            <span key={source} className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                                {source.split('/').slice(-2).join('/')}
                                            </span>
                                        ))}
                                    </div>
                                ) : null}
                                {(contextEvidence.selected_skills?.length || 0) > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                        {contextEvidence.selected_skills?.map((skill) => (
                                            <span key={skill} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                                                {skill}
                                            </span>
                                        ))}
                                    </div>
                                ) : null}
                                {contextEvidence.failure_reason ? (
                                    <div className="text-[11px] text-amber-700 dark:text-amber-200">{contextEvidence.failure_reason}</div>
                                ) : null}
                            </div>
                        ) : null}
                        {hasGovernanceBlock && (projectStatus?.governance?.blocked_phase || projectStatus?.phase) ? (
                            <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                                Blocked scope: {projectStatus?.governance?.blocked_phase || projectStatus?.phase}
                            </div>
                        ) : null}
                        {projectStatus?.blocked_reason ? (
                            <div className="text-[11px] text-rose-700 dark:text-rose-200">{projectStatus.blocked_reason}</div>
                        ) : null}
                        {(projectStatus?.governance?.open_blocker_ids?.length || 0) > 0 ? (
                            <div className="space-y-1">
                                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Open Blockers</div>
                                {projectStatus?.governance?.open_blocker_ids?.map((issueId) => (
                                    <div key={issueId} className="font-mono text-[11px] text-zinc-800 dark:text-zinc-100">{issueId}</div>
                                ))}
                            </div>
                        ) : null}
                        {(projectStatus?.governance?.unrevalidated_blocker_ids?.length || 0) > 0 ? (
                            <div className="space-y-1">
                                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Awaiting Revalidation</div>
                                {projectStatus?.governance?.unrevalidated_blocker_ids?.map((issueId) => (
                                    <div key={issueId} className="font-mono text-[11px] text-zinc-800 dark:text-zinc-100">{issueId}</div>
                                ))}
                            </div>
                        ) : null}
                        {(projectStatus?.governance?.unresolved_conflict_ids?.length || 0) > 0 ? (
                            <div className="space-y-1">
                                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Unresolved Conflicts</div>
                                {projectStatus?.governance?.unresolved_conflict_ids?.map((conflictId) => (
                                    <div key={conflictId} className="font-mono text-[11px] text-zinc-800 dark:text-zinc-100">{conflictId}</div>
                                ))}
                            </div>
                        ) : null}
                        {projectStatus?.governance?.promotion_status_by_phase ? (
                            <div className="flex flex-wrap gap-2">
                                {Object.entries(projectStatus.governance.promotion_status_by_phase).map(([phase, status]) => (
                                    <span key={phase} className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-bold text-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200">
                                        {phase}: {status}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        {latestRevalidationEntries.length > 0 ? (
                            <div className="space-y-2">
                                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Latest Revalidation</div>
                                {latestRevalidationEntries.map(([phase, record]) => (
                                    <div key={phase} className="rounded-2xl bg-white/70 p-3 dark:bg-zinc-900/60">
                                        <div className="text-[11px] font-black text-zinc-900 dark:text-zinc-100">
                                            {phase}: {String(record?.status || '').trim() || 'unknown'}
                                        </div>
                                        {record?.summary ? (
                                            <div className="text-[11px] text-zinc-600 dark:text-zinc-300">{String(record.summary)}</div>
                                        ) : null}
                                        {record?.created_at ? (
                                            <div className="text-[10px] text-zinc-500 dark:text-zinc-400">{String(record.created_at)}</div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        {executionEvidence.length > 0 ? (
                            <div className="space-y-2">
                                {hasGovernanceBlock || hasExecutionFailure ? (
                                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                                        Implementation Evidence
                                    </div>
                                ) : null}
                                {executionEvidence.map((evidence) => {
                                    const traceMarkdown = agentTraceMarkdown(evidence);
                                    return (
                                        <div key={evidence.execution_id || `${evidence.agent}-${evidence.status}`} className="rounded-2xl bg-white/70 p-3 dark:bg-zinc-900/60">
                                            <div className="text-[11px] font-black text-zinc-900 dark:text-zinc-100">
                                                {evidence.agent} {evidence.status}
                                            </div>
                                            {evidence.failure_reason ? (
                                                <div className="text-[11px] text-rose-700 dark:text-rose-200">{evidence.failure_reason}</div>
                                            ) : (
                                                <div className="text-[11px] text-zinc-600 dark:text-zinc-300">{evidence.summary}</div>
                                            )}
                                            {(evidence.generated_paths?.length || 0) > 0 ? (
                                                <div className="mt-2 flex flex-wrap gap-1">
                                                    {evidence.generated_paths?.map((path) => (
                                                        <span key={path} className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[10px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                                            {path}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : null}
                                            {traceMarkdown ? (
                                                <div className="mt-3 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950/30">
                                                    <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Agent Trace</div>
                                                    <MarkdownRenderer
                                                        content={traceMarkdown}
                                                        isUser={false}
                                                        messageId={`agent-trace-${evidence.execution_id || evidence.agent}`}
                                                    />
                                                </div>
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <div className="grid grid-cols-2 gap-3">
                    {[
                        ['Discover', runtimeQueues.discoverable.length, 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'],
                        ['Review', runtimeQueues.review.length, 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'],
                        ['Verify', runtimeQueues.verification.length, 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'],
                        ['Blocked', runtimeQueues.blocked.length, 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'],
                    ].map(([label, count, classes]) => (
                        <div key={String(label)} className={`rounded-2xl p-4 ${classes}`}>
                            <div className="text-[9px] font-black uppercase tracking-widest opacity-70">{label}</div>
                            <div className="mt-2 text-2xl font-black">{count}</div>
                        </div>
                    ))}
                </div>

                <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                    <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                        Canonical Lifecycle
                    </div>
                    <div className="grid grid-cols-2 gap-px bg-zinc-200 dark:bg-zinc-800">
                        {[
                            'pending',
                            'claimed',
                            'in_progress',
                            'in_review',
                            'verified',
                            'released',
                            'changes_requested',
                            'invalidated',
                        ].map((status) => (
                            <div
                                key={status}
                                className="bg-white dark:bg-zinc-950/40 px-4 py-3 flex items-center justify-between"
                            >
                                <span className="text-[10px] font-black uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                                    {status.replace('_', ' ')}
                                </span>
                                <span className="text-sm font-black text-zinc-900 dark:text-zinc-100">
                                    {runtimeStatusCounts[status] || 0}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                    <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                        Swarm Activity
                    </div>
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {runtimeSwarmTasks.length === 0 ? (
                            <div className="px-4 py-4 text-sm text-zinc-500 dark:text-zinc-400">No active swarm-routed tasks.</div>
                        ) : (
                            runtimeSwarmTasks.slice(0, 6).map((task) => (
                                <div key={`swarm-${task.id}`} className="px-4 py-4 space-y-1">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                                                {task.summary}
                                            </div>
                                            <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                                {formatTaskId(task.id)} · @{task.swarm_parent || 'autonomous'}
                                                {task.micro_swarm_specialist ? ` / ${task.micro_swarm_specialist}` : ''}
                                            </div>
                                        </div>
                                        <div className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${TASK_STATUS_COLORS[getCanonicalTaskStatus(task)] || 'bg-zinc-100 text-zinc-500'}`}>
                                            {getTaskStatusLabel(task)}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-[9px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                                        {task.execution_mode && <span className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800">{task.execution_mode}</span>}
                                        {task.review_stage && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{task.review_stage}</span>}
                                        {task.verification_stage && <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{task.verification_stage}</span>}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                    <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                        Pending User Reviews
                    </div>
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {pendingReviews.length === 0 ? (
                            <div className="px-4 py-4 text-sm text-zinc-500 dark:text-zinc-400">No pending user review gates.</div>
                        ) : (
                            pendingReviews.map((review: ReviewDisplayModel) => {
                                const rollback: any = review.rollback_manifest || {};
                                const execution: any = review.execution_manifest || {};
                                const summary = (review.summary || {}) as Record<string, unknown>;
                                const verification = getVerificationSummary(review);
                                const openIssueIds = Array.isArray(review.open_issue_ids) ? review.open_issue_ids : [];
                                const openBlockerIds = Array.isArray(review.open_blocker_ids) ? review.open_blocker_ids : [];
                                const currentReviewArtifactId = getCurrentReviewArtifactId(review);
                                const currentReviewIteration = getCurrentReviewIteration(review);
                                const quorum = (review.quorum || {}) as Record<string, unknown>;
                                const affectedArtifacts = Array.isArray(rollback.affected_artifacts) ? rollback.affected_artifacts : [];
                                const affectedModules = Array.isArray(rollback.affected_modules) ? rollback.affected_modules : [];
                                const phaseSequence = Array.isArray(execution.phase_sequence) ? execution.phase_sequence : [];
                                const isIterationReview = review?.type === 'ITERATION_REAPPROVAL_REVIEW';
                                const isGddApproval = review?.type === 'GDD_APPROVAL_REVIEW';
                                const isBeeGamePermission = isBeeGamePermissionReview(review);
                                const isClarificationReview = review?.type === 'INTENT_CLARIFICATION';
                                const isDocumentApproval = isStructuredDocumentApprovalReview(review);
                                const awaitingUserApproval = isReviewAwaitingUserAction(review);
                                const promotionReady = review.ready_for_promotion === true;
                                const readinessLabel = getGddReviewReadinessLabel(review);
                                const canApprove = Boolean(onApprovePlan) && (
                                    isBeeGamePermission ||
                                    isClarificationReview ||
                                    isIterationReview ||
                                    ((isGddApproval || isDocumentApproval) && awaitingUserApproval)
                                );
                                const rejectionPending = review.gate_id ? isApprovalActionPending(approvalState, review.gate_id, 'reject') : false;
                                const approvalFailed = review.gate_id ? isApprovalActionFailed(approvalState, review.gate_id, 'approve') : false;
                                const revisionFailed = review.gate_id ? isApprovalActionFailed(approvalState, review.gate_id, 'revise') : false;
                                const rejectionFailed = review.gate_id ? isApprovalActionFailed(approvalState, review.gate_id, 'reject') : false;
                                const verificationDecision = verification.verification_decision || review.verification_decision || '';
                                return (
                                    <div key={review.gate_id || review.task_id || review.artifact_id} className="px-4 py-4 space-y-3">
                                        <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{formatReviewTitle(review)}</div>
                                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                            {String((review.artifact as any)?.artifact_type || review.artifact_type || 'artifact')} · {review.task_id || 'unknown task'}
                                        </div>
                                        {isClarificationReview ? (
                                            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/60 p-3 text-[11px] text-zinc-600 dark:text-zinc-300">
                                                Clarification gate is waiting for an explicit decision.
                                            </div>
                                        ) : null}
                                        <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/60 p-3 space-y-1.5">
                                            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                                                Current Review
                                            </div>
                                            <div className="text-[11px] text-zinc-700 dark:text-zinc-200">
                                                {formatGddReviewSummary(review)}
                                            </div>
                                            <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                                {getReviewBindingSummary(review)}
                                            </div>
                                            <div>
                                                Readiness: <span className={`font-semibold ${awaitingUserApproval ? 'text-amber-700 dark:text-amber-300' : promotionReady ? 'text-emerald-700 dark:text-emerald-300' : readinessLabel === 'Internal Review Running' ? 'text-blue-700 dark:text-blue-300' : readinessLabel === 'Revision Required' ? 'text-amber-700 dark:text-amber-300' : 'text-rose-600 dark:text-rose-300'}`}>
                                                    {readinessLabel}
                                                </span>
                                                {promotionReady ? <span className="ml-2 text-zinc-500 dark:text-zinc-400">promotion-ready</span> : null}
                                            </div>
                                            <div>
                                                Open issues: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{openIssueIds.length}</span>
                                                {openBlockerIds.length > 0 ? (
                                                    <span className="ml-2">Blockers: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{openBlockerIds.length}</span></span>
                                                ) : null}
                                            </div>
                                            <div>
                                                Iteration: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{currentReviewIteration}</span>
                                            </div>
                                            {currentReviewArtifactId ? (
                                                <div>
                                                    Artifact: <span className="font-mono text-zinc-800 dark:text-zinc-100">{currentReviewArtifactId}</span>
                                                </div>
                                            ) : null}
                                            {review.revised_from_artifact_id ? (
                                                <div>
                                                    Revised from: <span className="font-mono text-zinc-800 dark:text-zinc-100">{review.revised_from_artifact_id}</span>
                                                </div>
                                            ) : null}
                                        </div>
                                        {(summary.current_run || summary.current_snapshot || summary.latest_validation || summary.latest_review || summary.block_reason || summary.next_action) ? (
                                            <div className="rounded-2xl border border-blue-200 bg-blue-50/70 dark:border-blue-900/60 dark:bg-blue-950/20 p-3 space-y-1">
                                                <div className="text-[10px] font-black uppercase tracking-widest text-blue-700 dark:text-blue-300">
                                                    Document Pipeline Snapshot
                                                </div>
                                                {summary.current_run ? (
                                                    <div className="text-[11px] text-blue-700 dark:text-blue-200">
                                                        Run: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{describeSnapshotValue(summary.current_run)}</span>
                                                    </div>
                                                ) : null}
                                                {summary.current_snapshot ? (
                                                    <div className="text-[11px] text-blue-700 dark:text-blue-200">
                                                        Snapshot: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{describeSnapshotValue(summary.current_snapshot)}</span>
                                                    </div>
                                                ) : null}
                                                {summary.latest_validation ? (
                                                    <div className="text-[11px] text-blue-700 dark:text-blue-200">
                                                        Validation: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{describeSnapshotValue(summary.latest_validation)}</span>
                                                    </div>
                                                ) : null}
                                                {summary.latest_review ? (
                                                    <div className="text-[11px] text-blue-700 dark:text-blue-200">
                                                        Review: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{describeSnapshotValue(summary.latest_review)}</span>
                                                    </div>
                                                ) : null}
                                                {summary.block_reason ? (
                                                    <div className="text-[11px] text-blue-700 dark:text-blue-200">
                                                        Block reason: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{String(summary.block_reason)}</span>
                                                    </div>
                                                ) : null}
                                                {summary.next_action ? (
                                                    <div className="text-[11px] text-blue-700 dark:text-blue-200">
                                                        Next action: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{String(summary.next_action)}</span>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}
                                        {(typeof quorum.approval_count === 'number' || typeof quorum.reviewer_count === 'number' || typeof quorum.threshold_percentage === 'number') ? (
                                            <div className="text-[11px] text-zinc-600 dark:text-zinc-300">
                                                Quorum: <span className="font-semibold text-zinc-800 dark:text-zinc-100">
                                                    {typeof quorum.approval_count === 'number' ? quorum.approval_count : 0}/{typeof quorum.reviewer_count === 'number' ? quorum.reviewer_count : 0}
                                                </span>
                                                {typeof quorum.threshold_percentage === 'number' ? (
                                                    <span className="ml-2 text-zinc-500 dark:text-zinc-400">
                                                        threshold {(quorum.threshold_percentage * 100).toFixed(0)}%
                                                    </span>
                                                ) : null}
                                            </div>
                                        ) : null}
                                        {(verificationDecision || verification.verification_run_id || verification.attestation_ref || verification.blocking_finding_count || (Array.isArray(verification.blocking_findings) && verification.blocking_findings.length > 0)) ? (
                                            <div className={`rounded-2xl border p-3 space-y-1 ${verificationDecisionClasses(verificationDecision)}`}>
                                                <div className="text-[10px] font-black uppercase tracking-widest">
                                                    Verification Summary
                                                </div>
                                                <div>
                                                    Decision: <span className="font-semibold">{formatVerificationDecisionLabel(verificationDecision)}</span>
                                                </div>
                                                {verification.verification_run_id ? (
                                                    <div>
                                                        Run: <span className="font-mono text-zinc-800 dark:text-zinc-100">{verification.verification_run_id}</span>
                                                    </div>
                                                ) : null}
                                                {verification.policy_bundle_version ? (
                                                    <div>
                                                        Policy: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{verification.policy_bundle_version}</span>
                                                    </div>
                                                ) : null}
                                                {verification.attestation_ref ? (
                                                    <div>
                                                        Attestation: <span className="font-mono text-zinc-800 dark:text-zinc-100">{verification.attestation_ref}</span>
                                                    </div>
                                                ) : null}
                                                {typeof verification.blocking_finding_count === 'number' ? (
                                                    <div>
                                                        Blocking findings: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{verification.blocking_finding_count}</span>
                                                    </div>
                                                ) : null}
                                                {Array.isArray(verification.blocking_findings) && verification.blocking_findings.length > 0 ? (
                                                    <div className="text-[11px] text-zinc-700 dark:text-zinc-200">
                                                        {verification.blocking_findings.slice(0, 2).map((item) => item.claim).filter(Boolean).join(' · ')}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}
                                        {isIterationReview ? (
                                            <div className="space-y-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                                                <div>
                                                    Change: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{formatChangeTypeLabel(rollback.change_type || review.change_request?.change_type)}</span>
                                                </div>
                                                <div>
                                                    Rollback: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{formatRollbackPhaseLabel(rollback.rollback_to_phase || review.change_request?.rollback_to_phase)}</span>
                                                </div>
                                                {phaseSequence.length > 0 ? (
                                                    <div>
                                                        Patch path: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{phaseSequence.map(formatRollbackPhaseLabel).join(' -> ')}</span>
                                                    </div>
                                                ) : null}
                                                {affectedArtifacts.length > 0 ? (
                                                    <div>
                                                        Artifacts: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{affectedArtifacts.join(', ')}</span>
                                                    </div>
                                                ) : null}
                                                {affectedModules.length > 0 ? (
                                                    <div>
                                                        Modules: <span className="font-semibold text-zinc-800 dark:text-zinc-100">{affectedModules.join(', ')}</span>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}
                                        {Boolean(onApprovePlan) && review.gate_id ? (
                                            <ApprovalActionCard
                                                gateId={review.gate_id}
                                                title={
                                                    isBeeGamePermission
                                                        ? 'Permission Required'
                                                        : isClarificationReview
                                                        ? 'Clarification Required'
                                                        : canApprove
                                                            ? 'Approval Required'
                                                            : 'Revision Required'
                                                }
                                                description={
                                                    isClarificationReview
                                                        ? 'The project is waiting for an explicit clarification decision before the next stage can continue.'
                                                        : formatGddReviewSummary(review)
                                                }
                                                tone={
                                                    isBeeGamePermission
                                                        ? 'clarification'
                                                        : isClarificationReview
                                                        ? 'clarification'
                                                        : canApprove
                                                            ? 'approval'
                                                            : 'revision'
                                                }
                                                approvalState={approvalState}
                                                actions={[
                                                    ...(canApprove ? [{
                                                        action: 'approve' as const,
                                                        label: reviewApproveLabel(review),
                                                        onClick: () => onApprovePlan!(toApprovalPayload(review)),
                                                    }] : []),
                                                    ...((isBeeGamePermission || isGddApproval || isClarificationReview) ? [{
                                                        action: 'revise' as const,
                                                        label: reviewReviseLabel(review),
                                                        tone: isBeeGamePermission ? 'reject' as const : undefined,
                                                        onClick: () => onApprovePlan!(toApprovalPayload(review), undefined, 'revise'),
                                                    }] : []),
                                                    ...(isClarificationReview ? [{
                                                        action: 'reject' as const,
                                                        label: rejectionPending ? 'Submitting...' : 'Reject',
                                                        onClick: () => onApprovePlan!(toApprovalPayload(review), undefined, 'reject'),
                                                    }] : []),
                                                ]}
                                                pendingMessage={approvalState.message}
                                                failedMessage={
                                                    approvalFailed || revisionFailed || rejectionFailed
                                                        ? approvalState.message
                                                        : ''
                                                }
                                                className="mt-2"
                                            />
                                        ) : null}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                    <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                        Attention Queue
                    </div>
                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {runtimeAttentionTasks.length === 0 ? (
                            <div className="px-4 py-4 text-sm text-zinc-500 dark:text-zinc-400">No blocked or gated tasks.</div>
                        ) : (
                            runtimeAttentionTasks.map((task) => (
                                <div key={`attention-${task.id}`} className="px-4 py-4 space-y-1.5">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                                                {task.summary}
                                            </div>
                                            <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                                {formatTaskId(task.id)}
                                                {task.assignee ? ` · @${task.assignee}` : ''}
                                            </div>
                                        </div>
                                        <div className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${TASK_STATUS_COLORS[getCanonicalTaskStatus(task)] || 'bg-zinc-100 text-zinc-500'}`}>
                                            {getTaskStatusLabel(task)}
                                        </div>
                                    </div>
                                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                                            {task.invalidated_reason
                                                ? `Blocked: ${task.invalidated_reason}`
                                                : task.verification_stage
                                                    ? `Verification: ${task.verification_stage}`
                                                : getCanonicalTaskStatus(task) === 'in_review'
                                                    ? 'Review: in_review'
                                                    : `Lifecycle: ${getCanonicalTaskStatus(task)}`}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="space-y-3">
                    {tasks.slice(0, 8).map((task) => (
                        <div key={`runtime-${task.id}`} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60 p-4">
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-[11px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">{formatTaskId(task.id)}</div>
                                <div className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase ${TASK_STATUS_COLORS[getCanonicalTaskStatus(task)] || 'bg-zinc-100 text-zinc-500'}`}>
                                    {getTaskStatusLabel(task)}
                                </div>
                            </div>
                            <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100 mb-2">{task.summary}</div>
                            <div className="space-y-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                                <div>Lane: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{task.swarm_parent ? `@${task.swarm_parent}` : 'autonomous'}{task.micro_swarm_specialist ? ` / ${task.micro_swarm_specialist}` : ''}</span></div>
                                <div>Checks: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{getCanonicalTaskStatus(task)} · {task.verification_stage || 'no-verification-stage'}</span></div>
                                <div>Candidates: <span className="font-semibold text-zinc-700 dark:text-zinc-200">{(task.candidate_agents || []).slice(0, 3).map((c) => `@${c.agent_id}`).join(', ') || 'none'}</span></div>
                                {task.invalidated_reason && <div className="text-orange-600 dark:text-orange-300">Blocker: {task.invalidated_reason}</div>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});

RuntimePanel.displayName = 'RuntimePanel';
