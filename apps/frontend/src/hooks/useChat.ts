/**
 * useChat Hook
 * 
 * Manages chat functionality including:
 * - WebSocket message routing and processing
 * - Message type handling (token, status, tool_start, tool_end, usage, error_paused)
 * - Chat operations (sendMessage, continueTask, stopTask)
 * - Loading state management
 * 
 * Requirements: 1.1, 1.2, 1.3, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from './useWebSocket';
import { useChatStore } from '../store/chatStore';
import { useProjectStore } from '../store/projectStore';
import { useSystemStore, type ProjectTask } from '../store/systemStore';
import { api, normalizeApprovePlanPayload, normalizeReviewBindingPayload, type ChatAttachmentPayload, type ReviewBindingPayload } from '../services/api';
import type { ContinueTaskResponse, SendMessageResponse } from '../services/api';
import type { WebSocketMessage } from '../types/message';
import type { WebSocketState } from './useWebSocket';
import { normalizeChatHistory } from '../utils/chatHistory';
import { normalizeWebSocketSemanticType } from '../utils/messageSemantics';
import { getWaitingApprovalState } from '../utils/waitingApproval';
import { isBeeGameAdapterEnabled } from '../services/beeGameAdapter';
import {
  getCreditQuote,
  type BeeGameCreditQuote,
  type BeeGameCreditTaskType,
} from '../services/creditsApi';

const newClientMessageId = (): string => `client-msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const ACTIVE_TASK_STATUSES = new Set(['queued', 'running', 'resuming']);

function getErrorDisplayMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message || fallback;
  }
  if (typeof error === 'string') {
    const message = error.trim();
    return message || fallback;
  }
  return fallback;
}

function findActiveTask(tasks: ProjectTask[]): ProjectTask | undefined {
  return tasks.find(task => [task.lifecycle_status, task.task_status, task.status].some(status => (
    typeof status === 'string' && ACTIVE_TASK_STATUSES.has(status)
  )));
}

function isProjectStatusRunning(status: unknown): boolean {
  return Boolean(
    status &&
    typeof status === 'object' &&
    'phase' in status &&
    (status as { phase?: unknown }).phase === 'running'
  );
}

/**
 * Options for useChat hook
 */
export interface UseChatOptions {
  /** Project ID for the chat session */
  projectId: string;

  /** Callback when an error occurs (optional) */
  onError?: (error: Error) => void;

  /** Callback when a task completes (optional) */
  onTaskComplete?: () => void;

  /** Callback when ANY task event occurs (usage, status, tool, etc.) (optional) */
  onTaskEvent?: (type: string, data?: any) => void;

  /** Toast notification callbacks (optional) */

  showToastError?: (message: string) => void;
  showToastSuccess?: (message: string) => void;
  confirmCreditQuote?: (quote: BeeGameCreditQuote) => Promise<boolean>;
}

/**
 * Return type for useChat hook
 */
export interface UseChatReturn {
  /**
   * Send a message to the backend
   * @param content - The message content to send
   */
  sendMessage: (
    content: string,
    terminationNode?: string,
    attachments?: ChatAttachmentPayload[],
    supersedesMessageId?: string,
  ) => Promise<void>;

  /**
   * Continue a paused task
   */
  continueTask: () => Promise<void>;

  /**
   * Stop the current task
   */
  stopTask: () => Promise<void>;

  /** Whether a stop request is awaiting backend confirmation */
  isStopping: boolean;

  /**
   * Approve the current plan
   * @param feedback - Optional user feedback
   */
  approvePlan: (
    review: { gate_id: string; artifact_id?: string; artifact_version?: number; checkpoint_id?: string; commit_sha?: string; workspace_path?: string; workspace_ref?: string; binding?: ReviewBindingPayload },
    feedback?: string,
    action?: 'approve' | 'revise' | 'reject'
  ) => Promise<void>;

  /**
   * Upload and optionally auto-approve a revised manifest CSV
   * @param gateId - The asset gate ID to upload for
   * @param csvContent - The raw CSV content
   * @param autoApprove - Whether to automatically approve after uploading
   */
  uploadManifestCsv: (gateId: string, csvContent: string, autoApprove?: boolean) => Promise<void>;

  /**
   * Approve a manifest gate
   * @param gateId - The asset gate ID to approve
   * @param feedback - Optional feedback
   */
  approveManifest: (review: ReviewBindingPayload & { gate_id: string }, feedback?: string) => Promise<void>;

  /**
   * Revise a manifest gate
   * @param gateId - The asset gate ID to request revision for
   * @param feedback - Required feedback indicating what needs to change
   */
  reviseManifest: (gateId: string, feedback: string) => Promise<void>;

