import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { Navbar } from './components/Navbar';
import { IdentityPanel } from './components/IdentityPanel';
import { TokenManagerDialog } from './components/TokenManagerDialog';
import { ThemeProvider } from './lib/theme';
import { getUuid, setUuid, apiBind, setActiveApiToken } from './api/client';
import { ACPDirectView } from './components/ACPDirectView';
import { useTokens } from './hooks/useTokens';

const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const SessionDetail = lazy(() => import('./pages/SessionDetail').then(m => ({ default: m.SessionDetail })));
const Models = lazy(() => import('./pages/Models').then(m => ({ default: m.Models })));
const NewGame = lazy(() => import('./pages/NewGame').then(m => ({ default: m.NewGame })));
const RunDetail = lazy(() => import('./pages/RunDetail').then(m => ({ default: m.RunDetail })));

type AppRoute =
  | { kind: 'dashboard' }
  | { kind: 'models' }
  | { kind: 'new-game' }
  | { kind: 'run'; runId: string }
  | { kind: 'session'; sessionId: string };

export default function App() {
  const [route, setRoute] = useState<AppRoute>({ kind: 'dashboard' });
  const [identityOpen, setIdentityOpen] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [acpDirect, setAcpDirect] = useState<{ url: string; token: string } | null>(null);
  const { tokens, activeTokenId, activeLabel, activeTokenValue, setActiveTokenId, addToken, removeToken, updateToken } =
    useTokens();

  // Sync active token to API client
  useEffect(() => {
    setActiveApiToken(activeTokenValue);
  }, [activeTokenValue]);

  const handleSetActiveToken = useCallback(
    (id: string) => {
      setActiveTokenId(id);
    },
    [setActiveTokenId],
  );

  // Simple hash-based router
  const parseRoute = useCallback(() => {
    // Ensure UUID exists
    getUuid();

    const path = window.location.pathname;

    // Check for UUID import from QR scan (?uuid=xxx)
    const params = new URLSearchParams(window.location.search);
    const importUuid = params.get('uuid');
    if (importUuid) {
      setUuid(importUuid);
      const url = new URL(window.location.href);
      url.searchParams.delete('uuid');
      window.history.replaceState(null, '', url);
    }

    // Check for ACP direct connection (?acp=1)
    const acpParam = params.get('acp');
    if (acpParam === '1') {
      const stored = sessionStorage.getItem('acp_connection');
      if (stored) {
        try {
          const acpData = JSON.parse(stored);
          if (acpData.url && acpData.token) {
            setAcpDirect({ url: acpData.url, token: acpData.token });
            sessionStorage.removeItem('acp_connection');
            // Clean URL
            const url = new URL(window.location.href);
            url.searchParams.delete('acp');
            window.history.replaceState(null, '', url);
            return;
          }
        } catch {
          sessionStorage.removeItem('acp_connection');
        }
      }
    }

    // Check for CLI session bind (?sid=xxx) — bind session to current UUID
    const sid = params.get('sid');
    if (sid) {
      const url = new URL(window.location.href);
      url.searchParams.delete('sid');
      window.history.replaceState(null, '', `/code/${sid}`);
      setRoute({ kind: 'session', sessionId: sid });
      // Bind this session to the current user's UUID for ownership
      apiBind(sid).catch((err: unknown) => {
        console.warn('Failed to bind session:', err);
      });
      return;
    }

    if (path === '/code/models') {
      setRoute({ kind: 'models' });
      return;
    }

    if (path === '/code/new-game') {
      setRoute({ kind: 'new-game' });
      return;
    }

    const runMatch = path.match(/^\/code\/runs\/([^/]+)/);
    if (runMatch && runMatch[1]) {
      setRoute({ kind: 'run', runId: runMatch[1] });
      return;
    }

    // Path-based routing: /code/session_xxx → session detail
    const match = path.match(/^\/code\/([^/]+)/);
    if (match && match[1]) {
      setRoute({ kind: 'session', sessionId: match[1] });
    } else {
      setRoute({ kind: 'dashboard' });
    }
  }, []);

  useEffect(() => {
    parseRoute();
    window.addEventListener('popstate', parseRoute);
    return () => window.removeEventListener('popstate', parseRoute);
  }, [parseRoute]);

  const navigateToSession = useCallback((sessionId: string) => {
    window.history.pushState(null, '', `/code/${sessionId}`);
    setRoute({ kind: 'session', sessionId });
  }, []);

  const navigateToDashboard = useCallback(() => {
    window.history.pushState(null, '', '/code/');
    setRoute({ kind: 'dashboard' });
    setAcpDirect(null);
  }, []);

  const navigateToModels = useCallback(() => {
    window.history.pushState(null, '', '/code/models');
    setRoute({ kind: 'models' });
    setAcpDirect(null);
  }, []);

  const navigateToNewGame = useCallback(() => {
    window.history.pushState(null, '', '/code/new-game');
    setRoute({ kind: 'new-game' });
    setAcpDirect(null);
  }, []);

  const navigateToRun = useCallback((runId: string) => {
    window.history.pushState(null, '', `/code/runs/${runId}`);
    setRoute({ kind: 'run', runId });
    setAcpDirect(null);
  }, []);

  const sessionTitle =
    route.kind === 'session'
      ? route.sessionId
      : route.kind === 'models'
        ? 'Models'
        : route.kind === 'new-game'
          ? 'New Game'
          : route.kind === 'run'
            ? route.runId
            : acpDirect
              ? 'ACP'
              : undefined;

  return (
    <ThemeProvider defaultTheme="system">
      <div className="flex h-screen flex-col bg-surface-0 text-text-primary">
        <Navbar
          onIdentityClick={() => setIdentityOpen(true)}
          onTokenClick={() => setTokenDialogOpen(true)}
          activeTokenLabel={route.kind === 'dashboard' ? activeLabel : undefined}
          sessionTitle={sessionTitle}
          onBack={route.kind !== 'dashboard' || acpDirect ? navigateToDashboard : undefined}
        />

        <Suspense fallback={<div className="flex flex-1 items-center justify-center text-text-muted">Loading...</div>}>
          {acpDirect ? (
            <ACPDirectView url={acpDirect.url} token={acpDirect.token} onBack={navigateToDashboard} />
          ) : route.kind === 'session' ? (
            <SessionDetail key={route.sessionId} sessionId={route.sessionId} />
          ) : route.kind === 'models' ? (
            <div className="flex-1 overflow-y-auto">
              <Models />
            </div>
          ) : route.kind === 'new-game' ? (
            <div className="flex-1 overflow-y-auto">
              <NewGame onRunCreated={navigateToRun} onNavigateModels={navigateToModels} />
            </div>
          ) : route.kind === 'run' ? (
            <div className="flex-1 overflow-y-auto">
              <RunDetail key={route.runId} runId={route.runId} />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <Dashboard
                onNavigateSession={navigateToSession}
                onNavigateModels={navigateToModels}
                onNavigateNewGame={navigateToNewGame}
              />
            </div>
          )}
        </Suspense>

        <IdentityPanel open={identityOpen} onClose={() => setIdentityOpen(false)} />

        <TokenManagerDialog
          open={tokenDialogOpen}
          onClose={() => setTokenDialogOpen(false)}
          tokens={tokens}
          activeTokenId={activeTokenId}
          onSetActive={handleSetActiveToken}
          onAdd={addToken}
          onRemove={removeToken}
          onUpdate={updateToken}
        />
      </div>
    </ThemeProvider>
  );
}
