import type { ProjectEventMessage } from '../types/message';

export type CanonicalChatMessageType =
  | 'text'
  | 'thought'
  | 'artifact_card'
  | 'system_status'
  | 'error'
  | 'tool'
  | 'structured_output';

const CANONICAL_TYPES = new Set<CanonicalChatMessageType>([
  'text',
  'thought',
  'artifact_card',
  'system_status',
  'error',
  'tool',
  'structured_output',
]);

const TRANSPORT_TYPE_MAP: Record<string, CanonicalChatMessageType> = {
  normal: 'text',
  document: 'artifact_card',
};

interface SemanticResolverInput {
  type?: string;
  renderHint?: string;
  isDocument?: boolean;
  taskKind?: string;
  nextAction?: string;
  requiresUserAction?: boolean;
  content?: string;
}

export const normalizeCanonicalMessageType = ({
  type,
  renderHint,
  isDocument,
  requiresUserAction,
}: SemanticResolverInput): CanonicalChatMessageType => {
  const normalizedType = String(type || '').trim().toLowerCase();
  const mappedType = TRANSPORT_TYPE_MAP[normalizedType] || normalizedType;
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

  if (requiresUserAction) return 'system_status';
  return 'text';
};

export const normalizeProjectEventSemanticType = (message: ProjectEventMessage): CanonicalChatMessageType =>
  normalizeCanonicalMessageType({
    type: message.message_type,
    renderHint: message.render_hint,
    isDocument: message.is_document,
    taskKind: message.task_kind,
    nextAction: message.next_action,
    requiresUserAction: message.requires_user_action,
    content: message.content,
  });

export const normalizeHistorySemanticType = (message: {
  messageType?: string;
  renderHint?: string;
  isDocument?: boolean;
  taskKind?: string;
  nextAction?: string;
  requiresUserAction?: boolean;
  content?: string;
}): CanonicalChatMessageType =>
  normalizeCanonicalMessageType({
    type: message.messageType,
    renderHint: message.renderHint,
    isDocument: message.isDocument,
    taskKind: message.taskKind,
    nextAction: message.nextAction,
    requiresUserAction: message.requiresUserAction,
    content: message.content,
  });
