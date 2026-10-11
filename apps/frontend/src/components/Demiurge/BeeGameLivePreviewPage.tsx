import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronLeft, Copy, LoaderCircle, Play, Square, Upload } from 'lucide-react';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import type { Language } from './AgentsConfig';
import { useBeeGameText } from '../../i18n/useBeeGameTranslations';
import { Button } from '../beui/project-button';
import { SettingsMenu } from './Landing/SettingsMenu';
import {
  closeResourceLibraryRoute,
  isResourceLibraryRoute,
  openResourceLibraryRoute,
} from '../ResourceLibrary/resourceLibraryRoute';
import { CreditStoreModal } from './Landing/CreditStoreModal';
import { ProjectHistoryModal } from './Landing/ProjectHistoryModal';
import { ProfileModal } from './Landing/ProfileModal';
import type { BeeGameDeploymentPayload, BuildReportPayload } from '../../services/api';
import type { TokenUsage } from '../../types/message';
import { useSystemStore } from '../../store/systemStore';
import { useProjectStore } from '../../store/projectStore';
import { clearSupabaseSession } from '../../services/supabaseAuthApi';
import { buildApiUrl } from '../../services/apiClient';
import { WorkspaceShell } from '../Workspace/WorkspaceShell';
import { WorkspacePreviewPanel } from '../Workspace/WorkspacePreviewPanel';
import { WorkspaceDeploymentDialog } from '../Workspace/WorkspaceDeploymentDialog';
import { ProductionReviewPanel } from './ProductionReviewPanel';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { CloseIconButton } from '../ui/CloseIconButton';
import { ThemeToggle } from '../beui/motion/theme-toggle';
import { AccountActionsMenu } from './Landing/AccountActionsMenu';
import { MorphPopover, MorphPopoverContent, MorphPopoverTrigger } from '../beui/registry/components/motion/popover-morph';
import { AnimatedBadge } from '../beui/registry/components/motion/animated-badge';

const ResourceLibraryPage = lazy(async () => {
  const module = await import('../ResourceLibrary/ResourceLibraryView');
  return { default: module.ResourceLibraryPage };
});

export type DashboardStatus = 'starting' | 'running' | 'paused' | 'waiting_approval' | 'stopped' | 'finished' | 'idle' | 'offline';
type PreviewState = 'starting' | 'live' | 'failed' | 'stopped' | 'idle';

interface BeeGameLivePreviewPageProps {
  projectId: string;
  lang: Language;
  projectName: string;
  status: DashboardStatus;
  phaseLabel: string;
  handoffNotice?: string;
  credits?: {
    consumedCredits: number;
    weightedTokens?: number;
  } | null;
  accountCreditBalance?: {
    balanceCredits: number;
    consumedCredits: number;
  } | null;
  isSyncing: boolean;
  isInteractionLocked?: boolean;
  isWorkspaceBusy?: boolean;
  isAgentWorking?: boolean;
  buildReport?: BuildReportPayload | null;
  projectTarget?: string;
  tokenUsage?: TokenUsage | null;
  projectCreatedAt?: number;
  deployments?: BeeGameDeploymentPayload[];
  previewRefreshNonce?: number;
  onStartPreview?: () => void | Promise<void>;
  onStopPreview?: () => void | Promise<void>;
  onDeployProject?: () => void | Promise<void>;
  onRollbackDeployment?: (deploymentId: string) => void | Promise<void>;
  onFixDeploymentFailure?: () => void | Promise<void>;
  onFixConsoleError?: (message: string) => Promise<boolean | void>;
  onOpenExternal?: (url: string) => void;
  isDeploying?: boolean;
  onBack?: () => void;
  onSetLang: (lang: Language) => void;
  collaboration?: ReactNode;
}

const normalizeUrl = (url?: string): string => {
  const value = String(url || '').trim();
  if (!value) return '';
  return value.startsWith('/') ? buildApiUrl(value) : value;
};

const getPreviewState = (status: DashboardStatus, buildReport?: BuildReportPayload | null): PreviewState => {
  const reportStatus = String(buildReport?.status || '').toLowerCase();
  const url = normalizeUrl(buildReport?.build_url);

  if (reportStatus === 'failed' || reportStatus === 'error') return 'failed';
  if (url) return 'live';
  if (status === 'paused' || status === 'stopped' || status === 'offline') return 'stopped';
  return 'idle';
};

