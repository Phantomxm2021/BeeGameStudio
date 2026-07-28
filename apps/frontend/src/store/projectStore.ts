/**
 * Project store for managing projects and active project state
 * 
 * This store handles:
 * - Project list state management
 * - Active project tracking
 * - Project CRUD operations (create, read, update, delete)
 * - Integration with chat store for project switching
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.5, 3.6
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Project, StartProjectResult, UpdateProjectRequest } from '../types/project';
import {
  api,
  normalizeProjectBaselineStatusPayload,
  type PendingUserReviewsResponse,
  type PendingUserReviewItem,
  type ProjectBaselineStatusPayload,
} from '../services/api';
import type { BeeGameBuildBrief } from '../services/beeGameAdapter';
import { isAuthenticationServiceUnavailable } from '../services/apiClient';
import { useChatStore } from './chatStore';
import { useSystemStore } from './systemStore';
import type { ProductReadinessView } from '../types/message';

const normalizeProjectTimestamp = (project: Project): Project => {
  const ts = Number(project.created_at);
  if (!Number.isFinite(ts)) {
    return { ...project, created_at: Date.now() };
  }
  return {
    ...project,
    // Backward compatibility: old backend values may be in seconds.
    created_at: ts < 1e11 ? ts * 1000 : ts,
  };
};

const normalizeApiProject = (project: Project & { project_id?: string }): Project => {
  return normalizeProjectTimestamp({
    ...project,
    id: project.id || project.project_id || '',
  });
};

const upsertProject = (projects: Project[], project: Project): Project[] => {
  return [project, ...projects.filter((item) => item.id !== project.id)];
};

const PROJECT_OPEN_TIMEOUT_MS = 10_000;
const runtimeStateRequests = new Map<string, ReturnType<typeof api.getProjectRuntimeState>>();

const getProjectRuntimeStateSingleFlight = (
  projectId: string,
): ReturnType<typeof api.getProjectRuntimeState> => {
  const existing = runtimeStateRequests.get(projectId);
  if (existing) return existing;
  const request = api.getProjectRuntimeState(projectId).finally(() => {
    if (runtimeStateRequests.get(projectId) === request) {
      runtimeStateRequests.delete(projectId);
    }
  });
  runtimeStateRequests.set(projectId, request);
  return request;
};

const withProjectOpenTimeout = async (operation: Promise<unknown>): Promise<void> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error('Project open timed out'));
        }, PROJECT_OPEN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

/**
 * Project store state interface
 */
interface ProjectState {
  /** List of all projects */
  projects: Project[];

  /** ID of the currently active project */
  activeProjectId: string | null;

  /** Loading state for async operations */
  isLoading: boolean;

  /** Whether a project open/switch operation is in progress */
  isOpeningProject: boolean;

  /** List of pending user reviews for the active project */
  pendingReviews: PendingUserReviewItem[];

  /** Current project-level baseline status snapshot */
  projectStatus: ProjectBaselineStatusPayload | null;

  /** Current runtime module readiness snapshot */
  runtimeReadiness: ProductReadinessView | null;

  /** Toast notification callbacks */
  showToastError: ((message: string) => void) | null;
  showToastSuccess: ((message: string) => void) | null;

  /**
   * Set toast notification callbacks
   * Should be called once during app initialization
   */
  setToastCallbacks: (
    showError: (message: string) => void,
    showSuccess: (message: string) => void
  ) => void;

  /**
   * Load all projects from the backend
   * If no active project is set, automatically sets the first project as active
   * Requirements: 3.1
   */
  loadProjects: () => Promise<void>;

  /**
   * Load pending user reviews for a specific project
   */
  loadPendingReviews: (projectId: string) => Promise<void>;

  /** Load the single server-owned runtime snapshot used by dashboard views. */
  loadProjectRuntimeState: (projectId: string) => Promise<void>;

  /**
   * Remove a pending review from local optimistic state
   */
  removePendingReview: (gateId: string) => void;

