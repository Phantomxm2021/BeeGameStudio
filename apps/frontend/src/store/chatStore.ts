import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AssistantContentBlock, Message, MessageType } from '../types/message';
import {
  getSupabaseSessionUser,
  isHttpOnlySessionsEnabled,
} from '../services/supabaseAuthApi';
import { buildMessageDedupeKey } from '../utils/chatHistory';
import { settleChatActivity } from '../utils/chatActivity';
import { mergeSubagentActivity } from '@bee-game-studio/agent-workflow/subagent-activity';

function hasCloudSession(): boolean {
  return isHttpOnlySessionsEnabled() || Boolean(getSupabaseSessionUser()?.id?.trim());
}

interface ChatMessageSemantic {
  clientMessageId?: string;
  supersedesMessageId?: string;
  rewindAvailable?: boolean;
  attachments?: Message['attachments'];
  contentMode?: 'delta' | 'snapshot';
  sequence?: number;
  turnId?: Message['turnId'];
  contentBlocks?: AssistantContentBlock[];
  renderHint?: Message['renderHint'];
  artifactType?: string;
  taskKind?: string;
  nextAction?: string;
  requiresUserAction?: boolean;
  subagentPrompt?: string;
  subagentOutput?: string;
  subagentTrace?: string;
  subagentActivity?: Message['subagentActivity'];
  sources?: Message['sources'];
  citations?: Message['citations'];
  thinkingDurationMs?: number;
}

interface ChatState {
  messages: Message[];
  messageIndexMap: Record<string, number>;
  lastStreamingIdByTask: Record<string, string>;
  currentSender: string | null;
  streamingMessageId: string | null;
  isStreaming: boolean;
  expandedDocuments: Set<string>;

  addMessage: (message: Message) => void;
  updateMessage: (
    taskId: string,
    content: string,
    sender: string,
    type?: MessageType,
    isDocument?: boolean,
    artifactId?: string,
    documentTitle?: string,
    semantic?: ChatMessageSemantic,
    timestamp?: number,
    messageId?: string
  ) => void;
  updateThought: (taskId: string, thought: string, sender: string, timestamp?: number, messageId?: string, turnId?: string, contentMode?: 'delta' | 'snapshot', sequence?: number) => void;
  removeMessage: (messageId: string) => void;
  finalizeMessage: (
    taskId: string,
    content: string,
    sender: string,
    type?: MessageType,
    isDocument?: boolean,
    artifactId?: string,
    documentTitle?: string,
    semantic?: ChatMessageSemantic,
    timestamp?: number,
    messageId?: string
  ) => void;
  setCurrentSender: (sender: string | null) => void;
  setIsStreaming: (isStreaming: boolean) => void;
  settleActivity: (taskId: string, turnId: string | undefined, reason: 'stopped' | 'failed' | 'incomplete', at: number, completedAt?: number) => void;
  clearMessages: () => void;
  loadHistory: (messages: Message[]) => void;
  setDocumentExpanded: (messageId: string, expanded: boolean) => void;
  isDocumentExpanded: (messageId: string) => boolean;
}

function rebuildIndexMap(messages: Message[]): Record<string, number> {
  const map: Record<string, number> = {};
  messages.forEach((msg, idx) => {
    map[msg.id] = idx;
  });
  return map;
}

function withDerivedIdentity(message: Message): Message {
  const taskId = message.taskId;
  const dedupeKey = message.dedupeKey || buildMessageDedupeKey({
    taskId,
    sender: message.sender,
    content: message.content,
    messageType: message.type,
    artifactId: message.artifactId,
  });
  const messageId = message.messageId || (message.id.startsWith('streaming-') ? undefined : message.id);
  const id = messageId || message.clientMessageId || message.id || `msg-${dedupeKey}-${message.timestamp}`;
  return {
    ...message,
    id,
    messageId,
    dedupeKey,
  };
}

