/**
 * Project type definitions for the XRMOD Demiurge multi-agent system frontend.
 * 
 * This file defines the project-related types used for managing multiple
 * game development projects, each with independent conversation history and context.
 */

import type { IdeaIntakeAnalysisPayload } from '../services/api';

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
  
  /** Updated root path for the project files (optional) */
  root_path?: string;
}

export type StartProjectResult =
  | { status: 'started'; projectId: string }
  | { status: 'clarification_required'; analysis: IdeaIntakeAnalysisPayload };
