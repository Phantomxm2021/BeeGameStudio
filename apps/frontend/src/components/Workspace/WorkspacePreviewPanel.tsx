import { useEffect, useState, type RefObject } from 'react';
import { PREVIEW_IFRAME_SANDBOX } from '@bee-game-studio/agent-workflow/preview-environment';
import { AlertTriangle, MonitorPlay } from 'lucide-react';
import { Button } from '../beui/project-button';

export type WorkspacePreviewState = 'starting' | 'live' | 'failed' | 'stopped' | 'idle';

interface WorkspacePreviewPanelProps {
  title: string;
  labels: Record<string, string>;
  embeddedPreviewUrl: string;
  previewState: WorkspacePreviewState;
  statusText: string;
  previewDetailText: string;
  buildErrorLog: string;
  previewFrameRef: RefObject<HTMLIFrameElement | null>;
  canShowPreview: boolean;
  onFixBuildErrors?: () => void | Promise<void>;
}

export function WorkspacePreviewPanel({
  title,
  labels,
  embeddedPreviewUrl,
  previewState,
  statusText,
  previewDetailText,
  buildErrorLog,
  previewFrameRef,
  canShowPreview,
  onFixBuildErrors,
}: WorkspacePreviewPanelProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <div data-testid="beegame-preview-surface" className="workspace-preview-region relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-[var(--preview-well)] text-[var(--text-secondary)]">
      {canShowPreview ? (
        <PreviewFrame key={`${embeddedPreviewUrl}:${attempt}`} title={title} url={embeddedPreviewUrl}
          frameRef={previewFrameRef} labels={labels} onRetry={() => setAttempt(value => value + 1)} />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-8 text-center">
          <div className="max-w-md">
            <div className="mx-auto grid h-16 w-16 place-items-center text-[var(--text-secondary)]">
              {previewState === 'failed' ? <AlertTriangle className="h-8 w-8 text-[var(--destructive)]" /> : <MonitorPlay className="h-8 w-8" />}
            </div>
            <div className="type-caption-1 mt-6 text-[var(--text-secondary)]">{statusText}</div>
            {previewDetailText ? <p className="type-callout mt-3 text-[var(--text-muted)]">{previewDetailText}</p> : null}
          </div>
        </div>
      )}
      {buildErrorLog ? (
        <div data-testid="beegame-preview-error-overlay" className="absolute bottom-2 left-2 right-2 z-20 overflow-hidden rounded-lg border border-[var(--destructive)]/35 bg-[var(--surface-1)]">
          <div className="flex h-11 items-center justify-between gap-4 border-b border-[var(--destructive)]/20 px-4">
            <div className="type-caption-1 text-[var(--text-secondary)]">{labels.console}</div>
            <button type="button" aria-label={labels.fixBuildErrors} onClick={() => void onFixBuildErrors?.()} className="type-button rounded-md border border-[var(--border)] px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
              {labels.fixBuildErrors}
            </button>
          </div>
          <pre className="type-code-sm max-h-28 overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-[var(--destructive)]">{buildErrorLog}</pre>
        </div>
      ) : null}
    </div>
  );
}

function PreviewFrame({ title, url, frameRef, labels, onRetry }: {
  title: string; url: string; frameRef: RefObject<HTMLIFrameElement | null>;
  labels: Record<string, string>; onRetry: () => void;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  useEffect(() => {
    // iframe.onload also fires for HTTP errors; only the injected bridge can
    // confirm that the document and its initial modules have loaded.
    const expectedSession = decodeURIComponent(new URL(url, window.location.origin).pathname.split('/')[2] || '');
    const timer = setTimeout(() => setState('failed'), 30_000);
    let failed = false;
    const receive = (event: MessageEvent) => {
      if (!frameRef.current?.contentWindow || event.source !== frameRef.current.contentWindow) return;
      if (event.origin !== 'null' && event.origin !== new URL(url, window.location.origin).origin) return;
      if (event.data?.type !== 'beegame.preview.lifecycle' || event.data.sessionId !== expectedSession) return;
      if (event.data.status !== 'loaded' && event.data.status !== 'failed') return;
      clearTimeout(timer);
      failed ||= event.data.status === 'failed';
      setState(failed ? 'failed' : 'loaded');
    };
    window.addEventListener('message', receive);
    return () => { clearTimeout(timer); window.removeEventListener('message', receive); };
  }, [url, frameRef]);
  return <>
    {state !== 'failed' ? <iframe ref={frameRef} title={title} data-testid="beegame-live-preview-frame" src={url}
      onError={() => setState('failed')} sandbox={PREVIEW_IFRAME_SANDBOX}
      className="absolute inset-0 h-full w-full border-0 bg-transparent" /> : null}
    {state === 'loading' ? <div role="status" className="pointer-events-none absolute bottom-4 left-4 rounded-full bg-[var(--surface-1)] px-4 py-2 type-footnote">{labels.previewPageLoading || 'Loading preview page…'}</div> : null}
    {state === 'failed' ? <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--preview-well)] px-8 text-center">
      <AlertTriangle className="h-8 w-8 text-[var(--destructive)]" />
      <p>{labels.previewPageFailed || 'Preview page failed to load. This does not establish a game code defect.'}</p>
      <Button variant="outline" className="rounded-full" onClick={onRetry}>{labels.reload || 'Reload preview'}</Button>
    </div> : null}
  </>;
}
