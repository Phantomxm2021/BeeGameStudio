/**
 * Message type definitions for the BeeGame frontend.
 *
 * This file defines the core message types used for communication between
 * the frontend and backend, including WebSocket messages and token usage tracking.
 */

import type { ChatAttachmentPayload } from '../services/chatAttachments';

/**
 * Message type enumeration
 * Defines the different types of messages that can be displayed in the chat
 */
export type MessageType =
  | 'normal'
  | 'text'
  | 'tool'
  | 'error'
  | 'document'
  | 'thought'
  | 'artifact_card'
  | 'system_status'
  | 'structured_output';

export type RenderHint =
  | 'default' | 'document' | 'artifact_card' | 'structured_json' | 'csv_table';

export type WorkflowCardStatus =
  | 'draft'
  | 'running'
  | 'blocked'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stale';

export interface WorkflowCardTask {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'stopped';
  operation?: 'write' | 'review' | 'produce' | 'assemble'
  attempt?: number;
  failureReason?: string;
}

export type WorkflowCardAction = 'resume' | 'retry' | 'restart';

export interface WorkflowCardPayload {
  runId: string;
  status: WorkflowCardStatus;
  currentPhase?: string;
  documentStep?: string;
  reviewMode?: 'initial' | 'closure';
  reviewTarget?: 'foundation' | 'checklist' | 'resource';
  reviewAccepted?: boolean;
  worker?: string;
  thinking?: string;
  executionStatus?: string;
  currentItemId?: string;
  tasks?: WorkflowCardTask[];
  completedTaskCount?: number;
  totalTaskCount?: number;
  createdAt?: string;
  completedAt?: string;
  updatedAt?: string;
  stageStartedAt?: string;
  /** Accumulated active execution time before the current active interval. */
  elapsedMs?: number;
  /** Start of the current active interval; absent while paused or terminal. */
  activeSince?: string;
  nextAction?: WorkflowCardAction;
  block?: {
    message: string;
    nextAction?: string;
  };
  usage?: TokenUsage;
}

export interface ModuleReadinessView {
  status: 'ready' | 'degraded' | 'blocked';
  details: Record<string, unknown>;
}

export interface ProductReadinessView {
  status: 'ready' | 'degraded' | 'blocked';
  modules: Record<string, ModuleReadinessView>;
  blocking_modules?: string[];
  degraded_modules?: string[];
}

/**
 * Message interface
 * Represents a single message in the chat history
 */
export interface Message {
  /** Unique identifier for the message */
  id: string;

  /** Stable backend identity when available */
  messageId?: string;

  /** Stable client-side optimistic identity for user messages */
  clientMessageId?: string;

  /** Stable identity of the user message superseded by this message version */
  supersedesMessageId?: string;

  /** Semantic dedupe key used when stable identities are unavailable */
  dedupeKey?: string;

  /** Sender of the message (e.g., 'user', 'logos', 'metis', 'tecton', 'system') */
  sender: string;

  /** Content of the message */
  content: string;

  /** Image or document attachments submitted with the message */
  attachments?: ChatAttachmentPayload[];

  /** Timestamp when the message was created (Unix timestamp in milliseconds) */
  timestamp: number;

  /** Type of the message (optional, defaults to 'normal') */
  type?: MessageType;

  /** Whether this message should be displayed as a document (optional) */
  isDocument?: boolean;

  /** Title for document-type messages (optional) */
  documentTitle?: string;

  /** Whether the user can continue after an error (for error_paused messages) */
  canContinue?: boolean;

  /** Additional error details (optional) */
  errorDetails?: string;

  /** reasoning/thought content (optional) */
  thought?: string;

  /** Collaborative message delivery kind for replay diagnostics (optional) */
  deliveryKind?: 'new' | 'replay';

  /** Backend-compatible snake_case alias for delivery kind (optional) */
  delivery_kind?: 'new' | 'replay';

  /** Task ID associated with this message (optional, used for aggregation) */
  taskId?: string;

  /** Artifact ID associated with this message (optional, used for artifact preview) */
  artifactId?: string;

  /** Workspace-relative path from structured file tool input */
  artifactPath?: string;

  /** Explicit render directive from backend metadata */
  renderHint?: RenderHint;

  /** Explicit artifact semantic type from backend */
  artifactType?: string;

  /** Explicit task kind from backend */
  taskKind?: string;

  /** Explicit next action hint from backend */
  nextAction?: string;

  /** Whether the task currently requires user action */
  requiresUserAction?: boolean;

  /** Structured tool display metadata for tool cards */
  toolName?: string;
  toolStatus?: 'running' | 'completed' | 'failed';
  toolDetail?: string;
  toolOutput?: string;
  isSubagentTool?: boolean;
}


/**
 * WebSocket message type enumeration
 * Defines the different types of messages received via WebSocket
 */
