import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronLeft, ExternalLink, FileText, Globe2, MonitorPlay, Play, RefreshCw, Rocket, Settings, Square } from 'lucide-react';
import type { Language } from './AgentsConfig';
import { normalizeI18nLanguage, useBeeGameText } from '../../i18n/useBeeGameTranslations';
import { SettingsMenu } from './Landing/SettingsMenu';
import { UserAccountMenu, type UserAccountMenuItem } from './Landing/UserAccountMenu';
import type { BeeGameDeploymentPayload, BuildReportPayload } from '../../services/api';
import { useSystemStore } from '../../store/systemStore';

type DashboardStatus = 'running' | 'paused' | 'waiting_approval' | 'stopped' | 'finished' | 'idle' | 'offline';
type PreviewState = 'starting' | 'live' | 'failed' | 'stopped' | 'idle';
type PreviewControl = 'reload' | 'stop' | 'play' | 'open' | 'deploy';

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
    modelName: string;
    isSyncing: boolean;
    buildReport?: BuildReportPayload | null;
    deployments?: BeeGameDeploymentPayload[];
    onStartPreview?: () => void | Promise<void>;
    onRestartPreview?: () => void | Promise<void>;
    onStopPreview?: () => void | Promise<void>;
    onDeployProject?: () => void | Promise<void>;
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

const getPreviewState = (status: DashboardStatus, buildReport?: BuildReportPayload | null): PreviewState => {
    const reportStatus = String(buildReport?.status || '').toLowerCase();
    const url = normalizeUrl(buildReport?.build_url);

    if (reportStatus === 'failed' || reportStatus === 'error') return 'failed';
    if (url) return 'live';
    if (status === 'running' || status === 'waiting_approval') return 'starting';
    if (status === 'paused' || status === 'stopped' || status === 'offline') return 'stopped';
    return 'idle';
};

