import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, ExternalLink, Gamepad2, LoaderCircle } from 'lucide-react';
import { api, type BeeGameDeploymentDiscussionConfirmation, type BeeGameDeploymentPayload, type BeeGameDeploymentReadiness } from '../../services/api';
import { API_BASE_URL } from '../../services/apiClient';
import { Button } from '../beui/project-button';
import { CenterMorphModal, CenterMorphModalContent } from '../beui/registry/components/motion/center-morph-modal';
import { useToastContext } from '../../contexts/ToastContext';

export interface WorkspaceDeploymentDialogProps {
  projectId: string;
  projectName: string;
  isOpen: boolean;
  deployments: BeeGameDeploymentPayload[];
  labels: Record<string, string>;
  onClose: () => void;
  onOpenExternal?: (url: string) => void;
  onFixDeploymentFailure?: () => void | Promise<void>;
  onDeploy: (confirmation?: BeeGameDeploymentDiscussionConfirmation) => void | Promise<void>;
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

export function WorkspaceDeploymentDialog(props: WorkspaceDeploymentDialogProps) {
  return <WorkspaceDeploymentDialogContent key={props.projectId} {...props} />;
}

function WorkspaceDeploymentDialogContent({
  projectId,
  projectName,
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
  const { showError } = useToastContext();
  const [readiness, setReadiness] = useState<BeeGameDeploymentReadiness>();
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [checkVersion, setCheckVersion] = useState(0);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [discussionConfirmed, setDiscussionConfirmed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [republishForId, setRepublishForId] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) {
      setRepublishForId(null);
      return;
    }
    let disposed = false;
    // An earlier opening's approval must not authorize a new publication while readiness refreshes.
    /* eslint-disable react-hooks/set-state-in-effect */
    setChecking(true); setReadiness(undefined); setError(''); setCopied(false); setDiscussionConfirmed(false); setShowHistory(false);
    /* eslint-enable react-hooks/set-state-in-effect */
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
    catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      showError(message);
    }
    finally { setSubmitting(false); }
  };
  const latest = deployments[0];
  const latestUrl = normalizeUrl(latest?.url);
  const failureLog = latest?.status === 'failed' ? latest.buildLog || latest.message || labels.deploymentFailed : '';
  const busy = isDeploying || submitting;
  const activeStatus = latest && ['queued', 'building', 'publishing'].includes(latest.status) ? latest.status : undefined;
  const published = latest?.status === 'succeeded' && Boolean(latestUrl);
  const failed = latest?.status === 'failed';
  const confirmation = readiness?.confirmationRequired;
  // Readiness describes a possible *next* publication. It must not appear as
  // an unfinished condition of the version that is already live.
  const showReadiness = !published || republishForId === latest?.id;
  const canPublish = canDeploy && !busy && !checking && readiness?.destination === 'remote' &&
    (readiness.allowed || Boolean(confirmation && discussionConfirmed));
  const submitDeployment = () => void perform(() => onDeploy(confirmation ? {
    measurementId: confirmation.measurementId,
    requirementsRevision: confirmation.requirementsRevision,
    discussionConfirmation: { messageRequestKeys: confirmation.messages.map(item => item.requestKey) },
  } : undefined));
  const requestRepublish = () => {
    if (!latest || busy || !canDeploy || checking) return;
    if (!showReadiness && (confirmation || !readiness?.allowed)) {
      setRepublishForId(latest.id);
      setDiscussionConfirmed(false);
      return;
    }
    submitDeployment();
  };
  const openLive = () => { if (latestUrl) onOpenExternal?.(latestUrl); };
  const copyLive = () => {
    if (!latestUrl) return;
    void navigator.clipboard.writeText(latestUrl).then(() => setCopied(true)).catch(reason => showError(String(reason)));
  };

