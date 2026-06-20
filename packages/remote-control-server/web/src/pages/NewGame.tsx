import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gamepad2, Play, Settings } from 'lucide-react';
import {
  apiCreateGameProject,
  apiCreateGameRun,
  apiFetchModelConfigs,
  type ModelConfig,
  type TargetPlatform,
} from '../api/client';
import { cn } from '../lib/utils';

interface NewGameProps {
  onRunCreated: (runId: string) => void;
  onNavigateModels: () => void;
}

export function NewGame({ onRunCreated, onNavigateModels }: NewGameProps) {
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [idea, setIdea] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [targetPlatform, setTargetPlatform] = useState<TargetPlatform>('web');
  const [modelConfigId, setModelConfigId] = useState('');

  const defaultConfig = useMemo(() => configs.find(config => config.isDefault) ?? configs[0], [configs]);

  const loadModels = useCallback(async () => {
    setLoadingModels(true);
    setError(null);
    try {
      const next = await apiFetchModelConfigs();
      setConfigs(next);
      const preferred = next.find(config => config.isDefault) ?? next[0];
      setModelConfigId(preferred?.id ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model configs');
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const project = await apiCreateGameProject({
        name: name.trim(),
        idea: idea.trim(),
        targetPlatform,
        workspacePath: workspacePath.trim(),
      });
      const run = await apiCreateGameRun({
        projectId: project.id,
        modelConfigId,
      });
      onRunCreated(run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game run');
    } finally {
      setCreating(false);
    }
  };

  const canSubmit = name.trim() && idea.trim() && workspacePath.trim() && modelConfigId;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-brand">
          <Gamepad2 className="h-5 w-5" />
          <span className="text-sm font-medium">Game run</span>
        </div>
        <h1 className="font-display text-xl font-semibold text-text-primary">New Game</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          Start from an idea, then let the dashboard track design docs, implementation, build checks, and preview
          artifacts.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-md border border-border bg-surface-1 p-4">
          <Field label="Project name">
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand"
              placeholder="Orbit Garden"
              required
            />
          </Field>
          <Field label="Idea">
            <textarea
              value={idea}
              onChange={event => setIdea(event.target.value)}
              className="min-h-40 w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand"
              placeholder="A cozy orbital farming game where players tune gravity rings to grow alien crops."
              required
            />
          </Field>
          <Field label="Workspace path">
            <input
              value={workspacePath}
              onChange={event => setWorkspacePath(event.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none focus:border-brand"
              placeholder="/tmp/orbit-garden"
              required
            />
          </Field>
        </section>

        <aside className="rounded-md border border-border bg-surface-1 p-4">
          <div className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-text-primary">
            <Settings className="h-4 w-4 text-brand" />
            Run Settings
          </div>
          <Field label="Target platform">
            <select
              value={targetPlatform}
              onChange={event => setTargetPlatform(event.target.value as TargetPlatform)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand"
            >
              <option value="web">Web / HTML5</option>
              <option value="unity">Unity</option>
              <option value="godot">Godot</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          <Field label="Model provider">
            {loadingModels ? (
              <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">
                Loading...
              </div>
            ) : configs.length === 0 ? (
              <button
                type="button"
                onClick={onNavigateModels}
                className="w-full rounded-md border border-border px-3 py-2 text-sm text-brand transition-colors hover:bg-surface-2"
              >
                Configure models
              </button>
            ) : (
              <select
                value={modelConfigId || defaultConfig?.id || ''}
                onChange={event => setModelConfigId(event.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand"
              >
                {configs.map(config => (
                  <option key={config.id} value={config.id}>
                    {config.name}
                    {config.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button
            type="submit"
            disabled={!canSubmit || creating}
            className={cn(
              'mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-light',
              (!canSubmit || creating) && 'cursor-not-allowed opacity-60',
            )}
          >
            <Play className="h-4 w-4" />
            {creating ? 'Creating...' : 'Create Run'}
          </button>
        </aside>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}
