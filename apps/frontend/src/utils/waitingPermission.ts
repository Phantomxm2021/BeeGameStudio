import type { PendingToolPermissionItem } from '../services/api';
import type { PermissionDisplayModel } from '../viewModels/displayModels';

export type WaitingPermissionKind = 'none' | 'permission';

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

type PendingPermissionLike =
  | PendingToolPermissionItem
  | PermissionDisplayModel;

export const getWaitingPermissionState = (
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

  return deriveChatTerminalStatus(messages);
};

export const deriveChatTerminalStatus = (
  messages: ReadonlyArray<{ sender: string; content: string }>,
): 'finished' | 'stopped' | 'idle' => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.sender !== 'system') continue;
    if (message.content === 'finished') return 'finished';
    if (message.content === '任务已停止') return 'stopped';
  }
  return 'idle';
};