  /**
   * Restore or insert a pending review into local optimistic state
   */
  upsertPendingReview: (review: PendingUserReviewItem) => void;

  /**
   * Load project-level status and current baseline metadata
   */
  loadProjectStatus: (projectId: string) => Promise<void>;

  /**
   * Load runtime module readiness
   */
  loadSystemReadiness: () => Promise<void>;

  /**
   * Set the active project
   * Calls the mandatory backend open API before switching state
   * Clears current chat messages to prepare for loading new project's history
   * Requirements: 3.4, 3.7
   */
  setActiveProject: (projectId: string) => Promise<void>;

  /**
   * Return to the landing workspace without opening another project.
   * Clears project-scoped runtime state and chat history.
   */
  clearActiveProject: () => void;

  bootstrapProjectFromBrief: (data: BeeGameBuildBrief) => Promise<StartProjectResult>;

  /**
   * Update an existing project
   * Reloads the project list after update to ensure consistency
   * Requirements: 3.5
   */
  updateProject: (projectId: string, data: UpdateProjectRequest) => Promise<void>;

  /**
   * Delete a project
   * If the deleted project was active, switches to the first available project
   * Requirements: 3.6
   */
  deleteProject: (projectId: string) => Promise<void>;

  /**
   * Rename a project locally (usually triggered by WebSocket event)
   * Updates only the local state to match the backend
   */
  renameProjectLocally: (projectId: string, newName: string) => void;
}

/**
 * Project store implementation using Zustand
 * 
 * This store provides centralized state management for projects,
 * handling all project-related operations and maintaining consistency
 * with the backend state.
 */
