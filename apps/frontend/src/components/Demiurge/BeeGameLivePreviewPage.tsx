import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, ExternalLink, FileText, Info, MonitorPlay, Play, RefreshCw, Rocket, Square, X } from 'lucide-react';
import { BsStars } from 'react-icons/bs';
import type { Language } from './AgentsConfig';
import { useBeeGameText } from '../../i18n/useBeeGameTranslations';
import { Button } from '../ui/button';
import { ButtonGroup } from '../ui/button-group';
import { SettingsMenu } from './Landing/SettingsMenu';
import { ResourceLibraryPage } from '../ResourceLibrary/ResourceLibraryView';
import { closeResourceLibraryRoute, isResourceLibraryRoute, openResourceLibraryRoute } from '../ResourceLibrary/resourceLibraryRoute';
import { CreditStoreModal } from './Landing/CreditStoreModal';
import { ProjectHistoryModal } from './Landing/ProjectHistoryModal';
import { AccountActionsMenu } from './Landing/AccountActionsMenu';
import { ProfileModal } from './Landing/ProfileModal';
import type { BeeGameDeploymentPayload, BuildReportPayload, DeliveryReviewPayload } from '../../services/api';
import { useSystemStore } from '../../store/systemStore';
import { useProjectStore } from '../../store/projectStore';
import { clearSupabaseSession } from '../../services/supabaseAuthApi';

type DashboardStatus = 'running' | 'paused' | 'waiting_approval' | 'stopped' | 'finished' | 'idle' | 'offline';
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
    tokens: number;
    credits?: {
        settledCredits: number;
        outstandingReservedCredits: number;
    } | null;
    accountCreditBalance?: {
        balanceCredits: number;
        consumedCredits: number;
        reservedCredits: number;
    } | null;
    isSyncing: boolean;
    isInteractionLocked?: boolean;
    buildReport?: BuildReportPayload | null;
    deliveryReview?: DeliveryReviewPayload | null;
    deployments?: BeeGameDeploymentPayload[];
    previewRefreshNonce?: number;
    onStartPreview?: () => void | Promise<void>;
    onRestartPreview?: () => void | Promise<void>;
    onStopPreview?: () => void | Promise<void>;
    onDeployProject?: () => void | Promise<void>;
    onRollbackDeployment?: (deploymentId: string) => void | Promise<void>;
    onFixBuildErrors?: (errorLog: string) => void | Promise<void>;
    onOpenExternal?: (url: string) => void;
    isDeploying?: boolean;
    onBack?: () => void;
    onSetLang: (lang: Language) => void;
}

