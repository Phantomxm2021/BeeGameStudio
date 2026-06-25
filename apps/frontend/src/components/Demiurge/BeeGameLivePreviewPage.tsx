import { AlertTriangle, ExternalLink, MonitorPlay, RefreshCw, Square } from 'lucide-react';
import type { Language } from './AgentsConfig';
import type { BuildReportPayload } from '../../services/api';

type DashboardStatus = 'running' | 'paused' | 'waiting_approval' | 'stopped' | 'finished' | 'idle' | 'offline';
type PreviewState = 'starting' | 'live' | 'failed' | 'stopped' | 'idle';

interface BeeGameLivePreviewPageProps {
    lang: Language;
    status: DashboardStatus;
    buildReport?: BuildReportPayload | null;
    onReload?: () => void;
    onOpenExternal?: (url: string) => void;
    onStop?: () => void;
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
    status,
    buildReport,
    onReload,
    onOpenExternal,
    onStop,
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
            className="relative h-full flex-1 overflow-hidden bg-zinc-100 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50"
        >
            <div className="absolute inset-0 flex flex-col pt-24 pl-24 pr-[30rem] pb-8">
                <section className="min-h-0 flex-1 overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-[0_32px_80px_-48px_rgba(0,0,0,0.5)] dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="flex h-16 items-center justify-between border-b border-zinc-200 px-5 dark:border-zinc-800">
                        <div className="min-w-0">
                            <div className="flex items-center gap-3">
                                <span className={`h-2.5 w-2.5 rounded-full ${canShowPreview ? 'bg-emerald-400' : previewState === 'failed' ? 'bg-red-400' : 'bg-amber-400'}`} />
                                <h1 className="truncate text-sm font-black uppercase tracking-[0.22em] text-zinc-900 dark:text-zinc-100">
                                    {labels.title}
                                </h1>
                            </div>
                            <p className="mt-1 truncate text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-500">
                                {statusText}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                aria-label={labels.reload}
                                title={labels.reload}
                                onClick={onReload}
                                disabled={!canShowPreview}
                                className="grid h-10 w-10 place-items-center rounded-full border border-zinc-200 text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-35 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                            >
                                <RefreshCw className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                aria-label={labels.open}
                                title={labels.open}
                                onClick={() => previewUrl && onOpenExternal?.(previewUrl)}
                                disabled={!canShowPreview}
                                className="grid h-10 w-10 place-items-center rounded-full border border-zinc-200 text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-35 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                            >
                                <ExternalLink className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                aria-label={labels.stop}
                                title={labels.stop}
                                onClick={onStop}
                                disabled={status !== 'running'}
                                className="grid h-10 w-10 place-items-center rounded-full border border-zinc-200 text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-35 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                            >
                                <Square className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    <div className="h-[calc(100%-4rem)] bg-zinc-950">
                        {canShowPreview ? (
                            <iframe
                                key={previewUrl}
                                title={labels.title}
                                data-testid="beegame-live-preview-frame"
                                src={previewUrl}
                                sandbox="allow-forms allow-pointer-lock allow-popups allow-same-origin allow-scripts"
                                className="h-full w-full border-0 bg-white"
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

function PreviewMetric({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0 rounded-2xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                {label}
            </div>
            <div className="mt-1 truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
                {value}
            </div>
        </div>
    );
}
