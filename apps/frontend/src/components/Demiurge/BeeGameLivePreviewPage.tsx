import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronLeft, ExternalLink, Globe2, MonitorPlay, Play, RefreshCw, Settings, Square } from 'lucide-react';
import { LANGUAGE_OPTIONS, type Language } from './AgentsConfig';
import { normalizeI18nLanguage, useBeeGameText } from '../../i18n/useBeeGameTranslations';
import { SettingsMenu } from './Landing/SettingsMenu';
import { UserAccountMenu, type UserAccountMenuItem } from './Landing/UserAccountMenu';
import type { BuildReportPayload } from '../../services/api';
import { useSystemStore } from '../../store/systemStore';

type DashboardStatus = 'running' | 'paused' | 'waiting_approval' | 'stopped' | 'finished' | 'idle' | 'offline';
type PreviewState = 'starting' | 'live' | 'failed' | 'stopped' | 'idle';
type PreviewControl = 'reload' | 'stop' | 'play' | 'open';

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
    onStartPreview?: () => void | Promise<void>;
    onRestartPreview?: () => void | Promise<void>;
    onStopPreview?: () => void | Promise<void>;
    onOpenExternal?: (url: string) => void;
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
    onStartPreview,
    onRestartPreview,
    onStopPreview,
    onOpenExternal,
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
                <section className="min-h-0 flex-1 overflow-visible rounded-2xl border border-zinc-800 bg-zinc-950/60 shadow-[0_32px_80px_-48px_rgba(0,0,0,0.8)]">
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
                                control="open"
                                label={labels.open}
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

                    <div className="mx-9 mb-9 h-[calc(100%-7.25rem)] rounded-xl border border-zinc-800 bg-black p-4">
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
