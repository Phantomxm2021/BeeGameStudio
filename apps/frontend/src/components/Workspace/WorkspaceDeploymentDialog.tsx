import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, FileText, RefreshCw, Rocket } from 'lucide-react';
import { api, type BeeGameDeploymentPayload, type BeeGameDeploymentReadiness } from '../../services/api';
import { API_BASE_URL } from '../../services/apiClient';
import { AnimatedBadge, type AnimatedBadgeStatus } from '../beui/registry/components/motion/animated-badge';
import { Button } from '../beui/project-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../beui/motion/tabs';
import { CloseIconButton } from '../ui/CloseIconButton';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';

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

const statusTone = (status: BeeGameDeploymentPayload['status'] | undefined): AnimatedBadgeStatus => {
  if (status === 'succeeded') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'queued' || status === 'building' || status === 'publishing') return 'loading';
  return 'neutral';
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
      <DialogContent className="flex h-[min(680px,calc(100dvh-32px))] max-h-[calc(100dvh-32px)] max-w-2xl flex-col overflow-hidden p-5 text-foreground sm:p-6">
        <CloseIconButton label={labels.close || 'Close'} onClick={onClose} className="absolute right-4 top-4 text-[var(--text-secondary)]" />
        <DialogTitle className="type-title-2 pr-12">{labels.deploy}</DialogTitle>
        <Tabs defaultValue="publish" className="mt-5 flex-1">
          <TabsList aria-label={labels.deploy}>
            <TabsTrigger value="publish">{labels.deploy}</TabsTrigger>
            <TabsTrigger value="history">{labels.deploymentVersions}</TabsTrigger>
          </TabsList>

          <TabsContent value="publish" className="space-y-4 overflow-y-auto pt-4">
            <div className="space-y-2 type-footnote" aria-live="polite">
              {checking ? <p role="status" className="text-muted-foreground">{labels.deploymentChecking}</p> : null}
              {readiness?.destination === 'local' ? <p className="text-destructive">{labels.deploymentNotConfigured}</p> : null}
              {readiness && !readiness.allowed ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3"><p>{labels.deploymentBlocked}</p><p className="mt-1 text-muted-foreground">{labels.deploymentVerificationScope}</p><ul className="mt-1 list-disc pl-5">{readiness.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div> : null}
              {error ? <p role="alert" className="whitespace-pre-wrap text-destructive">{error}</p> : null}
              {!busy && !checking && (error || !readiness?.allowed) ? <Button variant="outline" size="sm" onClick={() => setCheckVersion(value => value + 1)}>{labels.deploymentRecheck}</Button> : null}
            </div>

            <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="type-caption-1 text-muted-foreground">{labels.deploymentLatest}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <AnimatedBadge status={statusTone(latest?.status)} size="sm" contentKey={latest?.status ?? 'unpublished'}>
                      {latest ? statusLabel(latest.status, labels) : labels.deploymentNotPublished}
                    </AnimatedBadge>
                  </div>
                  {latest?.deployedAt || latest?.updatedAt ? <div className="type-footnote mt-1 text-muted-foreground">{formatTime(latest.deployedAt || latest.updatedAt)}</div> : null}
                </div>
                <Button type="button" aria-label={isDeploying ? labels.deploying : latest ? labels.redeploy : labels.deploy} onClick={() => void perform(onDeploy)} disabled={!canPublish} className="shrink-0">
                  {isDeploying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  {isDeploying ? labels.deploying : latest ? labels.redeploy : labels.deploy}
                </Button>
              </div>

              {busy || activeStatus ? <div role="status" className="mt-4 flex flex-wrap items-center gap-2">
                {!activeStatus ? <AnimatedBadge status="loading" size="sm">{statusLabel('queued', labels)}</AnimatedBadge> : null}
                <p className="type-footnote text-muted-foreground">{labels.deploymentBackground}</p>
              </div> : null}
              {failureLog ? <pre className="type-code-sm mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words text-destructive">{failureLog}</pre> : null}
              {failureLog && onFixDeploymentFailure ? <Button type="button" variant="outline" size="sm" onClick={() => void perform(onFixDeploymentFailure)} disabled={busy} className="mt-3">{labels.fixBuildErrors}</Button> : null}
            </div>

            {latestUrl ? <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="type-caption-1 text-muted-foreground">{labels.openLive}</div>
                <div className="type-callout truncate" title={latestUrl}>{latestUrl}</div>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={labels.openLive} onClick={() => onOpenExternal?.(latestUrl)}><ExternalLink className="h-4 w-4" /></Button>
              <Button type="button" variant="outline" size="icon" aria-label={copied ? labels.deploymentCopied : labels.deploymentCopyLink} onClick={() => {
                void navigator.clipboard.writeText(latestUrl).then(() => setCopied(true)).catch(reason => setError(String(reason)));
              }}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button>
            </div> : null}
          </TabsContent>

          <TabsContent value="history" className="space-y-2 overflow-y-auto pt-4">
            {deployments.length > 0 ? <div className="space-y-2">{deployments.map((deployment, index) => {
              const deploymentUrl = normalizeUrl(deployment.url);
              const canRollback = index > 0 && deployment.status === 'succeeded' && Boolean(onRollback);
              return <div key={deployment.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2.5"><div className="flex min-w-0 items-center gap-3"><FileText className="h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><div className="type-callout truncate">{labels.version} {deployments.length - index}</div><div className="mt-1"><AnimatedBadge status={statusTone(deployment.status)} size="sm" contentKey={deployment.status}>{statusLabel(deployment.status, labels)}</AnimatedBadge></div><div className="type-footnote mt-1 truncate text-muted-foreground">{formatTime(deployment.deployedAt || deployment.updatedAt)}</div></div></div><div className="flex shrink-0 items-center gap-2">{deploymentUrl ? <Button type="button" variant="ghost" size="icon" aria-label={labels.open} onClick={() => onOpenExternal?.(deploymentUrl)}><ExternalLink className="h-4 w-4" /></Button> : null}{canRollback ? <Button type="button" variant="outline" size="sm" disabled={isDeploying} onClick={() => void onRollback?.(deployment.id)}>{labels.rollback || 'Rollback'}</Button> : null}</div></div>;
            })}</div> : <div className="flex min-h-full items-center justify-center py-4">
              <div role="status" className="flex w-full flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-10 text-center">
                <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><FileText className="h-5 w-5" /></span>
                <p className="type-callout text-muted-foreground">{labels.deploymentNoVersions}</p>
              </div>
            </div>}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
