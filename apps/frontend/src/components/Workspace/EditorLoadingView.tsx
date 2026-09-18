import { MagneticButton } from '../motion/button';

export type EditorLoadState = {
  status: 'loading' | 'ready' | 'error';
  progress: number;
  label: string;
  detail: string;
};

export function EditorLoadingView({
  state,
  progressLabel,
  onStop,
  onRetry,
  onExit,
}: {
  state: EditorLoadState;
  progressLabel: string;
  onStop: () => void;
  onRetry?: () => void;
  onExit?: () => void;
}) {
  const loading = state.status === 'loading';
  return (
    <div className="scene-loading-view" role={state.status === 'error' ? 'alert' : 'status'} aria-live="polite">
      <div className={`scene-loading-content is-${state.status}`}>
        {loading ? (
          <>
            <div className="scene-loading-progress-meta"><strong>{state.label}</strong><span>{state.progress}%</span></div>
            <div className="scene-loading-progress" role="progressbar" aria-label={progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.progress}>
              <span style={{ width: `${state.progress}%` }} />
            </div>
            <span className="scene-loading-detail">{state.detail}</span>
            <div className="scene-loading-stop-row">
              <MagneticButton variant="outline" size="md" strength={0.5} onClick={onStop}>
                Cancel
              </MagneticButton>
            </div>
          </>
        ) : (
          <>
            <div className="scene-loading-copy"><strong>{state.label}</strong></div>
            <span className="scene-loading-detail error-detail">{state.detail}</span>
            <div className="scene-loading-actions">
              {onRetry ? <button type="button" className="scene-loading-action primary" onClick={onRetry}>Try again</button> : null}
              {onExit ? <button type="button" className="scene-loading-action" onClick={onExit}>Close editor</button> : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
