import type { PendingUserReviewItem, ProjectBaselineStatusPayload } from '../services/api';
import { localizeReviewMessage } from './reviewStatus';
import { getWorkflowControlState, type ProjectRuntimeDisplayModel, type ReviewDisplayModel, type ReviewStatusDisplayPayload } from '../viewModels/displayModels';

export type WaitingApprovalKind = 'none' | 'review' | 'asset' | 'clarification';

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

export const getWaitingApprovalState = (
  projectStatus?: ProjectStatusLike,
  pendingReviews: PendingReviewLike[] = [],
): WaitingApprovalState => {
  const projectReviewStatus = (projectStatus as ReviewStatusLike | undefined)?.review_status;
  const activeReviewStatus = projectReviewStatus ?? pendingReviews.find((review) => review?.review_status)?.review_status;
  if (activeReviewStatus) {
    const localizedMessage = localizeReviewMessage(activeReviewStatus);
    if (activeReviewStatus.requires_user_action) {
      return {
        kind: 'review',
        isWaitingStatus: true,
        isBlockingChat: true,
        message: localizedMessage,
        placeholder: '请先处理当前请求...',
      };
    }
    if (activeReviewStatus.decision_status === 'revision_required') {
      return {
        kind: 'review',
        isWaitingStatus: true,
        isBlockingChat: true,
        message: localizedMessage,
        placeholder: '请先处理当前请求...',
      };
    }
    if (activeReviewStatus.decision_status === 'running' && normalize(activeReviewStatus.lane_id) === 'internal_board_review') {
      return {
        kind: 'review',
        isWaitingStatus: true,
        isBlockingChat: true,
        message: localizedMessage,
        placeholder: '当前 review 正在执行...',
      };
    }
  }

  const workflow = getWorkflowControlState(projectStatus as ProjectRuntimeDisplayModel | null | undefined);
  if (workflow?.status === 'failed') {
    if (workflow.block?.message) {
      return {
        kind: 'none',
        isWaitingStatus: false,
        isBlockingChat: false,
        message: workflow.block.message,
        placeholder: '输入修复要求或继续任务...',
      };
    }
  }
  if (workflow?.status === 'blocked' && workflow.block?.message) {
    return {
      kind: 'review',
      isWaitingStatus: true,
      isBlockingChat: true,
      message: workflow.block.message,
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