export function BeeGameLivePreviewPage({
    lang,
    projectName,
    status,
    phaseLabel,
    tokens,
    credits,
    modelName,
    isSyncing,
    buildReport,
    deployments = [],
    onStartPreview,
    onRestartPreview,
    onStopPreview,
    onDeployProject,
    onOpenExternal,
    isDeploying = false,
    onBack,
    onSetLang,
}: BeeGameLivePreviewPageProps) {
    const [isProjectHintOpen, setProjectHintOpen] = useState(false);
    const [isSettingsOpen, setSettingsOpen] = useState(false);
    const [hoveredControl, setHoveredControl] = useState<PreviewControl | null>(null);
    const [stoppedPreviewUrl, setStoppedPreviewUrl] = useState('');
    const [isStoppingPreview, setStoppingPreview] = useState(false);
    const { i18n } = useTranslation('beegame');
    const labels = i18n.getResourceBundle(normalizeI18nLanguage(lang), 'beegame').livePreview as Record<string, string>;
    const uiText = useBeeGameText(lang);
    const currentUser = useSystemStore(state => state.currentUser);
    const previewUrl = normalizeUrl(buildReport?.build_url);
    const isPreviewLocallyStopped = Boolean(previewUrl && stoppedPreviewUrl === previewUrl);
    const previewState = isPreviewLocallyStopped ? 'stopped' : getPreviewState(status, buildReport);
    const canShowPreview = previewState === 'live' && Boolean(previewUrl);
    const canStartPreview = !canShowPreview && !isStoppingPreview;
    const canStopPreview = canShowPreview && !isStoppingPreview;
    const canDeploy = Boolean(onDeployProject) && !isDeploying;
    const statusText = previewState === 'live'
        ? labels.live
        : previewState === 'failed'
            ? labels.failed
            : previewState === 'stopped'
                ? labels.stopped
                : previewState === 'starting'
                    ? labels.starting
                    : labels.waiting;
    const handleStop = async () => {
        if (!canStopPreview) return;
        setStoppingPreview(true);
        try {
            await onStopPreview?.();
            if (previewUrl) setStoppedPreviewUrl(previewUrl);
        } finally {
            setStoppingPreview(false);
        }
    };
    const handlePlay = async () => {
        setStoppedPreviewUrl('');
        await onStartPreview?.();
    };
    const handleRestart = async () => {
        setStoppedPreviewUrl('');
        await onRestartPreview?.();
    };
    const handleDeploy = async () => {
        await onDeployProject?.();
    };
    const userMenuItems: UserAccountMenuItem[] = [
        {
            key: 'settings',
            label: labels.settings,
            icon: <Settings className="h-4 w-4" />,
            onClick: () => setSettingsOpen(true),
        },
    ];
    useEffect(() => {
        setStoppedPreviewUrl('');
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
                    <button
                        type="button"
                        data-testid="beegame-project-trigger"
                        aria-describedby={isProjectHintOpen ? 'beegame-project-hint' : undefined}
                        onMouseEnter={() => setProjectHintOpen(true)}
                        onMouseLeave={() => setProjectHintOpen(false)}
                        onFocus={() => setProjectHintOpen(true)}
                        onBlur={() => setProjectHintOpen(false)}
                        className="type-title-3 min-w-0 max-w-[34rem] truncate bg-transparent p-0 text-left text-zinc-100 outline-none transition hover:text-white focus-visible:text-white"
                    >
                        {projectName}
                    </button>
                    <div className="type-footnote flex items-center gap-2 rounded-xl bg-zinc-800/80 px-3 py-1 text-zinc-300">
                        <Globe2 className="h-3.5 w-3.5" />
                        Web
                    </div>
                    <div className="type-footnote flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-1 text-emerald-300">
                        <span className={`h-2 w-2 rounded-full ${status === 'running' ? 'bg-emerald-400' : status === 'offline' ? 'bg-amber-400' : 'bg-zinc-500'}`} />
                        {statusText}
                    </div>
                    {credits ? (
                        <div className="type-footnote flex items-center gap-2 rounded-xl bg-amber-400/10 px-3 py-1 text-amber-200">
                            {labels.credits}: {credits.settledCredits.toLocaleString()}
                        </div>
                    ) : null}
                    {isSyncing ? (
                        <div className="type-footnote rounded-xl bg-zinc-800/80 px-3 py-1 text-zinc-400">
                            {labels.syncing}
                        </div>
                    ) : null}
                    {isProjectHintOpen ? (
                        <div
                            id="beegame-project-hint"
                            role="tooltip"
                            data-testid="beegame-project-hint"
                            className="absolute left-5 top-12 z-50 w-80 rounded-2xl border border-zinc-800 bg-zinc-950/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl"
                        >
                            <ProjectHintRow label={labels.tokens} value={tokens.toLocaleString()} />
                            {credits ? (
                                <>
                                    <ProjectHintRow label={labels.credits} value={credits.settledCredits.toLocaleString()} />
                                    <ProjectHintRow label={labels.reserved} value={credits.outstandingReservedCredits.toLocaleString()} />
                                </>
                            ) : null}
                            <ProjectHintRow label={labels.phase} value={phaseLabel} />
                            <ProjectHintRow label={labels.model} value={modelName || labels.unavailable} />
                        </div>
                    ) : null}
                </div>

                <UserAccountMenu
                    ariaLabel={labels.settings}
                    className="relative ml-auto"
                    isActive={isSettingsOpen}
                    currentUserId={currentUser?.id}
                    currentUserDisplayName={currentUser?.displayName}
                    currentUserEmail={currentUser?.email}
                    currentUserAvatarUrl={currentUser?.avatarUrl}
                    fallbackUserLabel={labels.settings}
                    signOutLabel=""
                    items={userMenuItems}
                    onOpenLogin={() => setSettingsOpen(true)}
                />
            </header>

            <div className="absolute bottom-4 left-4 right-[29rem] top-24 flex flex-col">
                <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/60 shadow-[0_32px_80px_-48px_rgba(0,0,0,0.8)]">
                    <div className="flex h-20 items-center justify-between px-9">
                        <div className="min-w-0">
                            <div className="flex items-baseline gap-3">
                                <h1 className="type-title-3 text-zinc-100">
                                    {uiText.previewTitle}
                                </h1>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <PreviewControlButton
                                control="reload"
                                label={labels.reload}
                                disabled={!canShowPreview}
                                hoveredControl={hoveredControl}
                                setHoveredControl={setHoveredControl}
                                onClick={handleRestart}
                            >
                                <RefreshCw className="h-4 w-4" />
                            </PreviewControlButton>
                            {!canShowPreview ? (
                                <PreviewControlButton
                                    control="play"
                                    label={labels.play}
                                    disabled={!canStartPreview}
                                    hoveredControl={hoveredControl}
                                    setHoveredControl={setHoveredControl}
                                    onClick={handlePlay}
                                >
                                    <Play className="h-4 w-4 fill-emerald-400 text-emerald-400" />
                                </PreviewControlButton>
                            ) : (
                                <PreviewControlButton
                                    control="stop"
                                    label={labels.stop}
                                    disabled={!canStopPreview}
                                    hoveredControl={hoveredControl}
                                    setHoveredControl={setHoveredControl}
                                    onClick={handleStop}
                                >
                                    <Square className="h-4 w-4 fill-red-500 text-red-500" />
                                </PreviewControlButton>
                            )}
                            <PreviewControlButton
                                control="deploy"
                                label={isDeploying ? labels.deploying : labels.deploy}
                                disabled={!canDeploy}
                                hoveredControl={hoveredControl}
                                setHoveredControl={setHoveredControl}
                                onClick={handleDeploy}
                            >
                                <Rocket className="h-4 w-4" />
                            </PreviewControlButton>
                            <PreviewControlButton
                                control="open"
                                label={labels.openLive || labels.open}
                                disabled={!canShowPreview}
                                hoveredControl={hoveredControl}
                                setHoveredControl={setHoveredControl}
                                onClick={() => {
                                    if (previewUrl) onOpenExternal?.(previewUrl);
                                }}
                            >
                                <ExternalLink className="h-4 w-4" />
                            </PreviewControlButton>
                        </div>
                    </div>

                    {deployments.length > 0 ? (
                        <DeploymentHistoryPanel
                            deployments={deployments}
                            labels={labels}
                            onOpenExternal={onOpenExternal}
                            onRedeploy={handleDeploy}
                            isDeploying={isDeploying}
                        />
                    ) : null}

                    <div className="mx-9 mb-9 min-h-0 flex-1 rounded-xl border border-zinc-800 bg-black p-4">
                        {canShowPreview ? (
                            <iframe
                                key={previewUrl}
                                title={uiText.previewTitle}
                                data-testid="beegame-live-preview-frame"
                                src={previewUrl}
                                sandbox="allow-forms allow-pointer-lock allow-popups allow-same-origin allow-scripts"
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
                                    <p className="type-callout mt-3 text-zinc-500">
                                        {buildReport?.failure_reason || buildReport?.summary || labels.noPreview}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                </section>
            </div>

            <SettingsMenu
                isOpen={isSettingsOpen}
                lang={lang}
                onClose={() => setSettingsOpen(false)}
                onSetLang={onSetLang}
            />

        </main>
    );
}

function DeploymentHistoryPanel({
    deployments,
    labels,
    onOpenExternal,
    onRedeploy,
    isDeploying,
}: {
    deployments: BeeGameDeploymentPayload[];
    labels: Record<string, string>;
    onOpenExternal?: (url: string) => void;
    onRedeploy: () => void | Promise<void>;
    isDeploying: boolean;
}) {
    const latest = deployments[0];
    const recent = deployments.slice(0, 4);
    const latestUrl = normalizeUrl(latest?.url);
    const failureLog = latest?.status === 'failed'
        ? (latest.buildLog || latest.message || labels.deploymentFailed)
        : '';
    return (
        <div className="mx-9 mb-4 rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-4 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <div className="type-caption-1 text-zinc-500">
                        {labels.deploymentHistory}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${latest?.status === 'succeeded' ? 'bg-emerald-300' : latest?.status === 'failed' ? 'bg-red-300' : 'bg-amber-300'}`} />
                        <span className="type-callout truncate text-zinc-100">
                            {deploymentStatusLabel(latest?.status, labels)}
                        </span>
                        {latest?.deployedAt || latest?.updatedAt ? (
                            <span className="type-footnote shrink-0 text-zinc-500">
                                {formatDeploymentTime(latest.deployedAt || latest.updatedAt)}
                            </span>
                        ) : null}
                    </div>
                    {failureLog ? (
                        <p className="type-footnote mt-1 line-clamp-1 text-red-200/80">
                            {failureLog}
                        </p>
                    ) : latestUrl ? (
                        <p className="type-footnote mt-1 truncate text-zinc-500">
                            {latestUrl}
                        </p>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {latestUrl ? (
                        <button
                            type="button"
                            onClick={() => onOpenExternal?.(latestUrl)}
                            className="secondary-pill type-button px-4 py-2 text-zinc-200"
                        >
                            {labels.openLive}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={onRedeploy}
                        disabled={isDeploying}
                        className="primary-pill type-button px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isDeploying ? labels.deploying : labels.redeploy}
                    </button>
                </div>
            </div>
            {failureLog ? (
                <div className="mt-3 rounded-xl border border-red-200/10 bg-red-950/10 p-3">
                    <div className="type-caption-2 mb-2 text-red-100/70">
                        {labels.deploymentFailureLog}
                    </div>
                    <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-red-100/80">
                        {failureLog}
                    </pre>
                </div>
            ) : null}
            {recent.length > 1 ? (
                <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
                    {recent.map((deployment, index) => (
                        <div
                            key={deployment.id}
                            className="min-w-0 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2"
                        >
                            <div className="flex items-center gap-2">
                                <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                                <span className="type-caption-2 truncate text-zinc-300">
                                    {labels.version} {recent.length - index}
                                </span>
                            </div>
                            <div className="type-caption-2 mt-1 truncate text-zinc-500">
                                {deploymentStatusLabel(deployment.status, labels)}
                            </div>
                        </div>
                    ))}
                </div>
            ) : null}
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

function PreviewControlButton({
    control,
    label,
    disabled,
    hoveredControl,
    setHoveredControl,
    onClick,
    children,
}: {
    control: PreviewControl;
    label: string;
    disabled: boolean;
    hoveredControl: PreviewControl | null;
    setHoveredControl: (control: PreviewControl | null) => void;
    onClick?: () => void | Promise<void>;
    children: ReactNode;
}) {
    const isHintVisible = hoveredControl === control;
    return (
        <div
            className="relative"
            onMouseEnter={() => setHoveredControl(control)}
            onMouseLeave={() => setHoveredControl(null)}
        >
            <button
                type="button"
                aria-label={label}
                aria-describedby={isHintVisible ? `beegame-preview-control-${control}` : undefined}
                title={label}
                onFocus={() => setHoveredControl(control)}
                onBlur={() => setHoveredControl(null)}
                onClick={onClick}
                disabled={disabled}
                className="glass-icon-button h-11 w-11 rounded-xl text-zinc-300 disabled:cursor-not-allowed disabled:opacity-35"
            >
                {children}
            </button>
            {isHintVisible ? (
                <div
                    id={`beegame-preview-control-${control}`}
                    role="tooltip"
                    className="type-footnote pointer-events-none absolute -top-10 left-1/2 z-[100] -translate-x-1/2 whitespace-nowrap rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-zinc-200 shadow-xl shadow-black/40"
                >
                    {label}
                </div>
            ) : null}
        </div>
    );
}
