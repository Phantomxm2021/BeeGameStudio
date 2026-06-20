import { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2, PlayCircle } from 'lucide-react';
import { apiFetchGameRunDetail, type GameRunDetail } from '../api/client';
import { StatusBadge } from '../components/Navbar';
import { cn } from '../lib/utils';

interface RunDetailProps {
  runId: string;
}

export function RunDetail({ runId }: RunDetailProps) {
  const [detail, setDetail] = useState<GameRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await apiFetchGameRunDetail(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void loadRun();
  }, [loadRun]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-text-muted">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading run...
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="rounded-md border border-status-error/30 bg-status-error/10 px-4 py-3 text-sm text-status-error">
          {error || 'Run not found'}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-brand">
            <PlayCircle className="h-5 w-5" />
            <span className="text-sm font-medium">Game run</span>
          </div>
          <h1 className="font-display text-xl font-semibold text-text-primary">{detail.project.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{detail.project.idea}</p>
        </div>
        <StatusBadge status={detail.run.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-md border border-border bg-surface-1 p-4">
          <h2 className="mb-4 font-display text-base font-semibold text-text-primary">Phases</h2>
          <div className="space-y-2">
            {detail.run.phases.map((phase, index) => (
              <div
                key={phase.id}
                className={cn(
                  'flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2',
                  phase.title === detail.run.currentPhase && 'border-brand/50',
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-1 text-xs text-text-muted">
                    {index + 1}
                  </span>
                  <span className="truncate text-sm font-medium text-text-primary">{phase.title}</span>
                </div>
                <span className="text-xs text-text-muted">{phase.status}</span>
              </div>
            ))}
          </div>
        </section>

        <aside className="rounded-md border border-border bg-surface-1 p-4">
          <div className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-text-primary">
            <FileText className="h-4 w-4 text-brand" />
            Artifacts
          </div>
          {detail.artifacts.length === 0 ? (
            <div className="rounded-md border border-border bg-surface-2 px-3 py-6 text-sm text-text-muted">
              No artifacts yet.
            </div>
          ) : (
            <div className="space-y-2">
              {detail.artifacts.map(artifact => (
                <div key={artifact.id} className="rounded-md border border-border bg-surface-2 px-3 py-2">
                  <div className="text-sm font-medium text-text-primary">{artifact.title}</div>
                  <div className="mt-1 text-xs text-text-muted">{artifact.kind}</div>
                  {artifact.path && (
                    <div className="mt-1 truncate font-mono text-xs text-text-muted">{artifact.path}</div>
                  )}
                  {artifact.url && (
                    <a href={artifact.url} className="mt-1 block truncate text-xs text-brand hover:underline">
                      {artifact.url}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
