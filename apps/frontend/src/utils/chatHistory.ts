import type { AssistantContentBlock, Message, MessageType } from '../types/message';
import { readSubagentActivity } from '@bee-game-studio/agent-workflow/subagent-activity';
import { normalizeHistorySemanticType } from './messageSemantics';
import { normalizeChatSources } from './chatSources';
import { normalizeChatAttachments } from '../services/chatAttachments';

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

const normalizeContentBlocks = (value: unknown): AssistantContentBlock[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const blocks = value.flatMap((block): AssistantContentBlock[] => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return [];
    const record = block as Record<string, unknown>;
    const type = record.type;
    if (type !== 'thinking' && type !== 'text' && type !== 'tool_use' && type !== 'tool_result') return [];
    return [{
      type,
      ...(typeof record.thinking === 'string' ? { text: record.thinking } : {}),
      ...(typeof record.text === 'string' ? { text: record.text } : {}),
      ...(typeof record.toolUseId === 'string'
        ? { toolUseId: record.toolUseId }
        : typeof record.tool_use_id === 'string'
          ? { toolUseId: record.tool_use_id }
          : typeof record.id === 'string'
            ? { toolUseId: record.id }
            : {}),
      ...(typeof record.toolName === 'string'
        ? { toolName: record.toolName }
        : typeof record.name === 'string'
          ? { toolName: record.name }
          : {}),
      ...(record.toolInput !== undefined
        ? { toolInput: record.toolInput }
        : record.input !== undefined
          ? { toolInput: record.input }
          : {}),
      ...(typeof record.isError === 'boolean'
        ? { isError: record.isError }
        : typeof record.is_error === 'boolean'
          ? { isError: record.is_error }
          : {}),
    }];
  });
  return blocks.length ? blocks : undefined;
};

