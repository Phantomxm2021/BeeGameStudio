import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Folder, LoaderCircle, PanelLeft, SquarePen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { Language } from '../Demiurge/AgentsConfig';
import { ThemeToggleButton } from '../beui/motion/theme-toggle-button';
import { useDesktopAppearance } from './useDesktopAppearance';
import { useProjectStore } from '../../store/projectStore';
import { useSystemStore } from '../../store/systemStore';
import { getProjectDisplayName } from '../../utils/projectDisplayName';
import { closeResourceLibraryRoute } from '../ResourceLibrary/resourceLibraryRoute';
import { useCommonText } from '../../i18n/useBeeGameTranslations';
import { DesktopLayoutContext, useDesktopLayout } from './desktopLayoutContext';
import { lastDesktopProjectKey, readDesktopPreference, writeDesktopPreference } from './desktopPreferences';
import type { SettingsSection } from '../Demiurge/Landing/SettingsMenu';
import './DesktopLayout.css';

/** Move the existing account controls; their auth, billing and modal state stay with the view. */
export function DesktopAccountSlot({ children }: { children: ReactNode }) {
  const desktop = useDesktopLayout();
  return desktop ? desktop.account && createPortal(children, desktop.account) : children;
}

export function DesktopWorkspaceHeader({ children }: { children: ReactNode }) {
  const desktop = useDesktopLayout();
  return desktop?.header ? createPortal(children, desktop.header) : null;
}

