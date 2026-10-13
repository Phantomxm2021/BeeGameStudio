import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { PREVIEW_IFRAME_SANDBOX } from '@bee-game-studio/agent-workflow/preview-environment';
import { DotsAvatar } from '../Demiurge/Landing/DotsAvatar';
import { useDailyAvatar } from '../Demiurge/Landing/useDailyAvatar';
import { AlertTriangle, Ellipsis, Maximize2, MonitorSmartphone, RefreshCw, RotateCw, Sparkles, SquareTerminal, Trash2, X } from 'lucide-react';
import { Liquid } from 'liquid-gooey';
import { Button } from '../beui/project-button';
import { StreamingResponse } from '../beui/registry/components/agents/streaming-response';
import { Input } from '../beui/registry/components/motion/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../beui/registry/components/motion/select';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { filterPathsForDisplay } from '../../utils/chatPathDisplay';

export type WorkspacePreviewState = 'starting' | 'live' | 'failed' | 'stopped' | 'idle';
type PreviewConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
type PreviewConsoleFilter = 'all' | 'info' | 'warn' | 'error';
type PreviewConsoleEntry = { id: number; level: PreviewConsoleLevel; message: string; createdAt: number };
const PREVIEW_CONSOLE_LEVELS = new Set<PreviewConsoleLevel>(['log', 'info', 'warn', 'error', 'debug']);
const consoleFilterForLevel = (level: PreviewConsoleLevel): Exclude<PreviewConsoleFilter, 'all'> =>
  level === 'warn' || level === 'error' ? level : 'info';
type PreviewViewportMode = 'responsive' | 'desktop' | 'ipad' | 'mobile' | 'custom';
type PreviewViewport = { mode: PreviewViewportMode; width: number; height: number };
const PREVIEW_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  ipad: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

interface WorkspacePreviewPanelProps {
  title: string;
  labels: Record<string, string>;
  embeddedPreviewUrl: string;
  previewState: WorkspacePreviewState;
  statusText: string;
  previewDetailText: string;
  previewFrameRef: RefObject<HTMLIFrameElement | null>;
  canShowPreview: boolean;
  isAgentWorking?: boolean;
  onOpenExternal?: (url: string) => void;
  onFixConsoleError?: (message: string) => Promise<boolean | void>;
}

