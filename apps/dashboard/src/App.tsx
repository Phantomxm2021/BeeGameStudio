import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createModelConfig,
  deleteModelConfig,
  createProject,
  createRun,
  fetchModels,
  fetchProjects,
  fetchProjectRuns,
  fetchRunDetail,
  fetchWorkers,
  updateModelConfig,
  type Artifact,
  type ModelConfigInput,
  type ModelConfig,
  type Project,
  type Run,
  type RunDetail,
  type RunPhase,
  type WorkerSummary,
  type WorkflowEvent,
} from './api';

type DirectoryPickerHandle = {
  name?: string;
};

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<DirectoryPickerHandle>;
  }
}

export function App() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [form, setForm] = useState({
    name: '',
    idea: '',
    targetRuntime: 'custom-runtime',
    workspacePath: '',
    modelConfigId: '',
  });
  const [modelForm, setModelForm] = useState<ModelConfigInput>({
    name: '',
    provider: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    models: { balanced: '' },
    isDefault: true,
  });

  const selectedProject = useMemo(
    () => projects.find(project => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const selectedRun = useMemo(() => runs.find(run => run.id === selectedRunId) ?? null, [runs, selectedRunId]);

  const loadProjectRuns = useCallback(async (projectId: string, preferredRunId?: string) => {
    const nextRuns = await fetchProjectRuns(projectId);
    setRuns(nextRuns);
    const nextRunId = preferredRunId ?? nextRuns.at(-1)?.id ?? null;
    setSelectedRunId(nextRunId);
    if (nextRunId) {
      setRunDetail(await fetchRunDetail(nextRunId));
    } else {
      setRunDetail(null);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    setError(null);
    try {
      const [nextModels, nextProjects, nextWorkers] = await Promise.all([
        fetchModels(),
        fetchProjects(),
        fetchWorkers(),
      ]);
      setModels(nextModels);
      setProjects(nextProjects);
      setWorkers(nextWorkers);
      const nextProjectId = selectedProjectId ?? nextProjects[0]?.id ?? null;
      setSelectedProjectId(nextProjectId);
      if (nextProjectId) {
        await loadProjectRuns(nextProjectId, selectedRunId ?? undefined);
      } else {
        setRuns([]);
        setSelectedRunId(null);
        setRunDetail(null);
      }
      setForm(current => ({
        ...current,
        modelConfigId:
          current.modelConfigId || nextModels.find(model => model.isDefault)?.id || nextModels[0]?.id || '',
      }));
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [loadProjectRuns, selectedProjectId, selectedRunId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleCreateRun = async () => {
    if (!form.name.trim() || !form.idea.trim() || !form.workspacePath.trim()) {
      setError('Project name, idea, and workspace are required.');
      return;
    }
    if (!form.modelConfigId) {
      setError('Create or select an LLM model config before starting a workflow.');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const project = await createProject({
        name: form.name.trim(),
        idea: form.idea.trim(),
        targetRuntime: form.targetRuntime.trim() || 'custom-runtime',
        workspacePath: form.workspacePath.trim(),
      });
      const run = await createRun(project.id, form.modelConfigId);
      const detail = await fetchRunDetail(run.id);
      setProjects(await fetchProjects());
      setSelectedProjectId(project.id);
      await loadProjectRuns(project.id, run.id);
      setRunDetail(detail);
      setForm(current => ({
        name: '',
        idea: '',
        targetRuntime: 'custom-runtime',
        workspacePath: '',
        modelConfigId: current.modelConfigId,
      }));
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const handleSaveModel = async () => {
    if (!modelForm.name.trim() || !modelForm.apiKey.trim() || !modelForm.models.balanced?.trim()) {
      setError('Model name, API key, and balanced model are required.');
      return;
    }

    setSavingModel(true);
    setError(null);
    try {
      const saved = await createModelConfig({
        name: modelForm.name.trim(),
        provider: modelForm.provider,
        ...(modelForm.baseUrl?.trim() ? { baseUrl: modelForm.baseUrl.trim() } : {}),
        apiKey: modelForm.apiKey.trim(),
        models: {
          ...(modelForm.models.fast?.trim() ? { fast: modelForm.models.fast.trim() } : {}),
          balanced: modelForm.models.balanced.trim(),
          ...(modelForm.models.strong?.trim() ? { strong: modelForm.models.strong.trim() } : {}),
        },
        isDefault: modelForm.isDefault,
      });
      setModels(await fetchModels());
      setForm(current => ({ ...current, modelConfigId: saved.id }));
      setModelForm({
        name: '',
        provider: 'openai-compatible',
        baseUrl: '',
        apiKey: '',
        models: { balanced: '' },
        isDefault: true,
      });
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSavingModel(false);
    }
  };

  const handleSetDefaultModel = async (model: ModelConfig) => {
    setError(null);
    try {
      await updateModelConfig(model.id, { isDefault: true });
      setModels(await fetchModels());
      setForm(current => ({ ...current, modelConfigId: model.id }));
    } catch (err) {
      setError(toErrorMessage(err));
    }
  };

  const handleDeleteModel = async (model: ModelConfig) => {
    setError(null);
    try {
      await deleteModelConfig(model.id);
      const nextModels = await fetchModels();
      setModels(nextModels);
      setForm(current => ({
        ...current,
        modelConfigId:
          current.modelConfigId === model.id
            ? nextModels.find(next => next.isDefault)?.id || nextModels[0]?.id || ''
            : current.modelConfigId,
      }));
    } catch (err) {
      setError(toErrorMessage(err));
    }
  };

  const handleSelectProject = async (project: Project) => {
    setSelectedProjectId(project.id);
    setError(null);
    try {
      await loadProjectRuns(project.id);
    } catch (err) {
      setError(toErrorMessage(err));
    }
  };

  const handleSelectRun = async (run: Run) => {
    setSelectedRunId(run.id);
    setError(null);
    try {
      setRunDetail(await fetchRunDetail(run.id));
    } catch (err) {
      setError(toErrorMessage(err));
    }
  };

  const handlePickWorkspace = async () => {
    if (!window.showDirectoryPicker) {
      setError('This browser does not expose folder picking. Use manual path input.');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker();
      setForm(current => ({
        ...current,
        workspacePath: handle.name ? `./${handle.name}` : current.workspacePath,
      }));
      setError(null);
    } catch (err) {
      if (toErrorMessage(err).includes('aborted')) return;
      setError(toErrorMessage(err));
    }
  };

  const activePhases = runDetail?.run.phases ?? defaultPhases;
  const activeEvents = runDetail?.events ?? [];
  const activeArtifacts = runDetail?.artifacts ?? [];

  useEffect(() => {
    if (!selectedRunId || !runDetail || !['queued', 'running', 'requires_action'].includes(runDetail.run.status))
      return;
    const timer = window.setInterval(() => {
      void fetchRunDetail(selectedRunId)
        .then(setRunDetail)
        .catch(err => setError(toErrorMessage(err)));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [runDetail, selectedRunId]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">AW</div>
          <div>
            <h1>Agent Workflow</h1>
            <p>Visual game creation control room</p>
          </div>
        </div>

        <section className="sidebar-section">
          <div className="section-title">Projects</div>
          <div className="project-list">
            {projects.length === 0 ? (
              <div className="empty">No projects yet</div>
            ) : (
              projects.map(project => (
                <button
                  key={project.id}
                  className={`project-item ${project.id === selectedProjectId ? 'active' : ''}`}
                  onClick={() => void handleSelectProject(project)}
                >
                  <span>{project.name}</span>
                  <small>{project.status}</small>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="sidebar-section">
          <div className="section-title">Runs</div>
          <div className="project-list">
            {runs.length === 0 ? (
              <div className="empty">No runs for this project</div>
            ) : (
              runs.map(run => (
                <button
                  key={run.id}
                  className={`project-item ${run.id === selectedRunId ? 'active' : ''}`}
                  onClick={() => void handleSelectRun(run)}
                >
                  <span>{run.currentPhase}</span>
                  <small>{run.status}</small>
                </button>
              ))
            )}
          </div>
        </section>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">Dashboard</div>
            <h2>{selectedProject?.name ?? 'Create a workflow run'}</h2>
            <p>{selectedRun ? `${selectedRun.status} · ${selectedRun.currentPhase}` : 'No run selected'}</p>
          </div>
          <button className="secondary-button" onClick={() => void loadDashboard()}>
            Refresh
          </button>
        </header>

        {error && <div className="error-banner">{error}</div>}

        <section className="composer">
          <div>
            <label>
              Project name
              <input
                value={form.name}
                onChange={event => setForm({ ...form, name: event.target.value })}
                placeholder="Prototype name"
              />
            </label>
            <label>
              Target runtime
              <input
                value={form.targetRuntime}
                onChange={event => setForm({ ...form, targetRuntime: event.target.value })}
                placeholder="custom-runtime"
              />
            </label>
          </div>
          <label className="idea-field">
            Idea
            <textarea
              value={form.idea}
              onChange={event => setForm({ ...form, idea: event.target.value })}
              placeholder="Describe the game idea, desired feel, constraints, and target player experience."
            />
          </label>
          <div className="workspace-row">
            <label>
              Workspace
              <input
                value={form.workspacePath}
                onChange={event => setForm({ ...form, workspacePath: event.target.value })}
                placeholder="Choose a folder or enter a path"
              />
            </label>
            <button className="secondary-button" type="button" onClick={() => void handlePickWorkspace()}>
              Choose Folder
            </button>
            <label>
              LLM config
              <select
                value={form.modelConfigId}
                onChange={event => setForm({ ...form, modelConfigId: event.target.value })}
              >
                <option value="">Select model</option>
                {models.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                    {model.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-button" type="button" disabled={creating} onClick={() => void handleCreateRun()}>
              {creating ? 'Starting...' : 'Start Workflow'}
            </button>
          </div>
        </section>

        <section className="workflow-grid">
          <div className="panel wide">
            <PanelTitle title="Workflow" detail={runDetail?.run.status ?? 'not started'} />
            <WorkflowTimeline phases={activePhases} />
          </div>
          <div className="panel">
            <PanelTitle title="Workers" detail={`${workers.length} registered`} />
            <WorkerList workers={workers} />
          </div>
          <div className="panel">
            <PanelTitle title="Artifacts" detail={`${activeArtifacts.length} files`} />
            <ArtifactList artifacts={activeArtifacts} />
          </div>
          <div className="panel wide">
            <PanelTitle title="Event Log" detail={`${activeEvents.length} events`} />
            <EventLog events={activeEvents} />
          </div>
          <div className="panel">
            <PanelTitle title="Models" detail={`${models.length} configs`} />
            <ModelSettings
              models={models}
              form={modelForm}
              saving={savingModel}
              onChange={setModelForm}
              onSave={() => void handleSaveModel()}
              onSetDefault={model => void handleSetDefaultModel(model)}
              onDelete={model => void handleDeleteModel(model)}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

const defaultPhases: RunPhase[] = [
  'Idea Intake',
  'GDD',
  'Technical Design',
  'Implementation Plan',
  'Implementation',
  'Build/Test',
  'Preview',
  'Iteration',
].map((title, index) => ({
  id: `${index}`,
  title,
  status: 'pending',
}));

function PanelTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="panel-title">
      <h3>{title}</h3>
      <span>{detail}</span>
    </div>
  );
}

function WorkflowTimeline({ phases }: { phases: RunPhase[] }) {
  return (
    <div className="timeline">
      {phases.map((phase, index) => (
        <div key={phase.id} className={`phase ${phase.status}`}>
          <div className="phase-index">{index + 1}</div>
          <div>
            <strong>{phase.title}</strong>
            <span>{phase.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkerList({ workers }: { workers: WorkerSummary[] }) {
  return (
    <div className="stack">
      {workers.map(worker => (
        <div key={worker.id} className="list-row">
          <div>
            <strong>{worker.name}</strong>
            <span>{worker.role}</span>
          </div>
          <small>{worker.status}</small>
        </div>
      ))}
    </div>
  );
}

function ArtifactList({ artifacts }: { artifacts: Artifact[] }) {
  if (artifacts.length === 0) return <div className="empty">No artifacts yet</div>;
  return (
    <div className="stack">
      {artifacts.map(artifact => (
        <div key={artifact.id} className="list-row">
          <div>
            <strong>{artifact.title}</strong>
            <span>{artifact.path ?? artifact.url ?? artifact.kind}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function EventLog({ events }: { events: WorkflowEvent[] }) {
  if (events.length === 0) return <div className="empty">Events appear when a run starts</div>;
  return (
    <div className="event-log">
      {events.map(event => (
        <div key={event.id} className="event-row">
          <span>{event.type}</span>
          <strong>{event.phase ?? event.agentName ?? 'workflow'}</strong>
          <p>{event.message}</p>
        </div>
      ))}
    </div>
  );
}

function ModelSettings({
  models,
  form,
  saving,
  onChange,
  onSave,
  onSetDefault,
  onDelete,
}: {
  models: ModelConfig[];
  form: ModelConfigInput;
  saving: boolean;
  onChange: (form: ModelConfigInput) => void;
  onSave: () => void;
  onSetDefault: (model: ModelConfig) => void;
  onDelete: (model: ModelConfig) => void;
}) {
  return (
    <div className="model-settings">
      <div className="model-form">
        <label>
          Name
          <input value={form.name} onChange={event => onChange({ ...form, name: event.target.value })} />
        </label>
        <label>
          Provider
          <select value={form.provider} onChange={event => onChange({ ...form, provider: event.target.value })}>
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="anthropic-compatible">Anthropic-compatible</option>
            <option value="gemini">Gemini</option>
            <option value="grok">Grok</option>
          </select>
        </label>
        <label>
          Base URL
          <input
            value={form.baseUrl ?? ''}
            onChange={event => onChange({ ...form, baseUrl: event.target.value })}
            placeholder="https://api.openai.com/v1"
          />
        </label>
        <label>
          API key
          <input
            type="password"
            value={form.apiKey}
            onChange={event => onChange({ ...form, apiKey: event.target.value })}
            placeholder="Stored server-side, shown masked"
          />
        </label>
        <div className="model-grid">
          <label>
            Fast model
            <input
              value={form.models.fast ?? ''}
              onChange={event =>
                onChange({
                  ...form,
                  models: { ...form.models, fast: event.target.value },
                })
              }
              placeholder="optional"
            />
          </label>
          <label>
            Balanced model
            <input
              value={form.models.balanced ?? ''}
              onChange={event =>
                onChange({
                  ...form,
                  models: { ...form.models, balanced: event.target.value },
                })
              }
              placeholder="required"
            />
          </label>
          <label>
            Strong model
            <input
              value={form.models.strong ?? ''}
              onChange={event =>
                onChange({
                  ...form,
                  models: { ...form.models, strong: event.target.value },
                })
              }
              placeholder="optional"
            />
          </label>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.isDefault === true}
            onChange={event => onChange({ ...form, isDefault: event.target.checked })}
          />
          Default for new runs
        </label>
        <button className="primary-button" type="button" disabled={saving} onClick={onSave}>
          {saving ? 'Saving...' : 'Save Model'}
        </button>
      </div>

      {models.length === 0 ? (
        <div className="empty">Add an LLM config before starting a workflow.</div>
      ) : (
        <div className="stack">
          {models.map(model => (
            <div key={model.id} className="model-row">
              <div>
                <strong>{model.name}</strong>
                <span>
                  {model.provider}
                  {model.baseUrl ? ` · ${model.baseUrl}` : ''}
                </span>
                <small>
                  key {model.apiKeyPreview} · balanced {model.models.balanced ?? 'unset'}
                </small>
              </div>
              <div className="row-actions">
                {!model.isDefault && (
                  <button className="secondary-button" type="button" onClick={() => onSetDefault(model)}>
                    Default
                  </button>
                )}
                <button className="secondary-button danger" type="button" onClick={() => onDelete(model)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed';
}
