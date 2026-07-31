import type { PendingToolPermissionItem } from '../services/api';
import { getWorkflowControlState, type ProjectRuntimeDisplayModel, type PermissionDisplayModel } from '../viewModels/displayModels';

export type WaitingPermissionKind = 'none' | 'permission' | 'workflow';

export interface WaitingPermissionState {
  kind: WaitingPermissionKind;
  isWaitingStatus: boolean;
  isBlockingChat: boolean;
  message: string;
  placeholder: string;
}

const DEFAULT_STATE: WaitingPermissionState = {
  kind: 'none',
  isWaitingStatus: false,
  isBlockingChat: false,
  message: '',
  placeholder: 'Ask team (Shift+Enter to new line)...',
};

const normalize = (value: unknown): string => String(value ?? '').trim();

type ProjectStatusLike = ProjectRuntimeDisplayModel | null | undefined;

type PendingPermissionLike =
  | PendingToolPermissionItem
  | PermissionDisplayModel;

export const getWaitingPermissionState = (
  projectStatus?: ProjectStatusLike,
  pendingPermissions: PendingPermissionLike[] = [],
): WaitingPermissionState => {
  if (pendingPermissions.some(permission => normalize(permission?.type) === 'BEEGAME_PERMISSION')) {
    return {
      kind: 'permission',
      isWaitingStatus: true,
      isBlockingChat: true,
      message: 'BeeGame 正在等待工具权限决定。',
      placeholder: '请先处理当前权限请求...',
    };
  }

  const workflow = getWorkflowControlState(projectStatus);
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
      kind: 'workflow',
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
  hasWaitingPermission,
  messages,
}: {
  isOffline: boolean;
  isLoading: boolean;
  canContinue: boolean;
  hasWaitingPermission: boolean;
  messages: Array<{ sender: string; content: string }>;
}): 'offline' | 'running' | 'paused' | 'waiting_approval' | 'finished' | 'stopped' | 'idle' => {
  if (isOffline) return 'offline';
  if (isLoading) return 'running';
  if (canContinue) return 'paused';
  if (hasWaitingPermission) return 'waiting_approval';

  const lastStatusMsg = [...messages]
    .reverse()
    .find((m) => m.sender === 'system' && (m.content === 'finished' || m.content === '任务已停止'));
  if (lastStatusMsg?.content === 'finished') return 'finished';
  if (lastStatusMsg?.content === '任务已停止') return 'stopped';
  return 'idle';
};
