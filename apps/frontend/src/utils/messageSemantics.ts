import type { GovernanceSnapshot, Message, MessageType, RenderHint, WebSocketMessage } from '../types/message';

export type CanonicalChatMessageType =
  | 'text'
  | 'artifact_card'
  | 'approval_request'
  | 'revision_request'
  | 'system_status'
  | 'error'
  | 'tool'
  | 'structured_output';

const CANONICAL_TYPES = new Set<CanonicalChatMessageType>([
  'text',
  'artifact_card',
  'approval_request',
  'revision_request',
  'system_status',
  'error',
  'tool',
  'structured_output',
]);

const LEGACY_MAP: Record<string, CanonicalChatMessageType> = {
  normal: 'text',
  document: 'artifact_card',
  thought: 'text',
};

interface SemanticResolverInput {
  type?: string;
  renderHint?: string;
  isDocument?: boolean;
  taskKind?: string;
  nextAction?: string;
  requiresUserAction?: boolean;
  governanceSnapshot?: GovernanceSnapshot;
  content?: string;
}

export const normalizeCanonicalMessageType = ({
  type,
  renderHint,
  isDocument,
  taskKind,
  nextAction,
  requiresUserAction,
}: SemanticResolverInput): CanonicalChatMessageType => {
  const normalizedType = String(type || '').trim().toLowerCase();
  const mappedType = LEGACY_MAP[normalizedType] || normalizedType;
  if (
    CANONICAL_TYPES.has(mappedType as CanonicalChatMessageType) &&
    !(mappedType === 'text' && requiresUserAction)
  ) {
    return mappedType as CanonicalChatMessageType;
  }
  if (CANONICAL_TYPES.has(normalizedType as CanonicalChatMessageType)) {
    return normalizedType as CanonicalChatMessageType;
  }

  const hint = String(renderHint || '').trim().toLowerCase();
  if (hint === 'artifact_card' || hint === 'document' || isDocument) {
    return 'artifact_card';
  }
  if (hint === 'structured_json' || hint === 'csv_table') {
    return 'structured_output';
  }

  const action = String(nextAction || '').trim().toLowerCase();
  const kind = String(taskKind || '').trim().toLowerCase();
  if (requiresUserAction) {
    if (action === 'revise' || action === 'upload_manifest' || action === 'clarify' || kind.includes('revision') || kind.includes('clarification')) {
      return 'revision_request';
    }
    return 'approval_request';
  }
  return 'text';
};

export const normalizeMessageSemanticFields = <T extends {
  type?: MessageType | string;
  renderHint?: RenderHint | string;
  isDocument?: boolean;
  taskKind?: string;
  nextAction?: string;
  requiresUserAction?: boolean;
  governanceSnapshot?: GovernanceSnapshot;
  content?: string;
}>(message: T): T & { type: CanonicalChatMessageType } => {
  return {
    ...message,
    type: normalizeCanonicalMessageType(message),
  };
};

export const normalizeWebSocketSemanticType = (message: WebSocketMessage): CanonicalChatMessageType =>
  normalizeCanonicalMessageType({
    type: message.message_type,
    renderHint: message.render_hint,
    isDocument: message.is_document,
    taskKind: message.task_kind,
    nextAction: message.next_action,
    requiresUserAction: message.requires_user_action,
    governanceSnapshot: message.governance_snapshot,
    content: message.content,
  });

export const normalizeHistorySemanticType = (message: {
  messageType?: string;
  renderHint?: string;
  isDocument?: boolean;
  taskKind?: string;
  nextAction?: string;
  requiresUserAction?: boolean;
  governanceSnapshot?: GovernanceSnapshot;
  content?: string;
}): CanonicalChatMessageType =>
  normalizeCanonicalMessageType({
    type: message.messageType,
    renderHint: message.renderHint,
    isDocument: message.isDocument,
    taskKind: message.taskKind,
    nextAction: message.nextAction,
    requiresUserAction: message.requiresUserAction,
    governanceSnapshot: message.governanceSnapshot,
    content: message.content,
  });

export const getSystemStatusLabel = (message: Message): string => {
  const kind = String(message.taskKind || '').trim().replace(/_/g, ' ');
  return kind || 'System Status';
};