function findMessageIndex(messages: Message[], candidate: Message): number {
  if (candidate.messageId) {
    const index = messages.findIndex((msg) => msg.messageId === candidate.messageId || msg.id === candidate.messageId);
    if (index !== -1) return index;
  }
  if (candidate.clientMessageId) {
    const index = messages.findIndex((msg) => msg.clientMessageId === candidate.clientMessageId || msg.id === candidate.clientMessageId);
    if (index !== -1) return index;
  }
  // Distinct persisted/client identities are distinct requests, even when the
  // user repeats text or sends several image-only messages with empty text.
  if (candidate.messageId || candidate.clientMessageId) return -1;
  if (candidate.dedupeKey) {
    const index = messages.findIndex((msg) => msg.dedupeKey === candidate.dedupeKey);
    if (index !== -1) return index;
  }
  return -1;
}

function mergeMessages(existing: Message, incoming: Message): Message {
  const isCompaction = existing.taskKind === 'context_compaction' || incoming.taskKind === 'context_compaction';
  const olderStreamCannotReopen = existing.streamStatus === 'complete' && incoming.streamStatus === 'streaming';
  const incomingOlder = incoming.sequence !== undefined && existing.sequence !== undefined
    ? incoming.sequence < existing.sequence : incoming.timestamp < existing.timestamp;
  const keepSubagentOutcome = existing.isSubagentTool && (incomingOlder ||
    existing.toolStatus !== undefined && existing.toolStatus !== 'running' && incoming.toolStatus === 'running');
  return withDerivedIdentity({
    ...existing,
    ...incoming,
    id: incoming.messageId || incoming.clientMessageId || existing.id,
    content: olderStreamCannotReopen ? existing.content : incoming.content || existing.content,
    streamStatus: olderStreamCannotReopen ? existing.streamStatus : incoming.streamStatus ?? existing.streamStatus,
    attachments: incoming.attachments || existing.attachments,
    thought: incoming.thought ?? existing.thought,
    toolStatus: keepSubagentOutcome ? existing.toolStatus : incoming.toolStatus ?? existing.toolStatus,
    toolOutput: keepSubagentOutcome ? existing.toolOutput : incoming.toolOutput ?? existing.toolOutput,
    completionReason: keepSubagentOutcome ? existing.completionReason : Object.prototype.hasOwnProperty.call(incoming, 'completionReason') ||
      (incoming.toolStatus && incoming.toolStatus !== 'running')
      ? incoming.completionReason : incoming.completionReason ?? existing.completionReason,
    thinkingDurationMs: incoming.thinkingDurationMs ?? existing.thinkingDurationMs,
    turnCompletedAt: incoming.turnCompletedAt ?? existing.turnCompletedAt,
    subagentPrompt: incoming.subagentPrompt ?? existing.subagentPrompt,
    subagentOutput: keepSubagentOutcome ? existing.subagentOutput : incoming.subagentOutput ?? existing.subagentOutput,
    subagentTrace: incoming.subagentTrace ?? existing.subagentTrace,
    subagentActivity: mergeSubagentActivity(existing.subagentActivity, incoming.subagentActivity, incomingOlder),
    timestamp: isCompaction ? Math.min(existing.timestamp, incoming.timestamp) : existing.timestamp || incoming.timestamp,
    sequence: isCompaction && existing.sequence !== undefined && incoming.sequence !== undefined
      ? Math.min(existing.sequence, incoming.sequence) : existing.sequence ?? incoming.sequence,
    type: incoming.type || existing.type,
    isDocument: incoming.isDocument !== undefined ? incoming.isDocument : existing.isDocument,
    artifactId: incoming.artifactId || existing.artifactId,
    documentTitle: incoming.documentTitle || existing.documentTitle,
    renderHint: incoming.renderHint || existing.renderHint,
    artifactType: incoming.artifactType || existing.artifactType,
    taskKind: incoming.taskKind || existing.taskKind,
    nextAction: incoming.nextAction || existing.nextAction,
    requiresUserAction: incoming.requiresUserAction ?? existing.requiresUserAction,
    messageId: incoming.messageId || existing.messageId,
    clientMessageId: incoming.clientMessageId || existing.clientMessageId,
    dedupeKey: incoming.dedupeKey || existing.dedupeKey,
  });
}

function upsertMessage(messages: Message[], candidate: Message): Message[] {
  const normalized = withDerivedIdentity(candidate);
  const index = findMessageIndex(messages, normalized);
  if (index === -1) {
    return [...messages, normalized];
  }
  const updated = [...messages];
  updated[index] = mergeMessages(updated[index], normalized);
  return updated;
}

