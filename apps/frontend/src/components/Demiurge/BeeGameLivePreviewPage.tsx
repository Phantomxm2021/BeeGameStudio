import { AlertTriangle, Box, ChevronLeft, CircleHelp, ExternalLink, Folder, FolderOpen, Globe2, MonitorPlay, Network, PlayCircle, RefreshCw, Settings, Square } from 'lucide-react';
import type { Language } from './AgentsConfig';
import type { BuildReportPayload } from '../../services/api';

type DashboardStatus = 'running' | 'paused' | 'waiting_approval' | 'stopped' | 'finished' | 'idle' | 'offline';
type PreviewState = 'starting' | 'live' | 'failed' | 'stopped' | 'idle';

interface BeeGameLivePreviewPageProps {
    lang: Language;
    projectName: string;
    status: DashboardStatus;
    phaseLabel: string;
    progress: number;
    tokens: number;
    isSyncing: boolean;
    buildReport?: BuildReportPayload | null;
    onReload?: () => void;
    onOpenExternal?: (url: string) => void;
    onStop?: () => void;
    onSetLang: (lang: Language) => void;
    onToggleTheme: () => void;
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
    build: string;
    health: string;
    entrypoint: string;
    unavailable: string;
    tokens: string;
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
        stop: '停止运行',
        build: '构建',
        health: '健康状态',
        entrypoint: '入口',
        unavailable: '未提供',
        tokens: '消耗',
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
        stop: '停止執行',
        build: '建構',
        health: '健康狀態',
        entrypoint: '入口',
        unavailable: '未提供',
        tokens: '消耗',
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
        stop: 'Stop runtime',
        build: 'Build',
        health: 'Health',
        entrypoint: 'Entrypoint',
        unavailable: 'Unavailable',
        tokens: 'Tokens',
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
        stop: '実行を停止',
        build: 'ビルド',
        health: '状態',
        entrypoint: '入口',
        unavailable: '未提供',
        tokens: '消費',
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
        stop: '실행 중지',
        build: '빌드',
        health: '상태',
        entrypoint: '진입점',
        unavailable: '없음',
        tokens: '토큰',
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
        stop: 'Arrêter le runtime',
        build: 'Build',
        health: 'Santé',
        entrypoint: 'Entrée',
        unavailable: 'Indisponible',
        tokens: 'Tokens',
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
        stop: 'Runtime stoppen',
        build: 'Build',
        health: 'Status',
        entrypoint: 'Einstieg',
        unavailable: 'Nicht verfügbar',
        tokens: 'Tokens',
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
        stop: 'Detener runtime',
        build: 'Build',
        health: 'Estado',
        entrypoint: 'Entrada',
        unavailable: 'No disponible',
        tokens: 'Tokens',
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
        stop: 'Ferma runtime',
        build: 'Build',
        health: 'Stato',
        entrypoint: 'Entrypoint',
        unavailable: 'Non disponibile',
        tokens: 'Token',
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
        stop: 'Parar runtime',
        build: 'Build',
        health: 'Saúde',
        entrypoint: 'Entrada',
        unavailable: 'Indisponível',
        tokens: 'Tokens',
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
    progress,
    tokens,
    isSyncing,
    buildReport,
    onReload,
    onOpenExternal,
    onStop,
    onSetLang,
    onToggleTheme,
}: BeeGameLivePreviewPageProps) {
    const labels = LABELS[lang] || LABELS.en;
    const previewUrl = normalizeUrl(buildReport?.build_url);
    const previewState = getPreviewState(status, buildReport);
    const canShowPreview = previewState === 'live' && Boolean(previewUrl);
    const statusText = previewState === 'live'
        ? labels.live
        : previewState === 'failed'
            ? labels.failed
            : previewState === 'stopped'
                ? labels.stopped
                : previewState === 'starting'
                    ? labels.starting
                    : labels.waiting;

    return (
        <main
            data-testid="beegame-live-preview-page"
            className="relative h-full flex-1 overflow-hidden bg-[#07090c] text-zinc-50"
        >
            <header
                data-testid="beegame-shell-top-nav"
                className="absolute left-0 right-0 top-0 z-30 flex h-20 items-center border-b border-zinc-800/80 bg-[#080c10]/95 px-7 backdrop-blur-xl"
            >
                <div className="flex w-36 items-center gap-3">
                    <div className="grid h-8 w-8 place-items-center rounded-xl border border-orange-500/50 text-orange-400">
                        <Box className="h-4 w-4" />
                    </div>
                    <div className="text-lg font-black tracking-tight">BeeGame</div>
                </div>

                <div className="flex h-12 min-w-0 items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4">
                    <ChevronLeft className="h-4 w-4 text-zinc-500" />
                    <div className="truncate text-lg font-black text-zinc-100">{projectName}</div>
                    <div className="flex items-center gap-2 rounded-full bg-zinc-800 px-3 py-1 text-xs font-bold text-zinc-300">
                        <Globe2 className="h-3.5 w-3.5" />
                        Web
                    </div>
                    <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-300">
                        <span className={`h-2 w-2 rounded-full ${status === 'running' ? 'bg-emerald-400' : status === 'offline' ? 'bg-amber-400' : 'bg-zinc-500'}`} />
                        {statusText}
                    </div>
                    {isSyncing ? (
                        <div className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-bold text-zinc-400">
                            Syncing
                        </div>
                    ) : null}
                </div>

                <div className="ml-6 flex items-center divide-x divide-zinc-800">
                    <HeaderMetric label={labels.tokens} value={tokens.toLocaleString()} />
                    <HeaderMetric label="Phase" value={`${phaseLabel} · ${Math.floor(progress)}%`} />
                    <HeaderMetric label="Model" value="Claude Sonnet 4" />
                </div>

                <div className="ml-auto flex items-center gap-3">
                    <select
                        aria-label="Language"
                        value={lang}
                        onChange={(event) => onSetLang(event.target.value as Language)}
                        className="h-10 rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm font-bold text-zinc-200 outline-none"
                    >
                        <option value="zh">简体中文</option>
                        <option value="zh-TW">繁體中文</option>
                        <option value="en">English</option>
                        <option value="ja">日本語</option>
                        <option value="ko">한국어</option>
                    </select>
                    <button
                        type="button"
                        aria-label="Theme"
                        onClick={onToggleTheme}
                        className="grid h-10 w-10 place-items-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-300"
                    >
                        <Settings className="h-4 w-4" />
                    </button>
                    <div className="grid h-11 w-11 place-items-center rounded-full border border-zinc-800 bg-zinc-900 text-sm font-black text-zinc-200">
                        N
                    </div>
                </div>
            </header>

            <nav
                data-testid="beegame-shell-side-nav"
                className="absolute bottom-0 left-0 top-20 z-20 flex w-28 flex-col items-center border-r border-zinc-800/80 bg-[#080c10]/90 py-6"
            >
                <SideNavItem icon={Folder} label="项目" active />
                <SideNavItem icon={PlayCircle} label="运行" />
                <SideNavItem icon={FolderOpen} label="工作区" />
                <SideNavItem icon={Box} label="模型" />
                <SideNavItem icon={Network} label="MCP" />
                <SideNavItem icon={Settings} label="设置" />
                <SideNavItem icon={CircleHelp} label="帮助" />
                <button
                    type="button"
                    aria-label="Collapse"
                    className="mt-auto grid h-12 w-12 place-items-center rounded-xl border border-zinc-800 bg-zinc-900/80 text-zinc-500"
                >
                    <ChevronLeft className="h-5 w-5" />
                </button>
            </nav>

            <div className="absolute bottom-4 left-32 right-[29rem] top-24 flex flex-col">
                <section className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/60 shadow-[0_32px_80px_-48px_rgba(0,0,0,0.8)]">
                    <div className="flex h-[7.5rem] items-center justify-between px-9">
                        <div className="min-w-0">
                            <div className="flex items-baseline gap-3">
                                <h1 className="text-2xl font-black text-zinc-100">
                                    {labels.title.replace('游戏画面', '预览')}
                                </h1>
                                <span className="text-sm font-bold text-zinc-500">Live Preview</span>
                            </div>
                            <div className="mt-4 flex items-center gap-4">
                                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold ${canShowPreview ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
                                    <span className={`h-2 w-2 rounded-full ${canShowPreview ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                    {canShowPreview ? 'Preview live' : statusText}
                                </span>
                                <span className="font-mono text-sm text-zinc-500">{previewUrl ? previewUrl.replace(/^https?:\/\//, '') : labels.unavailable}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                aria-label={labels.reload}
                                title={labels.reload}
                                onClick={onReload}
                                disabled={!canShowPreview}
                                className="inline-flex h-11 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 text-sm font-bold text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
                            >
                                <RefreshCw className="h-4 w-4" />
                                {labels.reload}
                            </button>
                            <button
                                type="button"
                                aria-label={labels.open}
                                title={labels.open}
                                onClick={() => previewUrl && onOpenExternal?.(previewUrl)}
                                disabled={!canShowPreview}
                                className="inline-flex h-11 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 text-sm font-bold text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
                            >
                                <ExternalLink className="h-4 w-4" />
                                {labels.open}
                            </button>
                            <button
                                type="button"
                                aria-label={labels.stop}
                                title={labels.stop}
                                onClick={onStop}
                                disabled={status !== 'running'}
                                className="inline-flex h-11 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 text-sm font-bold text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
                            >
                                <Square className="h-4 w-4 fill-red-500 text-red-500" />
                                {labels.stop}
                            </button>
                        </div>
                    </div>

                    <div className="mx-9 mb-9 h-[calc(100%-10.5rem)] rounded-xl border border-zinc-800 bg-black p-4">
                        {canShowPreview ? (
                            <iframe
                                key={previewUrl}
                                title={labels.title}
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

                <section className="mt-4 grid grid-cols-3 gap-3">
                    <PreviewMetric label={labels.health} value={statusText} />
                    <PreviewMetric label={labels.build} value={buildReport?.status || labels.unavailable} />
                    <PreviewMetric label={labels.entrypoint} value={buildReport?.entrypoint || labels.unavailable} />
                </section>
            </div>
        </main>
    );
}

function HeaderMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 px-5">
            <div className="text-xs font-medium text-zinc-500">
                {label}
            </div>
            <div className="mt-1 truncate text-sm font-bold text-zinc-100">
                {value}
            </div>
        </div>
    );
}

function SideNavItem({ icon: Icon, label, active = false }: { icon: typeof Folder; label: string; active?: boolean }) {
    return (
        <button
            type="button"
            className={`relative mb-5 flex h-16 w-20 flex-col items-center justify-center gap-2 rounded-xl text-xs font-bold transition ${active ? 'bg-zinc-900 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-900/70 hover:text-zinc-300'}`}
        >
            {active ? <span className="absolute -left-4 top-2 h-12 w-1 rounded-full bg-orange-500" /> : null}
            <Icon className={`h-5 w-5 ${active ? 'text-orange-400' : ''}`} />
            {label}
        </button>
    );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-3">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                {label}
            </div>
            <div className="mt-1 truncate text-sm font-bold text-zinc-300">
                {value}
            </div>
        </div>
    );
}
