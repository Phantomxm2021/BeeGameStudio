import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Message, MessageType } from '../types/message';
import { getSupabaseAccessToken } from '../services/supabaseAuthApi';
import { buildMessageDedupeKey } from '../utils/chatHistory';

function detectCorruption(content: string): boolean {
  if (!content || typeof content !== 'string') {
    return true;
  }

  const corruptionPatterns = [
    /\\[`*_[\]()]/g,
    /\|\|+/,
    /```[^`]*$/,
    /\s{10,}/,
    // eslint-disable-next-line no-control-regex
    /[\x00-\x08\x0B-\x0C\x0E-\x1F]/,
  ];

  return corruptionPatterns.some((pattern) => pattern.test(content));
}

const MAX_MESSAGES = 500;

function hasCloudSession(): boolean {
  return Boolean(getSupabaseAccessToken());
}

interface ChatMessageSemantic {
  renderHint?: Message['renderHint'];
  artifactType?: string;
  taskKind?: string;
  nextAction?: string;
  requiresUserAction?: boolean;
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
  updateThought: (taskId: string, thought: string, sender: string, timestamp?: number, messageId?: string) => void;
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
  clearMessages: () => void;
  loadHistory: (messages: Message[]) => void;
  setDocumentExpanded: (messageId: string, expanded: boolean) => void;
  isDocumentExpanded: (messageId: string) => boolean;
  retryRenderMessage: (messageId: string) => void;
  markMessageAsCorrupted: (messageId: string) => void;
}

function rebuildIndexMap(messages: Message[]): Record<string, number> {
  const map: Record<string, number> = {};
  messages.forEach((msg, idx) => {
    map[msg.id] = idx;
  });
  return map;
}

function limitMessages(messages: Message[]): Message[] {
  if (messages.length <= MAX_MESSAGES) return messages;
  return messages.slice(messages.length - MAX_MESSAGES);
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
    return -1;
  }
  if (candidate.clientMessageId) {
    const index = messages.findIndex((msg) => msg.clientMessageId === candidate.clientMessageId || msg.id === candidate.clientMessageId);
    if (index !== -1) return index;
    return -1;
  }
  if (candidate.dedupeKey) {
    const index = messages.findIndex((msg) => msg.dedupeKey === candidate.dedupeKey);
    if (index !== -1) return index;
  }
  if (candidate.sender === 'user') {
    const normalizedContent = candidate.content.trim().replace(/\s+/g, ' ');
    return messages.findIndex((msg) => (
      msg.sender === 'user' &&
      msg.content.trim().replace(/\s+/g, ' ') === normalizedContent
    ));
  }
  return -1;
}

function mergeMessages(existing: Message, incoming: Message): Message {
  return withDerivedIdentity({
    ...existing,
    ...incoming,
    id: incoming.messageId || incoming.clientMessageId || existing.id,
    content: incoming.content || existing.content,
    thought: incoming.thought ?? existing.thought,
    timestamp: incoming.timestamp || existing.timestamp,
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
    return limitMessages([...messages, normalized]);
  }
  const updated = [...messages];
  updated[index] = mergeMessages(updated[index], normalized);
  return limitMessages(updated);
}

function reconcileHistory(current: Message[], incoming: Message[]): Message[] {
  let merged = [...current.filter((msg) => !!msg.clientMessageId && !msg.messageId)];
  for (const message of incoming) {
    merged = upsertMessage(merged, message);
  }
  return merged.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
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
          const existingId = state.lastStreamingIdByTask[key];
          const existingIndex = existingId ? state.messageIndexMap[existingId] : -1;
          const now = timestamp || Date.now();

          if (existingIndex !== -1 && existingIndex < state.messages.length) {
            const existing = state.messages[existingIndex];
            const updatedMessages = [...state.messages];
            updatedMessages[existingIndex] = mergeMessages(existing, {
              ...existing,
              messageId: messageId || existing.messageId,
              id: messageId || existing.id,
              content: `${existing.content}${content}`,
              timestamp: now,
              type: type || existing.type || 'text',
              isDocument: isDocument !== undefined ? isDocument : existing.isDocument,
              artifactId: artifactId || existing.artifactId,
              documentTitle: documentTitle || existing.documentTitle,
              renderHint: semantic?.renderHint || existing.renderHint,
              artifactType: semantic?.artifactType || existing.artifactType,
              taskKind: semantic?.taskKind || existing.taskKind,
              nextAction: semantic?.nextAction || existing.nextAction,
              requiresUserAction: semantic?.requiresUserAction ?? existing.requiresUserAction,
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
            type: type || 'text',
            isDocument,
            artifactId,
            documentTitle,
            renderHint: semantic?.renderHint,
            artifactType: semantic?.artifactType,
            taskKind: semantic?.taskKind,
            nextAction: semantic?.nextAction,
            requiresUserAction: semantic?.requiresUserAction,
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

      updateThought: (taskId, thought, sender, timestamp, messageId) =>
        set((state) => {
          const key = `${taskId || 'na'}_${sender}`;
          const existingId = state.lastStreamingIdByTask[key];
          const existingIndex = existingId ? state.messageIndexMap[existingId] : -1;
          const now = timestamp || Date.now();

          if (existingIndex !== -1 && existingIndex < state.messages.length) {
            const existing = state.messages[existingIndex];
            const updatedMessages = [...state.messages];
            updatedMessages[existingIndex] = mergeMessages(existing, {
              ...existing,
              messageId: messageId || existing.messageId,
              id: messageId || existing.id,
              thought: `${existing.thought || ''}${thought}`,
              timestamp: now,
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
            taskId,
            timestamp: now,
          });
          return {
            messages: nextMessages,
            messageIndexMap: rebuildIndexMap(nextMessages),
            lastStreamingIdByTask: {
              ...state.lastStreamingIdByTask,
              [key]: messageId || fallbackId,
            },
            streamingMessageId: messageId || fallbackId,
            isStreaming: true,
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
            renderHint: semantic?.renderHint,
            artifactType: semantic?.artifactType,
            taskKind: semantic?.taskKind,
            nextAction: semantic?.nextAction,
            requiresUserAction: semantic?.requiresUserAction,
          });
          const newStreamingMap = { ...state.lastStreamingIdByTask };
          delete newStreamingMap[key];
          return {
            messages: nextMessages,
            messageIndexMap: rebuildIndexMap(nextMessages),
            lastStreamingIdByTask: newStreamingMap,
            streamingMessageId: null,
            isStreaming: false,
          };
        }),

      setCurrentSender: (sender) => set({ currentSender: sender }),
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

      retryRenderMessage: (messageId) => set((state) => {
        const index = state.messageIndexMap[messageId];
        if (index === undefined || index === -1) return state;
        const updatedMessages = [...state.messages];
        updatedMessages[index] = {
          ...updatedMessages[index],
          renderingError: false,
          lastRenderAttempt: Date.now(),
          renderAttempts: (updatedMessages[index].renderAttempts || 0) + 1,
        };
        return { messages: updatedMessages };
      }),

      markMessageAsCorrupted: (messageId) => set((state) => {
        const index = state.messageIndexMap[messageId];
        if (index === undefined || index === -1) return state;
        const updatedMessages = [...state.messages];
        updatedMessages[index] = {
          ...updatedMessages[index],
          corruptionDetected: detectCorruption(updatedMessages[index].content),
          renderingError: true,
          lastRenderAttempt: Date.now(),
        };
        return { messages: updatedMessages };
      }),
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
