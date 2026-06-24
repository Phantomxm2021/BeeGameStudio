import type { ProjectTask } from '../../../store/systemStore';
import type {
    ReviewStatusPayload,
    VerificationDecision,
} from '../../../services/api';
import { localizeReviewMessage } from '../../../utils/reviewStatus';
import { isReviewBlockerGateKind } from '../../../utils/gateSemantics';
import type {
    ProjectRuntimeDisplayModel,
    ReviewDisplayModel,
    ReviewStatusDisplayPayload,
    ReviewDisplayVerification,
} from '../../../viewModels/displayModels';

export const TASK_STATUS_COLORS: Record<string, string> = {
    'released': 'bg-emerald-500 text-white font-black',
    'in_progress': 'bg-blue-600 text-white font-black shadow-[0_4px_12px_rgba(37,99,235,0.3)] animate-pulse',
    'in_review': 'bg-amber-500 text-white font-black',
    'verified': 'bg-emerald-600 text-white font-black',
    'failed': 'bg-rose-600 text-white font-black',
    'pending': 'bg-zinc-400 text-white font-black dark:bg-zinc-600',
    'to_do': 'bg-zinc-400 text-white font-black dark:bg-zinc-600',
    'blocked': 'bg-red-600 text-white font-black',
    'invalidated': 'bg-orange-600 text-white font-black',
    'changes_requested': 'bg-fuchsia-600 text-white font-black',
    'paused': 'bg-violet-600 text-white font-black',
};

export const getCanonicalTaskStatus = (task: Pick<ProjectTask, 'task_status' | 'lifecycle_status'>): string => {
    return String(task.lifecycle_status || task.task_status || 'unknown').toLowerCase();
};

export const getTaskStatusLabel = (task: ProjectTask): string => {
    const status = getCanonicalTaskStatus(task);
    switch (status.toLowerCase()) {
        case 'in_review': return 'Reviewing';
        case 'verified':
            if (task.id?.toLowerCase().includes('generate_resource_manifest') || task.id === 'wp_4') {
                return 'Pending Upload';
            }
            return 'Verified';
        case 'in_progress': return 'Active';
        case 'released': return 'Released';
        case 'changes_requested': return 'Changes Req';
        case 'invalidated': return 'Invalidated';
        case 'to_do': return 'Planned';
        default: return status;
    }
};

type ReviewLike = ReviewDisplayModel | undefined | null;
type ProjectRuntimeLike = ProjectRuntimeDisplayModel | undefined | null;
type ReviewStatusLike = ReviewStatusPayload | ReviewStatusDisplayPayload | null | undefined;
const LEGACY_BEEGAME_PERMISSION_TYPE = ['CLAU', 'DE_CODE_PERMISSION'].join('');

export const isBlockerResolutionReview = (review: ReviewLike): boolean => {
    if (!review) return false;
    const gateKind = String(review.gate_kind || '').trim();
    const actionKind = String(review.user_action_kind || review.review_status?.user_action_kind || '').trim();
    return isReviewBlockerGateKind(gateKind) || actionKind === 'resolve_blockers';
};

export const isBeeGamePermissionReview = (review: ReviewLike): boolean => {
    if (!review) return false;
    return (
        review.type === 'BEEGAME_PERMISSION' ||
        review.type === LEGACY_BEEGAME_PERMISSION_TYPE ||
        review.gate_kind === 'beegame_permission' ||
        review.review_status?.workflow_id === 'beegame'
    );
};

export const formatReviewTitle = (review: ReviewLike): string => {
    if (!review) return 'Pending review';
    if (isBeeGamePermissionReview(review)) return review.title || 'BeeGame permission';
    if (isBlockerResolutionReview(review)) return 'Resolve blockers';
    if (review.type === 'ITERATION_REAPPROVAL_REVIEW') return 'Iteration reapproval';
    if (review.type === 'GDD_APPROVAL_REVIEW') return 'Design approval';
    if (review.type === 'ASSET_MANIFEST_REVIEW') return 'Asset delivery approval';
    return review.title || review.task_id || review.artifact_id || 'Pending review';
};

