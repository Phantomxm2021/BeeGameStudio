import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ProfileAvatarButton } from './ProfileAvatarButton';
import { ArrowLeft, ChevronDown, ExternalLink, FolderOpen, History, Play, RefreshCw, Settings, ShoppingCart, Square, Upload, UserCircle } from 'lucide-react';
import type { Language } from './AgentsConfig';
import { useBeeGameText, useCommonText } from '../../i18n/useBeeGameTranslations';
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
import { ThemeToggle } from '../beui/motion/theme-toggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

const ResourceLibraryPage = lazy(async () => {
  const module = await import('../ResourceLibrary/ResourceLibraryView');
  return { default: module.ResourceLibraryPage };
});

export type DashboardStatus = 'running' | 'paused' | 'waiting_approval' | 'stopped' | 'finished' | 'idle' | 'offline';
type PreviewState = 'starting' | 'live' | 'failed' | 'stopped' | 'idle';
type PreviewConsoleEntry = {
  level: string;
  message: string;
  createdAt?: string;
};

interface BeeGameLivePreviewPageProps {
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
  buildReport?: BuildReportPayload | null;
  projectTarget?: string;
  tokenUsage?: TokenUsage | null;
  deployments?: BeeGameDeploymentPayload[];
  previewRefreshNonce?: number;
  onStartPreview?: () => void | Promise<void>;
  onRestartPreview?: () => void | Promise<void>;
  onStopPreview?: () => void | Promise<void>;
  onDeployProject?: () => void | Promise<void>;
  onRollbackDeployment?: (deploymentId: string) => void | Promise<void>;
  onFixBuildErrors?: () => void | Promise<void>;
  onFixDeploymentFailure?: () => void | Promise<void>;
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

const getPreviewSessionId = (url?: string): string => {
  const value = normalizeUrl(url);
  if (!value || typeof window === 'undefined') return '';
  try {
    const parsed = new URL(value, window.location.origin);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'previews') return '';
    return decodeURIComponent(parts[1] || '');
  } catch {
    return '';
  }
};

const getPreviewState = (status: DashboardStatus, buildReport?: BuildReportPayload | null): PreviewState => {
  const reportStatus = String(buildReport?.status || '').toLowerCase();
  const url = normalizeUrl(buildReport?.build_url);

  if (reportStatus === 'failed' || reportStatus === 'error') return 'failed';
  if (url) return 'live';
  if (status === 'running' || status === 'waiting_approval') return 'starting';
  if (status === 'paused' || status === 'stopped' || status === 'offline') return 'stopped';
  return 'idle';
};

const collectBuildErrorLogs = (buildReport?: BuildReportPayload | null): string[] => {
  const reportStatus = String(buildReport?.status || '').toLowerCase();
  const isFailedReport = reportStatus === 'failed' || reportStatus === 'error';
  const logs = new Set<string>();
  const failureReason = String(buildReport?.failure_reason || '').trim();
  if (failureReason) logs.add(failureReason);

  for (const check of buildReport?.checks || []) {
    const checkStatus = String(check.status || '').toLowerCase();
    const isFailedCheck = checkStatus === 'failed' || checkStatus === 'error';
    const detail = String(check.detail || '').trim();
    if (!detail || (!isFailedReport && !isFailedCheck)) continue;
    const name = String(check.name || '').trim();
    logs.add(name ? `${name}: ${detail}` : detail);
  }

  return Array.from(logs);
};

