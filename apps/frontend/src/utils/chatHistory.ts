import type { Message, MessageType } from '../types/message';
import { normalizeHistorySemanticType } from './messageSemantics';

const toTimestampMs = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e11 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric < 1e11 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
};

const normalizeSender = (value: unknown): string => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'system';
  if (raw === 'assistant') return 'logos';
  if (raw === 'ai') return 'logos';
  return raw;
};

const normalizeContentForDedupe = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').slice(0, 240);

const stableStringHash = (value: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
};

export const buildMessageDedupeKey = ({
  taskId,
  sender,
  content,
  messageType,
  artifactId,
}: {
  taskId?: string;
  sender: string;
  content: string;
  messageType?: string;
  artifactId?: string;
}): string => {
  const normalized = normalizeContentForDedupe(content);
  const contentHash = stableStringHash(normalized);
  return [
    taskId || 'na',
    sender || 'system',
    messageType || 'text',
    artifactId || 'na',
    contentHash,
  ].join(':');
};

const resolveStableMessageId = (record: Record<string, unknown>): string => {
  const candidates = [
    record.message_id,
    record.messageId,
    record.id,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }
  return '';
};

export const normalizeChatHistory = (history: unknown): Message[] => {
  if (!Array.isArray(history)) return [];

  const normalized: Message[] = [];
  const seen = new Map<string, number>();

  for (const item of history) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const sender = normalizeSender(record.sender ?? record.role);
    const content = String(record.content ?? '').trim();
    if (!content) continue;

    if (
      sender === 'system' &&
      /^\[人工关卡\]/.test(content) &&
      /GDD\s*已通过内部评审|请查阅并决策|资源清单已生成|上传资源并审批继续/i.test(content)
    ) {
      continue;
    }

    const taskId = typeof record.task_id === 'string' ? record.task_id : typeof record.taskId === 'string' ? record.taskId : undefined;
    const timestamp = toTimestampMs(record.timestamp);
    const messageId = resolveStableMessageId(record);
    const clientMessageId = String(record.client_message_id ?? record.clientMessageId ?? '').trim() || undefined;
    const metadata = (record.metadata && typeof record.metadata === 'object') ? record.metadata as Record<string, unknown> : {};
    const supersedesMessageId = String(
      record.supersedes_message_id ?? record.supersedesMessageId ?? metadata.supersedes_message_id ?? metadata.supersedesMessageId ?? '',
    ).trim() || undefined;
    const rawType = String(record.message_type || record.type || metadata.message_type || '').trim() as MessageType;
    const renderHint = String(record.render_hint ?? record.renderHint ?? metadata.render_hint ?? metadata.renderHint ?? '').trim() as Message['renderHint'];
    const artifactType = String(record.artifact_type ?? record.artifactType ?? metadata.artifact_type ?? metadata.artifactType ?? '').trim() || undefined;
    const taskKind = String(record.task_kind ?? record.taskKind ?? metadata.task_kind ?? metadata.taskKind ?? '').trim() || undefined;
    const nextAction = String(record.next_action ?? record.nextAction ?? metadata.next_action ?? metadata.nextAction ?? '').trim() || undefined;
    const requiresUserActionRaw = record.requires_user_action ?? record.requiresUserAction ?? metadata.requires_user_action ?? metadata.requiresUserAction;
    const semanticType = normalizeHistorySemanticType({
      messageType: rawType,
      renderHint,
      isDocument: Boolean(record.is_document || record.isDocument || metadata.is_document || metadata.isDocument),
      taskKind,
      nextAction,
      requiresUserAction: typeof requiresUserActionRaw === 'boolean' ? requiresUserActionRaw : undefined,
      content,
    });
    const isDocument = semanticType === 'artifact_card' || Boolean(record.is_document || record.isDocument || metadata.is_document || metadata.isDocument);
    const artifactId = record.artifact_id as string || record.artifactId as string || metadata.artifact_id as string;
    const documentTitle = record.document_title as string || record.documentTitle as string || metadata.document_title as string;
    const clientIdFromMetadata = String(metadata.client_message_id ?? '').trim() || undefined;
    const finalClientMessageId = clientMessageId || clientIdFromMetadata;
    const dedupeKey = buildMessageDedupeKey({
      taskId,
      sender,
      content,
      messageType: semanticType,
      artifactId,
    });
    const id = messageId || finalClientMessageId || `history-${dedupeKey}-${timestamp}`;
    const uniqueKey = messageId || finalClientMessageId || dedupeKey;

    const message: Message = {
      id,
      messageId: messageId || undefined,
      clientMessageId: finalClientMessageId,
      supersedesMessageId,
      dedupeKey,
      sender,
      content,
      timestamp,
      type: semanticType,
      taskId,
      isDocument,
      artifactId,
      documentTitle,
      renderHint: renderHint || undefined,
      artifactType,
      taskKind,
      nextAction,
      requiresUserAction: typeof requiresUserActionRaw === 'boolean' ? requiresUserActionRaw : undefined,
    };

    const existingIndex = seen.get(uniqueKey);
    if (existingIndex !== undefined) {
      const existing = normalized[existingIndex];
      normalized[existingIndex] = {
        ...existing,
        ...message,
        timestamp: Math.max(existing.timestamp, message.timestamp),
      };
      continue;
    }

    seen.set(uniqueKey, normalized.length);
    normalized.push(message);
  }

  return normalized.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.id.localeCompare(b.id);
  });
};