export function WorkspacePreviewPanel({
  title,
  labels,
  embeddedPreviewUrl,
  previewState,
  statusText,
  previewDetailText,
  previewFrameRef,
  canShowPreview,
  isAgentWorking = false,
  onOpenExternal,
  onFixConsoleError,
}: WorkspacePreviewPanelProps) {
  const avatarToken = useDailyAvatar();
  const [attempt, setAttempt] = useState(0);
  const [viewport, setViewport] = useState<PreviewViewport>({ mode: 'responsive', width: 0, height: 0 });
  const [avatarState, setAvatarState] = useState<'default' | 'sleeping' | null>(null);
  const avatarSleepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameKey = `${embeddedPreviewUrl}:${attempt}:${canShowPreview ? 'active' : 'inactive'}`;
  const avatarIsWorking = isAgentWorking || previewState === 'starting';

  useEffect(() => () => {
    if (avatarSleepTimer.current) clearTimeout(avatarSleepTimer.current);
  }, []);

  const wakeAvatar = () => {
    if (avatarIsWorking) return;
    setAvatarState('default');
    if (avatarSleepTimer.current) clearTimeout(avatarSleepTimer.current);
    avatarSleepTimer.current = setTimeout(() => setAvatarState('sleeping'), 3_000);
  };

  return (
    <div data-testid="beegame-preview-surface" onClick={canShowPreview ? undefined : wakeAvatar} className="workspace-preview-region relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-[var(--preview-well)] text-[var(--text-secondary)]">
      {canShowPreview ? (
        <PreviewFrame key={frameKey} title={title} url={embeddedPreviewUrl}
          frameRef={previewFrameRef} labels={labels} onOpenExternal={onOpenExternal}
          onFixConsoleError={onFixConsoleError}
          viewport={viewport} onViewportChange={setViewport}
          onRetry={() => setAttempt(value => value + 1)} />
      ) : (
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden px-8 text-center">
          <div className="relative z-10 max-w-md">
            <div className="mx-auto grid size-24 place-items-center text-[var(--text-secondary)]">
              {previewState === 'failed'
                ? <AlertTriangle className="h-8 w-8 text-[var(--destructive)]" />
                : <DotsAvatar token={avatarToken} mood={avatarIsWorking ? 'thinking' : avatarState === 'default' ? 'idle' : 'sleeping'} label={statusText} />}
            </div>
            <div className="type-caption-1 mt-6 text-[var(--text-secondary)]">{statusText}</div>
            {previewDetailText ? <p className="type-callout mt-3 text-[var(--text-muted)]">{previewDetailText}</p> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewFrame({ title, url, frameRef, labels, viewport, onViewportChange, onOpenExternal, onFixConsoleError, onRetry }: {
  title: string; url: string; frameRef: RefObject<HTMLIFrameElement | null>;
  labels: Record<string, string>; onRetry: () => void;
  onOpenExternal?: (url: string) => void;
  onFixConsoleError?: (message: string) => Promise<boolean | void>;
  viewport: PreviewViewport; onViewportChange: (viewport: PreviewViewport) => void;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [viewportDialogOpen, setViewportDialogOpen] = useState(false);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const [previewAreaSize, setPreviewAreaSize] = useState({ width: 0, height: 0 });
  const [consoleEntries, setConsoleEntries] = useState<PreviewConsoleEntry[]>([]);
  const [consoleFilter, setConsoleFilter] = useState<PreviewConsoleFilter>('all');
  const [selectedConsoleEntryId, setSelectedConsoleEntryId] = useState<number | null>(null);
  const [fixingConsoleEntryId, setFixingConsoleEntryId] = useState<number | null>(null);
  const [unreadConsoleLevel, setUnreadConsoleLevel] = useState<Exclude<PreviewConsoleFilter, 'all'> | null>(null);
  const hasUnreadConsole = unreadConsoleLevel !== null;
  const unreadDotColor = unreadConsoleLevel === 'error' ? 'bg-[var(--destructive)]'
    : unreadConsoleLevel === 'warn' ? 'bg-amber-400' : 'bg-blue-400';
  const consoleOpenRef = useRef(false);
  const nextConsoleEntryId = useRef(0);
  const [paused, setPaused] = useState(false);
  const visibleConsoleEntries = consoleFilter === 'all'
    ? consoleEntries
    : consoleEntries.filter(entry => consoleFilterForLevel(entry.level) === consoleFilter);
  const framedViewport = viewport.mode !== 'responsive';
  const viewportScale = framedViewport && previewAreaSize.width > 0 && previewAreaSize.height > 0
    ? Math.max(0.01, Math.min(1, (previewAreaSize.width - 24) / viewport.width, (previewAreaSize.height - 24) / viewport.height))
    : 1;

  useEffect(() => {
    const area = previewAreaRef.current;
    if (!area) return;
    const measure = () => {
      const { width, height } = area.getBoundingClientRect();
      setPreviewAreaSize(current => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (paused) return;
    // iframe.onload also fires for HTTP errors. Legacy sessions use the injected
    // bridge; measured static Preview is confirmed by a successful HEAD probe.
    const expectedSession = decodeURIComponent(new URL(url, window.location.origin).pathname.split('/')[2] || '');
    const timer = setTimeout(() => setState('failed'), 30_000);
    loadTimeoutRef.current = timer;
    let failed = false;
    const receive = (event: MessageEvent) => {
      if (!frameRef.current?.contentWindow || event.source !== frameRef.current.contentWindow) return;
      if (event.origin !== 'null' && event.origin !== new URL(url, window.location.origin).origin) return;
      if (event.data?.sessionId !== expectedSession) return;
      if (event.data.type === 'beegame.preview.console') {
        const level = event.data.level as PreviewConsoleLevel;
        if (!PREVIEW_CONSOLE_LEVELS.has(level) || typeof event.data.message !== 'string') return;
        const message = event.data.message.slice(0, 2000);
        setConsoleEntries(entries => [...entries.slice(-199), {
          id: nextConsoleEntryId.current++, level, message, createdAt: Date.now(),
        }]);
        if (!consoleOpenRef.current) setUnreadConsoleLevel(current =>
          current === 'error' || level === 'error' ? 'error'
            : current === 'warn' || level === 'warn' ? 'warn' : 'info');
        return;
      }
      if (event.data.type !== 'beegame.preview.lifecycle') return;
      if (event.data.status !== 'loaded' && event.data.status !== 'failed') return;
      clearTimeout(timer);
      loadTimeoutRef.current = null;
      failed ||= event.data.status === 'failed';
      setState(failed ? 'failed' : 'loaded');
    };
    window.addEventListener('message', receive);
    return () => { clearTimeout(timer); loadTimeoutRef.current = null; window.removeEventListener('message', receive); };
  }, [url, frameRef, paused]);

  const openFullscreen = () => {
    if (!onOpenExternal) return;
    onOpenExternal(url);
    setPaused(true);
  };

  const submitConsoleError = async (entry: PreviewConsoleEntry) => {
    if (!onFixConsoleError || fixingConsoleEntryId !== null) return;
    setFixingConsoleEntryId(entry.id);
    try {
      const accepted = await onFixConsoleError(entry.message);
      if (accepted !== false) setSelectedConsoleEntryId(null);
    } finally {
      setFixingConsoleEntryId(null);
    }
  };

  return <>
    <div ref={previewAreaRef} className="absolute inset-0 flex items-center justify-center overflow-hidden">
      {state !== 'failed' && !paused ? <div data-testid="beegame-preview-viewport" className={framedViewport
        ? 'relative shrink-0 bg-[var(--surface-1)] shadow-2xl ring-1 ring-[var(--border)]'
        : 'relative h-full w-full'} style={framedViewport ? { width: viewport.width * viewportScale, height: viewport.height * viewportScale } : undefined}>
        <iframe ref={frameRef} title={title} data-testid="beegame-live-preview-frame" src={url}
          onLoad={() => { void fetch(url, { method: 'HEAD', mode: 'cors', cache: 'no-store' }).then(response => {
            // Measured V3 Preview serves the exact artifact bytes, without the legacy injected bridge.
            // iframe load alone is not enough: HTTP error documents also trigger it.
            if (!response.ok || response.headers.get('X-BeeGame-Preview-Mode') !== 'measured-static') return;
            if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
            loadTimeoutRef.current = null;
            setState(current => current === 'loading' ? 'loaded' : current);
          }).catch(() => undefined); }}
          onError={() => setState('failed')} sandbox={PREVIEW_IFRAME_SANDBOX}
          className={framedViewport ? 'absolute left-0 top-0 border-0 bg-transparent' : 'absolute inset-0 h-full w-full border-0 bg-transparent'}
          style={framedViewport ? { width: viewport.width, height: viewport.height, transform: `scale(${viewportScale})`, transformOrigin: 'top left' } : undefined} />
      </div> : null}
    </div>
    {state === 'loading' ? <div role="status" className="pointer-events-none absolute bottom-4 left-4 z-20 rounded-full bg-[var(--surface-1)] px-4 py-2 type-footnote">{labels.previewPageLoading || 'Loading preview page…'}</div> : null}
    {paused ? <div data-testid="beegame-preview-paused" className="absolute inset-0 grid place-items-center bg-[var(--preview-well)] type-callout text-[var(--text-muted)]">{labels.previewPaused}</div> : null}
    {state === 'failed' ? <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--preview-well)] px-8 text-center">
      <AlertTriangle className="h-8 w-8 text-[var(--destructive)]" />
      <p>{labels.previewPageFailed || 'Preview page failed to load. This does not establish a game code defect.'}</p>
      <Button variant="outline" className="rounded-full" onClick={onRetry}>{labels.reload || 'Reload preview'}</Button>
    </div> : null}
    {consoleOpen ? <section aria-label={labels.previewConsole || 'Console'} data-testid="beegame-preview-console" className="absolute inset-x-0 bottom-0 z-40 flex h-[60%] min-h-40 max-h-[32rem] flex-col overflow-hidden rounded-t-2xl border-t border-[var(--border)] bg-[var(--surface-1)]/95 text-[var(--text-secondary)] shadow-[0_-12px_40px_rgba(0,0,0,0.3)] backdrop-blur">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] px-4">
        <SquareTerminal className="size-4" aria-hidden="true" />
        <span className="type-caption-1 flex-1">{labels.previewConsole || 'Console'}</span>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={labels.clearPreviewConsole || 'Clear console'} title={labels.clearPreviewConsole || 'Clear console'} onClick={() => setConsoleEntries([])} className="rounded-full"><Trash2 className="size-3.5" aria-hidden="true" /></Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={labels.closePreviewConsole || 'Close console'} title={labels.closePreviewConsole || 'Close console'} onClick={() => { consoleOpenRef.current = false; setConsoleOpen(false); }} className="rounded-full"><X className="size-3.5" aria-hidden="true" /></Button>
      </div>
      <div role="group" aria-label={labels.previewConsoleFilters || 'Console filters'} className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border)] px-3 py-2">
        {([
          ['all', labels.previewConsoleAll || 'All'],
          ['info', labels.previewConsoleInfo || 'Info'],
          ['warn', labels.previewConsoleWarning || 'Warning'],
          ['error', labels.previewConsoleError || 'Error'],
        ] as const).map(([value, label]) => <Button key={value} type="button" size="xs" variant={consoleFilter === value ? 'secondary' : 'ghost'} aria-pressed={consoleFilter === value} onClick={() => setConsoleFilter(value)} className="shrink-0 rounded-full px-3">{label}</Button>)}
      </div>
      <div role="log" aria-live="off" className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs">
        {visibleConsoleEntries.length === 0 ? <p className="p-2 text-[var(--text-muted)]">{consoleEntries.length === 0 ? labels.emptyPreviewConsole || 'No console output yet' : labels.emptyFilteredPreviewConsole || 'No matching console output'}</p> : visibleConsoleEntries.map(entry => {
          const selected = selectedConsoleEntryId === entry.id;
          const messageLines = filterPathsForDisplay(entry.message).split('\n');
          const hasStack = messageLines.length > 1;
          return <article key={entry.id} data-testid={`beegame-console-entry-${entry.id}`} className={`mb-2 overflow-hidden rounded-lg border ${selected ? 'border-[var(--ring)] bg-[var(--surface-2)]/70' : 'border-[var(--border)]/70 bg-[var(--surface-1)]/60'} ${entry.level === 'error' ? 'text-[var(--destructive)]' : entry.level === 'warn' ? 'text-amber-400' : ''}`}>
            <button type="button" aria-pressed={selected} onClick={() => setSelectedConsoleEntryId(selected ? null : entry.id)} className="block w-full px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]">
              <span className="mr-2 opacity-60">{new Date(entry.createdAt).toLocaleTimeString()}</span>
              <span className="mr-2 uppercase opacity-70">{entry.level}</span>
              <span className="whitespace-pre-wrap break-words">{messageLines[0]}</span>
            </button>
            {hasStack ? <details className="border-t border-[var(--border)]/50 px-3 py-1.5">
              <summary className="cursor-pointer select-none text-[var(--text-muted)]">{labels.previewConsoleStackTrace || 'Stack trace'} · {messageLines.length - 1}</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-inherit">{messageLines.slice(1).join('\n')}</pre>
            </details> : null}
            <div className="flex justify-end gap-2 border-t border-[var(--border)]/50 px-2 py-1.5">
              <StreamingResponse
                status="complete"
                copyText={`${new Date(entry.createdAt).toLocaleTimeString()} ${entry.level.toUpperCase()}\n${filterPathsForDisplay(entry.message)}`}
                showActions
                announce={false}
                className="!w-auto [&>div:last-child]:!mt-0"
              >{null}</StreamingResponse>
              {onFixConsoleError ? <Button type="button" size="xs" variant="secondary" disabled={fixingConsoleEntryId !== null} onClick={() => void submitConsoleError(entry)} className="rounded-full px-3">
                <Sparkles className="size-3.5" aria-hidden="true" />
                {fixingConsoleEntryId === entry.id ? labels.fixingPreviewConsoleError || 'Sending…' : labels.fixBuildErrors || 'Fix'}
              </Button> : null}
            </div>
          </article>;
        })}
      </div>
    </section> : null}
    {(state === 'loaded' || state === 'failed') && !consoleOpen ? <div data-testid="beegame-preview-actions" className="pointer-events-none absolute bottom-3 left-3 z-30 h-32 w-32">
      <Liquid data-testid="preview-gooey-menu" blur={11} contrast={18} fill="var(--surface-1)" shadow="0 2px 10px rgba(0,0,0,.35)" className="h-full w-full">
        <Liquid.Item style={{ position: 'absolute', left: 0, bottom: 0 }} x={actionsExpanded ? 84 : 0} scale={actionsExpanded ? 1 : 0} transition="bouncy" delay={actionsExpanded ? 90 : 0}>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.fullScreenPreview} title={labels.fullScreenPreview} aria-hidden={!actionsExpanded} tabIndex={actionsExpanded ? 0 : -1} disabled={!actionsExpanded || !onOpenExternal || paused} onClick={openFullscreen} className="pointer-events-auto rounded-full !bg-transparent text-[var(--text-secondary)] hover:!bg-transparent">
            <Maximize2 className="size-4" aria-hidden="true" />
          </Button>
        </Liquid.Item>
        <Liquid.Item style={{ position: 'absolute', left: 0, bottom: 0 }} x={actionsExpanded ? 73 : 0} y={actionsExpanded ? -42 : 0} scale={actionsExpanded ? 1 : 0} transition="bouncy" delay={actionsExpanded ? 60 : 0}>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.refreshPreview} title={labels.refreshPreview} aria-hidden={!actionsExpanded} tabIndex={actionsExpanded ? 0 : -1} disabled={!actionsExpanded} onClick={onRetry} className="pointer-events-auto rounded-full !bg-transparent text-[var(--text-secondary)] hover:!bg-transparent">
            <RefreshCw className="size-4" aria-hidden="true" />
          </Button>
        </Liquid.Item>
        <Liquid.Item style={{ position: 'absolute', left: 0, bottom: 0 }} x={actionsExpanded ? 42 : 0} y={actionsExpanded ? -73 : 0} scale={actionsExpanded ? 1 : 0} transition="bouncy" delay={actionsExpanded ? 30 : 0}>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.previewViewport || 'Viewport'} title={labels.previewViewport || 'Viewport'} aria-hidden={!actionsExpanded} tabIndex={actionsExpanded ? 0 : -1} disabled={!actionsExpanded} onClick={() => { setActionsExpanded(false); setViewportDialogOpen(true); }} className="pointer-events-auto rounded-full !bg-transparent text-[var(--text-secondary)] hover:!bg-transparent">
            <MonitorSmartphone className="size-4" aria-hidden="true" />
          </Button>
        </Liquid.Item>
        <Liquid.Item style={{ position: 'absolute', left: 0, bottom: 0 }} y={actionsExpanded ? -84 : 0} scale={actionsExpanded ? 1 : 0} transition="bouncy">
          <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.previewConsole || 'Console'} aria-description={hasUnreadConsole ? labels.newPreviewConsoleOutput || 'New console output' : undefined} title={labels.previewConsole || 'Console'} aria-hidden={!actionsExpanded} tabIndex={actionsExpanded ? 0 : -1} disabled={!actionsExpanded} onClick={() => { consoleOpenRef.current = true; setUnreadConsoleLevel(null); setActionsExpanded(false); setConsoleOpen(true); }} className="pointer-events-auto relative rounded-full !bg-transparent text-[var(--text-secondary)] hover:!bg-transparent">
            <SquareTerminal className="size-4" aria-hidden="true" />
          </Button>
        </Liquid.Item>
        <Liquid.Item style={{ position: 'absolute', left: 0, bottom: 0 }}>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={actionsExpanded ? labels.closePreviewActions : labels.previewActions} aria-description={hasUnreadConsole ? labels.newPreviewConsoleOutput || 'New console output' : undefined} title={actionsExpanded ? labels.closePreviewActions : labels.previewActions} aria-expanded={actionsExpanded} onClick={() => setActionsExpanded(value => !value)} className="pointer-events-auto relative rounded-full !bg-transparent text-[var(--text-secondary)] hover:!bg-transparent">
            <Ellipsis className="size-4" aria-hidden="true" />
          </Button>
        </Liquid.Item>
      </Liquid>
      {hasUnreadConsole ? <span data-testid="beegame-console-unread-dot" aria-hidden="true"
        className={`pointer-events-none absolute bottom-6 left-6 size-2 rounded-full ${unreadDotColor} ring-2 ring-[var(--surface-1)]`}
        style={{ transform: `translateY(${actionsExpanded ? -84 : 0}px)` }} /> : null}
    </div> : null}
    {viewportDialogOpen ? <PreviewViewportDialog onClose={() => setViewportDialogOpen(false)} viewport={viewport} onApply={onViewportChange} labels={labels} /> : null}
  </>;
}