export type ProjectEventMessageType =
  | 'token'         // Streaming token for real-time response
  | 'agent_message' // Agent final message
  | 'thought'       // Streaming thought/reasoning token
  | 'think_start'   // Redacted assistant thinking lifecycle started
  | 'think_end'     // Redacted assistant thinking lifecycle ended
  | 'status'        // Task status update
  | 'tool_start'    // Tool invocation started
  | 'tool_end'      // Tool invocation completed
  | 'usage'         // Token usage statistics
  | 'human_gate'    // Human approval gate open
  | 'error'         // Runtime error event
  | 'p2p_route'     // Peer-to-peer routing event
  | 'error_paused'  // Error occurred, task paused
  | 'artifact_created' // Real-time artifact created event
  | 'context_update' // Context bundle visibility event
  | 'project_renamed' // Project renamed event (AI auto-naming)
  ;

export interface RuntimeContextEvidence {
  bundle_id?: string;
  phase?: string;
  status?: string;
  summary?: string;
  failure_reason?: string;
  blackboard_record_count?: number;
  memory_hits?: number;
  rag_sources?: string[];
  selected_skills?: string[];
}

/**
 * WebSocket message interface
 * Represents a message received from the backend via WebSocket
 */
export interface ProjectEventMessage {
  /** Type of the WebSocket message */
  type: ProjectEventMessageType;

  event_id?: string;
  sequence?: number;
  sent_at?: string;
  schema_version?: string;

  /** Message content (optional, used for token and error_paused types) */
  content?: string;

  /** Task ID associated with this message */
  task_id: string;

  /** Project ID associated with this message (optional) */
  project_id?: string;

  /** Sender of the message (optional, used for token type) */
  sender?: string;

  /** Stable backend message identity for reconcile/deduplication */
  message_id?: string;

  /** Stable client message identity for optimistic user messages */
  client_message_id?: string;

  /** Stable identity of the user message superseded by this message version */
  supersedes_message_id?: string;

  /** Tool name (optional, used for tool_start and tool_end types) */
  tool?: string;

  /** Stable tool invocation identity (optional, used for tool_start and tool_end types) */
  tool_use_id?: string;

  /** Tool output (optional, used for tool_end type) */
  output?: string;

  /** Tool result (backend protocol field, used for tool_end type) */
  result?: string;

  /** Structured tool card status */
  tool_status?: 'running' | 'completed' | 'failed';

  /** Structured tool card detail, such as command or target path */
  tool_detail?: string;

  /** Structured tool card output summary */
  tool_output?: string;

  /** Workspace-relative path from structured file tool input */
  artifact_path?: string;

  /** Whether this tool event represents a subagent */
  is_subagent_tool?: boolean;

  /** Token usage statistics (optional, used for usage type) */
  usage?: TokenUsage;

  /** Error message (optional, used for error_paused type) */
  error?: string;

  /** Error message (backend compatibility, used for error type) */
  message?: string;

  /** Structured error code (optional, used for error/error_paused type) */
  code?: string;

  /** Whether the error is recoverable (optional, used for error/error_paused type) */
  recoverable?: boolean;

  /** Trace ID for backend diagnostics (optional) */
  trace_id?: string;

  /** Structured status enum (optional, used for status type) */
  status?:
    | 'queued' | 'running' | 'resuming' | 'paused' | 'idle' | 'finished' | 'failed' | 'stopped';

  /** Human gate name (optional, used for human_gate type) */
  gate?: string;

  /** Project name (optional, used for project_renamed type) */
  name?: string;

  /** Artifact version (optional, used for artifact_created type) */
  version?: number;

  /** Agent id (optional, used for artifact/context events) */
  agent?: string;

  /** Runtime context evidence (optional, used for context_update type) */
  context?: RuntimeContextEvidence;

  /** P2P route info (optional, used for p2p_route type) */
  data?: {
    source_agent: string;
    target_agent: string;
    timestamp: number;
  };

  /** The specific type of the nested message content (e.g. 'document') */
  message_type?: MessageType;

  /** Explicit flag if this message represents a document artifact */
  is_document?: boolean;

  /** Optional title for documents */
  document_title?: string;

  /** Optional associated artifact ID */
  artifact_id?: string;

  /** Explicit render directive from backend */
  render_hint?: RenderHint;

  /** Explicit artifact semantic type from backend */
  artifact_type?: string;

  /** Explicit task kind from backend */
  task_kind?: string;

  /** Explicit next action from backend */
  next_action?: string;

  /** Explicit user-action requirement from backend */
  requires_user_action?: boolean;

  /** Credit event kind, used for balance/ledger refresh */

  /** Latest credit balance from backend event payload */

  /** Credit delta from backend event payload */
  
  /** External timestamp from backend (Unix ms) */
  timestamp?: number;
}


/**
 * Token usage interface
 * Tracks LLM token consumption for cost monitoring
 */
export interface TokenUsage {
  /** Number of tokens used in the prompt */
  prompt_tokens: number;

  /** Number of tokens generated in the completion */
  completion_tokens: number;

  /** Total number of tokens used (prompt + completion) */
  total_tokens: number;
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  output_tokens?: number;
}
