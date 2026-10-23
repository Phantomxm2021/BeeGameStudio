/**
 * App Component
 *
 * Root component for the BeeGame frontend.
 */

import { lazy, Suspense, useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import ErrorBoundary from './components/Common/ErrorBoundary';
import { WorkspaceLoadingPage } from './components/Common/WorkspaceLoadingPage';
import { useProjectStore } from './store/projectStore';
import { applyThemeToDocument, useSystemStore } from './store/systemStore';
import { useToastContext } from './contexts/ToastContext';
import { setToastErrorCallback } from './services/api';
import {
  AUTHENTICATION_REQUIRED_EVENT,
  hasEnvAuthToken,
  isAuthenticationServiceUnavailable,
} from './services/apiClient';
import { authRetryDelay } from './services/authRetry';
import type { StartProjectResult } from './types/project';
import type { BeeGameBuildBrief } from './services/beeGameAdapter';
import {
  initializeSupabaseSession,
  isHttpOnlySessionsEnabled,
} from './services/supabaseAuthApi';

// New Demiurge Views
import { LandingView } from './components/Demiurge/LandingView';
import type { Language } from './components/Demiurge/AgentsConfig';
import i18n, { getInitialUiLanguage } from './i18n';
import { isResourceLibraryRoute } from './components/ResourceLibrary/resourceLibraryRoute';
import { getProjectRouteId, WORKSPACE_ROUTE_CHANGE_EVENT } from './navigation/workspaceRoute';

const loadDashboardView = () => import('./components/Demiurge/DashboardView');

const DashboardView = lazy(async () => {
  const module = await loadDashboardView();
  return { default: module.DashboardView };
});

function App() {
  const {
    loadProjects,
    projects,
    activeProjectId,
    hasLoadedProjects,
    bootstrapProjectFromBrief,
    setToastCallbacks,
    clearActiveProject,
    syncActiveProjectFromRoute,
  } = useProjectStore(useShallow((state) => ({
    loadProjects: state.loadProjects,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    hasLoadedProjects: state.hasLoadedProjects,
    bootstrapProjectFromBrief: state.bootstrapProjectFromBrief,
    setToastCallbacks: state.setToastCallbacks,
    clearActiveProject: state.clearActiveProject,
    syncActiveProjectFromRoute: state.syncActiveProjectFromRoute,
  })));
  const {
    loadCurrentUser,
    authenticationStatus,
    setAuthenticationStatus,
    currentUser,
    isDark,
  } = useSystemStore(useShallow((state) => ({
    loadCurrentUser: state.loadCurrentUser,
    authenticationStatus: state.authenticationStatus,
    setAuthenticationStatus: state.setAuthenticationStatus,
    currentUser: state.currentUser,
    isDark: state.isDark,
  })));
  const { showError, showSuccess } = useToastContext();

  const [lang, setLang] = useState<Language>(getInitialUiLanguage);
  const handleSetLang = (language: Language) => {
    setLang(language);
    void i18n.changeLanguage(language);
  };
  const [isResourceRoute, setIsResourceRoute] = useState(() => isResourceLibraryRoute());
  const [authenticationRetryVersion, setAuthenticationRetryVersion] = useState(0);
  const [authenticationInitializationError, setAuthenticationInitializationError] = useState('');
  const authenticationInitializationStartedRef = useRef<typeof loadCurrentUser | null>(null);
  const authenticationRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedProtectedDataUserRef = useRef<{ userId: string; loadProjects: typeof loadProjects } | null>(null);
  const activeProject = projects.find(p => p.id === activeProjectId);
  const requestedProjectId = getProjectRouteId();
  const isProjectRouteRestoring = Boolean(
    authenticationStatus === 'authenticated' && requestedProjectId && !hasLoadedProjects,
  );
  const isDashboardVisible = Boolean(
    authenticationStatus === 'authenticated' && activeProjectId && activeProject && !isResourceRoute,
  );

  useEffect(() => {
    const syncResourceRoute = () => setIsResourceRoute(isResourceLibraryRoute());
    const syncPopState = () => {
      syncResourceRoute();
      syncActiveProjectFromRoute();
    };
    window.addEventListener('popstate', syncPopState);
    window.addEventListener(WORKSPACE_ROUTE_CHANGE_EVENT, syncResourceRoute);
    return () => {
      window.removeEventListener('popstate', syncPopState);
      window.removeEventListener(WORKSPACE_ROUTE_CHANGE_EVENT, syncResourceRoute);
    };
  }, [syncActiveProjectFromRoute]);

  useEffect(() => {
    if (authenticationStatus === 'anonymous' || (!requestedProjectId && !activeProjectId)) return;
    void loadDashboardView().catch(() => undefined);
  }, [activeProjectId, authenticationStatus, requestedProjectId]);

  // Keep the persisted theme across Idea Home, the project workspace, and the resource library.
  useLayoutEffect(() => {
    applyThemeToDocument(isDark);
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

  useEffect(() => {
    const handleOAuthError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: unknown }>).detail;
      showError(typeof detail?.message === 'string' ? detail.message : '登录失败，请重试');
    };
    window.addEventListener('beegame-oauth-error', handleOAuthError);
    return () => window.removeEventListener('beegame-oauth-error', handleOAuthError);
  }, [showError]);

  // Initialize app data on mount
  useEffect(() => {
    if (authenticationInitializationStartedRef.current === loadCurrentUser) return;
    authenticationInitializationStartedRef.current = loadCurrentUser;
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
          if (authenticationInitializationStartedRef.current === loadCurrentUser) {
            authenticationInitializationStartedRef.current = null;
          }
          if (authenticationRetryTimerRef.current) {
            clearTimeout(authenticationRetryTimerRef.current);
          }
          authenticationRetryTimerRef.current = setTimeout(() => {
            authenticationRetryTimerRef.current = null;
            setAuthenticationRetryVersion(version => version + 1);
          }, authRetryDelay(authenticationRetryVersion + 1, error));
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
    if (loadedProtectedDataUserRef.current?.userId === currentUser.id &&
        loadedProtectedDataUserRef.current.loadProjects === loadProjects) return;
    const load = { userId: currentUser.id, loadProjects };
    loadedProtectedDataUserRef.current = load;
    loadProjects().catch((error) => {
      if (loadedProtectedDataUserRef.current === load) loadedProtectedDataUserRef.current = null;
      console.error('Failed to load authenticated app data:', error);
      showError(error instanceof Error ? error.message : '登录数据加载失败');
    });
  }, [authenticationStatus, currentUser?.id, loadProjects, showError]);

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
    if (requestedProjectId && !isResourceRoute && !authenticationInitializationError) {
      return <WorkspaceLoadingPage />;
    }
    return (
      <WorkspaceLoadingPage
        title={authenticationInitializationError || '正在恢复登录状态…'}
        description=""
        ariaLabel="Initializing BeeGame"
      />
    );
  }

  if (isProjectRouteRestoring) {
    return <WorkspaceLoadingPage />;
  }

  return (
    <ErrorBoundary>
      {/* If we have an active project ID and valid project, render the Dashboard */}
      {isDashboardVisible ? (
        <Suspense fallback={<WorkspaceLoadingPage />}>
          <DashboardView
            projectId={activeProjectId!}
            projectName={activeProject?.name || 'Untitled Project'}
            lang={lang}
            onSetLang={handleSetLang}
            onBack={clearActiveProject}
          />
        </Suspense>
      ) : (
        /* Otherwise, render the Landing View */
        <LandingView
          lang={lang}
          onSetLang={handleSetLang}
          onStart={handleStartProject}
        />
      )}
    </ErrorBoundary>
  );
}

export default App;