function PreviewViewportDialog({ viewport, onApply, onClose, labels }: {
  viewport: PreviewViewport;
  onApply: (viewport: PreviewViewport) => void;
  onClose: () => void;
  labels: Record<string, string>;
}) {
  const [mode, setMode] = useState<PreviewViewportMode>(viewport.mode);
  const [width, setWidth] = useState(String(viewport.width || 1280));
  const [height, setHeight] = useState(String(viewport.height || 720));
  const validSize = /^\d+$/.test(width) && /^\d+$/.test(height)
    && Number(width) >= 240 && Number(width) <= 4096
    && Number(height) >= 240 && Number(height) <= 4096;
  const choose = (nextMode: PreviewViewportMode) => {
    setMode(nextMode);
    if (nextMode === 'desktop' || nextMode === 'ipad' || nextMode === 'mobile') {
      setWidth(String(PREVIEW_VIEWPORTS[nextMode].width));
      setHeight(String(PREVIEW_VIEWPORTS[nextMode].height));
    }
  };
  const apply = () => {
    if (mode !== 'responsive' && !validSize) return;
    onApply({ mode, width: mode === 'responsive' ? 0 : Number(width), height: mode === 'responsive' ? 0 : Number(height) });
    onClose();
  };

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-md overflow-visible p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <DialogTitle>{labels.previewViewportTitle || 'Preview viewport'}</DialogTitle>
          <DialogDescription>{labels.previewViewportDescription || 'Test another screen size without changing the game.'}</DialogDescription>
        </div>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={labels.previewViewportClose || 'Close viewport settings'} onClick={onClose} className="shrink-0 rounded-full"><X className="size-4" aria-hidden="true" /></Button>
      </div>
      <div className="mt-5">
        <Select value={mode} onValueChange={value => choose(value as PreviewViewportMode)}>
          <SelectTrigger ariaLabel={labels.previewViewportPresets || 'Viewport presets'} className="h-10 rounded-xl">
            <SelectValue placeholder={labels.previewViewportPresets || 'Viewport presets'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="responsive">{`${labels.previewViewportResponsive || 'Fit panel'} · ${labels.previewViewportAutomatic || 'Automatic'}`}</SelectItem>
            <SelectItem value="desktop">{`${labels.previewViewportDesktop || 'PC'} · 1440 × 900`}</SelectItem>
            <SelectItem value="ipad">{`${labels.previewViewportIpad || 'iPad'} · 768 × 1024`}</SelectItem>
            <SelectItem value="mobile">{`${labels.previewViewportMobile || 'Mobile'} · 390 × 844`}</SelectItem>
            <SelectItem value="custom">{labels.previewViewportCustom || 'Custom'}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <Input label={labels.previewViewportWidth || 'Width'} type="number" min={240} max={4096} value={width} disabled={mode === 'responsive'} onChange={value => { setWidth(value); setMode('custom'); }} classNames={{ field: 'h-9', input: 'text-sm' }} />
        <Button type="button" variant="ghost" size="icon-sm" disabled={mode === 'responsive'} aria-label={labels.previewViewportSwap || 'Swap width and height'} title={labels.previewViewportSwap || 'Swap width and height'} onClick={() => { setWidth(height); setHeight(width); setMode('custom'); }} className="mb-0.5 rounded-full"><RotateCw className="size-4" aria-hidden="true" /></Button>
        <Input label={labels.previewViewportHeight || 'Height'} type="number" min={240} max={4096} value={height} disabled={mode === 'responsive'} onChange={value => { setHeight(value); setMode('custom'); }} classNames={{ field: 'h-9', input: 'text-sm' }} />
      </div>
      {mode !== 'responsive' && !validSize ? <p role="alert" className="mt-2 text-xs text-[var(--destructive)]">{labels.previewViewportSizeError || 'Enter a width and height from 240 to 4096 px.'}</p> : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} className="rounded-full">{labels.previewViewportCancel || 'Cancel'}</Button>
        <Button type="button" size="sm" disabled={mode !== 'responsive' && !validSize} onClick={apply} className="rounded-full">{labels.previewViewportApply || 'Apply'}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
