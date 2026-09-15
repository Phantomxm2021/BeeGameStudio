import { ExternalLink, FileText, RefreshCw, Rocket, X } from 'lucide-react';
import type { BeeGameDeploymentPayload } from '../../services/api';
import { Button } from '../beui/project-button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';

export interface WorkspaceDeploymentDialogProps {
  isOpen: boolean;
  deployments: BeeGameDeploymentPayload[];
  labels: Record<string, string>;
  onClose: () => void;
  onOpenExternal?: (url: string) => void;
  onFixDeploymentFailure?: () => void | Promise<void>;
  onDeploy: () => void | Promise<void>;
  onRollback?: (deploymentId: string) => void | Promise<void>;
  isDeploying: boolean;
  canDeploy: boolean;
}

const normalizeUrl = (url?: string): string => {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (typeof window === 'undefined') return value;
  return new URL(value, window.location.origin).toString();
};

const formatTime = (value?: string): string => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const statusLabel = (status: BeeGameDeploymentPayload['status'] | undefined, labels: Record<string, string>): string => {
  if (status === 'succeeded') return labels.deploymentSucceeded;
  if (status === 'failed') return labels.deploymentFailed;
  if (status === 'building') return labels.deploymentBuilding;
  if (status === 'publishing') return labels.deploymentPublishing;
  return labels.deploymentQueued;
};

export function WorkspaceDeploymentDialog({
  isOpen,
  deployments,
  labels,
  onClose,
  onOpenExternal,
  onFixDeploymentFailure,
  onDeploy,
  onRollback,
  isDeploying,
  canDeploy,
}: WorkspaceDeploymentDialogProps) {
  if (!isOpen) return null;
  const latest = deployments[0];
  const latestUrl = normalizeUrl(latest?.url);
  const failureLog = latest?.status === 'failed' ? latest.buildLog || latest.message || labels.deploymentFailed : '';

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[min(720px,calc(100dvh-32px))] max-w-2xl bg-[var(--popover)] p-6 text-[var(--text-primary)]">
        <Button type="button" variant="ghost" size="icon" aria-label={labels.close || 'Close'} onClick={onClose} className="absolute right-4 top-4 text-[var(--text-secondary)]"><X className="h-4 w-4" /></Button>
        <DialogTitle className="type-title-2 pr-12">{labels.deploy}</DialogTitle>
        <DialogDescription className="type-callout mt-2 text-[var(--text-secondary)]">{labels.deploymentDialogDescription}</DialogDescription>

        <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="type-caption-1 text-[var(--text-muted)]">{labels.deploymentLatest}</div>
              <div className="mt-2 flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${latest?.status === 'succeeded' ? 'bg-[var(--success)]' : latest?.status === 'failed' ? 'bg-[var(--destructive)]' : latest ? 'bg-[var(--warning)]' : 'bg-[var(--text-disabled)]'}`} />
                <span className="type-headline truncate">{latest ? statusLabel(latest.status, labels) : labels.deploymentNotPublished}</span>
              </div>
              {latest?.deployedAt || latest?.updatedAt ? <div className="type-footnote mt-1 text-[var(--text-muted)]">{formatTime(latest.deployedAt || latest.updatedAt)}</div> : null}
            </div>
            <Button type="button" aria-label={isDeploying ? labels.deploying : latest ? labels.redeploy : labels.deploy} onClick={() => void onDeploy()} disabled={!canDeploy} className="h-9 shrink-0">
              {isDeploying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {isDeploying ? labels.deploying : latest ? labels.redeploy : labels.deploy}
            </Button>
          </div>
          {failureLog ? <pre className="type-code-sm mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[var(--destructive)]">{failureLog}</pre> : latestUrl ? <div className="mt-3 flex items-center justify-between gap-3 text-[var(--text-secondary)]"><span className="truncate">{latestUrl}</span><Button type="button" variant="ghost" size="icon" aria-label={labels.openLive} onClick={() => onOpenExternal?.(latestUrl)}><ExternalLink className="h-4 w-4" /></Button></div> : <p className="type-footnote mt-3 text-[var(--text-muted)]">{labels.deploymentNotPublishedHint}</p>}
          {failureLog ? <Button type="button" variant="link" onClick={() => void onFixDeploymentFailure?.()} className="mt-3 text-[var(--info)]">{labels.fixBuildErrors}</Button> : null}
        </div>

        <div className="mt-6">
          <div className="type-caption-1 mb-3 text-[var(--text-muted)]">{labels.deploymentVersions}</div>
          {deployments.length > 0 ? <div className="space-y-2">{deployments.map((deployment, index) => {
            const deploymentUrl = normalizeUrl(deployment.url);
            const canRollback = index > 0 && deployment.status === 'succeeded' && Boolean(onRollback);
            return <div key={deployment.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"><div className="flex min-w-0 items-center gap-3"><FileText className="h-4 w-4 shrink-0 text-[var(--text-muted)]" /><div className="min-w-0"><div className="type-callout truncate">{labels.version} {deployments.length - index}</div><div className="type-footnote truncate text-[var(--text-muted)]">{statusLabel(deployment.status, labels)} · {formatTime(deployment.deployedAt || deployment.updatedAt)}</div></div></div><div className="flex shrink-0 items-center gap-2">{deploymentUrl ? <Button type="button" variant="ghost" size="icon" aria-label={labels.open} onClick={() => onOpenExternal?.(deploymentUrl)}><ExternalLink className="h-4 w-4" /></Button> : null}{canRollback ? <Button type="button" variant="link" disabled={isDeploying} onClick={() => void onRollback?.(deployment.id)} className="text-[var(--info)]">{labels.rollback || 'Rollback'}</Button> : null}</div></div>;
          })}</div> : <div className="rounded-lg border border-[var(--border)] px-3 py-4 text-[var(--text-muted)]">{labels.deploymentNoVersions}</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