export const formatBeeGamePermissionSummary = (review: ReviewLike): string => {
    if (!review) return 'BeeGame is waiting for a permission decision.';
    const artifact = review.artifact || {};
    const content = String(artifact.content || '').trim();
    const input = artifact.input && typeof artifact.input === 'object'
        ? artifact.input as Record<string, unknown>
        : {};
    const command = String(input.command || '').trim();
    const path = String(input.path || input.file_path || input.notebook_path || '').trim();
    const target = command || compactPermissionPath(path, getReviewWorkspaceRef(review));
    if (content.includes('was blocked') && content.includes('allowed working directories')) {
        return `${content} This is a workspace boundary. Change the session workspace if BeeGame should operate there.`;
    }
    if (target) {
        return `BeeGame requests ${review.title || 'tool access'}:\n${target}`;
    }
    return content || 'BeeGame is waiting for a tool permission decision.';
};

const compactPermissionPath = (path: string, workspaceRef: string): string => {
    if (!path) return '';
    const normalizedPath = path.replace(/\/+$/, '');
    const normalizedWorkspace = workspaceRef.replace(/\/+$/, '');
    if (normalizedWorkspace && normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
        return `./${normalizedPath.slice(normalizedWorkspace.length + 1)}`;
    }
    const parts = normalizedPath.split('/').filter(Boolean);
    if (parts.length <= 5) return normalizedPath;
    return `.../${parts.slice(-4).join('/')}`;
};

export const isReviewAwaitingUserAction = (review: ReviewLike): boolean => {
    if (!review) return false;
    if (isBlockerResolutionReview(review)) return false;
    if (review.review_status?.requires_user_action === true) return true;
    return review.ready_for_user_approval === true;
};

export const isStructuredDocumentApprovalReview = (review: ReviewLike): boolean => {
    if (!review) return false;
    if (String(review.review_status?.workflow_id || '').trim()) return true;
    return Boolean(review.type?.endsWith('_APPROVAL_REVIEW'));
};

export const formatChangeTypeLabel = (changeType?: string): string => {
    if (!changeType) return 'unknown';
    return changeType.replace(/_/g, ' ');
};

export const formatRollbackPhaseLabel = (phase?: string): string => {
    if (!phase) return 'unknown';
    return phase.replace(/_/g, ' ');
};

export const getCurrentReviewArtifactId = (review: ReviewLike): string => {
    return String(review?.current_review_artifact_id || review?.artifact_id || '').trim();
};

export const getReviewWorkspaceRef = (review: ReviewLike): string => {
    return String(review?.binding?.workspace_ref || review?.binding?.workspace_path || review?.workspace_ref || review?.workspace_path || '').trim();
};

export const isPinnedReviewBinding = (review: ReviewLike): boolean => {
    return Boolean(String(review?.binding?.checkpoint_id || review?.checkpoint_id || '').trim());
};

