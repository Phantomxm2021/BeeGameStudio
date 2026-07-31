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

import { useCallback, useEffect, useRef, useState } from 'react'
import { useProjectEventPolling } from './useProjectEventPolling'
import { useChatStore } from '../store/chatStore'
import { useProjectStore } from '../store/projectStore'
import { useSystemStore } from '../store/systemStore'
import {
  api,
  type ChatAttachmentPayload,
  type ProjectBaselineStatusPayload,
} from '../services/api'
import type { ContinueTaskResponse, SendMessageResponse } from '../services/api'
import type { ProjectEventMessage } from '../types/message'
import type { ProjectEventPollingState } from './useProjectEventPolling'
import { normalizeChatHistory } from '../utils/chatHistory'
import { normalizeProjectEventSemanticType } from '../utils/messageSemantics'
import { getWaitingPermissionState } from '../utils/waitingPermission'
import { toProjectRuntimeDisplayModel } from '../viewModels/displayModels'

const newClientMessageId = (): string =>
  `client-msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

function getErrorDisplayMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim()
    return message || fallback
  }
  if (typeof error === 'string') {
    const message = error.trim()
    return message || fallback
  }
  return fallback
}

function isProjectWorkflowActive(
  status?: ProjectBaselineStatusPayload | null,
): boolean {
  const workflowStatus = toProjectRuntimeDisplayModel(status)?.workflow?.status
  return workflowStatus === 'running' || workflowStatus === 'verifying'
}

/**
 * Options for useChat hook
 */
export interface UseChatOptions {
  /** Project ID for the chat session */
  projectId: string

  /** Callback when an error occurs (optional) */
  onError?: (error: Error) => void

  /** Callback when a task completes (optional) */
  onTaskComplete?: () => void

  /** Callback when ANY task event occurs (usage, status, tool, etc.) (optional) */
  onTaskEvent?: (type: string, data?: unknown) => void

  /** Toast notification callbacks (optional) */

  showToastError?: (message: string) => void
  showToastSuccess?: (message: string) => void
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
  ) => Promise<void>

  /**
   * Continue a paused task
   */
  continueTask: () => Promise<void>

  /**
   * Stop the current task
   */
  stopTask: () => Promise<void>

  /** Whether a stop request is awaiting backend confirmation */
  isStopping: boolean

  resolveToolPermission: (
    permission: {
      gate_id: string
    },
    decision?: 'allow' | 'deny',
    scope?: 'once' | 'session',
  ) => Promise<void>

  /** Local state for tool-permission submission UX */
  permissionState: {
    gateId: string | null
    action: 'allow' | 'deny' | null
    phase: 'idle' | 'submitting' | 'awaiting_runtime' | 'failed'
    message: string
  }

  /** Whether a task is currently being processed */

  isLoading: boolean

  /** Current task ID (if any) */
  currentTaskId: string | null

  /** Whether the task is paused and can be continued */
  canContinue: boolean

  /** WebSocket connection state */
  wsState: ProjectEventPollingState
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
}: UseChatOptions): UseChatReturn => {
  // State management
  const [isLoading, setIsLoading] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const isStoppingRef = useRef(false)
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [canContinue, setCanContinue] = useState(false)
  const [permissionState, setPermissionState] = useState<
    UseChatReturn['permissionState']
  >({
    gateId: null,
    action: null,
    phase: 'idle',
    message: '',
  })

  // Store actions
  const {
    addMessage,
    updateMessage,
    updateThought,
    removeMessage,
    finalizeMessage,
    setCurrentSender,
    setIsStreaming,
    loadHistory,
  } = useChatStore()
  const pendingPermissions = useProjectStore(state => state.pendingPermissions)
  const projectStatus = useProjectStore(state => state.projectStatus)
  const removePendingPermission = useProjectStore(
    state => state.removePendingPermission,
  )
  const upsertPendingPermission = useProjectStore(
    state => state.upsertPendingPermission,
  )
  const {
    updateTokenUsage,
    updateLastP2PRoute,
    loadCurrentUser,
    setIsSyncing,
  } = useSystemStore()
  const projectRuntimeDisplay = toProjectRuntimeDisplayModel(projectStatus)
  const waitingPermission = getWaitingPermissionState(
    projectRuntimeDisplay,
    pendingPermissions,
  )

  useEffect(() => {
    // These values describe one project's active turn. The hook remains
    // mounted while Dashboard switches projects, so carrying them across the
    // project boundary can make an idle project look permanently busy until
    // another runtime event happens to arrive. Reset only client-side
    // transients here; the authoritative runtime snapshot below will restore
    // a genuine running turn for the newly selected project.
    isStoppingRef.current = false
    setIsStopping(false)
    setIsLoading(false)
    setCurrentTaskId(null)
    setCanContinue(false)
    setPermissionState({
      gateId: null,
      action: null,
      phase: 'idle',
      message: '',
    })
    setCurrentSender(null)
    setIsStreaming(false)
  }, [projectId, setCurrentSender, setIsStreaming])

  useEffect(() => {
    if (!permissionState.gateId) {
      return
    }
    const gateStillPresent = pendingPermissions.some(
      permission =>
        String(permission?.gate_id || '').trim() ===
        String(permissionState.gateId || '').trim(),
    )
    if (!gateStillPresent && permissionState.phase !== 'failed') {
      setPermissionState({
        gateId: null,
        action: null,
        phase: 'idle',
        message: '',
      })
    }
  }, [permissionState, pendingPermissions])

  const refreshProjectVisibility = useCallback(async () => {
    if (useSystemStore.getState().authenticationStatus !== 'authenticated')
      return
    const store = useProjectStore.getState()
    await store.loadProjectRuntimeState(projectId)
  }, [projectId])

  const emitWaitingPermissionBlock = useCallback(
    (message: string) => {
      setIsLoading(false)
      setCanContinue(false)
      addMessage({
        id: `waiting-approval-${Date.now()}`,
        sender: 'system',
        content: message,
        timestamp: Date.now(),
        type: 'error',
        taskKind: 'approval_gate',
        requiresUserAction: true,
      })
      showToastError?.(message)
      onError?.(new Error(message))
    },
    [addMessage, onError, showToastError],
  )

  // Use refs to avoid handleProjectEventMessage dependency churn and event polling restarts
  const latestRefs = useRef({
    projectId,
    onError,
    onTaskComplete,
    onTaskEvent,
    showToastError,
    showToastSuccess,
    permissionState,
    loadCurrentUser,
    refreshProjectVisibility,
  })

  // Update refs on every render
  latestRefs.current = {
    projectId,
    onError,
    onTaskComplete,
    onTaskEvent,
    showToastError,
    showToastSuccess,
    permissionState,
    loadCurrentUser,
    refreshProjectVisibility,
  }

  /**
   * Handle incoming WebSocket messages
   * Routes messages to appropriate handlers based on type
   *
   * Requirements: 1.2, 7.1, 7.2
   */
  const handleProjectEventMessage = useCallback(
    (message: ProjectEventMessage) => {
      const refs = latestRefs.current

      switch (message.type) {
        case 'token':
          // Streaming token - accumulate content
          // Requirements: 1.3
          if (message.content && message.sender) {
            const semanticType = normalizeProjectEventSemanticType(message)
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
              message.message_id,
            )
            setCurrentSender(message.sender)
          }
          break

        case 'agent_message':
          if (message.content && message.sender) {
            const semanticType = normalizeProjectEventSemanticType(message)
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
              message.message_id,
            )
            setCurrentSender(message.sender)
          }
          break

        case 'thought':
          // Streaming thought - accumulate reasoning
          if (message.content && message.sender) {
            updateThought(
              message.task_id,
              message.content,
              message.sender,
              message.timestamp,
              message.message_id,
            )
            setCurrentSender(message.sender)
          }
          break

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
            )
            setCurrentSender(message.sender)
          }
          break

        case 'think_end':
          if (message.message_id) removeMessage(message.message_id)
          break

        case 'status':
          // Task status update
          // Requirements: 6.2
          if (
            message.status === 'finished' ||
            message.status === 'stopped' ||
            message.status === 'idle'
          ) {
            setIsLoading(false)
            setCurrentTaskId(null)
            setCurrentSender(null)
            setIsStreaming(false) // Mark streaming as complete
            if (message.status === 'finished') {
              refs.onTaskComplete?.()
            }
            // Trigger event for UI refresh
            refs.onTaskEvent?.(
              message.status === 'idle' ? 'status_idle' : 'status_finished',
              message,
            )

          } else if (
            message.status === 'queued' ||
            message.status === 'running' ||
            message.status === 'resuming'
          ) {
            setIsLoading(true)
            if (message.sender) {
              setCurrentSender(message.sender)
            }
            refs.onTaskEvent?.('status_running', message)
          } else if (
            message.status === 'paused' ||
            message.status === 'failed'
          ) {
            setIsLoading(false)
            if (message.content) {
              addMessage({
                id: `status-${message.status}-${message.task_id || 'na'}-${String(message.content).substring(0, 48)}`,
                sender: 'system',
                content: message.content,
                timestamp: message.timestamp || Date.now(),
                type: message.status === 'paused' ? 'system_status' : 'error',
                taskKind:
                  message.status === 'paused'
                    ? 'workflow_paused'
                    : 'workflow_failed',
                canContinue: message.status === 'paused',
              })
            }
            setPermissionState(prev => {
              if (
                message.status !== 'failed' ||
                (prev.phase !== 'awaiting_runtime' &&
                  prev.phase !== 'submitting')
              ) {
                return prev
              }
              return {
                gateId: prev.gateId,
                action: prev.action,
                phase: 'failed',
                message: '权限决定已提交，但后续执行失败。',
              }
            })
            refs.onTaskEvent?.('status_failed', message)
          }
          break

        case 'human_gate':
          setIsLoading(false)
          setCanContinue(false)

          // Permission events can arrive while the document is hidden, when the
          // dashboard's visibility-aware status poll is intentionally paused.
          // Refresh the authoritative pending permission snapshot immediately so
          // the browser-tab attention indicator and permission panel do not wait
          // for the user to return to the page.
          refs
            .refreshProjectVisibility()
            .catch(err =>
              console.error(
                '[useChat] Permission visibility refresh failed:',
                err,
              ),
            )
          refs.onTaskEvent?.('human_gate', message)
          break

        case 'artifact_created':
          // Real-time artifact event
          // Requirements: System Design §8.9.5
          if (!message.project_id || message.project_id === refs.projectId) {
            const artifactName =
              message.name || message.artifact_id || 'new artifact'
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
            })
            refs
              .refreshProjectVisibility()
              .catch(err =>
                console.error(
                  '[useChat] Artifact visibility refresh failed:',
                  err,
                ),
              )
            refs.onTaskEvent?.('artifact_created', message)
          }
          break

        case 'context_update': {
          const context = message.context
          if (
            !context ||
            (message.project_id && message.project_id !== refs.projectId)
          ) {
            break
          }
          const ragCount = context.rag_sources?.length ?? 0
          const skillCount = context.selected_skills?.length ?? 0
          addMessage({
            id: `context-${context.bundle_id || message.task_id || Date.now()}`,
            sender: 'system',
            content: `Context used for ${context.phase || 'phase'}: blackboard ${context.blackboard_record_count ?? 0}, memory ${context.memory_hits ?? 0}, RAG ${ragCount}, skills ${skillCount}.`,
            timestamp: Date.now(),
            type: 'system_status',
            taskKind: 'context_update',
          })
          refs
            .refreshProjectVisibility()
            .catch(err =>
              console.error(
                '[useChat] Context visibility refresh failed:',
                err,
              ),
            )
          refs.onTaskEvent?.('context_update', message)
          break
        }

        case 'error': {
          const errContent =
            message.content ||
            message.message ||
            message.error ||
            '任务执行出现错误'
          const contextualError =
            refs.permissionState.phase === 'awaiting_runtime' ||
            refs.permissionState.phase === 'submitting'
              ? `权限决定已提交，但后续执行失败：${errContent}`
              : errContent
          addMessage({
            id: `error-${message.task_id || 'na'}-${contextualError.substring(0, 32)}`,
            sender: 'system',
            content: contextualError,
            timestamp: Date.now(),
            type: 'error',
            taskKind: 'runtime_error',
            errorDetails: message.error || message.message || message.code,
          })
          setIsLoading(false)
          setPermissionState(prev => {
            if (
              prev.phase !== 'awaiting_runtime' &&
              prev.phase !== 'submitting'
            ) {
              return prev
            }
            return {
              gateId: prev.gateId,
              action: prev.action,
              phase: 'failed',
              message: contextualError,
            }
          })
          if (message.recoverable) {
            setCanContinue(true)
          }
          refs.showToastError?.(contextualError)
          refs.onError?.(new Error(contextualError))
          refs.onTaskEvent?.('error', message)
          break
        }

        case 'tool_start':
          // Tool invocation started
          // Requirements: 7.1
          if (message.tool) {
            const toolMessageId =
              message.message_id ||
              `tool-${message.task_id}-${message.tool_use_id || message.tool}`
            addMessage({
              id: toolMessageId,
              messageId: toolMessageId,
              sender: 'system',
              content:
                message.content || `Tool: ${message.tool}\nStatus: running`,
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
            })
            refs.onTaskEvent?.('tool_start', message)
          }
          break

        case 'tool_end':
          // Tool invocation completed
          // Requirements: 7.2
          if (message.tool) {
            const toolMessageId =
              message.message_id ||
              `tool-${message.task_id}-${message.tool_use_id || message.tool}`
            const toolResult = message.result || message.output
            const outputSummary = toolResult
              ? toolResult.length > 100
                ? `${toolResult.substring(0, 100)}...`
                : toolResult
              : '(无输出)'
            const status =
              message.error ||
              String(message.output || '')
                .toLowerCase()
                .includes('failed')
                ? 'failed'
                : 'completed'

            addMessage({
              id: toolMessageId,
              messageId: toolMessageId,
              sender: 'system',
              content:
                message.content ||
                `Tool: ${message.tool}\nStatus: ${status}\nOutput: ${outputSummary}`,
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
            })
            refs.onTaskEvent?.('tool_end', message)
          }
          break

        case 'usage':
          // Token usage statistics
          // Requirements: 4.3
          if (message.usage) {
            updateTokenUsage(message.usage, refs.projectId, message.task_id)
            refs.onTaskEvent?.('usage', message.usage)
          }

          break

        case 'p2p_route':
          // Peer-to-peer routing event
          if (message.data) {
            updateLastP2PRoute(message.data)
          }
          break

        case 'error_paused':
          // Error occurred, task paused
          // Requirements: 6.3
          setIsLoading(false)
          setCanContinue(true)

          addMessage({
            id: `error-paused-${message.task_id}-${message.content?.substring(0, 32)}`,
            sender: 'system',
            content: message.content || '任务遇到错误并已暂停',
            timestamp: Date.now(),
            type: 'error',
            taskKind: 'runtime_error',
            canContinue: true,
            errorDetails: message.error || message.message || message.code,
          })

          break

        case 'project_renamed':
          // Project renamed (AI auto-naming)
          if (message.project_id && message.name) {
            useProjectStore
              .getState()
              .renameProjectLocally(message.project_id, message.name)
          }
          break

        default:
          console.warn(
            '[useChat] Unknown message type:',
            (message as unknown as Record<string, unknown>).type,
          )
      }
    },
    [
      addMessage,
      updateMessage,
      finalizeMessage,
      removeMessage,
      setCurrentSender,
      updateTokenUsage,
      setIsStreaming,
      updateThought,
      updateLastP2PRoute,
    ],
  )

  /**
   * Synchronize all state with backend after reconnection
   * Requirements: 7.2
   */
  const syncAfterReconnect = useCallback(async () => {
    if (!projectId) return

    setIsSyncing(true)

    try {
      // BeeGame has one server-owned runtime-state snapshot.
      await refreshProjectVisibility()
      const projectStatus = useProjectStore.getState().projectStatus
      if (isProjectWorkflowActive(projectStatus)) {
        setCurrentTaskId(currentTaskId || projectId)
        setIsLoading(true)
        setCanContinue(false)
      }

      // Sync chat history only after the authoritative runtime state.
      const { isStreaming } = useChatStore.getState()
      if (!isStreaming) {
        const history = (await api.getChatHistory(projectId)) as unknown
        const messages = normalizeChatHistory(history)
        const currentMessages = useChatStore.getState().messages
        if (messages.length > 0 || currentMessages.length === 0) {
          loadHistory(messages)
        }
      }
    } catch (error) {
      console.error('[useChat] Failed to synchronize state:', error)
    } finally {
      setIsSyncing(false)
    }
  }, [
    projectId,
    currentTaskId,
    loadHistory,
    setIsSyncing,
    refreshProjectVisibility,
  ])

  /**
   * Handle WebSocket errors
   */
  const handleWebSocketError = useCallback((error: Event) => {
    // Browser WebSocket error events do not expose actionable diagnostics.
    // Treat close/failure state as the source of truth and avoid surfacing
    // transient reconnect noise as a fatal UI error.
    console.warn('[useChat] WebSocket transport error event:', error)
  }, [])

  /**
   * Handle WebSocket close
   */
  const handleWebSocketClose = useCallback(() => {
    // A transport disconnect does not mean the server-owned BeeGame turn
    // stopped. Keep the runtime lock until the authoritative runtime snapshot
    // or a terminal status event says otherwise.
    setIsStreaming(false)
  }, [setIsStreaming])

  useEffect(() => {
    if (!projectStatus || projectStatus.project_id !== projectId) return
    if (isProjectWorkflowActive(projectStatus)) {
      setIsLoading(true)
      setCanContinue(false)
      setCurrentTaskId(current => current || projectId)
      return
    }
    // The backend snapshot is authoritative for whether a native turn is
    // alive. In particular, a server restart recovers an unterminated turn as
    // paused/failed. Leaving the previous local loading flag untouched for
    // those phases permanently locks the composer even though no BeeGame
    // worker exists. Approval state has its own explicit UI lock.
    setIsLoading(false)
    setCurrentTaskId(null)
  }, [projectId, projectStatus])

  // Initialize WebSocket connection
  const { state: wsState, reconnect } = useProjectEventPolling({
    projectId,
    onMessage: handleProjectEventMessage,
    onError: handleWebSocketError,
    onClose: handleWebSocketClose,
    onOpen: syncAfterReconnect, // Trigger sync on connect/reconnect
    showToastError,
  })

  /**
   * Send a message to the backend
   * Requirements: 1.1, 6.1
   */
  const sendMessage = useCallback(
    async (
      content: string,
      terminationNode?: string,
      attachments?: ChatAttachmentPayload[],
      supersedesMessageId?: string,
    ) => {
      if (waitingPermission.isBlockingChat) {
        emitWaitingPermissionBlock(waitingPermission.message)
        return
      }
      try {
        setIsLoading(true)
        setCanContinue(false)
        if (wsState !== 'connected') {
          reconnect()
        }

        const clientMessageId = newClientMessageId()
        const optimisticTimestamp = Date.now()

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
        })

        // Send message to backend via REST API
        const response = (await api.sendMessage({
          content,
          project_id: projectId,
          termination_node: terminationNode,
          client_message_id: clientMessageId,
          attachments,
          supersedes_message_id: supersedesMessageId,
        })) as SendMessageResponse

        setCurrentTaskId(response.task_id)
        void syncAfterReconnect()
      } catch (error) {
        console.error('[useChat] Failed to send message:', error)
        setIsLoading(false)
        const errorMessage = getErrorDisplayMessage(
          error,
          '发送消息失败，请重试',
        )
        // Add error message to chat
        addMessage({
          id: `error-${Date.now()}`,
          sender: 'system',
          content: errorMessage,
          timestamp: Date.now(),
          type: 'error',
        })

        showToastError?.(errorMessage)
        onError?.(error instanceof Error ? error : new Error(errorMessage))
      }
    },
    [
      projectId,
      addMessage,
      onError,
      showToastError,
      wsState,
      reconnect,
      syncAfterReconnect,
      waitingPermission,
      emitWaitingPermissionBlock,
    ],
  )

  /**
   * Continue a paused task
   * Requirements: 6.4
   */
  const continueTask = useCallback(async () => {
    if (waitingPermission.isBlockingChat) {
      emitWaitingPermissionBlock(waitingPermission.message)
      return
    }
    try {
      setIsLoading(true)
      setCanContinue(false)
      if (wsState !== 'connected') {
        reconnect()
      }

      // Send continue request to backend
      const response = (await api.continueTask({
        project_id: projectId,
        task_id: currentTaskId || undefined,
      })) as ContinueTaskResponse

      setCurrentTaskId(response.resume_task_id)
      void syncAfterReconnect()
    } catch (error) {
      console.error('[useChat] Failed to continue task:', error)
      setIsLoading(false)
      setCanContinue(true)
      const errorMessage = getErrorDisplayMessage(error, '继续任务失败，请重试')
      // Add error message to chat
      addMessage({
        id: `error-${Date.now()}`,
        sender: 'system',
        content: errorMessage,
        timestamp: Date.now(),
        type: 'error',
      })

      showToastError?.(errorMessage)
      onError?.(error instanceof Error ? error : new Error(errorMessage))
    }
  }, [
    projectId,
    currentTaskId,
    addMessage,
    onError,
    showToastError,
    wsState,
    reconnect,
    syncAfterReconnect,
    waitingPermission,
    emitWaitingPermissionBlock,
  ])

  /**
   * Stop the current task
   * Requirements: 6.1
   */
  const stopTask = useCallback(async () => {
    if (isStoppingRef.current) return
    const stopTargetId = currentTaskId || projectId
    if (!stopTargetId) {
      console.warn('[useChat] No task to stop')
      return
    }

    try {
      isStoppingRef.current = true
      setIsStopping(true)

      // Send stop request to backend
      await api.stopTask({ task_id: stopTargetId, project_id: projectId })

      setIsLoading(false)
      setCurrentTaskId(null)
      setCurrentSender(null)
      setCanContinue(false)

      // Add system message
      addMessage({
        id: `stop-${stopTargetId}-${Date.now()}`,
        sender: 'system',
        content: '任务已停止',
        timestamp: Date.now(),
        type: 'system_status',
        taskKind: 'task_stopped',
      })
    } catch (error) {
      console.error('[useChat] Failed to stop task:', error)

      // Add error message to chat
      addMessage({
        id: `error-${Date.now()}`,
        sender: 'system',
        content: '停止任务失败，请重试',
        timestamp: Date.now(),
        type: 'error',
      })

      onError?.(error as Error)
    } finally {
      isStoppingRef.current = false
      setIsStopping(false)
    }
  }, [currentTaskId, projectId, addMessage, setCurrentSender, onError])

  const resolveToolPermission = useCallback(
    async (
      permission: { gate_id: string },
      decision: 'allow' | 'deny' = 'allow',
      scope: 'once' | 'session' = 'once',
    ) => {
      const permissionSnapshot = pendingPermissions.find(
        item =>
          String(item?.gate_id || '').trim() ===
          String(permission.gate_id || '').trim(),
      )
      try {
        const submittedMessage =
          decision === 'allow' ? '已允许工具操作。' : '已拒绝工具操作。'
        setPermissionState({
          gateId: permission.gate_id,
          action: decision,
          phase: 'submitting',
          message: submittedMessage,
        })

        showToastSuccess?.(submittedMessage)

        await api.resolveToolPermission({
          project_id: projectId,
          gate_id: permission.gate_id,
          decision,
          scope,
        })

        removePendingPermission(permission.gate_id)
        await refreshProjectVisibility()
        setPermissionState({
          gateId: null,
          action: null,
          phase: 'idle',
          message: '',
        })
        onTaskEvent?.('permission_resolved', { gate_id: permission.gate_id, decision })
      } catch (error) {
        console.error('[useChat] Failed to resolve tool permission:', error)
        if (permissionSnapshot) {
          upsertPendingPermission(permissionSnapshot)
        }
        const errorMessage =
          error instanceof Error ? error.message : '权限操作失败，请重试'
        setPermissionState({
          gateId: permission.gate_id,
          action: decision,
          phase: 'failed',
          message: errorMessage,
        })

        showToastError?.(`权限操作失败：${errorMessage}`)

        onError?.(error as Error)
      }
    },
    [
      onError,
      onTaskEvent,
      pendingPermissions,
      projectId,
      refreshProjectVisibility,
      removePendingPermission,
      showToastError,
      showToastSuccess,
      upsertPendingPermission,
    ],
  )

  return {
    sendMessage,
    continueTask,
    stopTask,
    resolveToolPermission,
    permissionState,
    isLoading,
    isStopping,
    currentTaskId,
    canContinue,
    wsState,
  }
}
