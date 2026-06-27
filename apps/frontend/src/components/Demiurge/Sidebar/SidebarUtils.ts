import type { ProjectTask } from '../../../store/systemStore';
import type {
    ReviewStatusPayload,
} from '../../../services/api';
import { localizeReviewMessage } from '../../../utils/reviewStatus';
import type {
    ReviewDisplayModel,
    ReviewStatusDisplayPayload,
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
const LEGACY_BEEGAME_PERMISSION_TYPE = ['CLAU', 'DE_CODE_PERMISSION'].join('');

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
    if (review.type === 'ITERATION_REAPPROVAL_REVIEW') return 'Review required';
    if (review.type === 'GDD_APPROVAL_REVIEW') return 'Review required';
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
    if (review.review_status?.requires_user_action === true) return true;
    return review.ready_for_user_approval === true;
};

export const isStructuredDocumentApprovalReview = (review: ReviewLike): boolean => {
    if (!review) return false;
    if (String(review.review_status?.workflow_id || '').trim()) return true;
    return Boolean(review.type?.endsWith('_APPROVAL_REVIEW'));
};

const getCurrentReviewArtifactId = (review: ReviewLike): string => {
    return String(review?.current_review_artifact_id || review?.artifact_id || '').trim();
};

export const getReviewWorkspaceRef = (review: ReviewLike): string => {
    return String(review?.binding?.workspace_ref || review?.binding?.workspace_path || review?.workspace_ref || review?.workspace_path || '').trim();
};

export const formatReviewSummary = (review: ReviewLike): string => {
    if (isBeeGamePermissionReview(review)) {
        return formatBeeGamePermissionSummary(review);
    }
    const reviewStatusMessage = localizeReviewMessage(review?.review_status);
    if (reviewStatusMessage) {
        return reviewStatusMessage;
    }
    const artifactId = getCurrentReviewArtifactId(review);
    const decisionStatus = String(review?.review_status?.decision_status || '').trim().toLowerCase();
    const laneStatus = String(review?.review_status?.lane_status || '').trim().toLowerCase();
    if (decisionStatus === 'awaiting_user') {
        return `Review is ready for your confirmation${artifactId ? `: ${artifactId}` : ''}.`;
    }
    if (decisionStatus === 'revision_required' && !laneStatus.includes('revision')) {
        return `Revision is required${artifactId ? ` for ${artifactId}` : ''}.`;
    }
    if (decisionStatus === 'revision_required' && laneStatus.includes('revision')) {
        return `Revision has started${artifactId ? ` for ${artifactId}` : ''}.`;
    }
    if (decisionStatus === 'running' && laneStatus.includes('revision')) {
        return `Review is running again${artifactId ? ` for ${artifactId}` : ''}.`;
    }
    return `Review needs attention${artifactId ? `: ${artifactId}` : ''}.`;
};