export const normalizeChatHistory = (history: unknown): Message[] => {
  if (!Array.isArray(history)) return [];

  const normalized: Message[] = [];
  const seen = new Map<string, number>();

  for (const [sourceIndex, item] of history.entries()) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const sender = normalizeSender(record.sender ?? record.role);
    const content = String(record.content ?? '').trim();
    const metadata = (record.metadata && typeof record.metadata === 'object') ? record.metadata as Record<string, unknown> : {};
    const contentBlocks = normalizeContentBlocks(record.content_blocks ?? record.contentBlocks ?? metadata.content_blocks ?? metadata.contentBlocks);
    const attachments = normalizeChatAttachments(record.attachments);
    if (!content && !contentBlocks?.length && !attachments?.length) continue;

    const taskId = typeof record.task_id === 'string' ? record.task_id : typeof record.taskId === 'string' ? record.taskId : undefined;
    const turnId = String(record.turn_id ?? record.turnId ?? metadata.turn_id ?? metadata.turnId ?? '').trim() || undefined;
    const timestamp = toTimestampMs(record.timestamp);
    const thinkingDurationCandidate = record.thinking_duration_ms
      ?? record.thinkingDurationMs
      ?? metadata.thinking_duration_ms
      ?? metadata.thinkingDurationMs;
    const thinkingDurationMs = typeof thinkingDurationCandidate === 'number'
      ? thinkingDurationCandidate
      : typeof thinkingDurationCandidate === 'string'
        ? Number(thinkingDurationCandidate)
        : undefined;
    const messageId = resolveStableMessageId(record);
    const clientMessageId = String(record.client_message_id ?? record.clientMessageId ?? '').trim() || undefined;
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
    const readOptionalString = (...keys: string[]): string | undefined => {
      for (const key of keys) {
        const value = record[key] ?? metadata[key];
        if (typeof value === 'string' && value.trim()) return value;
      }
      return undefined;
    };
    const structuredPatch = record.structured_patch ?? record.structuredPatch ?? metadata.structured_patch ?? metadata.structuredPatch;
    const exitCode = record.tool_exit_code ?? record.toolExitCode ?? metadata.tool_exit_code ?? metadata.toolExitCode;
    const durationMs = record.tool_duration_ms ?? record.toolDurationMs ?? metadata.tool_duration_ms ?? metadata.toolDurationMs;
    const toolInput = record.tool_input ?? record.toolInput ?? metadata.tool_input ?? metadata.toolInput;
    const rawToolStatus = readOptionalString('tool_status', 'toolStatus')?.toLowerCase();
    const toolStatus = rawToolStatus === 'running' || rawToolStatus === 'completed' || rawToolStatus === 'failed'
      ? rawToolStatus
      : undefined;
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
      rewindAvailable: record.rewind_available === true || record.rewindAvailable === true || metadata.rewind_available === true,
      dedupeKey,
      sender,
      content,
      contentBlocks,
      attachments,
      timestamp,
      ...(typeof record.turnCompletedAt === 'number' && Number.isFinite(record.turnCompletedAt)
        ? { turnCompletedAt: record.turnCompletedAt }
        : {}),
      sequence: typeof record.sequence === 'number' ? record.sequence : undefined,
      streamStatus: record.streamStatus === 'streaming' ? 'streaming' : record.streamStatus === 'complete' ? 'complete' : undefined,
      completionReason: record.completionReason === 'stopped' || record.completionReason === 'failed' || record.completionReason === 'incomplete' ? record.completionReason : undefined,
      ...(typeof thinkingDurationMs === 'number' && Number.isFinite(thinkingDurationMs) && thinkingDurationMs >= 0
        ? { thinkingDurationMs }
        : {}),
      type: semanticType,
      taskId,
      turnId,
      sourceIndex,
      isDocument,
      artifactId,
      documentTitle,
      renderHint: renderHint || undefined,
      artifactType,
      taskKind,
      nextAction,
      requiresUserAction: typeof requiresUserActionRaw === 'boolean' ? requiresUserActionRaw : undefined,
      toolName: readOptionalString('tool_name', 'toolName', 'tool'),
      toolStatus,
      toolExitCode: typeof exitCode === 'number' && Number.isInteger(exitCode) ? exitCode : undefined,
      toolDurationMs: typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined,
      toolDetail: readOptionalString('tool_detail', 'toolDetail'),
      toolOutput: readOptionalString('tool_output', 'toolOutput', 'output'),
      toolDiff: readOptionalString('tool_diff', 'toolDiff', 'diff', 'gitDiff', 'git_diff'),
      toolUseId: readOptionalString('tool_use_id', 'toolUseId'),
      toolPatch: readOptionalString('tool_patch', 'toolPatch', 'patch'),
      toolBefore: readOptionalString('tool_before', 'toolBefore', 'before', 'originalFile', 'original_file'),
      // `content` is the persisted display summary for tool events. It is not
      // a file snapshot; real write content arrives as tool_after/after from
      // the canonical adapter payload.
      toolAfter: readOptionalString('tool_after', 'toolAfter', 'after'),
      toolStructuredPatch: structuredPatch,
      toolInput,
      todoScope: readOptionalString('todoScope'),
      sources: normalizeChatSources(record.sources),
      citations: normalizeChatSources(record.citations),
      isSubagentTool: record.isSubagentTool === true || record.is_subagent_tool === true,
      subagentPrompt: readOptionalString('subagentPrompt', 'subagent_prompt'),
      subagentOutput: readOptionalString('subagentOutput', 'subagent_output'),
      subagentTrace: readOptionalString('subagentTrace', 'subagent_trace'),
      subagentActivity: readSubagentActivity(record.subagentActivity ?? record.subagent_activity),
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
    if (a.sequence !== undefined && b.sequence !== undefined) return a.sequence - b.sequence;
    if (a.turnId && a.turnId === b.turnId) return (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0);
    return a.id.localeCompare(b.id);
  });
};
