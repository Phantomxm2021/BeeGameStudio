import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
  createModelConfig,
  deleteModelConfig,
  fetchConsoleEvents,
  fetchConsoleSession,
  fetchConsoleSessions,
  fetchDirectories,
  fetchModels,
  sendConsoleInput,
  startConsoleSession,
  stopConsoleSession,
  updateModelConfig,
  type ConsoleEvent,
  type ConsoleSession,
  type DirectoryListing,
  type ModelConfig,
  type ModelConfigInput,
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
  const [sessions, setSessions] = useState<ConsoleSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<ConsoleEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [directoryListing, setDirectoryListing] = useState<DirectoryListing | null>(null);
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [loadingDirectories, setLoadingDirectories] = useState(false);
  const [sessionForm, setSessionForm] = useState({
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

  const selectedSession = useMemo(
    () => sessions.find(session => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const loadDashboard = useCallback(async () => {
    setError(null);
    try {
      const [nextModels, nextSessions] = await Promise.all([fetchModels(), fetchConsoleSessions()]);
      setModels(nextModels);
      setSessions(nextSessions);
      setSelectedSessionId(current => current ?? nextSessions[0]?.id ?? null);
      setSessionForm(current => ({
        ...current,
        modelConfigId:
          current.modelConfigId || nextModels.find(model => model.isDefault)?.id || nextModels[0]?.id || '',
      }));
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!selectedSessionId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    const loadInitial = async () => {
      try {
        const nextEvents = await fetchConsoleEvents(selectedSessionId);
        if (!cancelled) setEvents(nextEvents);
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err));
      }
    };
    void loadInitial();
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const timer = window.setInterval(() => {
      const after = events.at(-1)?.id ?? 0;
      void fetchConsoleEvents(selectedSessionId, after)
        .then(nextEvents => {
          if (nextEvents.length > 0) {
            setEvents(current => [...current, ...nextEvents]);
          }
        })
        .catch(err => setError(toErrorMessage(err)));
      void fetchConsoleSession(selectedSessionId)
        .then(nextSession => {
          setSessions(current => current.map(session => (session.id === nextSession.id ? nextSession : session)));
        })
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(timer);
  }, [events, selectedSessionId]);

  const handleStartSession = async () => {
    if (!sessionForm.workspacePath.trim()) {
      setError('Workspace path is required.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const session = await startConsoleSession({
        workspacePath: sessionForm.workspacePath.trim(),
        ...(sessionForm.modelConfigId ? { modelConfigId: sessionForm.modelConfigId } : {}),
      });
      setSessions(await fetchConsoleSessions());
      setSelectedSessionId(session.id);
      setEvents(await fetchConsoleEvents(session.id));
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!selectedSessionId) return;
    setError(null);
    try {
      const stopped = await stopConsoleSession(selectedSessionId);
      setSessions(current => current.map(session => (session.id === stopped.id ? stopped : session)));
      setEvents(await fetchConsoleEvents(selectedSessionId));
    } catch (err) {
      setError(toErrorMessage(err));
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
      setSessionForm(current => ({ ...current, modelConfigId: saved.id }));
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
      setSessionForm(current => ({ ...current, modelConfigId: model.id }));
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
      setSessionForm(current => ({
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

  const handlePickWorkspace = async () => {
    setDirectoryPickerOpen(true);
    setLoadingDirectories(true);
    setError(null);
    try {
      setDirectoryListing(await fetchDirectories(sessionForm.workspacePath || undefined));
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoadingDirectories(false);
    }
  };

  const handleOpenDirectory = async (path: string) => {
    setLoadingDirectories(true);
    setError(null);
    try {
      setDirectoryListing(await fetchDirectories(path));
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoadingDirectories(false);
    }
  };

  const handleSelectDirectory = (path: string) => {
    setSessionForm(current => ({ ...current, workspacePath: path }));
    setDirectoryPickerOpen(false);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">CC</div>
          <div>
            <h1>Claude Code</h1>
            <p>Web console</p>
          </div>
        </div>

        <section className="sidebar-section">
          <div className="section-title">Sessions</div>
          <div className="project-list">
            {sessions.length === 0 ? (
              <div className="empty">No sessions yet</div>
            ) : (
              sessions.map(session => (
                <button
                  key={session.id}
                  className={`project-item ${session.id === selectedSessionId ? 'active' : ''}`}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <span>{session.cwd}</span>
                  <small>{session.status}</small>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="sidebar-section">
          <div className="section-title">New Session</div>
          <div className="session-form">
            <label>
              Workspace
              <input
                value={sessionForm.workspacePath}
                onChange={event =>
                  setSessionForm({
                    ...sessionForm,
                    workspacePath: event.target.value,
                  })
                }
                placeholder="/path/to/project"
              />
            </label>
            <button className="secondary-button" type="button" onClick={() => void handlePickWorkspace()}>
              Choose Folder
            </button>
            {directoryPickerOpen && (
              <DirectoryPicker
                listing={directoryListing}
                loading={loadingDirectories}
                onOpen={path => void handleOpenDirectory(path)}
                onSelect={handleSelectDirectory}
                onClose={() => setDirectoryPickerOpen(false)}
              />
            )}
            <label>
              Model config
              <select
                value={sessionForm.modelConfigId}
                onChange={event =>
                  setSessionForm({
                    ...sessionForm,
                    modelConfigId: event.target.value,
                  })
                }
              >
                <option value="">Use current environment</option>
                {models.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                    {model.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={starting}
              onClick={() => void handleStartSession()}
            >
              {starting ? 'Starting...' : 'Start Session'}
            </button>
          </div>
        </section>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">Console</div>
            <h2>{selectedSession?.cwd ?? 'Start a Claude Code session'}</h2>
            <p>
              {selectedSession
                ? `${selectedSession.status} · ${selectedSession.id}`
                : 'Web input writes to the Claude Code process.'}
            </p>
          </div>
          <div className="row-actions">
            <button className="secondary-button" type="button" onClick={() => void loadDashboard()}>
              Refresh
            </button>
            <button
              className="secondary-button danger"
              type="button"
              disabled={!selectedSession || selectedSession.status !== 'running'}
              onClick={() => void handleStop()}
            >
              Stop
            </button>
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}

        <section className="console-layout">
          <div className="panel console-panel">
            <PanelTitle title="Terminal" detail={`${events.length} console events`} />
            <TerminalView
              events={events}
              session={selectedSession}
              onInput={async text => {
                if (!selectedSessionId) return;
                await sendConsoleInput(selectedSessionId, text);
              }}
              onError={message => setError(message)}
            />
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

function PanelTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="panel-title">
      <h3>{title}</h3>
      <span>{detail}</span>
    </div>
  );
}

function TerminalView({
  events,
  session,
  onInput,
  onError,
}: {
  events: ConsoleEvent[];
  session: ConsoleSession | null;
  onInput: (text: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const lastEventIdRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const inputRef = useRef(onInput);
  const errorRef = useRef(onError);

  useEffect(() => {
    inputRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    errorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!containerRef.current) return;
    const terminal = new Terminal({
      cols: 120,
      rows: 34,
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: '#141312',
        foreground: '#f3eee7',
        cursor: '#d77757',
        selectionBackground: '#3a312c',
      },
    });
    terminal.open(containerRef.current);
    terminalRef.current = terminal;

    const dataDisposable = terminal.onData(data => {
      if (sessionIdRef.current) {
        void inputRef.current(data).catch(err => errorRef.current(toErrorMessage(err)));
      }
    });

    return () => {
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    if (session?.id !== sessionIdRef.current) {
      sessionIdRef.current = session?.id ?? null;
      lastEventIdRef.current = 0;
      terminal.clear();
    }

    for (const event of events) {
      if (event.id <= lastEventIdRef.current) continue;
      if (event.type === 'stdout' || event.type === 'stderr') {
        terminal.write(event.text);
      } else if (
        event.type === 'session.failed' ||
        event.type === 'session.stopped' ||
        event.type === 'session.exited'
      ) {
        terminal.writeln(`\r\n[${event.type}] ${event.text}`);
      }
      lastEventIdRef.current = event.id;
    }
  }, [events, session?.id]);

  return (
    <div className="terminal-shell">
      <div ref={containerRef} className="terminal-host" />
      {!session && <div className="terminal-empty">Start a session to open Claude Code</div>}
    </div>
  );
}

function DirectoryPicker({
  listing,
  loading,
  onOpen,
  onSelect,
  onClose,
}: {
  listing: DirectoryListing | null;
  loading: boolean;
  onOpen: (path: string) => void;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="directory-picker">
      <div className="directory-picker-header">
        <div>
          <strong>Workspace Folder</strong>
          <span>{listing?.path ?? 'Loading directories...'}</span>
        </div>
        <button className="secondary-button" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="directory-actions">
        {listing && (
          <>
            <button className="secondary-button" type="button" onClick={() => onOpen(listing.homePath)}>
              Home
            </button>
            <button className="secondary-button" type="button" onClick={() => onOpen(listing.parentPath)}>
              Up
            </button>
            <button className="primary-button" type="button" onClick={() => onSelect(listing.path)}>
              Select Current
            </button>
          </>
        )}
      </div>
      {loading ? (
        <div className="empty">Loading directories...</div>
      ) : listing && listing.entries.length > 0 ? (
        <div className="directory-list">
          {listing.entries.map(entry => (
            <button key={entry.path} className="directory-row" type="button" onClick={() => onOpen(entry.path)}>
              <span>{entry.name}</span>
              <small>{entry.path}</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">No child folders</div>
      )}
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
          Default for new sessions
        </label>
        <button className="primary-button" type="button" disabled={saving} onClick={onSave}>
          {saving ? 'Saving...' : 'Save Model'}
        </button>
      </div>

      {models.length === 0 ? (
        <div className="empty">Add an LLM config or use current environment.</div>
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