function ProjectSyncBadge({ active, syncingLabel, syncedLabel }: {
  active: boolean;
  syncingLabel: string;
  syncedLabel: string;
}) {
  const reduceMotion = useReducedMotion();
  const [state, setState] = useState({ active, showCompletion: false });
  if (state.active !== active) {
    setState({ active, showCompletion: !active });
  }

  useEffect(() => {
    if (!state.showCompletion) return;
    const timer = window.setTimeout(() => setState(current => ({ ...current, showCompletion: false })), 1_000);
    return () => window.clearTimeout(timer);
  }, [state.showCompletion]);

  return <AnimatePresence initial={false}>
    {active || state.showCompletion ? <AnimatedBadge
      key="project-sync"
      status={active ? 'loading' : 'success'}
      size="md"
      contentKey={active ? 'syncing' : 'synced'}
      data-testid="beegame-sync-status"
      className="max-[899px]:hidden"
      aria-live="polite"
      exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : {
        opacity: 0, y: -4, scale: 0.96, transition: { duration: 0.2 },
      }}
    >
      {active ? syncingLabel : syncedLabel}
    </AnimatedBadge> : null}
  </AnimatePresence>;
}

export function BeeGameLivePreviewPage({
  projectId,
  lang,
  projectName,
  status,
  handoffNotice,
  credits,
  accountCreditBalance,
  tokenUsage,
  projectCreatedAt,
  isSyncing,
  isInteractionLocked = false,
  isWorkspaceBusy = false,
  isAgentWorking = false,
  buildReport,
  deployments = [],
  previewRefreshNonce = 0,
  onStartPreview,
  onStopPreview,
  onDeployProject,
  onRollbackDeployment,
  onFixDeploymentFailure,
  onFixConsoleError,
  onOpenExternal,
  isDeploying = false,
  onBack,
  onSetLang,
  collaboration,
}: BeeGameLivePreviewPageProps) {
  const [isProductionReviewOpen, setProductionReviewOpen] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [isResourceLibraryOpen, setIsResourceLibraryOpen] = useState(() => isResourceLibraryRoute());
  const [isCreditStoreOpen, setCreditStoreOpen] = useState(false);
  const [isHistoryOpen, setHistoryOpen] = useState(false);
  const [isProfileOpen, setProfileOpen] = useState(false);
  const [isProjectMenuOpen, setProjectMenuOpen] = useState(false);
  useEffect(() => {
    const syncResourceRoute = () => setIsResourceLibraryOpen(isResourceLibraryRoute());
    window.addEventListener('popstate', syncResourceRoute);
    return () => window.removeEventListener('popstate', syncResourceRoute);
  }, []);
  const [isDeploymentDialogOpen, setDeploymentDialogOpen] = useState(false);
  const [stoppedPreviewUrl, setStoppedPreviewUrl] = useState('');
  const [isStartingPreview, setStartingPreview] = useState(false);
  const [isStoppingPreview, setStoppingPreview] = useState(false);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const uiText = useBeeGameText(lang);
  const labels = uiText.livePreview as Record<string, string>;
  const backHomeLabel = lang.startsWith('zh') ? '返回主页' : 'Back to home';
  const currentUser = useSystemStore(state => state.currentUser);
  const loadCurrentUser = useSystemStore(state => state.loadCurrentUser);
  const previewUrl = normalizeUrl(buildReport?.build_url);
  const embeddedPreviewUrl = useMemo(() => {
    if (!previewUrl || previewRefreshNonce <= 0 || typeof window === 'undefined') return previewUrl;
    try {
      const url = new URL(previewUrl, window.location.origin);
      url.searchParams.set('__beegame_preview_refresh', String(previewRefreshNonce));
      return /^https?:\/\//i.test(previewUrl) ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return previewUrl;
    }
  }, [previewRefreshNonce, previewUrl]);
  const isPreviewLocallyStopped = Boolean(previewUrl && stoppedPreviewUrl === previewUrl);
  const previewState = isStartingPreview
    ? 'starting'
    : isPreviewLocallyStopped
      ? 'stopped'
      : getPreviewState(status, buildReport);
  const canShowPreview = previewState === 'live' && Boolean(previewUrl);
  const canStartPreview =
    Boolean(onStartPreview) &&
    !canShowPreview &&
    !isStartingPreview &&
    !isStoppingPreview &&
    !isInteractionLocked &&
    !isWorkspaceBusy;
  const canStopPreview = Boolean(onStopPreview) && canShowPreview && !isStoppingPreview && !isInteractionLocked && !isWorkspaceBusy;
  const canDeploy = Boolean(onDeployProject) && !isDeploying && !isInteractionLocked && !isWorkspaceBusy;
  const showsAgentWorkingStatus = isAgentWorking && !canShowPreview;
  const statusText =
    showsAgentWorkingStatus
      ? labels.agentWorking
      : isStartingPreview
        ? labels.starting
        : previewState === 'failed'
          ? labels.failed
          : previewState === 'live'
            ? labels.live
            : labels.standby;
  const previewDetailText =
    previewState === 'failed' ? buildReport?.failure_reason || buildReport?.summary || labels.noPreview : '';
  const handleStop = async () => {
    if (!canStopPreview || isInteractionLocked) return;
    setStoppingPreview(true);
    try {
      await onStopPreview?.();
      if (previewUrl) setStoppedPreviewUrl(previewUrl);
    } finally {
      setStoppingPreview(false);
    }
  };
  const handlePlay = async () => {
    if (isInteractionLocked || isWorkspaceBusy || isStartingPreview) return;
    setStoppedPreviewUrl('');
    setStartingPreview(true);
    try {
      await onStartPreview?.();
    } finally {
      setStartingPreview(false);
    }
  };
  const handleDeploy = async () => {
    if (isInteractionLocked || isWorkspaceBusy) return;
    await onDeployProject?.();
  };
  const closeAccountSurfaces = () => {
    setSettingsOpen(false);
    setCreditStoreOpen(false);
    setHistoryOpen(false);
    setProfileOpen(false);
  };
  const handleSelectProject = async (projectId: string) => {
    if (isInteractionLocked) return;
    setHistoryOpen(false);
    await useProjectStore.getState().setActiveProject(projectId);
  };
  const handleSignOut = async () => {
    closeAccountSurfaces();
    clearSupabaseSession();
    await loadCurrentUser?.();
    onBack?.();
  };
  useEffect(() => {
    // A new preview identity must not inherit the locally stopped state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStoppedPreviewUrl('');
  }, [previewRefreshNonce, previewUrl]);

  const workspaceHeader = (
    <div className="workspace-header flex min-w-0 items-center">
      <header
        data-testid="beegame-shell-top-nav"
        className="relative z-[90] flex h-12 min-w-0 flex-1 items-center px-2 sm:h-14"
      >
        <div className="relative flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
          <button
            type="button"
            aria-label={backHomeLabel}
            title={backHomeLabel}
            onClick={onBack}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-transparent bg-transparent text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:border-[var(--border-strong)] focus-visible:bg-[var(--surface-hover)] focus-visible:text-[var(--text-primary)] focus-visible:outline-none sm:h-10 sm:w-10"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </button>
          <MorphPopover open={isProjectMenuOpen} onOpenChange={setProjectMenuOpen} className="min-w-0 max-w-[min(52vw,28rem)]">
            <MorphPopoverTrigger>
              <button type="button" data-testid="beegame-project-info-trigger" aria-label={`${projectName}, ${labels.projectInfo || 'Project info'}`}
              className="group flex min-w-0 max-w-[min(52vw,28rem)] flex-[0_1_auto] items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-left transition hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <span data-testid="beegame-project-trigger" className="type-body-lg min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]">{projectName}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform group-data-[open]:rotate-180" aria-hidden="true" />
              </button>
            </MorphPopoverTrigger>
            <MorphPopoverContent align="start" radius={16} className="w-[min(20rem,calc(100vw-1rem))] bg-popover text-popover-foreground">
              <div id="beegame-project-hint" data-testid="beegame-project-hint" className="px-4 py-3">
                <ProjectNameCopy name={projectName} copyLabel={labels.copyProjectName} copiedLabel={labels.projectNameCopied} failedLabel={labels.projectNameCopyFailed} />
                <div className="mt-2">
                  <ProjectElapsedRow startedAt={projectCreatedAt} label={labels.projectRunTime} detail={labels.projectRunTimeDetail} lang={lang} />
                  <ProjectHintRow label={labels.consumedCredits} value={formatCreditAmount(credits?.consumedCredits)} />
                  <ProjectHintRow label={labels.inputTokens} value={formatUsage(tokenUsage?.input_tokens ?? tokenUsage?.prompt_tokens)} />
                  <ProjectHintRow label={labels.cachedInputTokens} value={formatUsage(tokenUsage?.cache_read_tokens ?? tokenUsage?.cached_input_tokens)} />
                  <ProjectHintRow label={labels.outputTokens} value={formatUsage(tokenUsage?.output_tokens ?? tokenUsage?.completion_tokens)} />
                </div>
              </div>
            </MorphPopoverContent>
          </MorphPopover>
          <ProjectSyncBadge active={isSyncing || status === 'starting'} syncingLabel={labels.syncing} syncedLabel={labels.synced} />
          {handoffNotice ? (
            <div
              data-testid="beegame-foundation-handoff-notice"
              className="type-footnote max-w-[24rem] truncate rounded-md border border-[var(--success)] bg-[var(--surface-2)] px-3 py-1 text-[var(--success)] max-[899px]:hidden"
            >
              {handoffNotice}
            </div>
          ) : null}
        </div>
        <div className="workspace-header-actions ml-1 flex shrink-0 items-center gap-2 sm:ml-auto sm:gap-3">
          <ThemeToggle />
          <Button variant="ghost" size="sm" disabled={isInteractionLocked || isWorkspaceBusy} onClick={() => setProductionReviewOpen(value => !value)}>{lang.startsWith('zh') ? '制作验收' : 'Production review'}</Button>
          <div data-testid="beegame-preview-deploy-control" className="flex h-10 min-w-10 shrink-0 items-stretch overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-2)] min-[900px]:min-w-[204px]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={canShowPreview ? labels.stop : labels.play}
              aria-busy={isStartingPreview || isStoppingPreview}
              disabled={canShowPreview ? !canStopPreview : !canStartPreview}
              onClick={() => void (canShowPreview ? handleStop() : handlePlay())}
              className="h-full min-w-0 flex-1 justify-center rounded-none border-0 px-3 text-[var(--text-primary)] hover:bg-[var(--surface-hover)] sm:px-5"
            >
              {isStartingPreview || isStoppingPreview ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : canShowPreview ? <Square className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
              <span className="max-[899px]:hidden">{canShowPreview ? labels.stop : uiText.preview}</span>
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              aria-label={isDeploying ? labels.deploying : labels.deploy}
              disabled={!canDeploy}
              onClick={() => { if (canDeploy) setDeploymentDialogOpen(true); }}
              className="h-full min-w-10 shrink-0 rounded-none border-0 border-l border-[var(--border)] px-3 min-[900px]:w-[84px] min-[900px]:min-w-[84px]"
            >
              <Upload className="h-3.5 w-3.5 min-[900px]:hidden" />
              <span className="max-[899px]:hidden">{isDeploying ? labels.deploying : labels.deploy}</span>
            </Button>
          </div>
          <AccountActionsMenu
            lang={lang}
            isSettingsOpen={isSettingsOpen}
            isHistoryOpen={isHistoryOpen}
            isProfileOpen={isProfileOpen}
            isCreditStoreOpen={isCreditStoreOpen}
            isResourceLibraryOpen={isResourceLibraryOpen}
            currentUserId={currentUser?.id}
            currentUserDisplayName={currentUser?.displayName}
            currentUserEmail={currentUser?.email}
            currentUserAvatarUrl={currentUser?.avatarUrl}
            creditBalance={accountCreditBalance?.balanceCredits}
            canManageResources={currentUser?.role === 'owner' || currentUser?.permissions.includes('resources.manage')}
            onOpenProfile={() => { closeAccountSurfaces(); setProfileOpen(true); }}
            onOpenCreditStore={() => { closeAccountSurfaces(); setCreditStoreOpen(true); }}
            onToggleSettings={() => { closeAccountSurfaces(); setSettingsOpen(true); }}
            onOpenResourceLibrary={() => { openResourceLibraryRoute(); closeAccountSurfaces(); setIsResourceLibraryOpen(true); }}
            onToggleHistory={() => { closeAccountSurfaces(); setHistoryOpen(true); }}
            onOpenLogin={() => setProfileOpen(true)}
            onSignOut={currentUser ? () => void handleSignOut() : undefined}
          />
        </div>
      </header>

    </div>
  );

  const workspacePreview = (
    <WorkspacePreviewPanel
      title={uiText.previewTitle}
      labels={labels}
      embeddedPreviewUrl={embeddedPreviewUrl}
      previewState={previewState}
      statusText={statusText}
      previewDetailText={previewDetailText}
      previewFrameRef={previewFrameRef}
      canShowPreview={canShowPreview}
      isAgentWorking={showsAgentWorkingStatus}
      onOpenExternal={onOpenExternal}
      onFixConsoleError={onFixConsoleError}
    />
  );

  return (
    <div data-testid="beegame-live-preview-page" className="contents">
      <WorkspaceShell
        header={workspaceHeader}
        preview={workspacePreview}
        collaboration={collaboration ?? <div className="workspace-collaboration-panel" />}
      />

      <SettingsMenu isOpen={isSettingsOpen} lang={lang} onClose={() => setSettingsOpen(false)} onSetLang={onSetLang} />
      {isResourceLibraryOpen ? (
        <Suspense
          fallback={
            <div
              role="status"
              aria-label="Loading resource library"
              aria-busy="true"
              className="fixed inset-0 z-[200] grid place-items-center bg-[var(--surface-1)] text-[var(--text-primary)]"
            >
              <span className="size-7 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--primary)]" />
            </div>
          }
        >
          <ResourceLibraryPage
            onBack={() => {
              closeResourceLibraryRoute();
              setIsResourceLibraryOpen(false);
            }}
          />
        </Suspense>
      ) : null}
      <ProjectHistoryModal
        isOpen={isHistoryOpen}
        lang={lang}
        onClose={() => setHistoryOpen(false)}
        onSelectProject={projectId => void handleSelectProject(projectId)}
      />
      <CreditStoreModal isOpen={isCreditStoreOpen} lang={lang} onClose={() => setCreditStoreOpen(false)} />
      <ProfileModal
        isOpen={isProfileOpen}
        lang={lang}
        currentUser={currentUser}
        creditBalance={accountCreditBalance ?? null}
        onClose={() => setProfileOpen(false)}
        onUserChanged={async () => {
          await loadCurrentUser();
        }}
      />
      {isProductionReviewOpen && <Dialog open onOpenChange={open => !open && setProductionReviewOpen(false)}>
        <DialogContent className="max-h-[calc(100dvh-32px)] max-w-2xl overflow-y-auto p-5 text-foreground">
          <CloseIconButton label={lang.startsWith('zh') ? '关闭' : 'Close'} onClick={() => setProductionReviewOpen(false)} className="absolute right-4 top-4" />
          <DialogTitle className="pr-12">{lang.startsWith('zh') ? '制作验收' : 'Production review'}</DialogTitle>
          <ProductionReviewPanel projectId={projectId} chinese={lang.startsWith('zh')} />
        </DialogContent>
      </Dialog>}
      <WorkspaceDeploymentDialog
        projectId={projectId}
        isOpen={isDeploymentDialogOpen}
        deployments={deployments}
        labels={labels}
        onClose={() => setDeploymentDialogOpen(false)}
        onOpenExternal={onOpenExternal}
        onFixDeploymentFailure={onFixDeploymentFailure}
        onDeploy={handleDeploy}
        onRollback={onRollbackDeployment}
        isDeploying={isDeploying}
        canDeploy={canDeploy}
      />
    </div>
  );
}



