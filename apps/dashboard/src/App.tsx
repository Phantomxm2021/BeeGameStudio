import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createModelConfig,
  createProject,
  createRun,
  fetchModels,
  fetchProjects,
  fetchRunDetail,
  fetchWorkers,
  type Artifact,
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
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    idea: '',
    targetRuntime: 'custom-runtime',
    workspacePath: '',
  });

  const selectedProject = useMemo(
    () => projects.find(project => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

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
      setSelectedProjectId(current => current ?? nextProjects[0]?.id ?? null);
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleCreateRun = async () => {
    if (!form.name.trim() || !form.idea.trim() || !form.workspacePath.trim()) {
      setError('Project name, idea, and workspace are required.');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const model = models[0] ?? (await createModelConfig());
      const project = await createProject({
        name: form.name.trim(),
        idea: form.idea.trim(),
        targetRuntime: form.targetRuntime.trim() || 'custom-runtime',
        workspacePath: form.workspacePath.trim(),
      });
      const run = await createRun(project.id, model.id);
      const detail = await fetchRunDetail(run.id);
      setModels(await fetchModels());
      setProjects(await fetchProjects());
      setSelectedProjectId(project.id);
      setRunDetail(detail);
      setForm({ name: '', idea: '', targetRuntime: 'custom-runtime', workspacePath: '' });
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const handleSelectProject = async (project: Project) => {
    setSelectedProjectId(project.id);
    setRunDetail(null);
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
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">Dashboard</div>
            <h2>{selectedProject?.name ?? 'Create a workflow run'}</h2>
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
            <ModelList models={models} />
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

function ModelList({ models }: { models: ModelConfig[] }) {
  if (models.length === 0) {
    return <div className="empty">A placeholder local model config is created when the first run starts</div>;
  }
  return (
    <div className="stack">
      {models.map(model => (
        <div key={model.id} className="list-row">
          <div>
            <strong>{model.name}</strong>
            <span>{model.provider}</span>
          </div>
          <small>{model.isDefault ? 'default' : model.apiKeyPreview}</small>
        </div>
      ))}
    </div>
  );
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed';
}
