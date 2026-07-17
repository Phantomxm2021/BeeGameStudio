/**
 * Project type definitions for the BeeGame frontend.
 *
 * This file defines the project-related types used for managing multiple
 * game development projects, each with independent conversation history and context.
 */

import type { IdeaIntakeAnalysisPayload } from '../services/api';

export interface ProjectRuntimeSnapshot {
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    cache_read_tokens?: number;
    cache_creation_tokens?: number;
    total_tokens: number;
  };
  phase_name?: string;
  model_config_id?: string;
  model_name?: string;
  updated_at?: number;
}

/**
 * Project interface
 * Represents a game development project in the system
 */
export interface Project {
  /** Unique identifier for the project */
  id: string;
  
  /** Name of the project */
  name: string;
  
  /** Root path for the project files (optional) */
  root_path?: string;
  
  /** Timestamp when the project was created (Unix timestamp in milliseconds) */
  created_at: number;

  /** Last dashboard runtime summary persisted for quick restoration */
  runtime_snapshot?: ProjectRuntimeSnapshot;
}

/**
 * Create project request interface
 * Data required to create a new project
 */
export interface CreateProjectRequest {
  /** Name of the new project */
  name: string;
  
  /** Root path for the project files (optional) */
  root_path?: string;
}

/**
 * Update project request interface
 * Data that can be updated for an existing project
 */
export interface UpdateProjectRequest {
  /** Updated name for the project (optional) */
  name?: string;
}

export type StartProjectResult =
  | { status: 'started'; projectId: string }
  | { status: 'clarification_required'; analysis: IdeaIntakeAnalysisPayload };
