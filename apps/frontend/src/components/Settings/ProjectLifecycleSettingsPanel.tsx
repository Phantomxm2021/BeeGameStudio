import type {
  BeeGameProjectLifecycleDeletion,
  BeeGameProjectLifecycleOverview,
  BeeGameProjectLifecycleProject,
  BeeGameProjectRetentionResult,
} from '../../services/projectLifecycleApi';
import { CreditMetric } from './BillingSettingsPanel';
import { Button } from '../beui/project-button';

export type ProjectLifecycleSettingsCopy = {
  tab: string;
  title: string;
  description: string;
  quotaUsage: string;
  quotaRemaining: string;
  storageCleanup: string;
  projectsValue: (count: number) => string;
  projectsLimitValue: (used: number, limit: number) => string;
  unlimited: string;
  remainingValue: (count: number) => string;
  supabaseEnabled: string;
  localOnly: string;
  retentionTitle: string;
  retentionDescription: string;
  dryRun: string;
  runRetention: string;
  retentionSummary: (planned: number, deleted: number, retained: number) => string;
  lastRetentionRun: string;
  dryRunLabel: string;
  deletedRunLabel: (count: number) => string;
  activeProjects: string;
  recentCleanup: string;
  noActiveProjects: string;
  noRecentCleanup: string;
  noWorkspacePath: string;
  snapshotSaved: string;
  noSnapshot: string;
  dryRunStatus: (count: number) => string;
  runStatus: (count: number) => string;
  dryRunFailed: string;
  runFailed: string;
  unavailable: string;
};

export function ProjectLifecyclePanel({
  overview,
  status,
  retentionResult,
  copy,
  isRetentionRunning,
  onPlanRetention,
  onRunRetention,
}: {
  overview: BeeGameProjectLifecycleOverview | null;
  status: string;
  retentionResult: BeeGameProjectRetentionResult | null;
  copy: ProjectLifecycleSettingsCopy;
  isRetentionRunning: boolean;
  onPlanRetention: () => void;
  onRunRetention: () => void;
}) {
  const quota = overview?.quota;
  const projectLimit = quota?.limit ?? null;
  const quotaValue =
    projectLimit === null
      ? copy.projectsValue(quota?.used ?? 0)
      : copy.projectsLimitValue(quota?.used ?? 0, projectLimit);
  const remainingValue = projectLimit === null ? copy.unlimited : copy.remainingValue(quota?.remaining ?? 0);
  const projects = overview?.projects ?? [];
  const deletions = overview?.recentDeletions ?? [];
  const retentionRuns = overview?.recentRetentionRuns ?? [];
  return (
    <div className="space-y-4 py-3">
      <div>
        <h3 className="type-subheadline text-foreground">{copy.title}</h3>
        <p className="type-footnote mt-1 text-muted-foreground">{copy.description}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <CreditMetric label={copy.quotaUsage} value={quotaValue} />
        <CreditMetric label={copy.quotaRemaining} value={remainingValue} />
        <CreditMetric
          label={copy.storageCleanup}
          value={overview?.storage.supabaseStorageConfigured ? copy.supabaseEnabled : copy.localOnly}
        />
      </div>
      {status ? (
        <div className="type-footnote rounded-lg border border-warning-300/20 bg-muted px-3 py-2 text-foreground">
          {status}
        </div>
      ) : null}
      <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="type-caption-1 text-muted-foreground">{copy.retentionTitle}</div>
            <div className="type-footnote text-foreground">{copy.retentionDescription}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isRetentionRunning}
              onClick={onPlanRetention}
              className="rounded-full"
            >
              {copy.dryRun}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isRetentionRunning}
              onClick={onRunRetention}
              className="rounded-full"
            >
              {copy.runRetention}
            </Button>
          </div>
        </div>
        {retentionResult ? (
          <div className="type-caption-1 text-muted-foreground">
            {copy.retentionSummary(
              retentionResult.summary.deploymentRecordsPlannedForDeletion,
              retentionResult.summary.deploymentRecordsDeleted,
              retentionResult.summary.deploymentRecordsRetained,
            )}
          </div>
        ) : null}
        {retentionRuns.length ? (
          <div className="space-y-1">
            <div className="type-caption-1 text-muted-foreground">{copy.lastRetentionRun}</div>
            <div className="max-h-24 space-y-1 overflow-y-auto pr-1">
              {retentionRuns.map(run => (
                <div key={`${run.ranAt}-${run.deploymentRecordsDeleted}`} className="type-footnote text-foreground">
                  {run.dryRun ? copy.dryRunLabel : copy.deletedRunLabel(run.deploymentRecordsDeleted)}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="space-y-2">
        <div className="type-caption-1 text-muted-foreground">{copy.activeProjects}</div>
        <div className="overflow-hidden rounded-lg border border-border">
          {projects.length ? (
            <div className="max-h-80 divide-y divide-border overflow-y-auto">
              {projects.map(project => (
                <ProjectLifecycleRow key={project.id} project={project} copy={copy} />
              ))}
            </div>
          ) : (
            <div className="type-footnote px-3 py-4 text-muted-foreground">{copy.noActiveProjects}</div>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <div className="type-caption-1 text-muted-foreground">{copy.recentCleanup}</div>
        <div className="overflow-hidden rounded-lg border border-border">
          {deletions.length ? (
            <div className="max-h-64 divide-y divide-border overflow-y-auto">
              {deletions.map(deletion => (
                <ProjectLifecycleDeletionRow
                  key={`${deletion.projectId}-${deletion.deletedAt}`}
                  deletion={deletion}
                  copy={copy}
                />
              ))}
            </div>
          ) : (
            <div className="type-footnote px-3 py-4 text-muted-foreground">{copy.noRecentCleanup}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectLifecycleRow({
  project,
  copy,
}: {
  project: BeeGameProjectLifecycleProject;
  copy: ProjectLifecycleSettingsCopy;
}) {
  return (
    <div className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="type-footnote break-all text-foreground">{project.name}</div>
        <div className="type-caption-1 break-all text-muted-foreground">{project.rootPath || copy.noWorkspacePath}</div>
      </div>
      <div className="type-caption-1 max-w-full break-all text-muted-foreground sm:max-w-48 sm:text-right">
        {project.lifecycle.phaseName || (project.lifecycle.hasRuntimeSnapshot ? copy.snapshotSaved : copy.noSnapshot)}
      </div>
    </div>
  );
}

function ProjectLifecycleDeletionRow({
  deletion,
  copy,
}: {
  deletion: BeeGameProjectLifecycleDeletion;
  copy: ProjectLifecycleSettingsCopy;
}) {
  return (
    <div className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="type-footnote break-all text-foreground">{deletion.projectId}</div>
        <div className="type-caption-1 break-all text-muted-foreground">
          {deletion.deletedWorkspacePath || copy.noWorkspacePath}
        </div>
      </div>
      <div className="type-caption-1 max-w-full break-all text-muted-foreground sm:max-w-48 sm:text-right">
        {deletion.cleanupOutcome}
      </div>
    </div>
  );
}