export function BeeGameLivePreviewPage({
  lang,
  projectName,
  status,
  handoffNotice,
  credits,
  accountCreditBalance,
  isSyncing,
  isInteractionLocked = false,
  isWorkspaceBusy = false,
  buildReport,
  deployments = [],
  previewRefreshNonce = 0,
  onStartPreview,
  onRestartPreview,
  onStopPreview,
  onDeployProject,
  onRollbackDeployment,
  onFixBuildErrors,
  onFixDeploymentFailure,
  onOpenExternal,
  isDeploying = false,
  onBack,
  onSetLang,
  collaboration,
}: BeeGameLivePreviewPageProps) {
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [isResourceLibraryOpen, setIsResourceLibraryOpen] = useState(() => isResourceLibraryRoute());
  const [isCreditStoreOpen, setCreditStoreOpen] = useState(false);
  const [isHistoryOpen, setHistoryOpen] = useState(false);
  const [isProfileOpen, setProfileOpen] = useState(false);
  const [isProjectMenuOpen, setProjectMenuOpen] = useState(false);
  const [isProfileMenuOpen, setProfileMenuOpen] = useState(false);
  const [isPreviewMenuOpen, setPreviewMenuOpen] = useState(false);
  useEffect(() => {
    const syncResourceRoute = () => setIsResourceLibraryOpen(isResourceLibraryRoute());
    window.addEventListener('popstate', syncResourceRoute);
    return () => window.removeEventListener('popstate', syncResourceRoute);
  }, []);
  const [isDeploymentDialogOpen, setDeploymentDialogOpen] = useState(false);
  const [stoppedPreviewUrl, setStoppedPreviewUrl] = useState('');
  const [isStartingPreview, setStartingPreview] = useState(false);
  const [isStoppingPreview, setStoppingPreview] = useState(false);
  const [previewConsoleEntries, setPreviewConsoleEntries] = useState<PreviewConsoleEntry[]>([]);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const uiText = useBeeGameText(lang);
  const commonText = useCommonText(lang);
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
  const canStopPreview = canShowPreview && !isStoppingPreview && !isInteractionLocked;
  const canDeploy = Boolean(onDeployProject) && !isDeploying && !isInteractionLocked && !isWorkspaceBusy;
  const buildErrorLogs = collectBuildErrorLogs(buildReport);
  const runtimeErrorLogs = previewConsoleEntries
    .filter(entry => entry.level === 'error' || entry.level === 'warn')
    .map(entry => `[preview ${entry.level}] ${entry.message}`);
  const buildErrorLog = [...buildErrorLogs, ...runtimeErrorLogs].join('\n\n');
  const statusText =
    previewState === 'live'
      ? labels.live
      : previewState === 'failed'
        ? labels.failed
        : previewState === 'stopped'
          ? labels.stopped
          : previewState === 'starting'
            ? labels.starting
            : labels.waiting;
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
  const handleRestart = async () => {
    if (isInteractionLocked || isWorkspaceBusy) return;
    setStoppedPreviewUrl('');
    await onRestartPreview?.();
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
    // These local overlays must clear as soon as the preview identity changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStoppedPreviewUrl('');
    setPreviewConsoleEntries([]);
  }, [previewRefreshNonce, previewUrl]);

  useEffect(() => {
    const handlePreviewConsoleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin && event.origin !== 'null') return;
      if (event.source !== previewFrameRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if ((data as { type?: unknown }).type !== 'beegame.preview.console') return;
      const expectedSessionId = getPreviewSessionId(previewUrl);
      const sessionId = String((data as { sessionId?: unknown }).sessionId || '').trim();
      if (expectedSessionId && sessionId !== expectedSessionId) return;
      const level = String((data as { level?: unknown }).level || '').trim();
      const message = String((data as { message?: unknown }).message || '').trim();
      if (!level || !message) return;
      setPreviewConsoleEntries(entries => [
        ...entries.slice(-9),
        {
          level,
          message,
          createdAt: String((data as { createdAt?: unknown }).createdAt || '').trim(),
        },
      ]);
    };

    window.addEventListener('message', handlePreviewConsoleMessage);
    return () => window.removeEventListener('message', handlePreviewConsoleMessage);
  }, [previewUrl]);

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
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-transparent bg-transparent text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:border-[var(--border-strong)] focus-visible:bg-[var(--surface-hover)] focus-visible:text-[var(--text-primary)] focus-visible:outline-none sm:h-10 sm:w-10"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <DropdownMenu open={isProjectMenuOpen} onOpenChange={setProjectMenuOpen}>
            <DropdownMenuTrigger
              render={<button type="button" data-testid="beegame-project-info-trigger" aria-label={`${projectName}, ${labels.projectInfo || 'Project info'}`} />}
              onClick={(event) => {
                if (event.currentTarget.getAttribute('aria-expanded') !== 'true') setProjectMenuOpen(true);
              }}
              className="group flex min-w-0 max-w-[min(52vw,28rem)] flex-[0_1_auto] items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-left transition hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <span data-testid="beegame-project-trigger" className="min-w-0 flex-1 truncate text-[18px] font-semibold leading-6 text-[var(--text-primary)] sm:text-xl sm:leading-6">{projectName}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform group-data-[open]:rotate-180" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[min(20rem,calc(100vw-1rem))]">
              <div id="beegame-project-hint" data-testid="beegame-project-hint" className="border-b border-[var(--border)] px-3 py-2.5">
                <div className="type-footnote truncate text-[var(--text-primary)]">{projectName}</div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <ProjectHintRow label={labels.credits || 'Credit'} value={formatCreditAmount(credits?.consumedCredits ?? 0)} />
                </div>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          {isSyncing ? (
            <div
              data-testid="beegame-sync-status"
              className="type-footnote flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-[var(--text-secondary)] max-[899px]:hidden"
            >
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>{labels.syncing}</span>
            </div>
          ) : null}
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
          <div data-testid="beegame-preview-split-control" className="flex h-10 min-w-10 shrink-0 items-stretch overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-2)] min-[900px]:min-w-[148px]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={isStartingPreview ? labels.starting : canShowPreview ? labels.stop : labels.play}
              disabled={!canStartPreview}
              onClick={() => void handlePlay()}
              className="h-full min-w-0 flex-1 justify-center rounded-none border-0 px-3 text-[var(--text-primary)] hover:bg-[var(--surface-hover)] sm:px-5"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              <span className="max-[899px]:hidden">Preview</span>
            </Button>
            <DropdownMenu open={isPreviewMenuOpen} onOpenChange={setPreviewMenuOpen}>
              <DropdownMenuTrigger
                render={<button type="button" aria-label={labels.actions || 'Actions'} />}
                onClick={(event) => {
                  if (event.currentTarget.getAttribute('aria-expanded') !== 'true') setPreviewMenuOpen(true);
                }}
                className="grid h-full w-11 shrink-0 place-items-center border-l border-[var(--border)] text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem disabled={!canStopPreview} onClick={() => void handleStop()}><Square className="h-4 w-4" />{labels.stop}</DropdownMenuItem>
                <DropdownMenuItem disabled={!canShowPreview || isInteractionLocked} onClick={() => void handleRestart()}><RefreshCw className="h-4 w-4" />{labels.reload}</DropdownMenuItem>
                <DropdownMenuItem disabled={!canShowPreview} onClick={() => previewUrl && onOpenExternal?.(previewUrl)}><ExternalLink className="h-4 w-4" />{labels.openLive || labels.open}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button
            type="button"
            variant="default"
            size="sm"
            aria-label={isDeploying ? labels.deploying : labels.deploy}
            disabled={!canDeploy}
            onClick={() => setDeploymentDialogOpen(true)}
            className="h-10 min-w-10 rounded-full min-[900px]:min-w-[112px]"
          >
            <Upload className="h-3.5 w-3.5 min-[900px]:hidden" />
            <span className="max-[899px]:hidden">{isDeploying ? labels.deploying : 'Build'}</span>
          </Button>
          <DropdownMenu open={isProfileMenuOpen} onOpenChange={setProfileMenuOpen}>
            <DropdownMenuTrigger
              render={<ProfileAvatarButton avatarUrl={currentUser?.avatarUrl} userLabel={currentUser?.displayName?.trim() || currentUser?.email?.trim()} data-testid="beegame-profile-trigger" aria-label={commonText.profile || 'Profile'} title={commonText.profile || 'Profile'} />}
              onClick={(event) => {
                if (event.currentTarget.getAttribute('aria-expanded') !== 'true') setProfileMenuOpen(true);
              }}
            />
            <DropdownMenuContent align="end" className="w-[min(18rem,calc(100vw-1rem))]">
              <div data-testid="beegame-profile-menu-user" className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
                {currentUser?.avatarUrl ? (
                  <img src={currentUser.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--surface-3)] type-button font-semibold text-[var(--text-primary)]" aria-hidden="true">
                    {(currentUser?.displayName?.trim() || currentUser?.email?.trim() || 'Profile').slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="type-button truncate text-[var(--text-primary)]">{currentUser?.displayName?.trim() || commonText.profile || 'Profile'}</div>
                  {currentUser?.email ? <div className="type-caption-1 truncate text-[var(--text-secondary)]">{currentUser.email}</div> : null}
                </div>
              </div>
              <DropdownMenuItem onClick={() => { closeAccountSurfaces(); setProfileOpen(true); }}><UserCircle className="h-4 w-4" />{commonText.profile || 'Profile'}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { closeAccountSurfaces(); setCreditStoreOpen(true); }}><ShoppingCart className="h-4 w-4" />{commonText.creditStore || 'Credit Store'}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { closeAccountSurfaces(); setSettingsOpen(true); }}><Settings className="h-4 w-4" />{commonText.settings || 'Settings'}</DropdownMenuItem>
              {currentUser?.role === 'owner' || currentUser?.permissions.includes('resources.manage') ? (
                <DropdownMenuItem onClick={() => { openResourceLibraryRoute(); closeAccountSurfaces(); setIsResourceLibraryOpen(true); setSettingsOpen(false); }}><FolderOpen className="h-4 w-4" />{commonText.resources || 'Resources'}</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => { closeAccountSurfaces(); setHistoryOpen(true); }}><History className="h-4 w-4" />{commonText.historyProjects || 'History Projects'}</DropdownMenuItem>
              {currentUser ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void handleSignOut()}>{commonText.signOut || 'Sign out'}</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
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
      buildErrorLog={buildErrorLog}
      previewFrameRef={previewFrameRef}
      canShowPreview={canShowPreview}
      onFixBuildErrors={onFixBuildErrors}
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
      <WorkspaceDeploymentDialog
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



function formatCreditAmount(value: number): string {
  return Math.round(Math.max(0, Number(value) || 0)).toLocaleString();
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
