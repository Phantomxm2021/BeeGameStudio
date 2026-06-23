import type { PendingUserReviewItem, ProjectBaselineStatusPayload } from '../services/api';
import { localizeReviewMessage } from './reviewStatus';
import { isReviewBlockerGateKind } from './gateSemantics';
import type { ProjectRuntimeDisplayModel, ReviewDisplayModel, ReviewStatusDisplayPayload } from '../viewModels/displayModels';

export type WaitingApprovalKind = 'none' | 'gdd' | 'asset' | 'clarification';

export interface WaitingApprovalState {
  kind: WaitingApprovalKind;
  isWaitingStatus: boolean;
  isBlockingChat: boolean;
  message: string;
  placeholder: string;
}

const DEFAULT_STATE: WaitingApprovalState = {
  kind: 'none',
  isWaitingStatus: false,
  isBlockingChat: false,
  message: '',
  placeholder: 'Ask team (Shift+Enter to new line)...',
};

const normalize = (value: unknown): string => String(value ?? '').trim();

type ReviewStatusLike = {
  review_status?: ReviewStatusDisplayPayload | null;
};

type ProjectStatusLike =
  | ProjectBaselineStatusPayload
  | ProjectRuntimeDisplayModel
  | null
  | undefined;

type PendingReviewLike =
  | PendingUserReviewItem
  | ReviewDisplayModel;

const isBlockerResolutionReview = (review?: PendingReviewLike | null): boolean => {
  const gateKind = normalize(review?.gate_kind);
  const actionKind = normalize(review?.user_action_kind || review?.review_status?.user_action_kind);
  return isReviewBlockerGateKind(gateKind) || actionKind === 'resolve_blockers';
};

const collectGovernanceBlockingIds = (projectStatus?: ProjectStatusLike): string[] => {
  const governance = projectStatus?.governance;
  if (!governance || !governance.blocked) {
    return [];
  }
  return [
    ...(governance.open_blocker_ids || []),
    ...(governance.unrevalidated_blocker_ids || []),
    ...(governance.unresolved_conflict_ids || []),
  ]
    .map((value) => normalize(value))
    .filter(Boolean);
};

export const getWaitingApprovalState = (
  projectStatus?: ProjectStatusLike,
  pendingReviews: PendingReviewLike[] = [],
): WaitingApprovalState => {
  const blockerReview = pendingReviews.find(isBlockerResolutionReview);
  if (blockerReview) {
    const blockerIds = (blockerReview.open_blocker_ids || []).map((value) => normalize(value)).filter(Boolean);
    return {
      kind: 'gdd',
      isWaitingStatus: true,
      isBlockingChat: true,
      message: blockerIds.length > 0
        ? `当前 GDD blocker 尚未清理：${blockerIds.join(', ')}。请先处理后再继续。`
        : '当前 GDD blocker 尚未清理。请先处理后再继续。',
      placeholder: '请先处理 GDD blocker...',
    };
  }
  const projectReviewStatus = (projectStatus as ReviewStatusLike | undefined)?.review_status;
  const activeReviewStatus = projectReviewStatus ?? pendingReviews.find((review) => review?.review_status)?.review_status;
  if (activeReviewStatus) {
    const localizedMessage = localizeReviewMessage(activeReviewStatus);
    if (activeReviewStatus.requires_user_action) {
      return {
        kind: 'gdd',
        isWaitingStatus: true,
        isBlockingChat: true,
        message: localizedMessage,
        placeholder: '请先审批或修订当前文档...',
      };
    }
    if (activeReviewStatus.decision_status === 'revision_required') {
      return {
        kind: 'gdd',
        isWaitingStatus: true,
        isBlockingChat: true,
        message: localizedMessage,
        placeholder: '请先修订当前文档...',
      };
    }
    if (activeReviewStatus.decision_status === 'running' && normalize(activeReviewStatus.lane_id) === 'internal_board_review') {
      return {
        kind: 'gdd',
        isWaitingStatus: true,
        isBlockingChat: true,
        message: localizedMessage,
        placeholder: '当前 review 正在执行...',
      };
    }
  }

  const governanceBlockingIds = collectGovernanceBlockingIds(projectStatus);
  if (governanceBlockingIds.length > 0) {
    return {
      kind: 'gdd',
      isWaitingStatus: true,
      isBlockingChat: true,
      message: `当前治理 blocker 尚未清理：${governanceBlockingIds.join(', ')}。请先处理后再继续。`,
      placeholder: '请先处理治理 blocker...',
    };
  }

  if (projectStatus?.blocked && normalize(projectStatus.blocked_reason)) {
    if (
      normalize(projectStatus.phase).toLowerCase() === 'paused' &&
      !projectStatus.approval_required
    ) {
      return {
        kind: 'none',
        isWaitingStatus: false,
        isBlockingChat: false,
        message: normalize(projectStatus.blocked_reason),
        placeholder: '输入修复要求或继续任务...',
      };
    }
    return {
      kind: 'gdd',
      isWaitingStatus: true,
      isBlockingChat: true,
      message: normalize(projectStatus.blocked_reason),
      placeholder: '当前 workflow 已暂停...',
    };
  }

  return DEFAULT_STATE;
};

export const deriveDashboardStatus = ({
  isOffline,
  isLoading,
  canContinue,
  hasWaitingApproval,
  messages,
}: {
  isOffline: boolean;
  isLoading: boolean;
  canContinue: boolean;
  hasWaitingApproval: boolean;
  messages: Array<{ sender: string; content: string }>;
}): 'offline' | 'running' | 'paused' | 'waiting_approval' | 'finished' | 'stopped' | 'idle' => {
  if (isOffline) return 'offline';
  if (isLoading) return 'running';
  if (canContinue) return 'paused';
  if (hasWaitingApproval) return 'waiting_approval';

  const lastStatusMsg = [...messages]
    .reverse()
    .find((m) => m.sender === 'system' && (m.content === 'finished' || m.content === '任务已停止'));
  if (lastStatusMsg?.content === 'finished') return 'finished';
  if (lastStatusMsg?.content === '任务已停止') return 'stopped';
  return 'idle';
};
