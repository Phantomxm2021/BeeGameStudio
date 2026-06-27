import { type ReactNode, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronLeft, ExternalLink, Globe2, MonitorPlay, Play, RefreshCw, Settings, Square } from 'lucide-react';
import { LANGUAGE_OPTIONS, type Language } from './AgentsConfig';
import { getBeeGameText } from './BeeGameI18n';
import { SettingsMenu } from './Landing/SettingsMenu';
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

const LABELS: Record<Language, {
    title: string;
    starting: string;
    waiting: string;
    noPreview: string;
    failed: string;
    stopped: string;
    live: string;
    reload: string;
    open: string;
    stop: string;
    play: string;
    build: string;
    health: string;
    entrypoint: string;
    unavailable: string;
    tokens: string;
    phase: string;
    model: string;
    syncing: string;
    back: string;
    settings: string;
    language: string;
}> = {
    zh: {
        title: '实时游戏画面',
        starting: '正在准备预览',
        waiting: '等待可运行画面',
        noPreview: '构建完成后会在这里显示游戏画面',
        failed: '预览不可用',
        stopped: '运行已停止',
        live: 'Live',
        reload: '刷新预览',
        open: '在新窗口打开',
        stop: '停止预览',
        play: '播放预览',
        build: '构建',
        health: '健康状态',
        entrypoint: '入口',
        unavailable: '未提供',
        tokens: '消耗',
        phase: '阶段',
        model: '模型',
        syncing: '同步中',
        back: '返回项目列表',
        settings: '设置',
        language: '语言',
    },
    'zh-TW': {
        title: '即時遊戲畫面',
        starting: '正在準備預覽',
        waiting: '等待可執行畫面',
        noPreview: '建構完成後會在這裡顯示遊戲畫面',
        failed: '預覽不可用',
        stopped: '執行已停止',
        live: 'Live',
        reload: '重新整理預覽',
        open: '在新視窗開啟',
        stop: '停止預覽',
        play: '播放預覽',
        build: '建構',
        health: '健康狀態',
        entrypoint: '入口',
        unavailable: '未提供',
        tokens: '消耗',
        phase: '階段',
        model: '模型',
        syncing: '同步中',
        back: '返回專案列表',
        settings: '設定',
        language: '語言',
    },
    en: {
        title: 'Live Game Preview',
        starting: 'Preparing preview',
        waiting: 'Waiting for a playable surface',
        noPreview: 'The game preview appears here after a build is available',
        failed: 'Preview unavailable',
        stopped: 'Runtime stopped',
        live: 'Live',
        reload: 'Reload preview',
        open: 'Open in new window',
        stop: 'Stop preview',
        play: 'Start preview',
        build: 'Build',
        health: 'Health',
        entrypoint: 'Entrypoint',
        unavailable: 'Unavailable',
        tokens: 'Tokens',
        phase: 'Phase',
        model: 'Model',
        syncing: 'Syncing',
        back: 'Back to projects',
        settings: 'Settings',
        language: 'Language',
    },
    ja: {
        title: 'ライブゲームプレビュー',
        starting: 'プレビューを準備中',
        waiting: '実行画面を待機中',
        noPreview: 'ビルド後にゲーム画面がここに表示されます',
        failed: 'プレビュー不可',
        stopped: '実行停止',
        live: 'Live',
        reload: 'プレビューを更新',
        open: '新しいウィンドウで開く',
        stop: 'プレビューを停止',
        play: 'プレビューを開始',
        build: 'ビルド',
        health: '状態',
        entrypoint: '入口',
        unavailable: '未提供',
        tokens: '消費',
        phase: 'フェーズ',
        model: 'モデル',
        syncing: '同期中',
        back: 'プロジェクト一覧に戻る',
        settings: '設定',
        language: '言語',
    },
    ko: {
        title: '실시간 게임 화면',
        starting: '미리보기 준비 중',
        waiting: '실행 가능한 화면 대기 중',
        noPreview: '빌드가 준비되면 게임 화면이 여기에 표시됩니다',
        failed: '미리보기 사용 불가',
        stopped: '실행 중지',
        live: 'Live',
        reload: '미리보기 새로고침',
        open: '새 창에서 열기',
        stop: '미리보기 중지',
        play: '미리보기 시작',
        build: '빌드',
        health: '상태',
        entrypoint: '진입점',
        unavailable: '없음',
        tokens: '토큰',
        phase: '단계',
        model: '모델',
        syncing: '동기화 중',
        back: '프로젝트 목록으로 돌아가기',
        settings: '설정',
        language: '언어',
    },
    fr: {
        title: 'Aperçu du jeu en direct',
        starting: 'Préparation de l’aperçu',
        waiting: 'En attente d’une surface jouable',
        noPreview: 'L’aperçu du jeu apparaîtra ici après le build',
        failed: 'Aperçu indisponible',
        stopped: 'Runtime arrêté',
        live: 'Live',
        reload: 'Recharger l’aperçu',
        open: 'Ouvrir dans une nouvelle fenêtre',
        stop: 'Arrêter l’aperçu',
        play: 'Démarrer l’aperçu',
        build: 'Build',
        health: 'Santé',
        entrypoint: 'Entrée',
        unavailable: 'Indisponible',
        tokens: 'Tokens',
        phase: 'Phase',
        model: 'Modèle',
        syncing: 'Synchronisation',
        back: 'Retour aux projets',
        settings: 'Réglages',
        language: 'Langue',
    },
    de: {
        title: 'Live-Spielvorschau',
        starting: 'Vorschau wird vorbereitet',
        waiting: 'Warte auf spielbare Oberfläche',
        noPreview: 'Die Spielvorschau erscheint hier nach einem Build',
        failed: 'Vorschau nicht verfügbar',
        stopped: 'Runtime gestoppt',
        live: 'Live',
        reload: 'Vorschau neu laden',
        open: 'In neuem Fenster öffnen',
        stop: 'Vorschau stoppen',
        play: 'Vorschau starten',
        build: 'Build',
        health: 'Status',
        entrypoint: 'Einstieg',
        unavailable: 'Nicht verfügbar',
        tokens: 'Tokens',
        phase: 'Phase',
        model: 'Modell',
        syncing: 'Synchronisierung',
        back: 'Zurück zu Projekten',
        settings: 'Einstellungen',
        language: 'Sprache',
    },
    es: {
        title: 'Vista previa del juego',
        starting: 'Preparando vista previa',
        waiting: 'Esperando una superficie jugable',
        noPreview: 'La vista previa aparecerá aquí cuando exista una build',
        failed: 'Vista previa no disponible',
        stopped: 'Runtime detenido',
        live: 'Live',
        reload: 'Recargar vista previa',
        open: 'Abrir en una ventana nueva',
        stop: 'Detener vista previa',
        play: 'Iniciar vista previa',
        build: 'Build',
        health: 'Estado',
        entrypoint: 'Entrada',
        unavailable: 'No disponible',
        tokens: 'Tokens',
        phase: 'Fase',
        model: 'Modelo',
        syncing: 'Sincronizando',
        back: 'Volver a proyectos',
        settings: 'Configuración',
        language: 'Idioma',
    },
    it: {
        title: 'Anteprima gioco live',
        starting: 'Preparazione anteprima',
        waiting: 'In attesa di una superficie giocabile',
        noPreview: 'L’anteprima del gioco apparirà qui dopo la build',
        failed: 'Anteprima non disponibile',
        stopped: 'Runtime fermato',
        live: 'Live',
        reload: 'Ricarica anteprima',
        open: 'Apri in una nuova finestra',
        stop: 'Ferma anteprima',
        play: 'Avvia anteprima',
        build: 'Build',
        health: 'Stato',
        entrypoint: 'Entrypoint',
        unavailable: 'Non disponibile',
        tokens: 'Token',
        phase: 'Fase',
        model: 'Modello',
        syncing: 'Sincronizzazione',
        back: 'Torna ai progetti',
        settings: 'Impostazioni',
        language: 'Lingua',
    },
    pt: {
        title: 'Prévia do jogo ao vivo',
        starting: 'Preparando prévia',
        waiting: 'Aguardando uma superfície jogável',
        noPreview: 'A prévia do jogo aparece aqui quando houver uma build',
        failed: 'Prévia indisponível',
        stopped: 'Runtime parado',
        live: 'Live',
        reload: 'Recarregar prévia',
        open: 'Abrir em nova janela',
        stop: 'Parar prévia',
        play: 'Iniciar prévia',
        build: 'Build',
        health: 'Saúde',
        entrypoint: 'Entrada',
        unavailable: 'Indisponível',
        tokens: 'Tokens',
        phase: 'Fase',
        model: 'Modelo',
        syncing: 'Sincronizando',
        back: 'Voltar aos projetos',
        settings: 'Configurações',
        language: 'Idioma',
    },
};

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
    const [isUserMenuOpen, setUserMenuOpen] = useState(false);
    const [isSettingsOpen, setSettingsOpen] = useState(false);
    const [hoveredControl, setHoveredControl] = useState<PreviewControl | null>(null);
    const [stoppedPreviewUrl, setStoppedPreviewUrl] = useState('');
    const [isStoppingPreview, setStoppingPreview] = useState(false);
    const labels = LABELS[lang] || LABELS.en;
    const uiText = getBeeGameText(lang);
    const hasPermission = useSystemStore(state => state.hasPermission);
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
    const currentLanguageLabel = LANGUAGE_OPTIONS.find(option => option.code === lang)?.label || LANGUAGE_OPTIONS[0]?.label || '';

    useEffect(() => {
        setStoppedPreviewUrl('');
    }, [previewUrl]);

    return (
        <main
            data-testid="beegame-live-preview-page"
            className="relative h-full flex-1 overflow-hidden bg-[#07090c] text-zinc-50"
        >
            <header
                data-testid="beegame-shell-top-nav"
                className="absolute left-0 right-0 top-0 z-[90] flex h-20 items-center border-b border-zinc-800/80 bg-[#080c10]/95 px-7 backdrop-blur-xl"
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
                        className="min-w-0 max-w-[34rem] truncate bg-transparent p-0 text-left text-lg font-black text-zinc-100 outline-none transition hover:text-white focus-visible:text-white"
                    >
                        {projectName}
                    </button>
                    <div className="flex items-center gap-2 rounded-xl bg-zinc-800/80 px-3 py-1 text-xs font-bold text-zinc-300">
                        <Globe2 className="h-3.5 w-3.5" />
                        Web
                    </div>
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-300">
                        <span className={`h-2 w-2 rounded-full ${status === 'running' ? 'bg-emerald-400' : status === 'offline' ? 'bg-amber-400' : 'bg-zinc-500'}`} />
                        {statusText}
                    </div>
                    {isSyncing ? (
                        <div className="rounded-xl bg-zinc-800/80 px-3 py-1 text-xs font-bold text-zinc-400">
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
                            <ProjectHintRow label={labels.phase} value={phaseLabel} />
                            <ProjectHintRow label={labels.model} value={modelName || labels.unavailable} />
                        </div>
                    ) : null}
                </div>

                <div
                    className="relative ml-auto"
                    onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                            setUserMenuOpen(false);
                        }
                    }}
                >
                    <button
                        type="button"
                        aria-label={labels.settings}
                        aria-expanded={isUserMenuOpen}
                        onClick={() => setUserMenuOpen(open => !open)}
                        className="flex h-11 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-2 pl-3 text-zinc-200 transition hover:bg-zinc-800 focus-visible:bg-zinc-800 focus-visible:outline-none"
                    >
                        <span className="grid h-7 w-7 place-items-center rounded-lg bg-zinc-800 text-sm font-black text-zinc-100">
                            N
                        </span>
                        <ChevronDown className={`h-4 w-4 text-zinc-500 transition ${isUserMenuOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isUserMenuOpen ? (
                        <div
                            role="menu"
                            data-testid="beegame-user-settings-menu"
                            className="absolute right-0 top-14 z-[80] w-72 rounded-2xl border border-zinc-800 bg-zinc-950/95 p-3 text-zinc-100 shadow-2xl shadow-black/50 backdrop-blur-xl"
                        >
                            <div className="flex items-center gap-3 px-2 pb-3">
                                <div className="grid h-9 w-9 place-items-center rounded-xl bg-zinc-900 text-sm font-black">N</div>
                                <div className="min-w-0">
                                    <div className="text-sm font-black">N</div>
                                    <div className="truncate text-xs font-bold text-zinc-500">{currentLanguageLabel}</div>
                                </div>
                            </div>
                            <button
                                type="button"
                                role="menuitem"
                                aria-label={labels.settings}
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    setUserMenuOpen(false);
                                    setSettingsOpen(true);
                                }}
                                onClick={() => {
                                    setUserMenuOpen(false);
                                    setSettingsOpen(true);
                                }}
                                className="mt-2 flex w-full items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/50"
                            >
                                <span className="grid h-9 w-9 place-items-center rounded-xl bg-zinc-800 text-zinc-300">
                                    <Settings className="h-4 w-4" />
                                </span>
                                <div className="min-w-0">
                                    <div className="text-sm font-black">{labels.settings}</div>
                                    <div className="truncate text-xs font-bold text-zinc-500">{currentLanguageLabel}</div>
                                </div>
                            </button>
                        </div>
                    ) : null}
                </div>
            </header>

            <div className="absolute bottom-4 left-4 right-[29rem] top-24 flex flex-col">
                <section className="min-h-0 flex-1 overflow-visible rounded-2xl border border-zinc-800 bg-zinc-950/60 shadow-[0_32px_80px_-48px_rgba(0,0,0,0.8)]">
                    <div className="flex h-20 items-center justify-between px-9">
                        <div className="min-w-0">
                            <div className="flex items-baseline gap-3">
                                <h1 className="text-2xl font-black text-zinc-100">
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
                                    <div className="mt-6 text-sm font-black uppercase tracking-[0.22em] text-zinc-200">
                                        {statusText}
                                    </div>
                                    <p className="mt-3 text-sm leading-6 text-zinc-500">
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
                canManageWorkspace={hasPermission('workspace.manage')}
                canManageSecrets={hasPermission('secrets.manage')}
                canManageRuntimeSettings={hasPermission('runtime_settings.manage')}
                canManageMcp={hasPermission('mcp.manage')}
                canManageModelConfig={hasPermission('model_config.manage')}
            />
        </main>
    );
}

function ProjectHintRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800/70 py-2 last:border-b-0">
            <div className="shrink-0 text-xs font-bold text-zinc-500">
                {label}
            </div>
            <div className="min-w-0 truncate text-right text-sm font-bold text-zinc-100">
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
                className="grid h-11 w-11 place-items-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
            >
                {children}
            </button>
            {isHintVisible ? (
                <div
                    id={`beegame-preview-control-${control}`}
                    role="tooltip"
                    className="pointer-events-none absolute -top-10 left-1/2 z-[100] -translate-x-1/2 whitespace-nowrap rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs font-bold text-zinc-200 shadow-xl shadow-black/40"
                >
                    {label}
                </div>
            ) : null}
        </div>
    );
}