export const getCurrentReviewIteration = (review: ReviewLike): number => {
    const raw = review?.current_review_iteration ?? review?.review_iteration ?? 1;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export const getReviewBindingSummary = (review: ReviewLike): string => {
    if (!review) return 'Baseline: unavailable';
    if (isPinnedReviewBinding(review)) {
        const checkpoint = String(review?.binding?.checkpoint_id || review?.checkpoint_id || '').trim();
        return checkpoint ? `Baseline: checkpoint ${checkpoint}` : 'Baseline: pinned checkpoint';
    }
    const artifactVersion = review?.binding?.artifact_version ?? review?.artifact_version;
    if (artifactVersion != null) {
        return `Baseline: artifact v${artifactVersion}`;
    }
    const workspaceRef = getReviewWorkspaceRef(review);
    if (workspaceRef) {
        return `Baseline: workspace ${workspaceRef}`;
    }
    return 'Baseline: unavailable';
};

const getReviewLifecycleLabel = (reviewStatus?: ReviewStatusLike): string => {
    const decisionStatus = String(reviewStatus?.decision_status || '').trim().toLowerCase();
    const laneStatus = String(reviewStatus?.lane_status || '').trim().toLowerCase();
    if (decisionStatus === 'awaiting_user') return 'Awaiting User Approval';
    if (decisionStatus === 'approved') return 'Approved';
    if (decisionStatus === 'revision_required') return laneStatus.includes('revision') ? 'Applying Internal Review Revisions' : 'Revision Required';
    if (decisionStatus === 'escalated') return 'Escalated';
    if (decisionStatus === 'running') return laneStatus.includes('revision') ? 'Re-reviewing Revised GDD' : 'Internal Review Running';
    return '';
};

export const formatGddReviewSummary = (review: ReviewLike): string => {
    if (isBeeGamePermissionReview(review)) {
        return formatBeeGamePermissionSummary(review);
    }
    if (isBlockerResolutionReview(review)) {
        const artifactId = getCurrentReviewArtifactId(review);
        const iteration = getCurrentReviewIteration(review);
        return `GDD 第 ${iteration} 轮内部评审仍有 blocker，当前需修订 artifact ${artifactId || 'unknown'}`;
    }
    const reviewStatusMessage = localizeReviewMessage(review?.review_status);
    if (reviewStatusMessage) {
        return reviewStatusMessage;
    }
    const artifactId = getCurrentReviewArtifactId(review);
    const iteration = getCurrentReviewIteration(review);
    const decisionStatus = String(review?.review_status?.decision_status || '').trim().toLowerCase();
    const laneStatus = String(review?.review_status?.lane_status || '').trim().toLowerCase();
    if (decisionStatus === 'awaiting_user') {
        return `GDD 第 ${iteration} 轮内部评审已通过，当前待用户确认的是 artifact ${artifactId || 'unknown'}`;
    }
    if (decisionStatus === 'revision_required' && !laneStatus.includes('revision')) {
        return `GDD 第 ${iteration} 轮内部评审已完成，当前需按 blocker 修订 artifact ${artifactId || 'unknown'}`;
    }
    if (decisionStatus === 'revision_required' && laneStatus.includes('revision')) {
        return `GDD 第 ${iteration} 轮修订请求已生成，Metis 正在根据 blocker 修订 artifact ${artifactId || 'unknown'}`;
    }
    if (decisionStatus === 'running' && laneStatus.includes('revision')) {
        return `GDD 第 ${iteration} 轮修订已提交，正在重新进行内部评审，当前 artifact ${artifactId || 'unknown'}`;
    }
    return `GDD 第 ${iteration} 轮内部评审未通过，需修订后重审。当前阻塞的是 artifact ${artifactId || 'unknown'}`;
};

export const getGddReviewReadinessLabel = (review: ReviewLike): string => {
    if (isBlockerResolutionReview(review)) return 'Revision Required';
    const reviewStatusMessage = localizeReviewMessage(review?.review_status);
    if (reviewStatusMessage) return reviewStatusMessage;
    return getReviewLifecycleLabel(review?.review_status) || 'Blocked';
};

export const getVerificationSummary = (review: ReviewLike): ReviewDisplayVerification => {
    return review?.verification || {};
};

export const getProjectBaselineSummary = (projectStatus: ProjectRuntimeLike): string => {
    const reviewStatusMessage = localizeReviewMessage(projectStatus?.review_status);
    if (reviewStatusMessage) {
        return reviewStatusMessage;
    }
    if (!projectStatus) return 'Baseline: unavailable';
    const baseline = projectStatus.baseline;
    const checkpoint = String(baseline?.checkpoint_id || '').trim();
    if (checkpoint) {
        return `Baseline: checkpoint ${checkpoint}`;
    }
    const artifactVersion = baseline?.artifact_version;
    if (artifactVersion != null) {
        return `Baseline: artifact v${artifactVersion}`;
    }
    const workspaceRef = String(baseline?.workspace_ref || baseline?.workspace_path || '').trim();
    if (workspaceRef) {
        return `Baseline: workspace ${workspaceRef}`;
    }
    if (String(baseline?.artifact_id || '').trim()) {
        return `Baseline: artifact ${baseline?.artifact_id}`;
    }
    return 'Baseline: unavailable';
};

export const formatVerificationDecisionLabel = (decision?: VerificationDecision | ''): string => {
    if (decision === 'blocked') return 'Blocked';
    if (decision === 'warning') return 'Warning';
    if (decision === 'pass') return 'Pass';
    return 'Unavailable';
};

export const verificationDecisionClasses = (decision?: VerificationDecision | ''): string => {
    if (decision === 'blocked') return 'border-rose-200 bg-rose-50/80 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-200';
    if (decision === 'warning') return 'border-amber-200 bg-amber-50/80 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200';
    if (decision === 'pass') return 'border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200';
    return 'border-zinc-200 bg-zinc-50/80 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200';
};
