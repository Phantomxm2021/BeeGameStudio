import type { RefObject } from 'react';
import { PREVIEW_IFRAME_SANDBOX } from '@bee-game-studio/agent-workflow/preview-environment';
import { AlertTriangle, MonitorPlay } from 'lucide-react';

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
  return (
    <div data-testid="beegame-preview-surface" className="workspace-preview-region relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-[var(--preview-well)] text-[var(--text-secondary)]">
      {canShowPreview ? (
        <iframe ref={previewFrameRef} title={title} data-testid="beegame-live-preview-frame" src={embeddedPreviewUrl} sandbox={PREVIEW_IFRAME_SANDBOX} className="absolute inset-0 h-full w-full border-0 bg-transparent" />
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
