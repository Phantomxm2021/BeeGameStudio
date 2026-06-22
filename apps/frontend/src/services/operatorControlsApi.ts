import apiClient from './apiClient';
import type {
  ResetGddApprovalResponse,
  ResetGddApprovalSourceMode,
  StageControlAnchor,
  StageControlInspectPayload,
  StageControlResetPayload,
  StageControlStartPayload,
} from '../types/operatorControls';

export const operatorControlsApi = {
  resetGddApproval: (projectId: string, sourceMode: ResetGddApprovalSourceMode = 'latest_review_or_baseline') =>
    apiClient.post(
      `/api/operator-controls/projects/${projectId}/reset-gdd-approval`,
      { source_mode: sourceMode },
      { headers: { 'Hide-Error-Toast': 'true' } },
    ) as Promise<ResetGddApprovalResponse>,

  getStageControls: (projectId: string) =>
    apiClient.get(
      `/api/operator-controls/projects/${projectId}/stage-controls`,
      { headers: { 'Hide-Error-Toast': 'true' } },
    ) as Promise<StageControlInspectPayload>,

  resetStageAnchor: (
    projectId: string,
    anchor: StageControlAnchor,
    sourceMode: ResetGddApprovalSourceMode = 'latest_review_or_baseline',
  ) =>
    apiClient.post(
      `/api/operator-controls/projects/${projectId}/reset-stage-anchor`,
      { anchor, source_mode: sourceMode },
      { headers: { 'Hide-Error-Toast': 'true' } },
    ) as Promise<StageControlResetPayload>,

  startStageAnchor: (
    projectId: string,
    anchor: StageControlAnchor,
    resumeMode: 'manual_stage_start' = 'manual_stage_start',
  ) =>
    apiClient.post(
      `/api/operator-controls/projects/${projectId}/start-stage-anchor`,
      { anchor, resume_mode: resumeMode },
      { headers: { 'Hide-Error-Toast': 'true' } },
    ) as Promise<StageControlStartPayload>,
};
