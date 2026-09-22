import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, FileText, RefreshCw, Rocket, X } from 'lucide-react';
import { api, type BeeGameDeploymentPayload, type BeeGameDeploymentReadiness } from '../../services/api';
import { API_BASE_URL } from '../../services/apiClient';
import { Button } from '../beui/project-button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';

export interface WorkspaceDeploymentDialogProps {
  projectId: string;
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
  try {
    const url = new URL(value, new URL(API_BASE_URL || '/', window.location.origin));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch { return ''; }
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
  projectId,
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
  const [readiness, setReadiness] = useState<BeeGameDeploymentReadiness>();
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkVersion, setCheckVersion] = useState(0);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    setChecking(true); setReadiness(undefined); setError(''); setCopied(false);
    void api.getDeploymentReadiness(projectId).then(value => {
      if (!disposed) setReadiness(value);
    }).catch(reason => {
      if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (!disposed) setChecking(false); });
    return () => { disposed = true; };
  }, [projectId, isOpen, checkVersion]);
  const perform = async (action: () => void | Promise<void>) => {
    if (submitting || isDeploying) return;
    setSubmitting(true); setError('');
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSubmitting(false); }
  };
  if (!isOpen) return null;
  const latest = deployments[0];
  const latestUrl = normalizeUrl(latest?.url);
  const failureLog = latest?.status === 'failed' ? latest.buildLog || latest.message || labels.deploymentFailed : '';
  const busy = isDeploying || submitting;
  const activeStatus = latest && ['queued', 'building', 'publishing'].includes(latest.status) ? latest.status : undefined;
  const canPublish = canDeploy && !busy && !checking && readiness?.allowed === true && readiness.destination === 'remote';

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[min(720px,calc(100dvh-32px))] max-w-2xl overflow-y-auto bg-[var(--popover)] p-6 text-[var(--text-primary)]">
        <Button type="button" variant="ghost" size="icon" aria-label={labels.close || 'Close'} onClick={onClose} className="absolute right-4 top-4 text-[var(--text-secondary)]"><X className="h-4 w-4" /></Button>
        <DialogTitle className="type-title-2 pr-12">{labels.deploy}</DialogTitle>
        <DialogDescription className="type-callout mt-2 text-[var(--text-secondary)]">{labels.deploymentDialogDescription}</DialogDescription>
        <div className="mt-4 space-y-2 type-footnote" aria-live="polite">
          {checking ? <p role="status">{labels.deploymentChecking}</p> : null}
          <p className="text-[var(--text-secondary)]">{labels.deploymentVerificationScope}</p>
          {readiness?.workflow?.phase === 'ACCEPTANCE' && readiness.workflow.status === 'needs_action' ?
            <p className="text-[var(--text-secondary)]">{labels.deploymentAcceptanceRequired}</p> : null}
          {readiness?.destination === 'remote' ? <p className="text-[var(--text-secondary)]">{labels.deploymentPublicNotice}</p> : null}
          {readiness?.destination === 'local' ? <p className="text-[var(--destructive)]">{labels.deploymentNotConfigured}</p> : null}
          {readiness && !readiness.allowed ? <div role="alert"><p>{labels.deploymentBlocked}</p><ul className="mt-1 list-disc pl-5">{readiness.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div> : null}
          {error ? <p role="alert" className="whitespace-pre-wrap text-[var(--destructive)]">{error}</p> : null}
          {!busy && !checking && (error || !readiness?.allowed) ? <Button variant="link" onClick={() => setCheckVersion(value => value + 1)}>{labels.deploymentRecheck}</Button> : null}
        </div>

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
            <Button type="button" aria-label={isDeploying ? labels.deploying : latest ? labels.redeploy : labels.deploy} onClick={() => void perform(onDeploy)} disabled={!canPublish} className="h-9 shrink-0 rounded-full">
              {isDeploying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {isDeploying ? labels.deploying : latest ? labels.redeploy : labels.deploy}
            </Button>
          </div>
          {busy || activeStatus ? <div role="status" className="mt-4 space-y-2">
            <div className="flex gap-2">{(['queued', 'building', 'publishing'] as const).map(status => <div key={status} className={`h-1 flex-1 rounded-full ${activeStatus === status ? 'animate-pulse bg-[var(--text-primary)]' : 'bg-[var(--border)]'}`} />)}</div>
            <p className="type-footnote text-[var(--text-secondary)]">{statusLabel(activeStatus || 'queued', labels)} · {labels.deploymentBackground}</p>
          </div> : null}
          {latest?.status === 'succeeded' && latestUrl ? <Button variant="outline" className="mt-3 rounded-full" onClick={() => {
            void navigator.clipboard.writeText(latestUrl).then(() => setCopied(true)).catch(reason => setError(String(reason)));
          }}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? labels.deploymentCopied : labels.deploymentCopyLink}</Button> : null}
          {failureLog ? <pre className="type-code-sm mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[var(--destructive)]">{failureLog}</pre> : latestUrl ? <div className="mt-3 flex items-center justify-between gap-3 text-[var(--text-secondary)]"><span className="truncate">{latestUrl}</span><Button type="button" variant="ghost" size="icon" aria-label={labels.openLive} onClick={() => onOpenExternal?.(latestUrl)}><ExternalLink className="h-4 w-4" /></Button></div> : <p className="type-footnote mt-3 text-[var(--text-muted)]">{labels.deploymentNotPublishedHint}</p>}
          {failureLog && onFixDeploymentFailure ? <Button type="button" variant="link" onClick={() => void perform(onFixDeploymentFailure)} disabled={busy} className="mt-3 text-[var(--info)]">{labels.fixBuildErrors}</Button> : null}
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
