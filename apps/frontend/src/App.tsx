/**
 * App Component
 * 
 * Root component of the XRMOD Demiurge Web Frontend.
 * Re-architected to feature the Landing/Dashboard state progression.
 */

import { useState, useEffect, useRef } from 'react';
import ErrorBoundary from './components/Common/ErrorBoundary';
import { useProjectStore } from './store/projectStore';
import { useSystemStore } from './store/systemStore';
import { useChatStore } from './store/chatStore';
import { useToastContext } from './contexts/ToastContext';
import { setToastErrorCallback, api } from './services/api';
import { normalizeChatHistory } from './utils/chatHistory';
import { buildBootstrapPayload } from './utils/bootstrapIdea';
import type { StartProjectResult } from './types/project';
import type { BeeGameBuildBrief } from './services/beeGameAdapter';

// New Demiurge Views
import { LandingView } from './components/Demiurge/LandingView';
import { DashboardView } from './components/Demiurge/DashboardView';
import { OperatorControlsPage } from './components/Demiurge/OperatorControlsPage';
import type { Language } from './components/Demiurge/AgentsConfig';

function App() {
  const { loadProjects, projects, activeProjectId, bootstrapProject, bootstrapProjectFromBrief, setToastCallbacks } = useProjectStore();
  const { loadStatus, loadAgents, loadActivities, isDark, toggleTheme } = useSystemStore();
  const { loadHistory } = useChatStore();
  const { showError, showSuccess } = useToastContext();

  const [lang, setLang] = useState<Language>('zh');
  const loadedHistoryProjectRef = useRef<string | null>(null);
  const activeProject = projects.find(p => p.id === activeProjectId);
  const isOperatorControlsPage = window.location.pathname === '/operator-controls';
  const operatorControlsParams = new URLSearchParams(window.location.search);

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

  // Initialize app data on mount
  useEffect(() => {
    const initializeApp = async () => {
      try {
        await Promise.all([
          loadProjects(),
          loadStatus(),
          loadAgents(),
          loadActivities(),
        ]);
      } catch (error) {
        console.error('Failed to initialize app:', error);
      }
    };
    initializeApp();
  }, [loadProjects, loadStatus, loadAgents, loadActivities]);

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
    projectName: string,
    clarification?: Record<string, string>,
    brief?: BeeGameBuildBrief,
  ): Promise<StartProjectResult> => {
    try {
      if (brief) {
        return await bootstrapProjectFromBrief(brief);
      }
      // Use the atomic bootstrap action from projectStore
      return await bootstrapProject(buildBootstrapPayload(projectName, clarification, lang));
    } catch (error) {
      console.error('Failed to start project:', error);
      showError(error instanceof Error ? error.message : '项目启动失败，请检查后端服务');
      throw error;
    }
  };

  if (isOperatorControlsPage) {
    const operatorControlsLang = (operatorControlsParams.get('lang') || lang) as Language;
    return (
      <ErrorBoundary>
        <OperatorControlsPage
          projectId={operatorControlsParams.get('project_id') || activeProjectId || ''}
          projectName={operatorControlsParams.get('project_name') || activeProject?.name || 'Project'}
          lang={operatorControlsLang}
          onBackToWorkspace={() => window.close()}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      {/* If we have an active project ID and valid project, render the Dashboard */}
      {activeProjectId && activeProject ? (
        <DashboardView
          projectId={activeProjectId}
          projectName={activeProject.name || 'Untitled Project'}
          lang={lang}
          onSetLang={setLang}
          initialPrompt=""
        />
      ) : (
        /* Otherwise, render the Landing View */
        <LandingView
          lang={lang}
          onSetLang={setLang}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onStart={handleStartProject}
        />
      )}
    </ErrorBoundary>
  );
}

export default App;