  return (
    <CenterMorphModal open={isOpen} onOpenChange={open => !open && onClose()}>
      <CenterMorphModalContent ariaLabel={showHistory ? labels.deploymentVersions : labels.deploy} closeButtonLabel={labels.close || 'Close'} backdropClassName="bg-black/38 backdrop-blur-[2px]" className="flex min-h-[365px] max-h-[calc(100dvh-32px)] max-w-[510px] flex-col overflow-hidden rounded-[20px] bg-popover p-0 text-foreground">
        <div className="flex items-center justify-between pl-6 pr-14 pt-6 sm:pl-[30px]">
          <div className="flex min-w-0 items-center gap-2">
            {showHistory ? <Button type="button" variant="ghost" size="icon-xs" aria-label={labels.deploymentBack} onClick={() => setShowHistory(false)} className="-ml-2 rounded-full"><ArrowLeft className="size-4" /></Button> : null}
            <h2 className="type-body-lg font-semibold">{showHistory ? labels.deploymentVersions : labels.deploy}</h2>
          </div>
        </div>

        {showHistory ? <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-7 sm:px-[30px]">
          {deployments.length ? <div className="divide-y divide-border">{deployments.map((deployment, index) => {
            const deploymentUrl = normalizeUrl(deployment.url);
            const canRollback = index > 0 && deployment.status === 'succeeded' && Boolean(onRollback);
            return <div key={deployment.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
              <div className="min-w-0"><p className="type-callout truncate">{labels.version} {deployments.length - index}</p><p className="type-footnote mt-1 text-muted-foreground">{statusLabel(deployment.status, labels)}{deployment.deployedAt || deployment.updatedAt ? ` · ${formatTime(deployment.deployedAt || deployment.updatedAt)}` : ''}</p></div>
              <div className="flex shrink-0 items-center gap-1">{deploymentUrl ? <Button type="button" variant="ghost" size="icon" aria-label={labels.open} onClick={() => onOpenExternal?.(deploymentUrl)}><ExternalLink className="size-4" /></Button> : null}{canRollback ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void perform(() => onRollback?.(deployment.id))}>{labels.rollback}</Button> : null}</div>
            </div>;
          })}</div> : <div role="status" className="flex min-h-[235px] items-center justify-center text-center type-callout text-muted-foreground">{labels.deploymentNoVersions}</div>}
        </div> : <>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8 text-center sm:px-[30px]" aria-live="polite">
            <span className="mb-5 grid size-[54px] shrink-0 place-items-center rounded-[14px] bg-[var(--surface-3)] text-[var(--text-secondary)]">
              {busy || activeStatus ? <LoaderCircle className="size-6 animate-spin" /> : published ? <Check className="size-6" /> : <Gamepad2 className="size-6" />}
            </span>
            <p className="type-body-lg max-w-full truncate font-semibold">{published ? labels.deploymentPublishedTitle.replace('{projectName}', projectName) : projectName}</p>
            <p className="type-callout mt-2 max-w-[325px] text-muted-foreground">
              {busy || activeStatus ? statusLabel(activeStatus || 'queued', labels) : published ? labels.deploymentPublishedDescription : failed ? labels.deploymentFailed : checking ? labels.deploymentChecking : canPublish ? labels.deploymentReadyDescription : labels.deploymentBlocked}
            </p>
            {busy || activeStatus ? <p role="status" className="type-footnote mt-2 text-muted-foreground">{labels.deploymentBackground}</p> : null}
            {published ? <div className="mt-5 flex min-w-0 max-w-full items-center gap-2 rounded-[10px] bg-[var(--surface-3)] py-2 pl-4 pr-2 text-left">
              <span className="type-footnote min-w-0 truncate" title={latestUrl}>{latestUrl}</span>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={copied ? labels.deploymentCopied : labels.deploymentCopyLink} onClick={copyLive} className="shrink-0 rounded-md bg-[var(--surface-1)] text-foreground">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}</Button>
            </div> : null}
            {failed && failureLog ? <pre className="type-code-sm mt-5 max-h-28 w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-3)] p-3 text-left text-destructive">{failureLog}</pre> : null}
            {showReadiness && readiness?.destination === 'local' ? <p role="alert" className="type-footnote mt-5 text-destructive">{labels.deploymentNotConfigured}</p> : null}
            {showReadiness && readiness && !readiness.allowed && !confirmation && readiness.issues.length ? <div role="alert" className="type-footnote mt-5 max-h-28 w-full overflow-y-auto text-left text-destructive"><p>{labels.deploymentVerificationScope}</p><ul className="mt-2 list-disc space-y-1 pl-5">{readiness.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div> : null}
            {showReadiness && confirmation ? <div className="type-footnote mt-5 w-full text-left">
              <p className="font-medium">{labels.deploymentDiscussionTitle}</p>
              <p className="mt-1 text-muted-foreground">{labels.deploymentDiscussionScope}</p>
              <ul className="mt-2 max-h-28 list-disc overflow-y-auto pl-5">{confirmation.messages.map(item => <li key={item.requestKey} className="whitespace-pre-wrap break-words">{item.text}</li>)}</ul>
              <label className="mt-3 flex cursor-pointer items-start gap-2"><input type="checkbox" checked={discussionConfirmed} onChange={event => setDiscussionConfirmed(event.target.checked)} /><span>{labels.deploymentDiscussionConfirm}</span></label>
            </div> : null}
            {error ? <p role="alert" className="type-footnote mt-5 max-h-32 w-full overflow-y-auto whitespace-pre-wrap break-words text-left text-destructive">{error}</p> : null}
            {showReadiness && !busy && !checking && (error || !readiness?.allowed) ? <Button variant="ghost" size="sm" onClick={() => { setChecking(true); setReadiness(undefined); setError(''); setDiscussionConfirmed(false); setCheckVersion(value => value + 1); }} className="mt-3 rounded-full">{labels.deploymentRecheck}</Button> : null}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-6 py-4 sm:px-[30px]">
            <button type="button" onClick={() => setShowHistory(true)} className="type-footnote text-[var(--text-secondary)] hover:text-foreground">{labels.deploymentVersions}</button>
            <div className="flex items-center gap-3">
              {published && !busy ? <Button type="button" variant="ghost" size="sm" onClick={requestRepublish} disabled={showReadiness ? !canPublish : !canDeploy || checking} className="rounded-full">{labels.redeploy}</Button> : null}
              {failed && onFixDeploymentFailure ? <Button type="button" variant="ghost" size="sm" onClick={() => void perform(onFixDeploymentFailure)} disabled={busy} className="rounded-full">{labels.fixBuildErrors}</Button> : null}
              {published ? <Button type="button" onClick={openLive} disabled={!onOpenExternal} className="min-w-[90px] rounded-full px-5">{labels.deploymentOpenGame}</Button> : <Button type="button" aria-label={busy || activeStatus ? labels.deploying : failed ? labels.redeploy : labels.deploymentPublishAction} onClick={submitDeployment} disabled={!canPublish} className="min-w-[76px] rounded-full px-5">{busy || activeStatus ? labels.deploying : failed ? labels.redeploy : labels.deploymentPublishAction}</Button>}
            </div>
          </div>
        </>}
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
