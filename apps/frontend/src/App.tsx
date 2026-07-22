/**
 * App Component
 *
 * Root component for the BeeGame frontend.
 */

import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import ErrorBoundary from './components/Common/ErrorBoundary';
import { useProjectStore } from './store/projectStore';
import { useSystemStore } from './store/systemStore';
import { useChatStore } from './store/chatStore';
import { useToastContext } from './contexts/ToastContext';
import { setToastErrorCallback, api } from './services/api';
import {
  AUTHENTICATION_REQUIRED_EVENT,
  hasEnvAuthToken,
  isAuthenticationServiceUnavailable,
} from './services/apiClient';
import { normalizeChatHistory } from './utils/chatHistory';
import type { StartProjectResult } from './types/project';
import type { BeeGameBuildBrief } from './services/beeGameAdapter';
import {
  initializeSupabaseSession,
  isHttpOnlySessionsEnabled,
} from './services/supabaseAuthApi';

// New Demiurge Views
import { LandingView } from './components/Demiurge/LandingView';
import type { Language } from './components/Demiurge/AgentsConfig';
import { isResourceLibraryRoute } from './components/ResourceLibrary/resourceLibraryRoute';

const DashboardView = lazy(async () => {
  const module = await import('./components/Demiurge/DashboardView');
  return { default: module.DashboardView };
});

