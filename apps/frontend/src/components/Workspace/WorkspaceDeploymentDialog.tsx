import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ExternalLink, ImagePlus, Loader2, Share, WandSparkles } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { api, type BeeGameDeploymentRequest, type BeeGameDeploymentPayload, type BeeGameDeploymentReadiness } from '../../services/api';
import { API_BASE_URL } from '../../services/apiClient';
import { portalDeploymentUrl, portalProjectUrl } from '../../utils/portalDeploymentUrl';
import { Button } from '../beui/project-button';
import { CenterMorphModal, CenterMorphModalContent } from '../beui/registry/components/motion/center-morph-modal';
import { PresenceGate } from '../beui/registry/lib/presence-gate';
import { useToastContext } from '../../contexts/ToastContext';
import { DeploymentProgress } from './DeploymentProgress';
import { PublicationMarkdown } from '../Common/PublicationMarkdown';

export interface WorkspaceDeploymentDialogProps {
  projectId: string;
  projectName: string;
  isOpen: boolean;
  deployments: BeeGameDeploymentPayload[];
  labels: Record<string, string>;
  onClose: () => void;
  onOpenExternal?: (url: string) => void;
  onFixDeploymentFailure?: () => void | Promise<void>;
  onDeploy: (confirmation?: BeeGameDeploymentRequest) => void | Promise<void>;
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
  onRollback,
  onFixDeploymentFailure,
  onDeploy,
  isDeploying,
  canDeploy,
}: WorkspaceDeploymentDialogProps) {
  const { showError } = useToastContext();
  const [readiness, setReadiness] = useState<BeeGameDeploymentReadiness>();
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [discussionConfirmed, setDiscussionConfirmed] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // An opening starts in the editor. Only a publication observed or started
  // during this opening may replace it with the persistent completion page.
  const [publicationBaseline, setPublicationBaseline] = useState<string | null>();
  const reduced = useReducedMotion();
  const [republishForId, setRepublishForId] = useState<string | null>(null);
  const latestSuccessful = deployments.find(deployment => deployment.status === 'succeeded' && normalizeUrl(deployment.url));
  const [description, setDescription] = useState(latestSuccessful?.publicDescription || '');
  const [previewDescription, setPreviewDescription] = useState(false);
  const [cover, setCover] = useState<BeeGameDeploymentRequest['publicationCover']>();
  const [readingCover, setReadingCover] = useState(false);
  const [filling, setFilling] = useState(false);
  const fillRequest = useRef(0);
  const [coverError, setCoverError] = useState('');
  const coverInput = useRef<HTMLInputElement>(null);
  const coverRequest = useRef(0);
  useEffect(() => {
    ++coverRequest.current;
    ++fillRequest.current;
    /* eslint-disable react-hooks/set-state-in-effect */
    setDescription(latestSuccessful?.publicDescription || '');
    setPreviewDescription(false);
    setCover(undefined); setCoverError(''); setReadingCover(false);
    setFilling(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => { ++coverRequest.current; ++fillRequest.current; };
  }, [isOpen, latestSuccessful?.id, latestSuccessful?.publicDescription]);
  const selectCover = async (file: File) => {
    const request = ++coverRequest.current;
    setCoverError(''); setReadingCover(true);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(labels.deploymentCoverFormat);
      if (!file.size || file.size > 10 * 1024 * 1024) throw new Error(labels.deploymentCoverSize);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(labels.deploymentCoverReadError));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(labels.deploymentCoverReadError));
        image.src = dataUrl;
      });
      if (!image.naturalWidth || image.naturalWidth * 9 !== image.naturalHeight * 16) {
        throw new Error(labels.deploymentCoverRatio.replace('{width}', String(image.naturalWidth)).replace('{height}', String(image.naturalHeight)));
      }
      if (request === coverRequest.current) setCover({ mediaType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
        filename: file.name, data: dataUrl.slice(dataUrl.indexOf(',') + 1) });
    } catch (reason) {
      if (request === coverRequest.current) setCoverError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === coverRequest.current) setReadingCover(false);
    }
  };
  const fillFromProject = async () => {
    if (filling || readingCover || isDeploying || submitting || !canDeploy) return;
    const request = ++fillRequest.current;
    setFilling(true); setError(''); setCoverError('');
    const [draft, picture] = await Promise.allSettled([
      api.generatePublicationDescription(projectId), api.capturePublicationCover(projectId),
    ]);
    if (request !== fillRequest.current) return;
    const errors: string[] = [];
    if (draft.status === 'fulfilled') setDescription(draft.value.description);
    else errors.push(`${labels.deploymentDescription}: ${draft.reason instanceof Error ? draft.reason.message : String(draft.reason)}`);
    if (picture.status === 'fulfilled') setCover(picture.value);
    else errors.push(`${labels.deploymentCover}: ${picture.reason instanceof Error ? picture.reason.message : String(picture.reason)}`);
    if (errors.length) setError(errors.join('\n'));
    setFilling(false);
  };
  useEffect(() => {
    if (!isOpen) {
      setRepublishForId(null);
      setPublicationBaseline(undefined);
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
  }, [projectId, isOpen]);
  const perform = async (action: () => void | Promise<void>) => {
    if (submitting || isDeploying) return;
    setSubmitting(true); setError('');
    try { await action(); }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      setPublicationBaseline(undefined);
      showError(message);
    }
    finally { setSubmitting(false); }
  };
  const latest = deployments[0];
  const latestUrl = latestSuccessful
    ? portalProjectUrl(latestSuccessful.portalPublishedAt ? import.meta.env.VITE_BEEGAME_GAME_PORTAL_BASE_URL : undefined, projectId, normalizeUrl(latestSuccessful.url))
    : '';
  const failureLog = latest?.status === 'failed' ? latest.buildLog || latest.message || labels.deploymentFailed : '';
  const busy = isDeploying || submitting;
  const activeStatus = latest?.status === 'queued' || latest?.status === 'building' || latest?.status === 'publishing' ? latest.status : undefined;
  const showingProgress = busy || Boolean(activeStatus);
  const published = latest?.status === 'succeeded' && Boolean(latestUrl);
  const failed = latest?.status === 'failed';
  const showCompleted = published && !showingProgress && publicationBaseline !== undefined && latest.id !== publicationBaseline;
  const historyView = showHistory && !activeStatus && !showCompleted;
  const statusView = (showingProgress || showCompleted) && !historyView;
  // Keep the existing history's version numbering, using this release's real
  // position in the complete server-supplied deployment history.
  const publishedVersion = latestSuccessful ? deployments.length - deployments.findIndex(item => item.id === latestSuccessful.id) : 0;
  useEffect(() => {
    if (isOpen && activeStatus) setPublicationBaseline(previous => previous === undefined ? latestSuccessful?.id ?? null : previous);
  }, [isOpen, activeStatus, latestSuccessful?.id]);
  const confirmation = readiness?.confirmationRequired;
  // Readiness describes a possible *next* publication. It must not appear as
  // an unfinished condition of the version that is already live.
  const showReadiness = !published || republishForId === latest?.id;
  useEffect(() => {
    if (isOpen && !statusView && showReadiness && readiness && !readiness.allowed && !confirmation && readiness.issues.length) {
      showError([labels.deploymentVerificationScope, ...readiness.issues].join('\n'));
    }
  }, [isOpen, statusView, showReadiness, readiness, confirmation, labels.deploymentVerificationScope, showError]);
  const coverUrl = cover ? `data:${cover.mediaType};base64,${cover.data}` : normalizeUrl(latestSuccessful?.publicCoverUrl);
  const canPublish = canDeploy && !readingCover && !filling && !busy && !checking && readiness?.destination === 'remote' &&
    (readiness.allowed || Boolean(confirmation && discussionConfirmed));
  const submitDeployment = () => {
    if (readingCover || filling) return;
    const request: BeeGameDeploymentRequest = {
      ...(confirmation ? { measurementId: confirmation.measurementId,
        requirementsRevision: confirmation.requirementsRevision,
        discussionConfirmation: { messageRequestKeys: confirmation.messages.map(item => item.requestKey) } } : {}),
      ...(description.trim() || latestSuccessful?.publicDescription ? {
        publicationDescription: { text: description.trim(), confirmed: true as const },
      } : {}),
      ...(cover ? { publicationCover: cover } : {}),
    };
    setShowHistory(false);
    setPublicationBaseline(latestSuccessful?.id ?? null);
    setCopied(false);
    void perform(() => onDeploy(Object.keys(request).length ? request : undefined));
  };
  const requestRepublish = () => {
    if (!latest || busy || !canDeploy || checking || readingCover || filling) return;
    if (!showReadiness && (confirmation || !readiness?.allowed)) {
      setRepublishForId(latest.id);
      setDiscussionConfirmed(false);
      return;
    }
    submitDeployment();
  };
  const copyLive = async () => {
    if (!latestUrl) return;
    try {
      await navigator.clipboard.writeText(latestUrl);
      setCopied(true);
    } catch {
      setCopied(false);
      showError(labels.deploymentShareFailed);
    }
  };
  const ease = [0.22, 1, 0.36, 1] as const;
  const element = {
    hidden: { opacity: 0, y: reduced ? 0 : 6 },
    visible: { opacity: 1, y: 0, transition: { duration: reduced ? 0 : 0.28, ease } },
  };

  return (
    <CenterMorphModal open={isOpen} onOpenChange={open => !open && onClose()}>
      <CenterMorphModalContent ariaLabel={historyView ? labels.deploymentVersions : showCompleted ? labels.deploymentCompleteTitle : labels.deploy} closeButtonLabel={labels.close || 'Close'} layout="size"
        backdropClassName="bg-black/38 backdrop-blur-[2px]"
        className={`flex min-h-[365px] max-h-[calc(100dvh-32px)] flex-col overflow-hidden rounded-[24px] bg-popover p-0 text-foreground ${statusView ? 'max-w-[408px]' : 'max-w-[510px]'}`}>
        <AnimatePresence mode="wait" initial={false}>
          {historyView ? <motion.div key="history" initial={{ opacity: 0, x: reduced ? 0 : 10 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: reduced ? 0 : 10 }} transition={{ duration: reduced ? 0 : 0.2, ease }} className="flex min-h-0 flex-1 flex-col">
            <PresenceGate>{({ gate }) => <div {...gate} className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center gap-2 pl-6 pr-14 pt-6 sm:pl-[30px]">
                <Button type="button" variant="ghost" size="icon-xs" aria-label={labels.deploymentBack} onClick={() => setShowHistory(false)} className="-ml-2 rounded-full"><ArrowLeft className="size-4" /></Button>
                <h2 className="type-body-lg font-semibold">{labels.deploymentVersions}</h2>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-7 sm:px-[30px]">
          {deployments.length ? <div className="divide-y divide-border">{deployments.map((deployment, index) => {
            const deploymentUrl = portalDeploymentUrl(deployment.portalPublishedAt ? import.meta.env.VITE_BEEGAME_GAME_PORTAL_BASE_URL : undefined, normalizeUrl(deployment.url), deployment.id);
            const canRollback = index > 0 && deployment.status === 'succeeded' && Boolean(onRollback);
            return <div key={deployment.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
              <div className="min-w-0"><p className="type-callout truncate">{labels.version} {deployments.length - index}</p><p className="type-footnote mt-1 text-muted-foreground">{statusLabel(deployment.status, labels)}{deployment.deployedAt || deployment.updatedAt ? ` · ${formatTime(deployment.deployedAt || deployment.updatedAt)}` : ''}</p></div>
              <div className="flex shrink-0 items-center gap-1">{deploymentUrl ? <Button type="button" variant="ghost" size="icon" aria-label={labels.open} onClick={() => onOpenExternal?.(deploymentUrl)}><ExternalLink className="size-4" /></Button> : null}{canRollback ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void perform(() => onRollback?.(deployment.id))}>{labels.rollback}</Button> : null}</div>
            </div>;
          })}</div> : <div role="status" className="flex min-h-[235px] items-center justify-center text-center type-callout text-muted-foreground">{labels.deploymentNoVersions}</div>}
              </div>
            </div>}</PresenceGate>
          </motion.div> : statusView ? <motion.div key="publication" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.15 } }} className="min-h-0 overflow-y-auto">
            <DeploymentProgress status={showCompleted ? 'succeeded' : activeStatus || 'queued'} projectName={projectName}
              version={publishedVersion} copied={copied} onShare={copyLive} labels={labels} />
          </motion.div> : <motion.div key="editor" initial="hidden" animate="visible"
            exit={{ opacity: 0, y: reduced ? 0 : -5, transition: { duration: reduced ? 0 : 0.15 } }}
            variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: reduced ? 0 : 0.045 } } }}
            className="flex min-h-0 flex-1 flex-col">
            <PresenceGate>{({ gate }) => <div {...gate} className="flex min-h-0 flex-1 flex-col">
              <motion.h2 variants={element} className="type-body-lg shrink-0 px-6 pt-6 font-semibold sm:px-[30px]">{labels.deploy}</motion.h2>
          <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-6 text-center sm:px-[30px]" aria-live="polite">
            <motion.p variants={element} className="type-body-lg shrink-0 max-w-full truncate font-semibold">{published && !showingProgress ? labels.deploymentPublishedTitle.replace('{projectName}', projectName) : projectName}</motion.p>
            {!published && !showingProgress ? <p className="type-callout shrink-0 mt-2 max-w-[325px] text-muted-foreground">
              {failed ? labels.deploymentFailed : checking ? labels.deploymentChecking : canPublish ? labels.deploymentReadyDescription : labels.deploymentBlocked}
            </p> : null}
            {failed && failureLog ? <pre className="type-code-sm shrink-0 mt-5 max-h-28 w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-3)] p-3 text-left text-destructive">{failureLog}</pre> : null}
            {showReadiness && readiness?.destination === 'local' ? <p role="alert" className="type-footnote shrink-0 mt-5 text-destructive">{labels.deploymentNotConfigured}</p> : null}
            {showReadiness && confirmation ? <div className="type-footnote shrink-0 mt-5 w-full text-left">
              <p className="font-medium">{labels.deploymentDiscussionTitle}</p>
              <p className="mt-1 text-muted-foreground">{labels.deploymentDiscussionScope}</p>
              <ul className="mt-2 max-h-28 list-disc overflow-y-auto pl-5">{confirmation.messages.map(item => <li key={item.requestKey} className="whitespace-pre-wrap break-words">{item.text}</li>)}</ul>
              <label className="mt-3 flex cursor-pointer items-start gap-2"><input type="checkbox" checked={discussionConfirmed} onChange={event => setDiscussionConfirmed(event.target.checked)} /><span>{labels.deploymentDiscussionConfirm}</span></label>
            </div> : null}
            {error ? <p role="alert" className="type-footnote shrink-0 mt-5 max-h-32 w-full overflow-y-auto whitespace-pre-wrap break-words text-left text-destructive">{error}</p> : null}
            {!busy && !activeStatus ? <motion.div variants={element} className="mt-5 w-full shrink-0 text-left">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2"><span className="type-callout font-medium">{labels.deploymentCover}</span><span className="type-footnote text-muted-foreground">16:9</span></div>
                <Button type="button" variant="ghost" size="sm" onClick={() => void fillFromProject()} disabled={!canDeploy || filling || readingCover}
                  title={labels.deploymentAutofillHint} className="h-7 gap-1.5 rounded-full px-2 text-xs">
                  {filling ? <Loader2 className="size-3.5 animate-spin" /> : <WandSparkles className="size-3.5" />}
                  {filling ? labels.deploymentAutofilling : labels.deploymentAutofill}
                </Button>
              </div>
              <div className="group relative aspect-video overflow-hidden rounded-[11px] bg-[var(--surface-3)]">
                {coverUrl ? <img src={coverUrl} alt={labels.deploymentCover} className="absolute inset-0 size-full object-cover" /> : null}
                <Button type="button" variant="ghost" size="sm" disabled={!canDeploy || readingCover || filling} onClick={() => coverInput.current?.click()}
                  className={coverUrl ? 'absolute bottom-3 right-3 gap-2 rounded-lg bg-popover/95 text-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100' : 'absolute inset-0 size-full gap-2 rounded-[11px] text-muted-foreground'}>
                  <ImagePlus className="size-4" />{readingCover ? labels.deploymentCoverReading : coverUrl ? labels.deploymentCoverReplace : labels.deploymentCoverUpload}
                </Button>
              </div>
              <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label={labels.deploymentCoverUpload} className="hidden" onChange={event => {
                const file = event.target.files?.[0]; event.target.value = ''; if (file) void selectCover(file);
              }} />
              {coverError ? <p role="alert" className="type-footnote mt-2 text-destructive">{coverError}</p> : null}
              <div className="mb-2 mt-5 flex items-center justify-between gap-2">
                <label htmlFor="publication-description" className="type-callout font-medium">{labels.deploymentDescription}</label>
                <div className="flex items-center gap-2"><span className="type-footnote text-muted-foreground">Markdown</span>
                  <Button type="button" variant="ghost" size="sm" className="h-7 rounded-full px-2 text-xs"
                    disabled={filling || !description.trim()} aria-pressed={previewDescription} onClick={() => setPreviewDescription(value => !value)}>
                    {previewDescription ? labels.deploymentDescriptionEdit : labels.deploymentDescriptionPreview}
                  </Button>
                </div>
              </div>
              {previewDescription ? <div role="region" aria-label={labels.deploymentDescriptionPreview} className="type-callout min-h-24 max-h-44 overflow-y-auto rounded-lg border border-border p-3">
                <PublicationMarkdown>{description}</PublicationMarkdown>
              </div> : <textarea id="publication-description" rows={3} maxLength={4000} value={description}
                disabled={!canDeploy || filling}
                onChange={event => setDescription(event.target.value)}
                className="type-callout w-full resize-y rounded-lg border border-border bg-transparent p-3 leading-relaxed" />}
            </motion.div> : null}

          </div>
          <motion.div variants={element} className="flex shrink-0 items-center gap-3 border-t border-border px-6 py-4 sm:px-[30px]">
            <button type="button" onClick={() => setShowHistory(true)} className="type-footnote mr-auto text-muted-foreground hover:text-foreground">{labels.deploymentVersions}</button>
            {failed && onFixDeploymentFailure ? <Button type="button" variant="ghost" size="sm" onClick={() => void perform(onFixDeploymentFailure)} disabled={busy} className="rounded-full">{labels.fixBuildErrors}</Button> : null}
            {latestUrl ? <Button type="button" variant="ghost" size="sm" onClick={copyLive} className="gap-2 rounded-full">
              {copied ? <Check className="size-4" /> : <Share className="size-4" />}{copied ? labels.deploymentCopied : labels.deploymentShare}
            </Button> : null}
            {published ? <Button type="button" onClick={requestRepublish} disabled={busy || readingCover || filling || (showReadiness ? !canPublish : !canDeploy || checking)} className="min-w-[90px] rounded-full px-5">{labels.deploymentPublishUpdate}</Button>
              : <Button type="button" onClick={submitDeployment} disabled={!canPublish} className="min-w-[90px] rounded-full px-5">{failed ? labels.redeploy : labels.deploymentPublishAction}</Button>}
          </motion.div>
            </div>}</PresenceGate>
          </motion.div>}
        </AnimatePresence>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}