  /** Local state for plan approval / revision submission UX */
  approvalState: {
    gateId: string | null;
    action: 'approve' | 'revise' | 'reject' | null;
    phase: 'idle' | 'submitting' | 'awaiting_runtime' | 'failed';
    message: string;
  };

  /** Whether a task is currently being processed */

  isLoading: boolean;

  /** Current task ID (if any) */
  currentTaskId: string | null;

  /** Whether the task is paused and can be continued */
  canContinue: boolean;

  /** WebSocket connection state */
  wsState: WebSocketState;
}

/**
 * Custom hook for managing chat functionality
 * 
 * This hook integrates WebSocket communication, message routing,
 * and chat operations (send, continue, stop) into a single interface.
 * 
 * @param options - Configuration options for the chat
 * @returns Chat operations and state
 * 
 * @example
 * ```typescript
 * const { sendMessage, continueTask, stopTask, isLoading } = useChat({
 *   projectId: 'project-123',
 *   onError: (error) => {
 *     console.error('Chat error:', error);
 *   }
 * });
 * 
 * // Send a message
 * await sendMessage('Hello, AI team!');
 * 
 * // Continue after error_paused
 * await continueTask();
 * 
 * // Stop current task
 * await stopTask();
 * ```
 */
export const useChat = ({
  projectId,
  onError,
  onTaskComplete,
  onTaskEvent,
  showToastError,
  showToastSuccess,
  confirmCreditQuote,
}: UseChatOptions): UseChatReturn => {
  // State management
  const [isLoading, setIsLoading] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const isStoppingRef = useRef(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [canContinue, setCanContinue] = useState(false);
  const [approvalState, setApprovalState] = useState<UseChatReturn['approvalState']>({
    gateId: null,
    action: null,
    phase: 'idle',
    message: '',
  });

  // Store actions
  const { addMessage, updateMessage, updateThought, removeMessage, finalizeMessage, setCurrentSender, setIsStreaming, loadHistory } = useChatStore();
  const pendingReviews = useProjectStore((state) => state.pendingReviews);
  const projectStatus = useProjectStore((state) => state.projectStatus);
  const removePendingReview = useProjectStore((state) => state.removePendingReview);
  const upsertPendingReview = useProjectStore((state) => state.upsertPendingReview);
  const { updateTokenUsage, updateLastP2PRoute, loadTasks, loadActivities, loadPhases, loadAgents, loadTokenUsage, loadCurrentUser, setAgentStatus, refreshAgents, setIsSyncing } = useSystemStore();
  const waitingApproval = getWaitingApprovalState(projectStatus, pendingReviews);

  useEffect(() => {
    if (!approvalState.gateId) {
      return;
    }
    const gateStillPresent = pendingReviews.some((review) => String(review?.gate_id || '').trim() === String(approvalState.gateId || '').trim());
    if (!gateStillPresent && approvalState.phase !== 'failed') {
      setApprovalState({
        gateId: null,
        action: null,
        phase: 'idle',
        message: '',
      });
    }
  }, [approvalState, pendingReviews]);

  const refreshProjectVisibility = useCallback(async () => {
    if (useSystemStore.getState().authenticationStatus !== 'authenticated') return;
    const store = useProjectStore.getState();
    await store.loadProjectRuntimeState(projectId);
  }, [projectId]);

  const emitWaitingApprovalBlock = useCallback((message: string) => {
    setIsLoading(false);
    setCanContinue(false);
    addMessage({
      id: `waiting-approval-${Date.now()}`,
      sender: 'system',
      content: message,
      timestamp: Date.now(),
      type: 'error',
      taskKind: 'approval_gate',
      requiresUserAction: true,
    });
    showToastError?.(message);
    onError?.(new Error(message));
  }, [addMessage, onError, showToastError]);


  // Use refs to avoid handleWebSocketMessage dependency churn and WebSocket reconnections
  const latestRefs = useRef({
    projectId,
    onError,
    onTaskComplete,
    onTaskEvent,
    showToastError,
    showToastSuccess,
    approvalState,
    loadPhases,
    loadTasks,
    loadActivities,
    loadTokenUsage,
    loadCurrentUser,
    refreshProjectVisibility,
  });

  // Update refs on every render
  latestRefs.current = {
    projectId,
    onError,
    onTaskComplete,
    onTaskEvent,
    showToastError,
    showToastSuccess,
    approvalState,
    loadPhases,
    loadTasks,
    loadActivities,
    loadTokenUsage,
    loadCurrentUser,
    refreshProjectVisibility,
  };

  /**
   * Handle incoming WebSocket messages
   * Routes messages to appropriate handlers based on type
   * 
   * Requirements: 1.2, 7.1, 7.2
   */
  const handleWebSocketMessage = useCallback((message: WebSocketMessage) => {
    const refs = latestRefs.current;
    console.log('[useChat] Received message:', message.type, 'sender:', message.sender, 'content length:', message.content?.length);

    switch (message.type) {
      case 'token':
        // Streaming token - accumulate content
        // Requirements: 1.3
        if (message.content && message.sender) {
          const semanticType = normalizeWebSocketSemanticType(message);
          updateMessage(
            message.task_id,
            message.content,
            message.sender,
            semanticType,
            message.is_document,
            message.artifact_id,
            message.document_title,
            {
              renderHint: message.render_hint,
              artifactType: message.artifact_type,
              taskKind: message.task_kind,
              nextAction: message.next_action,
              requiresUserAction: message.requires_user_action,
            },
            message.timestamp,
            message.message_id
          );
          setCurrentSender(message.sender);
          // Real-time status injection
          setAgentStatus(message.sender, 'working', message.task_id);
        }
        break;

      case 'agent_message':
        if (message.content && message.sender) {
          const semanticType = normalizeWebSocketSemanticType(message);
          finalizeMessage(
            message.task_id,
            message.content,
            message.sender,
            semanticType,
            message.is_document,
            message.artifact_id,
            message.document_title,
            {
              renderHint: message.render_hint,
              artifactType: message.artifact_type,
              taskKind: message.task_kind,
              nextAction: message.next_action,
              requiresUserAction: message.requires_user_action,
            },
            message.timestamp,
            message.message_id
          );
          setCurrentSender(message.sender);
        }
        break;

      case 'thought':
        // Streaming thought - accumulate reasoning
        if (message.content && message.sender) {
          updateThought(message.task_id, message.content, message.sender, message.timestamp, message.message_id);
          setCurrentSender(message.sender);
          // Real-time status injection
          setAgentStatus(message.sender, 'working', message.task_id);
        }
        break;

      case 'think_start':
        if (message.sender && message.message_id) {
          finalizeMessage(
            message.task_id,
            message.content || 'Thinking',
            message.sender,
            'thought',
            false,
            undefined,
            undefined,
            { taskKind: 'assistant_thinking' },
            message.timestamp,
            message.message_id,
          );
          setCurrentSender(message.sender);
        }
        break;

      case 'think_end':
        if (message.message_id) removeMessage(message.message_id);
        break;

      case 'status':
        // Task status update
        // Requirements: 6.2
        if (message.status === 'finished' || message.status === 'stopped' || message.status === 'idle') {
          setIsLoading(false);
          setCurrentTaskId(null);
          setCurrentSender(null);
          setIsStreaming(false); // Mark streaming as complete
          if (message.status === 'finished') {
            refs.onTaskComplete?.();
          }
          // Trigger event for UI refresh
          refs.onTaskEvent?.(message.status === 'idle' ? 'status_idle' : 'status_finished', message);
          console.log(`[useChat] Task ${message.status}`);

          // Final refresh to clear "working" status of agents
          refreshAgents().catch(err => console.error('[useChat] Status refresh failed:', err));
        } else if (message.status === 'queued' || message.status === 'running' || message.status === 'resuming') {
          setIsLoading(true);
          if (message.sender) {
            setCurrentSender(message.sender);
          }
          refs.onTaskEvent?.('status_running', message);
          console.log(`[useChat] Task ${message.status} started`);
        } else if (message.status === 'paused' || message.status === 'failed') {
          setIsLoading(false);
          if (message.content) {
            addMessage({
              id: `status-${message.status}-${message.task_id || 'na'}-${String(message.content).substring(0, 48)}`,
              sender: 'system',
              content: message.content,
              timestamp: message.timestamp || Date.now(),
              type: message.status === 'paused' ? 'system_status' : 'error',
              taskKind: message.status === 'paused' ? 'workflow_paused' : 'workflow_failed',
              canContinue: message.status === 'paused',
            });
          }
          setApprovalState((prev) => {
            if (message.status !== 'failed' || (prev.phase !== 'awaiting_runtime' && prev.phase !== 'submitting')) {
              return prev;
            }
            return {
              gateId: prev.gateId,
              action: prev.action,
              phase: 'failed',
              message: '审批已提交，但后续阶段启动失败。',
            };
          });
          refs.onTaskEvent?.('status_failed', message);
        }
        break;

      case 'plan_approved':
        // Plan approval event
        // Requirements: 4.4, 7.3
        refs.showToastSuccess?.(message.content || '审批已确认，系统正在继续执行。');
        setApprovalState((prev) => ({
          gateId: prev.gateId,
          action: prev.action,
          phase: 'idle',
          message: message.content || '审批已通过，系统正在继续执行。',
        }));
        refs.onTaskEvent?.('plan_approved', message);
        console.log('[useChat] Plan approved for project:', message.project_id);
        break;

      case 'phase_update':
      case 'pipeline_update':
        // Telemetry phase update
        if (!message.project_id || message.project_id === refs.projectId) {
          // Use refs to avoid re-creating this callback when projectId changes
          refs.loadPhases(refs.projectId).catch(err => console.error('[useChat] Phase refresh failed:', err));
          refs.loadTasks(refs.projectId).catch(err => console.error('[useChat] Task refresh failed:', err));
          refs.refreshProjectVisibility().catch(err => console.error('[useChat] Status visibility refresh failed:', err));
          refs.onTaskEvent?.('phase_update', message);
          console.log('[useChat] Pipeline phase updated:', message.current_phase || message.stage);
        }
        break;

      case 'human_gate':
        setIsLoading(false);
        setCanContinue(false);
      
        refs.onTaskEvent?.('human_gate', message);
        break;

      case 'artifact_created':
        // Real-time artifact event
        // Requirements: System Design §8.9.5
        if (!message.project_id || message.project_id === refs.projectId) {
          const artifactName = message.name || message.artifact_id || 'new artifact';
          addMessage({
            id: `artifact-${message.artifact_id || message.task_id || Date.now()}`,
            sender: message.agent || message.sender || 'system',
            content: `Artifact created: ${artifactName}`,
            timestamp: Date.now(),
            type: 'artifact_card',
            artifactId: message.artifact_id,
            artifactType: message.artifact_type,
            documentTitle: artifactName,
            taskKind: 'artifact_created',
          });
          refs.loadActivities().catch(err => console.error('[useChat] Artifact refresh failed:', err));
          refs.refreshProjectVisibility().catch(err => console.error('[useChat] Artifact visibility refresh failed:', err));
          refs.onTaskEvent?.('artifact_created', message);
          console.log('[useChat] New artifact detected via WebSocket');
        }
        break;

      case 'context_update': {
        const context = message.context;
        if (!context || (message.project_id && message.project_id !== refs.projectId)) {
          break;
        }
        const ragCount = context.rag_sources?.length ?? 0;
        const skillCount = context.selected_skills?.length ?? 0;
        addMessage({
          id: `context-${context.bundle_id || message.task_id || Date.now()}`,
          sender: 'system',
          content: `Context used for ${context.phase || 'phase'}: blackboard ${context.blackboard_record_count ?? 0}, memory ${context.memory_hits ?? 0}, RAG ${ragCount}, skills ${skillCount}.`,
          timestamp: Date.now(),
          type: 'system_status',
          taskKind: 'context_update',
        });
        refs.refreshProjectVisibility().catch(err => console.error('[useChat] Context visibility refresh failed:', err));
        refs.onTaskEvent?.('context_update', message);
        console.debug('[useChat] Context update:', context);
        break;
      }

      case 'error': {
        const errContent = message.content || message.message || message.error || '任务执行出现错误';
        const contextualError =
          refs.approvalState.phase === 'awaiting_runtime' || refs.approvalState.phase === 'submitting'
            ? `审批已提交，但后续执行失败：${errContent}`
            : errContent;
          addMessage({
            id: `error-${message.task_id || 'na'}-${contextualError.substring(0, 32)}`,
            sender: 'system',
            content: contextualError,
            timestamp: Date.now(),
            type: 'error',
            taskKind: 'runtime_error',
            errorDetails: message.error || message.message || message.code
          });
        setIsLoading(false);
        setApprovalState((prev) => {
          if (prev.phase !== 'awaiting_runtime' && prev.phase !== 'submitting') {
            return prev;
          }
          return {
            gateId: prev.gateId,
            action: prev.action,
            phase: 'failed',
            message: contextualError,
          };
        });
        if (message.recoverable) {
          setCanContinue(true);
        }
        refs.showToastError?.(contextualError);
        refs.onError?.(new Error(contextualError));
        refs.onTaskEvent?.('error', message);
        break;
      }

      case 'tool_start':
        // Tool invocation started
        // Requirements: 7.1
        if (message.tool) {
          const toolMessageId = message.message_id || `tool-${message.task_id}-${message.tool_use_id || message.tool}`;
          addMessage({
            id: toolMessageId,
            messageId: toolMessageId,
            sender: 'system',
            content: message.content || `Tool: ${message.tool}\nStatus: running`,
            timestamp: message.timestamp || Date.now(),
            type: 'tool',
            taskKind: 'tool_execution',
            toolName: message.tool,
            toolStatus: message.tool_status || 'running',
            toolDetail: message.tool_detail,
            toolOutput: message.tool_output,
            artifactId: message.artifact_id,
            artifactPath: message.artifact_path,
            isSubagentTool: message.is_subagent_tool,
          });
          refs.onTaskEvent?.('tool_start', message);
          console.log('[useChat] Tool started:', message.tool);
        }
        break;

      case 'tool_end':
        // Tool invocation completed
        // Requirements: 7.2
        if (message.tool) {
          const toolMessageId = message.message_id || `tool-${message.task_id}-${message.tool_use_id || message.tool}`;
          const toolResult = message.result || message.output;
          const outputSummary = toolResult
            ? toolResult.length > 100
              ? `${toolResult.substring(0, 100)}...`
              : toolResult
            : '(无输出)';
          const status = message.error || String(message.output || '').toLowerCase().includes('failed') ? 'failed' : 'completed';

          addMessage({
            id: toolMessageId,
            messageId: toolMessageId,
            sender: 'system',
            content: message.content || `Tool: ${message.tool}\nStatus: ${status}\nOutput: ${outputSummary}`,
            timestamp: message.timestamp || Date.now(),
            type: 'tool',
            taskKind: 'tool_execution',
            toolName: message.tool,
            toolStatus: message.tool_status || status,
            toolDetail: message.tool_detail,
            toolOutput: message.tool_output || outputSummary,
            artifactId: message.artifact_id,
            artifactPath: message.artifact_path,
            isSubagentTool: message.is_subagent_tool,
          });
          refs.onTaskEvent?.('tool_end', message);
          console.log('[useChat] Tool completed:', message.tool);
        }
        break;

      case 'usage':
        // Token usage statistics
        // Requirements: 4.3
        if (message.usage) {
          updateTokenUsage(message.usage, refs.projectId, message.task_id);
          if (!isBeeGameAdapterEnabled()) {
            refs.loadTokenUsage(refs.projectId).catch(err => console.error('[useChat] Token usage refresh failed:', err));
          }
          refs.onTaskEvent?.('usage', message.usage);
          console.log('[useChat] Token usage updated:', message.usage);
        }

        break;

      case 'credit_update':
        refs.loadCurrentUser().catch(err => console.error('[useChat] Credit balance refresh failed:', err));
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('beegame:credits-updated', {
            detail: {
              projectId: message.project_id,
              event: message.credit_event,
              balanceCredits: message.balance_credits,
              credits: message.credits,
            },
          }));
        }
        refs.onTaskEvent?.('credit_update', message);
        break;


      case 'p2p_route':
        // Peer-to-peer routing event
        if (message.data) {
          updateLastP2PRoute(message.data);
          console.log('[useChat] P2P route detected:', message.data);
        }
        break;

      case 'error_paused':
        // Error occurred, task paused
        // Requirements: 6.3
        setIsLoading(false);
        setCanContinue(true);

        addMessage({
          id: `error-paused-${message.task_id}-${message.content?.substring(0, 32)}`,
          sender: 'system',
          content: message.content || '任务遇到错误并已暂停',
          timestamp: Date.now(),
          type: 'error',
          taskKind: 'runtime_error',
          canContinue: true,
          errorDetails: message.error || message.message || message.code
        });

        console.log('[useChat] Task paused due to error:', message.error);
        break;

      case 'project_renamed':
        // Project renamed (AI auto-naming)
        if (message.project_id && message.name) {
          import('../store/projectStore').then(({ useProjectStore }) => {
            useProjectStore.getState().renameProjectLocally(message.project_id!, message.name!);
          });
          console.log('[useChat] Project renamed:', message.project_id, '->', message.name);
        }
        break;

      default:
        console.warn('[useChat] Unknown message type:', (message as unknown as Record<string, unknown>).type);
    }
  }, [addMessage, updateMessage, finalizeMessage, removeMessage, setCurrentSender, updateTokenUsage, setIsStreaming, updateThought, setAgentStatus, refreshAgents, updateLastP2PRoute]);


  /**
   * Synchronize all state with backend after reconnection
   * Requirements: 7.2
   */
  const syncAfterReconnect = useCallback(async () => {
    if (!projectId) return;

    console.log('[useChat] Synchronizing state after reconnection...');
    setIsSyncing(true);

    try {
      const isBeeGame = isBeeGameAdapterEnabled();
      if (!isBeeGame) {
        await loadPhases(projectId);
        await loadTokenUsage(projectId);
        await loadAgents();
      }

      // BeeGame has one server-owned runtime-state snapshot. Do not fan a
      // reconnect out into legacy phase, token, agent and task probes.
      await refreshProjectVisibility();
      const projectStatus = useProjectStore.getState().projectStatus;
      if (isProjectStatusRunning(projectStatus)) {
        setCurrentTaskId(currentTaskId || projectId);
        setIsLoading(true);
        setCanContinue(false);
      }

      if (!isBeeGame) {
        await loadTasks(projectId);
        const activeTask = findActiveTask(useSystemStore.getState().tasks);
        if (activeTask) {
          setCurrentTaskId(activeTask.id);
          setIsLoading(true);
          setCanContinue(false);
        }
        await loadActivities();
      }

      // Sync chat history only after the authoritative runtime state.
      const { isStreaming } = useChatStore.getState();
      if (!isStreaming) {
        const history = await api.getChatHistory(projectId) as unknown;
        const messages = normalizeChatHistory(history);
        const currentMessages = useChatStore.getState().messages;
        if (messages.length > 0 || currentMessages.length === 0) {
          loadHistory(messages);
        }
      }

      console.log('[useChat] Synchronization complete');
    } catch (error) {
      console.error('[useChat] Failed to synchronize state:', error);
    } finally {
      setIsSyncing(false);
    }
  }, [projectId, currentTaskId, loadTasks, loadActivities, loadHistory, loadPhases, loadAgents, loadTokenUsage, setIsSyncing, waitingApproval, emitWaitingApprovalBlock]);



  /**
   * Handle WebSocket errors
   */
  const handleWebSocketError = useCallback((error: Event) => {
    // Browser WebSocket error events do not expose actionable diagnostics.
    // Treat close/failure state as the source of truth and avoid surfacing
    // transient reconnect noise as a fatal UI error.
    console.warn('[useChat] WebSocket transport error event:', error);
  }, []);

  /**
   * Handle WebSocket close
   */
  const handleWebSocketClose = useCallback(() => {
    console.log('[useChat] WebSocket closed');
    // A transport disconnect does not mean the server-owned Claude Code turn
    // stopped. Keep the runtime lock until the authoritative runtime snapshot
    // or a terminal status event says otherwise.
    setIsStreaming(false);
  }, [setIsStreaming]);

  useEffect(() => {
    if (!projectStatus || projectStatus.project_id !== projectId) return;
    const phase = String(projectStatus.phase || '').toLowerCase();
    if (phase === 'running' || phase === 'starting') {
      setIsLoading(true);
      setCanContinue(false);
      setCurrentTaskId((current) => current || projectId);
      return;
    }
    if (phase === 'idle' || phase === 'finished' || phase === 'stopped') {
      setIsLoading(false);
      setCurrentTaskId(null);
    }
  }, [projectId, projectStatus]);


  // Initialize WebSocket connection
  const { state: wsState, reconnect } = useWebSocket({
    projectId,
    onMessage: handleWebSocketMessage,
    onError: handleWebSocketError,
    onClose: handleWebSocketClose,
    onOpen: syncAfterReconnect, // Trigger sync on connect/reconnect
    showToastError
  });

  const confirmTaskCredits = useCallback(async (
    taskType: BeeGameCreditTaskType,
  ): Promise<boolean> => {
    if (!isBeeGameAdapterEnabled()) return true;
    const quote = await getCreditQuote(taskType);
    if (!quote.canStart) {
      showToastError?.(`Credit 不足。本次请求需要预扣 ${quote.reservedCredits} credits，你当前有 ${quote.balanceCredits} credits。`);
      return false;
    }
    if (!confirmCreditQuote) return true;
    return confirmCreditQuote(quote);
  }, [confirmCreditQuote, showToastError]);


  /**
   * Send a message to the backend
   * Requirements: 1.1, 6.1
   */
  const sendMessage = useCallback(async (
    content: string,
    terminationNode?: string,
    attachments?: ChatAttachmentPayload[],
    supersedesMessageId?: string,
  ) => {
    if (waitingApproval.isBlockingChat) {
      emitWaitingApprovalBlock(waitingApproval.message);
      return;
    }
    try {
      const confirmed = await confirmTaskCredits('edit_turn');
      if (!confirmed) return;
      setIsLoading(true);
      setCanContinue(false);
      if (wsState !== 'connected') {
        reconnect();
      }

      const clientMessageId = newClientMessageId();
      const optimisticTimestamp = Date.now();

      // Add user message to chat history
      addMessage({
        id: clientMessageId,
        clientMessageId,
        supersedesMessageId,
        sender: 'user',
        content,
        attachments,
        timestamp: optimisticTimestamp,
        type: 'text',
      });

      console.log('[useChat] Sending message:', content);

      // Send message to backend via REST API
      const response = await api.sendMessage({
        content,
        project_id: projectId,
        termination_node: terminationNode,
        client_message_id: clientMessageId,
        attachments,
        supersedes_message_id: supersedesMessageId,
      }) as SendMessageResponse;

      setCurrentTaskId(response.task_id);
      console.log('[useChat] Message sent, task ID:', response.task_id);
      void syncAfterReconnect();
    } catch (error) {
      console.error('[useChat] Failed to send message:', error);
      setIsLoading(false);
      const errorMessage = getErrorDisplayMessage(error, '发送消息失败，请重试');
      // Add error message to chat
      addMessage({
        id: `error-${Date.now()}`,
        sender: 'system',
        content: errorMessage,
        timestamp: Date.now(),
        type: 'error'
      });

      showToastError?.(errorMessage);
      onError?.(error instanceof Error ? error : new Error(errorMessage));
    }
  }, [projectId, addMessage, onError, showToastError, wsState, reconnect, syncAfterReconnect, waitingApproval, emitWaitingApprovalBlock, confirmTaskCredits]);

  /**
   * Continue a paused task
   * Requirements: 6.4
   */
  const continueTask = useCallback(async () => {
    if (waitingApproval.isBlockingChat) {
      emitWaitingApprovalBlock(waitingApproval.message);
      return;
    }
    try {
      const confirmed = await confirmTaskCredits('continue_turn');
      if (!confirmed) return;
      setIsLoading(true);
      setCanContinue(false);
      if (wsState !== 'connected') {
        reconnect();
      }

      console.log('[useChat] Continuing task');

      // Send continue request to backend
      const response = await api.continueTask({
        project_id: projectId,
        task_id: currentTaskId || undefined
      }) as ContinueTaskResponse;

      setCurrentTaskId(response.resume_task_id);
      console.log('[useChat] Task continued, task ID:', response.resume_task_id);
      void syncAfterReconnect();
    } catch (error) {
      console.error('[useChat] Failed to continue task:', error);
      setIsLoading(false);
      setCanContinue(true);
      const errorMessage = getErrorDisplayMessage(error, '继续任务失败，请重试');
      // Add error message to chat
      addMessage({
        id: `error-${Date.now()}`,
        sender: 'system',
        content: errorMessage,
        timestamp: Date.now(),
        type: 'error'
      });

      showToastError?.(errorMessage);
      onError?.(error instanceof Error ? error : new Error(errorMessage));
    }
  }, [projectId, currentTaskId, addMessage, onError, showToastError, wsState, reconnect, syncAfterReconnect, waitingApproval, emitWaitingApprovalBlock, confirmTaskCredits]);

  /**
   * Stop the current task
   * Requirements: 6.1
   */
  const stopTask = useCallback(async () => {
    if (isStoppingRef.current) return;
    const stopTargetId = currentTaskId || (isBeeGameAdapterEnabled() ? projectId : '');
    if (!stopTargetId) {
      console.warn('[useChat] No task to stop');
      return;
    }

    try {
      isStoppingRef.current = true;
      setIsStopping(true);
      console.log('[useChat] Stopping task:', stopTargetId);

      // Send stop request to backend
      await api.stopTask({ task_id: stopTargetId, project_id: projectId });

      setIsLoading(false);
      setCurrentTaskId(null);
      setCurrentSender(null);
      setCanContinue(false);

      // Add system message
      addMessage({
        id: `stop-${stopTargetId}-${Date.now()}`,
        sender: 'system',
        content: '任务已停止',
        timestamp: Date.now(),
        type: 'system_status',
        taskKind: 'task_stopped',
      });

      console.log('[useChat] Task stopped');
    } catch (error) {
      console.error('[useChat] Failed to stop task:', error);

      // Add error message to chat
      addMessage({
        id: `error-${Date.now()}`,
        sender: 'system',
        content: '停止任务失败，请重试',
        timestamp: Date.now(),
        type: 'error'
      });

      onError?.(error as Error);
    } finally {
      isStoppingRef.current = false;
      setIsStopping(false);
    }
  }, [currentTaskId, projectId, addMessage, setCurrentSender, onError]);

  /**
   * Approve the current plan
   * Requirements: 7.3
   */
  const approvePlan = useCallback(async (
    review: ReviewBindingPayload & { gate_id: string; binding?: ReviewBindingPayload },
    feedback?: string,
    action: 'approve' | 'revise' | 'reject' = 'approve'
  ) => {
    const reviewSnapshot = pendingReviews.find((item) => String(item?.gate_id || '').trim() === String(review.gate_id || '').trim());
    try {
      console.log('[useChat] Approving plan for project:', projectId);
      const binding = review.binding ?? review;
      const submittedMessage =
        action === 'approve'
          ? '已提交批准，系统正在进入下一阶段。'
          : action === 'revise'
            ? '已提交修订请求，系统将返回设计修订流程。'
            : '已提交拒绝。';
      setApprovalState({
        gateId: review.gate_id,
        action,
        phase: 'submitting',
        message: submittedMessage,
      });

      showToastSuccess?.(submittedMessage);

      await api.approvePlan(normalizeApprovePlanPayload({
        project_id: projectId,
        gate_id: review.gate_id,
        action,
        artifact_id: binding.artifact_id ?? review.artifact_id,
        artifact_version: binding.artifact_version ?? review.artifact_version,
        checkpoint_id: binding.checkpoint_id ?? review.checkpoint_id,
        commit_sha: binding.commit_sha ?? review.commit_sha,
        workspace_path: binding.workspace_path ?? review.workspace_path ?? review.workspace_ref,
        workspace_ref: binding.workspace_ref ?? review.workspace_ref ?? review.workspace_path,
        feedback
      }));

      removePendingReview(review.gate_id);
      await refreshProjectVisibility();
      setApprovalState({
        gateId: null,
        action: null,
        phase: 'idle',
        message: '',
      });
      onTaskEvent?.('plan_submitted', { gate_id: review.gate_id, action });
      console.log('[useChat] Approval request sent');
    } catch (error) {
      console.error('[useChat] Failed to approve plan:', error);
      if (reviewSnapshot) {
        upsertPendingReview(reviewSnapshot);
      }
      const errorMessage = error instanceof Error ? error.message : '审批操作失败，请重试';
      setApprovalState({
        gateId: review.gate_id,
        action,
        phase: 'failed',
        message: errorMessage,
      });

      showToastError?.(`审批操作失败：${errorMessage}`);

      onError?.(error as Error);
    }
  }, [projectId, addMessage, onError, onTaskEvent, pendingReviews, refreshProjectVisibility, removePendingReview, upsertPendingReview]);

  /**
   * Upload and optionally auto-approve a manifest CSV
   */
  const uploadManifestCsv = useCallback(async (gateId: string, csvContent: string, autoApprove: boolean = false) => {
    try {
      console.log('[useChat] Uploading manifest CSV for gate:', gateId);
      await api.uploadManifestCsv({
        project_id: projectId,
        gate_id: gateId,
        csv_content: csvContent,
        auto_approve: autoApprove
      });
      console.log('[useChat] Manifest CSV uploaded');
      showToastSuccess?.(autoApprove
        ? '资源清单已上传并提交确认，系统正在校验资源并继续执行。'
        : '资源清单已上传，请确认后继续。');
      onTaskEvent?.(autoApprove ? 'manifest_auto_approved' : 'manifest_uploaded');
    } catch (error) {
      console.error('[useChat] Failed to upload manifest CSV:', error);
      showToastError?.('上传资源清单失败，请重试');
      onError?.(error as Error);
    }
  }, [projectId, addMessage, onError]);

  /**
   * Approve a manifest gate
   */
  const approveManifest = useCallback(async (review: ReviewBindingPayload & { gate_id: string; binding?: ReviewBindingPayload }, feedback?: string) => {
    try {
      console.log('[useChat] Approving manifest for gate:', review.gate_id);
      const binding = review.binding ?? review;
      const normalized = normalizeReviewBindingPayload({
        project_id: projectId,
        gate_id: review.gate_id,
        checkpoint_id: binding.checkpoint_id ?? review.checkpoint_id,
        commit_sha: binding.commit_sha ?? review.commit_sha,
        workspace_path: binding.workspace_path ?? review.workspace_path ?? review.workspace_ref,
        workspace_ref: binding.workspace_ref ?? review.workspace_ref ?? review.workspace_path,
        artifact_id: binding.artifact_id ?? review.artifact_id,
        artifact_version: binding.artifact_version ?? review.artifact_version,
        feedback
      });
      const result = await api.approveManifest(normalized) as unknown as { validation_status?: string };
      console.log('[useChat] Manifest approved');
      const validationStatus = String(result?.validation_status || 'VALIDATING');
      const content = validationStatus === 'VALIDATING'
        ? '资源清单已确认，系统正在校验资源并继续执行。'
        : `资源清单已确认，当前状态：${validationStatus}`;
      showToastSuccess?.(content);
      await refreshProjectVisibility();
      onTaskEvent?.('manifest_approved', { validation_status: validationStatus });
    } catch (error) {
      console.error('[useChat] Failed to approve manifest:', error);
      showToastError?.('审批资源清单失败，请重试');
      onError?.(error as Error);
    }
  }, [projectId, addMessage, onError, refreshProjectVisibility]);

  /**
   * Revise a manifest gate
   */
  const reviseManifest = useCallback(async (gateId: string, feedback: string) => {
    try {
      console.log('[useChat] Requesting revision for manifest gate:', gateId);
      await api.reviseManifest({
        project_id: projectId,
        gate_id: gateId,
        feedback
      });
      console.log('[useChat] Manifest revision requested');
      showToastSuccess?.('已提交资源清单修订请求，系统会重新生成并等待你再次确认。');
      await refreshProjectVisibility();
      onTaskEvent?.('manifest_revise_requested');
    } catch (error) {
      console.error('[useChat] Failed to revise manifest:', error);
      showToastError?.('驳回资源清单失败，请重试');
      onError?.(error as Error);
    }
  }, [projectId, addMessage, onError, onTaskEvent, refreshProjectVisibility]);

  return {
    sendMessage,
    continueTask,
    stopTask,
    approvePlan,
    uploadManifestCsv,
    approveManifest,
    reviseManifest,
    approvalState,
    isLoading,
    isStopping,
    currentTaskId,
    canContinue,
    wsState
  };
};