const normalizeUrl = (url?: string): string => {
    const value = String(url || '').trim();
    if (!value) return '';
    return value;
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

const displayDeploymentUrl = (url?: string): string => {
    const value = normalizeUrl(url);
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value.toLowerCase();
    if (value.startsWith('/') && typeof window !== 'undefined') {
        return `${window.location.origin}${value}`.toLowerCase();
    }
    return value.toLowerCase();
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

const previewControlButtonClass = 'border-white/[0.08] bg-white/[0.025] text-zinc-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-white/15 hover:bg-white/[0.055] hover:text-zinc-100 focus-visible:ring-1 focus-visible:ring-white/25 disabled:text-zinc-600 disabled:opacity-45';

export function BeeGameLivePreviewPage({
    lang,
    projectName,
    status,
    phaseLabel,
    tokens,
    credits,
    accountCreditBalance,
    isSyncing,
    isInteractionLocked = false,
    buildReport,
    deliveryReview,
    deployments = [],
    previewRefreshNonce = 0,
    onStartPreview,
    onRestartPreview,
    onStopPreview,
    onDeployProject,
    onRollbackDeployment,
    onFixBuildErrors,
    onOpenExternal,
    isDeploying = false,
    onBack,
    onSetLang,
}: BeeGameLivePreviewPageProps) {
    const [isProjectHintOpen, setProjectHintOpen] = useState(false);
    const [isSettingsOpen, setSettingsOpen] = useState(false);
    const [isResourceLibraryOpen, setIsResourceLibraryOpen] = useState(() => isResourceLibraryRoute());
    const [isCreditStoreOpen, setCreditStoreOpen] = useState(false);
    const [isHistoryOpen, setHistoryOpen] = useState(false);
    const [isProfileOpen, setProfileOpen] = useState(false);
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
    const labels = uiText.livePreview as Record<string, string>;
    const currentUser = useSystemStore(state => state.currentUser);
    const loadCurrentUser = useSystemStore(state => state.loadCurrentUser);
    const previewUrl = normalizeUrl(buildReport?.build_url);
    const embeddedPreviewUrl = useMemo(() => {
        if (!previewUrl || previewRefreshNonce <= 0 || typeof window === 'undefined') return previewUrl;
        try {
            const url = new URL(previewUrl, window.location.origin);
            url.searchParams.set('__beegame_preview_refresh', String(previewRefreshNonce));
            return /^https?:\/\//i.test(previewUrl)
                ? url.toString()
                : `${url.pathname}${url.search}${url.hash}`;
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
    const canStartPreview = Boolean(onStartPreview) && !canShowPreview && !isStartingPreview && !isStoppingPreview && !isInteractionLocked;
    const canStopPreview = canShowPreview && !isStoppingPreview && !isInteractionLocked;
    const canDeploy = Boolean(onDeployProject) && !isDeploying && !isInteractionLocked;
    const buildErrorLogs = collectBuildErrorLogs(buildReport);
    const runtimeErrorLogs = previewConsoleEntries
        .filter(entry => entry.level === 'error' || entry.level === 'warn')
        .map(entry => `[preview ${entry.level}] ${entry.message}`);
    const buildErrorLog = [...buildErrorLogs, ...runtimeErrorLogs].join('\n\n');
    const statusText = previewState === 'live'
        ? labels.live
        : previewState === 'failed'
            ? labels.failed
            : previewState === 'stopped'
                ? labels.stopped
                : previewState === 'starting'
                    ? labels.starting
                    : labels.waiting;
    const previewDetailText = previewState === 'failed'
        ? (buildReport?.failure_reason || buildReport?.summary || labels.noPreview)
        : '';
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
        if (isInteractionLocked || isStartingPreview) return;
        setStoppedPreviewUrl('');
        setStartingPreview(true);
        try {
            await onStartPreview?.();
        } finally {
            setStartingPreview(false);
        }
    };
    const handleRestart = async () => {
        if (isInteractionLocked) return;
        setStoppedPreviewUrl('');
        await onRestartPreview?.();
    };
    const handleDeploy = async () => {
        if (isInteractionLocked) return;
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

    return (
        <main
            data-testid="beegame-live-preview-page"
	            className="relative h-full flex-1 overflow-hidden bg-zinc-950 text-zinc-50"
        >
            <header
                data-testid="beegame-shell-top-nav"
	                className="absolute left-0 right-0 top-0 z-[90] flex h-20 items-center border-b border-zinc-800/80 bg-zinc-950/95 px-7 backdrop-blur-xl"
            >
                <div className="relative flex min-w-0 items-center gap-4">
                    <button
                        type="button"
                        aria-label={labels.back}
                        onClick={onBack}
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-transparent bg-transparent text-zinc-500 transition hover:border-zinc-800 hover:bg-zinc-900 hover:text-zinc-100 focus-visible:border-zinc-600 focus-visible:bg-zinc-900 focus-visible:text-zinc-100 focus-visible:outline-none"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <div
                        data-testid="beegame-project-trigger"
                        className="type-title-3 min-w-0 max-w-[34rem] truncate text-zinc-100"
                    >
                        {projectName}
                    </div>
                    <button
                        type="button"
                        data-testid="beegame-project-info-trigger"
                        aria-label={labels.projectInfo || 'Project info'}
                        aria-describedby={isProjectHintOpen ? 'beegame-project-hint' : undefined}
                        onMouseEnter={() => setProjectHintOpen(true)}
                        onMouseLeave={() => setProjectHintOpen(false)}
                        onFocus={() => setProjectHintOpen(true)}
                        onBlur={() => setProjectHintOpen(false)}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-transparent bg-transparent text-zinc-500 transition hover:border-zinc-800 hover:bg-zinc-900 hover:text-zinc-100 focus-visible:border-zinc-700 focus-visible:bg-zinc-900 focus-visible:text-zinc-100 focus-visible:outline-none"
                    >
                        <Info className="h-4 w-4" />
                    </button>
                    {isSyncing ? (
                        <div
                            data-testid="beegame-sync-status"
                            className="type-footnote flex items-center gap-2 rounded-xl bg-zinc-800/80 px-3 py-1 text-zinc-400"
                        >
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            <span>{labels.syncing}</span>
                        </div>
                    ) : null}
                    {deliveryReview ? (
                        <div
                            data-testid="beegame-delivery-review-status"
                            title={deliveryReview.summary || ''}
                            className={`type-footnote rounded-xl border px-3 py-1 ${deliveryReview.status === 'passed'
                                ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                                : deliveryReview.status === 'failed' || deliveryReview.status === 'blocked'
                                    ? 'border-rose-500/25 bg-rose-500/10 text-rose-300'
                                    : deliveryReview.status === 'validating'
                                        ? 'border-amber-500/25 bg-amber-500/10 text-amber-200'
                                        : 'border-zinc-700 bg-zinc-900 text-zinc-400'
                                }`}
                        >
                            {labels[`deliveryReview_${deliveryReview.status || 'untested'}`] || deliveryReview.status}
                        </div>
                    ) : null}
                    {isProjectHintOpen ? (
                        <div
                            id="beegame-project-hint"
                            role="tooltip"
                            data-testid="beegame-project-hint"
                            className="absolute left-5 top-12 z-50 w-80 rounded-2xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl"
                        >
                            <ProjectHintRow label={labels.platform || 'Platform'} value="Web" />
                            <ProjectHintRow label={labels.tokens} value={tokens.toLocaleString()} />
                            {credits ? (
                                <>
                                    <ProjectHintRow label={labels.credits} value={credits.settledCredits.toLocaleString()} />
                                    <ProjectHintRow label={labels.reserved} value={credits.outstandingReservedCredits.toLocaleString()} />
                                </>
                            ) : null}
                            <ProjectHintRow label={labels.phase} value={phaseLabel} />
                            {deliveryReview ? (
                                <ProjectHintRow
                                    label={labels.deliveryReview}
                                    value={labels[`deliveryReview_${deliveryReview.status || 'untested'}`] || deliveryReview.status || labels.unavailable}
                                />
                            ) : null}
                        </div>
                    ) : null}
                </div>

            </header>

            <AccountActionsMenu
                lang={lang}
                className="absolute right-7 top-5 z-[150]"
                isSettingsOpen={isSettingsOpen}
                isHistoryOpen={isHistoryOpen}
                isProfileOpen={isProfileOpen}
                isCreditStoreOpen={isCreditStoreOpen}
                isResourceLibraryOpen={isResourceLibraryOpen}
                currentUserId={currentUser?.id}
                currentUserDisplayName={currentUser?.displayName || currentUser?.email}
                currentUserEmail={currentUser?.email}
                currentUserAvatarUrl={currentUser?.avatarUrl}
                creditBalance={accountCreditBalance?.balanceCredits}
                onOpenLogin={() => setSettingsOpen(true)}
                onOpenProfile={() => {
                    closeAccountSurfaces();
                    setProfileOpen(true);
                }}
                onOpenCreditStore={() => {
                    closeAccountSurfaces();
                    setCreditStoreOpen(true);
                }}
                onToggleSettings={() => {
                    closeAccountSurfaces();
                    setSettingsOpen(true);
                }}
                canManageResources={currentUser?.role === 'owner' || currentUser?.permissions.includes('resources.manage')}
                onOpenResourceLibrary={() => {
                    openResourceLibraryRoute();
                    closeAccountSurfaces();
                    setIsResourceLibraryOpen(true);
                    setSettingsOpen(false);
                }}
                onToggleHistory={() => {
                    closeAccountSurfaces();
                    setHistoryOpen(true);
                }}
                onSignOut={currentUser ? () => void handleSignOut() : undefined}
            />

            <div className="absolute bottom-4 left-4 right-[29rem] top-24 flex flex-col">
                <section className="flex min-h-0 flex-1 flex-col overflow-visible rounded-2xl border border-zinc-800 bg-zinc-950/60 shadow-[0_32px_80px_-48px_rgba(0,0,0,0.8)]">
                    <div className="relative z-10 flex h-20 items-center justify-between overflow-visible px-9">
                        <div className="min-w-0">
                            <div className="flex items-baseline gap-3">
                                <h1 className="type-title-3 text-zinc-100">
                                    {uiText.previewTitle}
                                </h1>
                            </div>
                        </div>
                        <div className="relative z-20 flex shrink-0 items-center justify-end gap-2">
                            <ButtonGroup aria-label={labels.actions || 'Actions'}>
                                {!canShowPreview ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon-lg"
                                        aria-label={isStartingPreview ? labels.starting : labels.play}
                                        title={isStartingPreview ? labels.starting : labels.play}
                                        disabled={!canStartPreview}
                                        onClick={handlePlay}
                                        className={previewControlButtonClass}
                                    >
                                        {isStartingPreview ? (
                                            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                                        ) : (
                                            <Play className="h-4 w-4 fill-current" />
                                        )}
                                    </Button>
                                ) : (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon-lg"
                                        aria-label={labels.stop}
                                        title={labels.stop}
                                        disabled={!canStopPreview}
                                        onClick={handleStop}
                                        className={previewControlButtonClass}
                                    >
                                        <Square className="h-3.5 w-3.5 fill-current" />
                                    </Button>
                                )}
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-lg"
                                    aria-label={isDeploying ? labels.deploying : labels.deploy}
                                    title={isDeploying ? labels.deploying : labels.deploy}
                                    disabled={!canDeploy}
                                    onClick={() => setDeploymentDialogOpen(true)}
                                    className={previewControlButtonClass}
                                >
                                    <Rocket className="h-4 w-4" />
                                </Button>
                            </ButtonGroup>
                            <ButtonGroup aria-label={labels.openLive || labels.open}>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-lg"
                                    aria-label={labels.reload}
                                    title={labels.reload}
                                    disabled={!canShowPreview || isInteractionLocked}
                                    onClick={handleRestart}
                                    className={previewControlButtonClass}
                                >
                                    <RefreshCw className="h-4 w-4" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon-lg"
                                    aria-label={labels.openLive || labels.open}
                                    title={labels.openLive || labels.open}
                                    disabled={!canShowPreview}
                                    onClick={() => {
                                        if (previewUrl) onOpenExternal?.(previewUrl);
                                    }}
                                    className={previewControlButtonClass}
                                >
                                    <ExternalLink className="h-4 w-4" />
                                </Button>
                            </ButtonGroup>
                        </div>
                    </div>

                    <div
                        data-testid="beegame-preview-surface"
                        className="relative mx-9 mb-9 min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-800 bg-black p-4"
                    >
                        {canShowPreview ? (
                            <iframe
                                ref={previewFrameRef}
                                key={`${previewUrl}:${previewRefreshNonce}`}
                                title={uiText.previewTitle}
                                data-testid="beegame-live-preview-frame"
                                src={embeddedPreviewUrl}
                                sandbox="allow-forms allow-pointer-lock allow-popups allow-scripts"
                                className="h-full w-full rounded-lg border-0 bg-white"
                            />
                        ) : (
                            <div className="flex h-full items-center justify-center px-8 text-center">
                                <div className="max-w-md">
                                    <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-zinc-900 text-zinc-300 ring-1 ring-zinc-800">
                                        {previewState === 'failed' ? <AlertTriangle className="h-8 w-8 text-red-300" /> : <MonitorPlay className="h-8 w-8" />}
                                    </div>
                                    <div className="type-caption-1 mt-6 text-zinc-400">
                                        {statusText}
                                    </div>
                                    {previewDetailText ? (
                                        <p className="type-callout mt-3 text-zinc-500">
                                            {previewDetailText}
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                        )}

                        {buildErrorLog ? (
                            <div
                                data-testid="beegame-preview-error-overlay"
                                className="absolute bottom-4 left-4 right-4 z-20 overflow-hidden rounded-xl border border-red-300/20 bg-zinc-950/88 shadow-2xl shadow-black/45 backdrop-blur-xl"
                            >
                                <div className="flex h-11 items-center justify-between gap-4 border-b border-red-300/10 px-4">
                                    <div className="type-caption-1 text-zinc-300">
                                        {labels.console}
                                    </div>
                                    <button
                                        type="button"
                                        aria-label={labels.fixBuildErrors}
                                        onClick={() => void onFixBuildErrors?.(buildErrorLog)}
                                        className="type-button inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-2.5 text-emerald-200 transition hover:border-emerald-300/40 hover:bg-emerald-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/30"
                                    >
                                        <BsStars className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span>{labels.fixBuildErrors}</span>
                                    </button>
                                </div>
                                <pre className="type-code-sm max-h-28 overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-red-200/85">
                                    {buildErrorLog}
                                </pre>
                            </div>
                        ) : null}
                    </div>

                </section>
            </div>

            <SettingsMenu
                isOpen={isSettingsOpen}
                lang={lang}
                onClose={() => setSettingsOpen(false)}
                onSetLang={onSetLang}
            />
            {isResourceLibraryOpen ? <ResourceLibraryPage onBack={() => { closeResourceLibraryRoute(); setIsResourceLibraryOpen(false); }} /> : null}
            <ProjectHistoryModal
                isOpen={isHistoryOpen}
                lang={lang}
                onClose={() => setHistoryOpen(false)}
                onSelectProject={(projectId) => void handleSelectProject(projectId)}
            />
            <CreditStoreModal
                isOpen={isCreditStoreOpen}
                lang={lang}
                onClose={() => setCreditStoreOpen(false)}
            />
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
            <DeploymentDialog
                isOpen={isDeploymentDialogOpen}
                deployments={deployments}
                labels={labels}
                onClose={() => setDeploymentDialogOpen(false)}
                onOpenExternal={onOpenExternal}
                onFixBuildErrors={onFixBuildErrors}
                onDeploy={handleDeploy}
                onRollback={onRollbackDeployment}
                isDeploying={isDeploying}
                canDeploy={canDeploy}
            />

        </main>
    );
}

function DeploymentDialog({
    isOpen,
    deployments,
    labels,
    onClose,
    onOpenExternal,
    onFixBuildErrors,
    onDeploy,
    onRollback,
    isDeploying,
    canDeploy,
}: {
    isOpen: boolean;
    deployments: BeeGameDeploymentPayload[];
    labels: Record<string, string>;
    onClose: () => void;
    onOpenExternal?: (url: string) => void;
    onFixBuildErrors?: (errorLog: string) => void | Promise<void>;
    onDeploy: () => void | Promise<void>;
    onRollback?: (deploymentId: string) => void | Promise<void>;
    isDeploying: boolean;
    canDeploy: boolean;
}) {
    if (!isOpen) return null;
    const latest = deployments[0];
    const versionList = deployments;
    const latestUrl = normalizeUrl(latest?.url);
    const latestDisplayUrl = displayDeploymentUrl(latest?.url);
    const failureLog = latest?.status === 'failed'
        ? (latest.buildLog || latest.message || labels.deploymentFailed)
        : '';
    return (
        <div
            className="fixed inset-0 z-[180] grid place-items-center bg-black/55 px-6 py-8 backdrop-blur-2xl"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="beegame-deployment-dialog-title"
                className="relative w-full max-w-2xl overflow-hidden rounded-[2.25rem] border border-white/18 bg-zinc-950/76 p-7 text-zinc-50 shadow-[0_32px_100px_rgba(0,0,0,0.7)] backdrop-blur-2xl"
            >
                <button
                    type="button"
                    aria-label={labels.close || 'Close'}
                    onClick={onClose}
                    className="glass-icon-button absolute right-6 top-6 h-11 w-11 rounded-full text-zinc-300"
                >
                    <X className="h-5 w-5" />
                </button>

                <div className="pr-16">
                    <h2 id="beegame-deployment-dialog-title" className="type-title-2 text-zinc-50">
                        {labels.deploy}
                    </h2>
                    <p className="type-callout mt-2 max-w-xl text-zinc-400">
                        {labels.deploymentDialogDescription}
                    </p>
                </div>

                <div className="mt-7 rounded-[1.75rem] border border-white/12 bg-white/[0.045] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <div className="min-w-0">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <div className="type-caption-1 text-zinc-500">
                                    {labels.deploymentLatest}
                                </div>
                                <div className="mt-2 flex min-w-0 items-center gap-2">
                                    <span className={`h-2 w-2 rounded-full ${latest?.status === 'succeeded' ? 'bg-emerald-300' : latest?.status === 'failed' ? 'bg-red-300' : latest ? 'bg-amber-300' : 'bg-zinc-600'}`} />
                                    <span className="type-headline truncate text-zinc-100">
                                        {latest ? deploymentStatusLabel(latest.status, labels) : labels.deploymentNotPublished}
                                    </span>
                                </div>
                            </div>
                            <button
                                type="button"
                                aria-label={isDeploying ? labels.deploying : latest ? labels.redeploy : labels.deploy}
                                title={isDeploying ? labels.deploying : latest ? labels.redeploy : labels.deploy}
                                onClick={onDeploy}
                                disabled={!canDeploy}
                                className="secondary-pill type-button inline-flex shrink-0 items-center gap-2 px-4 py-2 text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isDeploying ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                ) : latest ? (
                                    <RefreshCw className="h-4 w-4" />
                                ) : (
                                    <Rocket className="h-4 w-4" />
                                )}
                                <span>{isDeploying ? labels.deploying : latest ? labels.redeploy : labels.deploy}</span>
                            </button>
                        </div>
                        {latest?.deployedAt || latest?.updatedAt ? (
                            <div className="type-footnote mt-1 text-zinc-500">
                                {formatDeploymentTime(latest.deployedAt || latest.updatedAt)}
                            </div>
                        ) : null}
                        {failureLog ? (
                            <p className="type-footnote mt-2 line-clamp-2 text-red-200/80">
                                {failureLog}
                            </p>
                        ) : latestDisplayUrl ? (
                            <div className="mt-3 flex min-w-0 items-end justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="type-caption-2 text-zinc-600">URL</div>
                                    <div className="type-footnote mt-1 truncate text-zinc-400">
                                        {latestDisplayUrl}
                                    </div>
                                </div>
                                {latestUrl ? (
                                    <button
                                        type="button"
                                        aria-label={labels.openLive}
                                        title={labels.openLive}
                                        onClick={() => onOpenExternal?.(latestUrl)}
                                        className="secondary-pill grid h-10 w-10 shrink-0 place-items-center p-0 text-zinc-200"
                                    >
                                        <ExternalLink className="h-4 w-4" />
                                    </button>
                                ) : null}
                            </div>
                        ) : (
                            <p className="type-footnote mt-2 text-zinc-500">
                                {labels.deploymentNotPublishedHint}
                            </p>
                        )}
                    </div>
                    {failureLog ? (
                        <div className="mt-4 rounded-2xl border border-red-200/10 bg-red-950/10 p-4">
                            <div className="flex items-center justify-between gap-3">
                                <div className="type-caption-2 text-red-100/70">
                                    {labels.deploymentFailureLog}
                                </div>
                                <button
                                    type="button"
                                    aria-label={labels.fixBuildErrors}
                                    onClick={() => void onFixBuildErrors?.(failureLog)}
                                    className="type-button inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-2.5 text-emerald-200 transition hover:border-emerald-300/40 hover:bg-emerald-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/30"
                                >
                                    <BsStars className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span>{labels.fixBuildErrors}</span>
                                </button>
                            </div>
                                <pre className="type-code-sm max-h-36 overflow-auto whitespace-pre-wrap break-words text-red-100/80">
                                {failureLog}
                            </pre>
                        </div>
                    ) : null}
                </div>

                <div className="mt-6">
                    <div className="type-caption-1 mb-3 text-zinc-500">
                        {labels.deploymentVersions}
                    </div>
                    {versionList.length > 0 ? (
                        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                            {versionList.map((deployment, index) => {
                                const canRollback = index > 0 && deployment.status === 'succeeded' && Boolean(onRollback);
                                const deploymentUrl = normalizeUrl(deployment.url);
                                const deploymentDisplayUrl = displayDeploymentUrl(deployment.url);
                                return (
                                    <div
                                        key={deployment.id}
                                        className="flex min-w-0 items-center justify-between gap-3 rounded-[1.25rem] border border-white/[0.08] bg-black/24 px-4 py-3"
                                    >
                                        <div className="flex min-w-0 items-center gap-3">
                                            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-500">
                                                <FileText className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="type-callout truncate text-zinc-200">
                                                    {labels.version} {versionList.length - index}
                                                </div>
                                                <div className="type-footnote mt-0.5 flex min-w-0 items-center gap-2 text-zinc-500">
                                                    <span>{deploymentStatusLabel(deployment.status, labels)}</span>
                                                    {deployment.deployedAt || deployment.updatedAt ? (
                                                        <span className="truncate">{formatDeploymentTime(deployment.deployedAt || deployment.updatedAt)}</span>
                                                    ) : null}
                                                </div>
                                                {deploymentDisplayUrl ? (
                                                    <div className="type-caption-2 mt-1 truncate text-zinc-600">
                                                        {deploymentDisplayUrl}
                                                    </div>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-3">
                                            {deploymentUrl ? (
                                                <button
                                                    type="button"
                                                    aria-label={labels.open}
                                                    title={labels.open}
                                                    onClick={() => onOpenExternal?.(deploymentUrl)}
                                                    className="secondary-pill grid h-9 w-9 place-items-center p-0 text-zinc-300"
                                                >
                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                </button>
                                            ) : null}
                                            {canRollback ? (
                                                <button
                                                    type="button"
                                                    onClick={() => onRollback?.(deployment.id)}
                                                    disabled={isDeploying}
                                                    className="type-button px-2 py-1.5 text-emerald-200/80 transition-colors hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {labels.rollback || 'Rollback'}
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-5 text-zinc-500">
                            <div className="type-callout">{labels.deploymentNoVersions}</div>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}

function deploymentStatusLabel(status: BeeGameDeploymentPayload['status'] | undefined, labels: Record<string, string>): string {
    if (status === 'succeeded') return labels.deploymentSucceeded;
    if (status === 'failed') return labels.deploymentFailed;
    if (status === 'building') return labels.deploymentBuilding;
    if (status === 'publishing') return labels.deploymentPublishing;
    return labels.deploymentQueued;
}

function formatDeploymentTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function ProjectHintRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800/70 py-2 last:border-b-0">
            <div className="type-caption-1 shrink-0 text-zinc-500">
                {label}
            </div>
            <div className="type-callout min-w-0 truncate text-right text-zinc-100">
                {value}
            </div>
        </div>
    );
}