export function DesktopLayout({ children, workspace, lang }: {
  children: ReactNode;
  workspace: boolean;
  lang: Language;
}) {
  const { appearance, setAppearance } = useDesktopAppearance();
  const { t } = useTranslation('landing');
  const common = useCommonText(lang);
  const [header, setHeader] = useState<HTMLDivElement | null>(null);
  const [account, setAccount] = useState<HTMLDivElement | null>(null);
  const [history, setHistory] = useState<HTMLDivElement | null>(null);
  const [settingsPage, setSettingsPage] = useState<HTMLDivElement | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(() => {
    const saved = readDesktopPreference('bgs-desktop-navigation-open');
    if (workspace && !window.matchMedia('(min-width: 1180px)').matches) return false;
    return saved === null ? !workspace : saved === 'true';
  });
  const [previousWorkspace, setPreviousWorkspace] = useState(workspace);
  if (previousWorkspace !== workspace) {
    setPreviousWorkspace(workspace);
    if (workspace && !window.matchMedia('(min-width: 1180px)').matches) setNavigationOpen(false);
  }
  const [openingProject, setOpeningProject] = useState<string | null>(null);
  const opening = useRef(false);
  const { currentUser, isDark } = useSystemStore(useShallow(state => ({
    currentUser: state.currentUser, isDark: state.isDark,
  })));
  const [settingsUser, setSettingsUser] = useState(currentUser?.id);
  if (settingsUser !== currentUser?.id) {
    setSettingsUser(currentUser?.id);
    setSettingsSection(null);
  }
  const { projects, activeProjectId, hasLoadedProjects, projectsHasMore, isLoadingMoreProjects,
    setActiveProject, clearActiveProject, loadMoreProjects, showToastError } = useProjectStore(useShallow(state => ({
    projects: state.projects, activeProjectId: state.activeProjectId,
    hasLoadedProjects: state.hasLoadedProjects, projectsHasMore: state.projectsHasMore,
    isLoadingMoreProjects: state.isLoadingMoreProjects, setActiveProject: state.setActiveProject,
    clearActiveProject: state.clearActiveProject, loadMoreProjects: state.loadMoreProjects, showToastError: state.showToastError,
  })));

  useEffect(() => {
    void window.beeGameDesktop?.setTheme?.(isDark)?.catch(error => {
      console.error('Unable to synchronize the desktop window theme.', error);
    });
  }, [isDark]);

  const selectProject = async (id: string) => {
    if (opening.current) return;
    opening.current = true;
    setOpeningProject(id);
    try {
      await setActiveProject(id);
      setSettingsSection(null);
      closeResourceLibraryRoute();
      if (!window.matchMedia('(min-width: 1180px)').matches) setNavigationOpen(false);
    } catch {
      // The shared project store owns the error toast. Leave navigation available to retry.
    } finally {
      opening.current = false;
      setOpeningProject(null);
    }
  };

  const toggleNavigation = useCallback(() => {
    if (settingsSection) return;
    setNavigationOpen(value => {
      writeDesktopPreference('bgs-desktop-navigation-open', String(!value));
      return !value;
    });
  }, [settingsSection]);

  const newProject = useCallback(() => {
    if (opening.current) return;
    setSettingsSection(null);
    if (currentUser?.id) writeDesktopPreference(lastDesktopProjectKey(currentUser.id), null);
    closeResourceLibraryRoute();
    clearActiveProject();
    if (!window.matchMedia('(min-width: 700px)').matches) setNavigationOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="idea-prompt-surface"] textarea')?.focus());
  }, [clearActiveProject, currentUser]);

  useEffect(() => {
    if (currentUser?.id && activeProjectId) {
      writeDesktopPreference(lastDesktopProjectKey(currentUser.id), activeProjectId);
    }
  }, [currentUser?.id, activeProjectId]);

  useEffect(() => window.beeGameDesktop?.onCommand?.(command => {
    if (command === 'new-project') newProject();
    if (command === 'toggle-sidebar') toggleNavigation();
    if (command === 'focus-input' && !settingsSection) {
      if (workspace) window.dispatchEvent(new Event('beegame-focus-chat-input'));
      else document.querySelector<HTMLTextAreaElement>('[data-testid="idea-prompt-surface"] textarea')?.focus();
    }
  }), [newProject, toggleNavigation, workspace, settingsSection]);

  const shortcutModifier = window.beeGameDesktop?.platform === 'darwin' ? '⌘' : 'Ctrl+';

  return (
    <DesktopLayoutContext.Provider value={{ header, account, history, settingsPage, settingsSection, setSettingsSection, appearance, setAppearance }}>
      <div className="desktop-app" data-testid="desktop-layout" data-workspace={workspace}
        data-navigation-open={navigationOpen} data-settings-open={settingsSection !== null} data-platform={window.beeGameDesktop?.platform || 'unknown'} lang={lang}>
        <header className="desktop-titlebar">
          <button type="button" className="desktop-icon-button" aria-label={t('desktop.toggleNavigation')}
            disabled={settingsSection !== null} aria-expanded={navigationOpen} aria-controls="desktop-project-navigation"
            title={`${t('desktop.toggleNavigation')} (${shortcutModifier}B)`}
            onClick={toggleNavigation}><PanelLeft aria-hidden="true" /></button>
          <div ref={setHeader} className="desktop-titlebar-content">
            {!workspace || settingsSection ? <span className="desktop-app-name">Bee Game Studio</span> : null}
          </div>
        </header>
        {navigationOpen && !settingsSection ? <button type="button" className="desktop-navigation-backdrop"
          aria-label={t('desktop.closeNavigation')} onClick={() => setNavigationOpen(false)} /> : null}
        <nav id="desktop-project-navigation" className="desktop-navigation" aria-label={t('desktop.projects')}
          hidden={!navigationOpen} inert={settingsSection !== null}>
          <button type="button" className="desktop-navigation-item desktop-new-project" aria-current={!workspace ? 'page' : undefined}
            title={`${t('desktop.newProject')} (${shortcutModifier}N)`}
            disabled={openingProject !== null} onClick={newProject}><SquarePen aria-hidden="true" /><span>{t('desktop.newProject')}</span></button>
          <div ref={setHistory} className="desktop-history-slot" />
          {currentUser ? <>
            <div className="desktop-navigation-heading">{t('desktop.projects')}</div>
            <div className="desktop-project-list">
              {!hasLoadedProjects ? <LoaderCircle className="desktop-loading" aria-label={t('desktop.loadingProjects')} /> : null}
              {projects.map(project => <button key={project.id} type="button" className="desktop-navigation-item"
                disabled={openingProject !== null} aria-current={workspace && project.id === activeProjectId ? 'page' : undefined}
                title={getProjectDisplayName(project, project.name || project.id)}
                onClick={() => void selectProject(project.id)}>
                {openingProject === project.id ? <LoaderCircle className="desktop-loading" aria-hidden="true" /> : <Folder aria-hidden="true" />}
                <span>{getProjectDisplayName(project, project.name || project.id)}</span>
              </button>)}
              {projectsHasMore ? <button type="button" className="desktop-navigation-item" disabled={isLoadingMoreProjects}
                onClick={() => { void loadMoreProjects().catch(error => {
                  console.error('Unable to load more projects.', error);
                  showToastError?.(t('desktop.loadProjectsFailed'));
                }); }}>{t('desktop.moreProjects')}</button> : null}
            </div>
          </> : null}
          <div className="desktop-account-row">
            <div ref={setAccount} className="desktop-account-slot" />
            <ThemeToggleButton isDark={isDark} onThemeChange={value => setAppearance(value ? 'dark' : 'light')} darkModeLabel={common.darkMode} lightModeLabel={common.lightMode} />
          </div>
        </nav>
        <div className="desktop-main">
          <div className="desktop-workbench" inert={settingsSection !== null}>{children}</div>
        </div>
        <div ref={setSettingsPage} className="desktop-settings-surface" />
      </div>
    </DesktopLayoutContext.Provider>
  );
}