function formatCreditAmount(value?: number): string {
  return value === undefined ? '—' : Math.max(0, value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatUsage(value?: number): string {
  return value === undefined ? '—' : Math.max(0, value).toLocaleString();
}

function ProjectNameCopy({ name, copyLabel, copiedLabel, failedLabel }: {
  name: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 2_000);
    return () => window.clearTimeout(timer);
  }, [copyState]);
  const buttonLabel = copyState === 'copied' ? copiedLabel : copyState === 'failed' ? failedLabel : copyLabel;

  return <div className="flex min-w-0 items-center justify-between gap-2">
    <span className="type-footnote min-w-0 truncate text-[var(--text-primary)]" title={name}>{name}</span>
    <button
      type="button"
      aria-label={buttonLabel}
      title={buttonLabel}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(name);
          setCopyState('copied');
        } catch {
          setCopyState('failed');
        }
      }}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      {copyState === 'copied' ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
    </button>
  </div>;
}

function ProjectElapsedRow({ startedAt, label, detail, lang }: {
  startedAt?: number;
  label: string;
  detail: string;
  lang: Language;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!Number.isFinite(startedAt) || !startedAt || startedAt > now) {
    return <ProjectHintRow label={label} value="—" detail={detail} />;
  }
  const totalMinutes = Math.floor((now - startedAt) / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const value = lang.startsWith('zh')
    ? [days && `${days}天`, (days || hours) && `${hours}小时`, `${minutes}分钟`].filter(Boolean).join(' ')
    : [days && `${days}d`, (days || hours) && `${hours}h`, `${minutes}m`].filter(Boolean).join(' ');
  return <ProjectHintRow label={label} value={value} detail={detail} />;
}

function ProjectHintRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] py-2 last:border-b-0">
      <div className="type-caption-1 shrink-0 text-[var(--text-muted)]">{label}</div>
      <div className="type-callout min-w-0 truncate text-right text-[var(--text-primary)]" title={detail}>
        {value}
      </div>
    </div>
  );
}