export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      isLoading: false,
      isOpeningProject: false,
      pendingReviews: [],
      projectStatus: null,
      runtimeReadiness: null,
      showToastError: null,
      showToastSuccess: null,

      setToastCallbacks: (showError, showSuccess) => {
        set({ showToastError: showError, showToastSuccess: showSuccess });
      },

      loadProjects: async () => {
        try {
          set({ isLoading: true });
          const rawProjects = (await api.getProjects()) as unknown as Project[];
          const projects = rawProjects.map(normalizeProjectTimestamp);
          const currentActiveId = get().activeProjectId;
          const hasActive = !!currentActiveId && projects.some((p) => p.id === currentActiveId);
          set({
            projects,
            activeProjectId: hasActive ? currentActiveId : null,
            isLoading: false,
          });
        } catch (error) {
          console.error('Failed to load projects:', error);
          set({ isLoading: false });
          throw error;
        }
      },

      loadPendingReviews: async (projectId) => {
        if (!projectId) return;
        try {
          const response = (await api.getPendingUserReviews(projectId)) as PendingUserReviewsResponse;
          set({ pendingReviews: response.items || [] });
        } catch (error) {
          console.error(`Failed to load pending reviews for project ${projectId}:`, error);
          // Do not fail hard, just set empty to avoid blocking UI
          set({ pendingReviews: [] });
        }
      },

      loadProjectRuntimeState: async (projectId) => {
        if (!projectId) return;
        const activeProjectId = get().activeProjectId;
        if (activeProjectId && activeProjectId !== projectId) return;
        try {
          const runtimeState = await getProjectRuntimeStateSingleFlight(projectId);
          const currentActiveProjectId = get().activeProjectId;
          if (currentActiveProjectId && currentActiveProjectId !== projectId) return;
          set({
            projectStatus: normalizeProjectBaselineStatusPayload(runtimeState.status),
            pendingReviews: runtimeState.pendingReviews,
          });
          const tokenBudget = runtimeState.status.context?.token_budget;
          if (tokenBudget) {
            useSystemStore.getState().updateTokenUsage({
              prompt_tokens: Number(tokenBudget.prompt_tokens ?? tokenBudget.input_tokens) || 0,
              input_tokens: Number(tokenBudget.input_tokens ?? tokenBudget.prompt_tokens) || 0,
              cached_input_tokens:
                Number(tokenBudget.cached_input_tokens) ||
                (Number(tokenBudget.cache_read_tokens) || 0) + (Number(tokenBudget.cache_creation_tokens) || 0),
              completion_tokens: Number(tokenBudget.completion_tokens ?? tokenBudget.output_tokens) || 0,
              output_tokens: Number(tokenBudget.output_tokens ?? tokenBudget.completion_tokens) || 0,
              total_tokens: Number(tokenBudget.total_tokens) || 0,
            }, projectId);
          }
        } catch (error) {
          if (
            getProjectStoreErrorStatus(error) !== 401 &&
            !isAuthenticationServiceUnavailable(error)
          ) {
            console.error(`Failed to load runtime state for project ${projectId}:`, error);
          }
          throw error;
        }
      },

      removePendingReview: (gateId) => {
        const normalizedGateId = String(gateId || '').trim();
        if (!normalizedGateId) return;
        set((state) => ({
          pendingReviews: state.pendingReviews.filter((review) => String(review?.gate_id || '').trim() !== normalizedGateId),
        }));
      },

      upsertPendingReview: (review) => {
        const normalizedGateId = String(review?.gate_id || '').trim();
        if (!normalizedGateId) return;
        set((state) => {
          const remaining = state.pendingReviews.filter((item) => String(item?.gate_id || '').trim() !== normalizedGateId);
          return {
            pendingReviews: [review, ...remaining],
          };
        });
      },

      loadProjectStatus: async (projectId) => {
        if (!projectId) return;
        try {
          const status = (await api.getProjectStatus(projectId)) as ProjectBaselineStatusPayload;
          set({ projectStatus: normalizeProjectBaselineStatusPayload(status) });
        } catch (error) {
          console.error(`Failed to load project status for project ${projectId}:`, error);
          const { showToastError } = get();
          if (showToastError) {
            showToastError('后端状态不可用，请检查服务和数据库配置');
          }
        }
      },

      loadSystemReadiness: async () => {
        try {
          const readiness = (await api.getSystemReadiness()) as unknown as ProductReadinessView;
          set({ runtimeReadiness: readiness });
        } catch (error) {
          console.error('Failed to load system readiness:', error);
        }
      },

      setActiveProject: async (projectId) => {
        const normalizedProjectId = projectId || null;
        if (!normalizedProjectId) {
          get().clearActiveProject();
          return;
        }

        if (get().activeProjectId === normalizedProjectId) {
          return;
        }

        try {
          set({ isOpeningProject: true });
          // Mandatory opening signal as per integration guide
          await withProjectOpenTimeout(api.openProject(normalizedProjectId));

          set({
            activeProjectId: normalizedProjectId,
            isOpeningProject: false,
            pendingReviews: [],
            projectStatus: null,
          });
          // Clear current messages to prepare for loading new project's history
          useChatStore.getState().clearMessages();
        } catch (error) {
          console.error(`Failed to open project ${normalizedProjectId}:`, error);
          set({ isOpeningProject: false });
          const { showToastError } = get();
          if (showToastError) {
            showToastError('切换项目失败，后端连接异常');
          }
          throw error;
        }
      },

      clearActiveProject: () => {
        set({
          activeProjectId: null,
          pendingReviews: [],
          projectStatus: null,
          runtimeReadiness: null,
        });
        useChatStore.getState().clearMessages();
      },

      bootstrapProjectFromBrief: async (data) => {
        try {
          set({ isLoading: true });
          const result = (await api.bootstrapProjectFromBrief(data)) as unknown as {
            project: Project & { project_id?: string };
            task_id: string;
            status: string;
          };
          const bootstrappedProject = normalizeApiProject(result.project);
          const newProjectId = bootstrappedProject.id;
          if (!newProjectId) {
            set({ isLoading: false });
            throw new Error('Bootstrap response missing project id');
          }

          set((state) => ({
            projects: upsertProject(state.projects, bootstrappedProject),
            activeProjectId: newProjectId,
            isLoading: false,
          }));

          const chatStore = useChatStore.getState();
          const bootstrapTimestamp = Date.now();
          chatStore.clearMessages();
          chatStore.addMessage({
            id: `bootstrap-user-${newProjectId}-${bootstrapTimestamp}`,
            clientMessageId: `bootstrap-user-${newProjectId}`,
            sender: 'user',
            content: data.idea,
            taskId: result.task_id,
            timestamp: bootstrapTimestamp,
            type: 'text',
          });
          chatStore.addMessage({
            id: `bootstrap-brief-${newProjectId}-${bootstrapTimestamp}`,
            clientMessageId: `bootstrap-brief-${newProjectId}`,
            sender: 'system',
            content: `方案已确认：${data.option.title} / ${data.settings.platform} / ${data.settings.engine || 'React'} / ${data.settings.dimension} / ${data.settings.genre}`,
            taskId: result.task_id,
            timestamp: bootstrapTimestamp + 1,
            type: 'system_status',
          });
          Promise.allSettled([
            api.getProjects().then((rawProjects) => {
              const projects = (rawProjects as unknown as Project[]).map(normalizeProjectTimestamp);
              set((state) => ({
                projects,
                activeProjectId: projects.some((project) => project.id === newProjectId) ? newProjectId : state.activeProjectId,
              }));
            }),
            get().loadProjectRuntimeState(newProjectId),
          ]).catch((error) => console.error('Failed to refresh bootstrap project state:', error));

          return { status: 'started', projectId: newProjectId };
        } catch (error) {
          console.error('Failed to bootstrap project from brief:', error);
          set({ isLoading: false });
          throw error;
        }
      },

      updateProject: async (projectId, data) => {
        try {
          set({ isLoading: true });
          await api.updateProject(projectId, data);

          // Reload projects to ensure consistency with backend
          const projects = ((await api.getProjects()) as unknown as Project[]).map(normalizeProjectTimestamp);
          set({ projects, isLoading: false });

          // Show success toast
          // Requirements: 12.4
          const { showToastSuccess } = get();
          if (showToastSuccess) {
            showToastSuccess('项目更新成功');
          }
        } catch (error) {
          console.error('Failed to update project:', error);
          set({ isLoading: false });
          throw error;
        }
      },

      deleteProject: async (projectId) => {
        try {
          set({ isLoading: true });
          await api.deleteProject(projectId);

          set((state) => {
            // Remove deleted project from list
            const filteredProjects = state.projects.filter((p) => p.id !== projectId);

            // If deleted project was active, switch to first available project
            let newActiveId = state.activeProjectId;
            if (state.activeProjectId === projectId) {
              newActiveId = filteredProjects.length > 0 ? filteredProjects[0].id : null;
              // Clear messages when switching projects
              if (newActiveId) {
                useChatStore.getState().clearMessages();
              }
            }

            return {
              projects: filteredProjects,
              activeProjectId: newActiveId,
              isLoading: false
            };
          });

          // Show success toast
          // Requirements: 12.4
          const { showToastSuccess } = get();
          if (showToastSuccess) {
            showToastSuccess('项目删除成功');
          }
        } catch (error) {
          console.error('Failed to delete project:', error);
          set({ isLoading: false });
          throw error;
        }
      },

      renameProjectLocally: (projectId, newName) => {
        set((state) => ({
          projects: state.projects.map((p) =>
            p.id === projectId ? { ...p, name: newName } : p
          )
        }));
      }
    }),
    {
      name: 'project-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // The id is only a navigation preference. loadProjects() validates it
        // against the authenticated user's server-side project list on every
        // app start before it can become active again.
        activeProjectId: state.activeProjectId,
      }),
    }
  )
);

function getProjectStoreErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}