function reconcileHistory(current: Message[], incoming: Message[]): Message[] {
  const merged = [...current];
  const positions = new Map<string, number>();
  const remember = (message: Message, index: number) => {
    for (const key of [message.id, message.messageId, message.clientMessageId]) {
      if (key) positions.set(key, index);
    }
  };
  current.forEach(remember);
  for (const message of incoming) {
    const normalized = withDerivedIdentity(message);
    let index = normalized.messageId ? positions.get(normalized.messageId) : undefined;
    if (index === undefined && normalized.clientMessageId) index = positions.get(normalized.clientMessageId);
    if (index === undefined && !normalized.messageId && !normalized.clientMessageId) {
      const found = findMessageIndex(merged, normalized);
      if (found >= 0) index = found;
    }
    if (index === undefined) {
      index = merged.length;
      merged.push(normalized);
    } else merged[index] = mergeMessages(merged[index], normalized);
    remember(merged[index], index);
  }
  return merged.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    if (a.sequence !== undefined && b.sequence !== undefined) return a.sequence - b.sequence;
    if (a.turnId && a.turnId === b.turnId) {
      return (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0);
    }
    return a.id.localeCompare(b.id);
  });
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      messageIndexMap: {},
      lastStreamingIdByTask: {},
      currentSender: null,
      streamingMessageId: null,
      isStreaming: false,
      expandedDocuments: new Set<string>(),

      addMessage: (message) =>
        set((state) => {
          const messages = upsertMessage(state.messages, message);
          return {
            messages,
            messageIndexMap: rebuildIndexMap(messages),
          };
        }),

      updateMessage: (taskId, content, sender, type, isDocument, artifactId, documentTitle, semantic, timestamp, messageId) =>
        set((state) => {
          const key = `${taskId || 'na'}_${sender}`;
          const existingId = messageId || state.lastStreamingIdByTask[key];
          const existingIndex = existingId ? state.messageIndexMap[existingId] : -1;
          const now = timestamp || Date.now();

          if (existingIndex !== -1 && existingIndex < state.messages.length) {
            const existing = state.messages[existingIndex];
            if (existing.streamStatus === 'complete') return state;
            const updatedMessages = [...state.messages];
            updatedMessages[existingIndex] = mergeMessages(existing, {
              ...existing,
              messageId: messageId || existing.messageId,
              id: messageId || existing.id,
              content: semantic?.contentMode === 'snapshot' ? content : `${existing.content}${content}`,
              timestamp: existing.timestamp,
              streamStatus: 'streaming',
              type: type || existing.type || 'text',
              isDocument: isDocument !== undefined ? isDocument : existing.isDocument,
              artifactId: artifactId || existing.artifactId,
              documentTitle: documentTitle || existing.documentTitle,
              renderHint: semantic?.renderHint || existing.renderHint,
              artifactType: semantic?.artifactType || existing.artifactType,
              taskKind: semantic?.taskKind || existing.taskKind,
              turnId: semantic?.turnId || existing.turnId,
              contentBlocks: semantic?.contentBlocks || existing.contentBlocks,
              nextAction: semantic?.nextAction || existing.nextAction,
              requiresUserAction: semantic?.requiresUserAction ?? existing.requiresUserAction,
              subagentPrompt: semantic?.subagentPrompt || existing.subagentPrompt,
              subagentOutput: semantic?.subagentOutput || existing.subagentOutput,
              subagentTrace: semantic?.subagentTrace || existing.subagentTrace,
              subagentActivity: semantic?.subagentActivity ?? existing.subagentActivity,
              sources: semantic?.sources || existing.sources,
              citations: semantic?.citations || existing.citations,
            });
            return {
              messages: updatedMessages,
              messageIndexMap: rebuildIndexMap(updatedMessages),
              streamingMessageId: updatedMessages[existingIndex].id,
              isStreaming: true,
            };
          }

          const fallbackId = messageId || `streaming-${taskId || 'na'}-${sender}`;
          const nextMessages = upsertMessage(state.messages, {
            id: fallbackId,
            messageId,
            sender,
            content,
            taskId,
            timestamp: now,
            streamStatus: 'streaming',
            sequence: semantic?.sequence,
            type: type || 'text',
            isDocument,
            artifactId,
            documentTitle,
            renderHint: semantic?.renderHint,
            artifactType: semantic?.artifactType,
            taskKind: semantic?.taskKind,
              turnId: semantic?.turnId,
              contentBlocks: semantic?.contentBlocks,
              nextAction: semantic?.nextAction,
            requiresUserAction: semantic?.requiresUserAction,
            subagentPrompt: semantic?.subagentPrompt,
            subagentOutput: semantic?.subagentOutput,
            subagentTrace: semantic?.subagentTrace,
            subagentActivity: semantic?.subagentActivity,
            sources: semantic?.sources,
            citations: semantic?.citations,
            thinkingDurationMs: semantic?.thinkingDurationMs,
          });
          const finalId = messageId || fallbackId;
          return {
            messages: nextMessages,
            messageIndexMap: rebuildIndexMap(nextMessages),
            lastStreamingIdByTask: {
              ...state.lastStreamingIdByTask,
              [key]: finalId,
            },
            streamingMessageId: finalId,
            isStreaming: true,
          };
        }),

      updateThought: (taskId, thought, sender, timestamp, messageId, turnId, contentMode, sequence) =>
        set((state) => {
          const key = `${taskId || 'na'}_${sender}`;
          // Thinking is an independent streamed block. It must never reuse the
          // current prose message merely because both came from one agent.
          const existingId = messageId || state.lastStreamingIdByTask[key];
          const existingIndex = existingId ? state.messageIndexMap[existingId] : -1;
          const now = timestamp || Date.now();

          if (existingIndex !== -1 && existingIndex < state.messages.length) {
            const existing = state.messages[existingIndex];
            if (existing.streamStatus === 'complete') return state;
            const updatedMessages = [...state.messages];
              updatedMessages[existingIndex] = mergeMessages(existing, {
              ...existing,
              messageId: messageId || existing.messageId,
              id: messageId || existing.id,
              thought: contentMode === 'snapshot' ? thought : `${existing.thought || ''}${thought}`,
              sequence: existing.sequence ?? sequence,
              streamStatus: 'streaming',
              turnId: turnId || existing.turnId,
              timestamp: existing.timestamp,
            });
            return {
              messages: updatedMessages,
              messageIndexMap: rebuildIndexMap(updatedMessages),
              streamingMessageId: updatedMessages[existingIndex].id,
              isStreaming: true,
            };
          }

          const fallbackId = messageId || `streaming-${taskId || 'na'}-${sender}`;
          const nextMessages = upsertMessage(state.messages, {
            id: fallbackId,
            messageId,
            sender,
            content: '',
            thought,
            streamStatus: 'streaming',
            sequence,
            type: 'thought',
            taskKind: 'assistant_thinking',
            turnId,
            taskId,
            timestamp: now,
          });
          return {
            messages: nextMessages,
            messageIndexMap: rebuildIndexMap(nextMessages),
            lastStreamingIdByTask: state.lastStreamingIdByTask,
            streamingMessageId: messageId || fallbackId,
            isStreaming: true,
          };
        }),

      removeMessage: (messageId) =>
        set((state) => {
          const messages = state.messages.filter((message) => message.id !== messageId && message.messageId !== messageId);
          if (messages.length === state.messages.length) return state;
          const lastStreamingIdByTask = Object.fromEntries(
            Object.entries(state.lastStreamingIdByTask).filter(([, id]) => id !== messageId),
          );
          return {
            messages,
            messageIndexMap: rebuildIndexMap(messages),
            lastStreamingIdByTask,
            streamingMessageId: state.streamingMessageId === messageId ? null : state.streamingMessageId,
          };
        }),

      finalizeMessage: (taskId, content, sender, type, isDocument, artifactId, documentTitle, semantic, timestamp, messageId) =>
        set((state) => {
          const key = `${taskId || 'na'}_${sender}`;
          const nextMessages = upsertMessage(state.messages, {
            id: messageId || `agent-${taskId || 'na'}-${sender}`,
            messageId,
            sender,
            content,
            taskId,
            timestamp: timestamp || Date.now(),
            type: type || 'text',
            isDocument,
            artifactId,
            documentTitle,
            attachments: semantic?.attachments,
            clientMessageId: semantic?.clientMessageId,
            supersedesMessageId: semantic?.supersedesMessageId,
            rewindAvailable: semantic?.rewindAvailable,
            renderHint: semantic?.renderHint,
            artifactType: semantic?.artifactType,
            taskKind: semantic?.taskKind,
            turnId: semantic?.turnId,
            nextAction: semantic?.nextAction,
            requiresUserAction: semantic?.requiresUserAction,
            subagentPrompt: semantic?.subagentPrompt,
            subagentOutput: semantic?.subagentOutput,
            subagentTrace: semantic?.subagentTrace,
            subagentActivity: semantic?.subagentActivity,
            sources: semantic?.sources,
            citations: semantic?.citations,
            thinkingDurationMs: semantic?.thinkingDurationMs,
            streamStatus: 'complete',
            completionReason: undefined,
            sequence: semantic?.sequence,
          });
          const newStreamingMap = { ...state.lastStreamingIdByTask };
          if (!messageId || newStreamingMap[key] === messageId) delete newStreamingMap[key];
          const stillStreaming = nextMessages.filter(message => message.streamStatus === 'streaming');
          return {
            messages: nextMessages,
            messageIndexMap: rebuildIndexMap(nextMessages),
            lastStreamingIdByTask: newStreamingMap,
            streamingMessageId: stillStreaming.at(-1)?.id ?? null,
            isStreaming: stillStreaming.length > 0,
          };
        }),

      setCurrentSender: (sender) => set({ currentSender: sender }),
      settleActivity: (taskId, turnId, reason, at, completedAt) => set(state => {
        const messages = settleChatActivity(state.messages, { taskId, turnId, reason, at, completedAt });
        const streaming = messages.filter(message => message.streamStatus === 'streaming');
        const ids = new Set(streaming.map(message => message.id));
        return { messages, streamingMessageId: streaming.at(-1)?.id ?? null, isStreaming: streaming.length > 0,
          lastStreamingIdByTask: Object.fromEntries(Object.entries(state.lastStreamingIdByTask).filter(([, id]) => ids.has(id))) };
      }),
      setIsStreaming: (isStreaming) => set({ isStreaming }),
      clearMessages: () => set({
        messages: [],
        messageIndexMap: {},
        lastStreamingIdByTask: {},
        currentSender: null,
        streamingMessageId: null,
        isStreaming: false,
        expandedDocuments: new Set<string>(),
      }),

      loadHistory: (messages) => set((state) => {
        const reconciled = reconcileHistory(state.messages, messages);
        return {
          messages: reconciled,
          messageIndexMap: rebuildIndexMap(reconciled),
          lastStreamingIdByTask: state.isStreaming ? state.lastStreamingIdByTask : {},
          currentSender: state.isStreaming ? state.currentSender : null,
          streamingMessageId: state.isStreaming ? state.streamingMessageId : null,
          isStreaming: state.isStreaming,
        };
      }),

      setDocumentExpanded: (messageId, expanded) => set((state) => {
        const nextExpanded = new Set(state.expandedDocuments);
        if (expanded) nextExpanded.add(messageId);
        else nextExpanded.delete(messageId);
        return { expandedDocuments: nextExpanded };
      }),

      isDocumentExpanded: (messageId) => get().expandedDocuments.has(messageId),

    }),
    {
      name: 'chat-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        messages: hasCloudSession() ? [] : state.messages,
        expandedDocuments: Array.from(state.expandedDocuments),
      }),
      onRehydrateStorage: () => (state: ChatState | undefined, error: Error | unknown) => {
        if (error) {
          localStorage.removeItem('chat-storage');
          return;
        }
        if (state) {
          state.messages = hasCloudSession()
            ? []
            : Array.isArray(state.messages) ? state.messages.map(withDerivedIdentity) : [];
          state.messageIndexMap = rebuildIndexMap(state.messages);
          state.lastStreamingIdByTask = {};
          state.expandedDocuments = new Set(Array.isArray(state.expandedDocuments) ? state.expandedDocuments : []);
        }
      },
    }
  )
);
