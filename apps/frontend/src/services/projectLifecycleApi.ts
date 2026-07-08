import apiClient from './apiClient';

export type BeeGameProjectLifecycleOverview = {
  quota: {
    limit: number | null;
    used: number;
    remaining: number | null;
  };
  storage: {
    supabaseStorageConfigured: boolean;
  };
  projects: BeeGameProjectLifecycleProject[];
  recentDeletions: BeeGameProjectLifecycleDeletion[];
  recentRetentionRuns: BeeGameProjectLifecycleRetentionRun[];
};

export type BeeGameProjectLifecycleProject = {
  id: string;
  name: string;
  createdAt: number;
  rootPath?: string;
  lifecycle: {
    hasWorkspacePath: boolean;
    hasRuntimeSnapshot: boolean;
    phaseName?: string;
    updatedAt?: number;
  };
};

export type BeeGameProjectLifecycleDeletion = {
  projectId: string;
  deletedAt: string;
  cleanupOutcome: string;
  deletedWorkspacePath?: string;
  storageCleanupOutcome?: string;
};

export type BeeGameProjectLifecycleRetentionRun = {
  dryRun: boolean;
  ranAt: string;
  deploymentRecordsDeleted: number;
  deploymentRecordsRetained: number;
  deploymentRecordsPlannedForDeletion: number;
  previewRecordsSkipped: number;
  logRecordsSkipped: number;
};

export type BeeGameProjectRetentionItem = {
  id: string;
  projectId?: string;
  sessionId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  deployedAt?: string;
  artifactPath?: string;
  reason: string;
};

export type BeeGameProjectRetentionResult = {
  dryRun: boolean;
  summary: {
    deploymentRecordsRetained: number;
    deploymentRecordsPlannedForDeletion: number;
    deploymentRecordsDeleted: number;
    deploymentArtifactsSkipped: number;
    previewRecordsSkipped: number;
    logRecordsSkipped: number;
  };
  deploymentRecords: {
    retained: BeeGameProjectRetentionItem[];
    plannedForDeletion: BeeGameProjectRetentionItem[];
    deleted: BeeGameProjectRetentionItem[];
    skipped: BeeGameProjectRetentionItem[];
  };
  previewRecords: {
    skipped: Array<{ reason: string }>;
  };
  logs: {
    skipped: Array<{ reason: string }>;
  };
};

export const getProjectLifecycleOverview = (): Promise<BeeGameProjectLifecycleOverview> => (
  apiClient.get('/api/admin/projects/lifecycle')
);

export const planProjectRetention = (): Promise<BeeGameProjectRetentionResult> => (
  apiClient.get('/api/admin/projects/retention/plan')
);

export const runProjectRetention = (): Promise<BeeGameProjectRetentionResult> => (
  apiClient.post('/api/admin/projects/retention/run')
);
