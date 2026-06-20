import { useState, useEffect, useCallback } from 'react';
import { apiFetchAllSessions, apiFetchEnvironments } from '../api/client';
import type { Session, Environment } from '../types';
import { EnvironmentList } from '../components/EnvironmentList';
import { SessionList } from '../components/SessionList';
import { NewSessionDialog } from '../components/NewSessionDialog';

interface DashboardProps {
  onNavigateSession: (sessionId: string) => void;
  onNavigateModels: () => void;
}

export function Dashboard({ onNavigateSession, onNavigateModels }: DashboardProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      const [sess, envs] = await Promise.all([apiFetchAllSessions(), apiFetchEnvironments()]);
      setSessions(sess || []);
      setEnvironments(envs || []);
    } catch (err) {
      console.error('Dashboard render error:', err);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 10000);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  const handleSessionCreated = (session: Session) => {
    setDialogOpen(false);
    onNavigateSession(session.id);
  };

  const handleSelectEnvironment = useCallback((_env: Environment) => {
    // ACP agents require WebSocket connection and cannot be navigated to directly
    // Bridge environments: no direct navigation (sessions are listed below)
  }, []);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      onNavigateSession(sessionId);
    },
    [onNavigateSession],
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="sr-only">Dashboard</h1>
      {/* Environments */}
      <section className="mb-10">
        <h2 className="mb-4 font-display text-lg font-semibold text-text-primary">Environments</h2>
        <EnvironmentList environments={environments} onSelectEnvironment={handleSelectEnvironment} />
      </section>

      {/* Sessions */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-text-primary">Sessions</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onNavigateModels}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
            >
              Models
            </button>
            <button
              onClick={() => setDialogOpen(true)}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-light"
            >
              + New Session
            </button>
          </div>
        </div>
        <SessionList sessions={sessions} onSelect={handleSelectSession} />
      </section>

      <NewSessionDialog
        open={dialogOpen}
        environments={environments}
        onClose={() => setDialogOpen(false)}
        onCreated={handleSessionCreated}
      />
    </div>
  );
}