function App() {
  const {
    loadProjects,
    projects,
    activeProjectId,
    bootstrapProjectFromBrief,
    setToastCallbacks,
    clearActiveProject,
  } = useProjectStore();
  const {
    loadCurrentUser,
    authenticationStatus,
    setAuthenticationStatus,
    currentUser,
    isDark,
  } = useSystemStore();
  const { loadHistory } = useChatStore();
  const { showError, showSuccess } = useToastContext();

  const [lang, setLang] = useState<Language>('zh');
  const [isResourceRoute, setIsResourceRoute] = useState(() => isResourceLibraryRoute());
  const [authenticationRetryVersion, setAuthenticationRetryVersion] = useState(0);
  const [authenticationInitializationError, setAuthenticationInitializationError] = useState('');
  const loadedHistoryProjectRef = useRef<string | null>(null);
  const authenticationInitializationStartedRef = useRef(false);
  const authenticationRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedProtectedDataUserRef = useRef<string | null>(null);
  const activeProject = projects.find(p => p.id === activeProjectId);

  useEffect(() => {
    const syncResourceRoute = () => setIsResourceRoute(isResourceLibraryRoute());
    window.addEventListener('popstate', syncResourceRoute);
    return () => window.removeEventListener('popstate', syncResourceRoute);
  }, []);

  // Sync dark mode class to root element
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // Initialize toast callbacks
  useEffect(() => {
    setToastErrorCallback(showError);
    setToastCallbacks(showError, showSuccess);
  }, [showError, showSuccess, setToastCallbacks]);

  useEffect(() => {
    const handleAuthenticationRequired = () => setAuthenticationStatus('anonymous');
    window.addEventListener(AUTHENTICATION_REQUIRED_EVENT, handleAuthenticationRequired);
    return () => window.removeEventListener(AUTHENTICATION_REQUIRED_EVENT, handleAuthenticationRequired);
  }, [setAuthenticationStatus]);

  // Initialize app data on mount
  useEffect(() => {
    if (authenticationInitializationStartedRef.current) return;
    authenticationInitializationStartedRef.current = true;
    const initializeApp = async () => {
      try {
        setAuthenticationInitializationError('');
        setAuthenticationStatus('initializing');
        const session = await initializeSupabaseSession();
        if (!session && (isHttpOnlySessionsEnabled() || !hasEnvAuthToken())) {
          setAuthenticationStatus('anonymous');
          return;
        }
        await loadCurrentUser();
      } catch (error) {
        if (isAuthenticationServiceUnavailable(error)) {
          setAuthenticationInitializationError('认证服务暂时不可用，正在重新连接…');
          authenticationInitializationStartedRef.current = false;
          if (authenticationRetryTimerRef.current) {
            clearTimeout(authenticationRetryTimerRef.current);
          }
          authenticationRetryTimerRef.current = setTimeout(() => {
            authenticationRetryTimerRef.current = null;
            setAuthenticationRetryVersion(version => version + 1);
          }, 2_000);
          return;
        }
        setAuthenticationStatus('anonymous');
        console.error('Failed to initialize app:', error);
        showError(error instanceof Error ? error.message : '登录状态初始化失败');
      }
    };
    initializeApp();
  }, [authenticationRetryVersion, loadCurrentUser, setAuthenticationStatus, showError]);

  useEffect(() => () => {
    if (authenticationRetryTimerRef.current) {
      clearTimeout(authenticationRetryTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (authenticationStatus !== 'authenticated' || !currentUser?.id) {
      if (authenticationStatus === 'anonymous') loadedProtectedDataUserRef.current = null;
      return;
    }
    if (loadedProtectedDataUserRef.current === currentUser.id) return;
    loadedProtectedDataUserRef.current = currentUser.id;
    loadProjects().catch((error) => {
      loadedProtectedDataUserRef.current = null;
      console.error('Failed to load authenticated app data:', error);
      showError(error instanceof Error ? error.message : '登录数据加载失败');
    });
  }, [authenticationStatus, currentUser?.id, loadProjects, showError]);

  // Load chat history when active project changes
  useEffect(() => {
    const loadChatHistory = async () => {
      if (!activeProjectId || !activeProject) {
        loadedHistoryProjectRef.current = null;
        return;
      }
      if (loadedHistoryProjectRef.current === activeProjectId) return;

      try {
        const history = await api.getChatHistory(activeProjectId) as unknown;
        const normalized = normalizeChatHistory(history);
        const currentMessages = useChatStore.getState().messages;
        const hasStreamingMessages = currentMessages.some((msg) => msg.id?.startsWith('streaming-'));

        // Keep locally injected bootstrap/system hints until backend has real history.
        if (!hasStreamingMessages && (normalized.length > 0 || currentMessages.length === 0)) {
          loadHistory(normalized);
        }
        loadedHistoryProjectRef.current = activeProjectId;
      } catch (error) {
        console.error('[App] Failed to load chat history:', error);
      }
    };

    loadChatHistory();
  }, [activeProjectId, activeProject, loadHistory]); // Read messages from the store at resolve time to avoid history-load races.

  const handleStartProject = async (
    _projectName: string,
    _clarification?: Record<string, string>,
    brief?: BeeGameBuildBrief,
  ): Promise<StartProjectResult> => {
    try {
      if (brief) {
        return await bootstrapProjectFromBrief(brief);
      }
      throw new Error('A confirmed production brief is required before project construction can start.');
    } catch (error) {
      console.error('Failed to start project:', error);
      showError(error instanceof Error ? error.message : '项目启动失败，请检查后端服务');
      throw error;
    }
  };

  if (authenticationStatus === 'initializing') {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-black px-6 text-center text-white"
        role="status"
        aria-label="Initializing BeeGame"
      >
        <div className="flex max-w-sm flex-col items-center gap-4">
          <span className="size-7 animate-spin rounded-full border-2 border-white/20 border-t-white/80" aria-hidden="true" />
          <p className="text-sm font-medium tracking-[-0.01em] text-white/80">
            {authenticationInitializationError || '正在恢复登录状态…'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {/* If we have an active project ID and valid project, render the Dashboard */}
      {authenticationStatus === 'authenticated' && activeProjectId && activeProject && !isResourceRoute ? (
        <Suspense fallback={<div className="grid min-h-screen place-items-center bg-black"><span className="size-7 animate-spin rounded-full border-2 border-white/20 border-t-white/80" /></div>}>
          <DashboardView
            projectId={activeProjectId}
            projectName={activeProject.name || 'Untitled Project'}
            lang={lang}
            onSetLang={setLang}
            onBack={clearActiveProject}
          />
        </Suspense>
      ) : (
        /* Otherwise, render the Landing View */
        <LandingView
          lang={lang}
          onSetLang={setLang}
          onStart={handleStartProject}
        />
      )}
    </ErrorBoundary>
  );
}

export default App;
