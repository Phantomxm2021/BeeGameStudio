import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18n from '../../i18n';
import { DesktopAccountSlot, DesktopLayout, DesktopWorkspaceHeader } from './DesktopLayout';
import { useDesktopLayout } from './desktopLayoutContext';
import { AccountActionsMenu } from '../Demiurge/Landing/AccountActionsMenu';

const state = vi.hoisted(() => ({
  projects: [{ id: 'one', name: 'Forest' }, { id: 'two', name: 'Orbit' }],
  activeProjectId: 'one', hasLoadedProjects: true, projectsHasMore: false,
  isLoadingMoreProjects: false, setActiveProject: vi.fn(), clearActiveProject: vi.fn(),
  loadMoreProjects: vi.fn(), showToastError: vi.fn(), currentUser: { id: 'user' } as { id: string } | null,
  isDark: true, setTheme: vi.fn(),
}));
vi.mock('../../store/projectStore', () => ({
  useProjectStore: (selector: (value: typeof state) => unknown) => selector(state),
}));
vi.mock('../../store/systemStore', () => ({
  useSystemStore: (selector: (value: typeof state) => unknown) => selector(state),
}));
vi.mock('../beui/motion/theme-toggle', () => ({ ThemeToggle: () => <button>Theme</button> }));

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
  state.currentUser = { id: 'user' };
  state.projectsHasMore = false;
  state.setActiveProject.mockReset().mockResolvedValue(undefined);
  state.loadMoreProjects.mockReset().mockResolvedValue(undefined);
  state.clearActiveProject.mockReset();
  state.showToastError.mockReset();
  window.beeGameDesktop = { isDesktop: true, platform: 'darwin', setTheme: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn(), onOAuthCallback: () => () => {} };
});
afterEach(() => { delete window.beeGameDesktop; vi.restoreAllMocks(); });

function HistoryActions() {
  const [open, setOpen] = useState(false);
  return <>
    <DesktopAccountSlot><AccountActionsMenu lang="en" currentUserId={state.currentUser?.id}
      isSettingsOpen={false} isHistoryOpen={open} onToggleHistory={() => setOpen(value => !value)}
      onToggleSettings={vi.fn()} onOpenCreditStore={vi.fn()} onOpenProfile={vi.fn()} onOpenLogin={vi.fn()} />
    </DesktopAccountSlot>
    {open ? <div role="dialog" aria-label="History Projects"><button onClick={() => setOpen(false)}>Close history</button></div> : null}
  </>;
}

describe('desktop layout', () => {
  it('reuses project navigation and keeps the workbench mounted when the sidebar toggles', async () => {
    const mounted = vi.fn();
    function Workbench() { useEffect(() => { mounted(); }, []); return <div>Workbench</div>; }
    render(<DesktopLayout lang="en" workspace><Workbench /></DesktopLayout>);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle project navigation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Orbit' }));
    await waitFor(() => expect(state.setActiveProject).toHaveBeenCalledWith('two'));
    await waitFor(() => expect(screen.queryByRole('navigation')).not.toBeInTheDocument());
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('leaves project navigation open when opening a project fails', async () => {
    state.setActiveProject.mockRejectedValue(new Error('Unavailable'));
    render(<DesktopLayout lang="en" workspace={false}><div>Idea</div></DesktopLayout>);
    fireEvent.click(screen.getByRole('button', { name: 'Orbit' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Orbit' })).toBeEnabled());
    expect(screen.getByRole('navigation')).toBeVisible();
  });

  it('places existing workspace actions and account controls in their desktop slots', async () => {
    render(<DesktopLayout lang="en" workspace>
      <DesktopWorkspaceHeader><button>Preview game</button></DesktopWorkspaceHeader>
      <DesktopAccountSlot><button>Account menu</button></DesktopAccountSlot>
    </DesktopLayout>);
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Preview game' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle project navigation' }));
    expect(within(screen.getByRole('navigation')).getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
    expect(window.beeGameDesktop?.setTheme).toHaveBeenCalledWith(true);
  });

  it('keeps web account controls in place without a desktop layout', () => {
    render(<DesktopAccountSlot><button>Web account</button></DesktopAccountSlot>);
    expect(screen.getByRole('button', { name: 'Web account' })).toBeInTheDocument();
    expect(screen.queryByTestId('desktop-layout')).not.toBeInTheDocument();
  });

  it('does not reveal project data before login and supports the existing pagination', () => {
    state.currentUser = null;
    const view = render(<DesktopLayout lang="en" workspace={false}><div>Idea</div></DesktopLayout>);
    expect(screen.queryByRole('button', { name: 'Forest' })).not.toBeInTheDocument();
    state.currentUser = { id: 'user' }; state.projectsHasMore = true;
    view.rerender(<DesktopLayout lang="en" workspace={false}><div>Idea</div></DesktopLayout>);
    fireEvent.click(screen.getByRole('button', { name: 'More projects' }));
    expect(state.loadMoreProjects).toHaveBeenCalledOnce();
  });
  it('keeps wide navigation open and preserves the user preference across routes and remounts', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ matches: true, media: query } as MediaQueryList));
    const view = render(<DesktopLayout lang="en" workspace={false}><div>Idea</div></DesktopLayout>);
    fireEvent.click(screen.getByRole('button', { name: 'Orbit' }));
    await waitFor(() => expect(state.setActiveProject).toHaveBeenCalledWith('two'));
    view.rerender(<DesktopLayout lang="en" workspace><div>Project</div></DesktopLayout>);
    expect(screen.getByRole('navigation')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Orbit' })).toHaveAttribute('title', 'Orbit');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle project navigation' }));
    view.unmount();
    render(<DesktopLayout lang="en" workspace={false}><div>Idea</div></DesktopLayout>);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('receives native commands, focuses the unchanged idea field, and forgets the old project on New', () => {
    let command: ((command: 'new-project' | 'toggle-sidebar' | 'focus-input') => void) | undefined;
    const unsubscribe = vi.fn();
    window.beeGameDesktop!.onCommand = handler => { command = handler; return unsubscribe; };
    const view = render(<DesktopLayout lang="en" workspace={false}>
      <div data-testid="idea-prompt-surface"><textarea aria-label="Idea" /></div>
    </DesktopLayout>);
    command?.('focus-input');
    expect(screen.getByRole('textbox', { name: 'Idea' })).toHaveFocus();
    command?.('new-project');
    expect(state.clearActiveProject).toHaveBeenCalledOnce();
    expect(localStorage.getItem('bgs-desktop-last-project:user')).toBeNull();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('closes navigation on a narrow restored workspace and reports pagination failures', async () => {
    state.projectsHasMore = true;
    state.loadMoreProjects.mockRejectedValue(new Error('Offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(<DesktopLayout lang="en" workspace={false}><div>Idea</div></DesktopLayout>);
    fireEvent.click(screen.getByRole('button', { name: 'More projects' }));
    await waitFor(() => expect(state.showToastError).toHaveBeenCalledWith('Unable to load more projects. Please try again.'));
    view.rerender(<DesktopLayout lang="en" workspace><div>Project</div></DesktopLayout>);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it.each([false, true])('opens the existing history surface directly from navigation (workspace=%s)', async workspace => {
    render(<DesktopLayout lang="en" workspace={workspace}><HistoryActions /></DesktopLayout>);
    if (workspace) fireEvent.click(screen.getByRole('button', { name: 'Toggle project navigation' }));
    const history = within(screen.getByRole('navigation')).getByRole('button', { name: 'History Projects' });
    expect(history).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(history);
    expect(screen.getByRole('dialog', { name: 'History Projects' })).toBeVisible();
    expect(history).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Close history' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(history).toHaveAttribute('aria-expanded', 'false');
    expect(state.setActiveProject).not.toHaveBeenCalled();
  });

  it('keeps project history unavailable before sign-in', () => {
    state.currentUser = null;
    render(<DesktopLayout lang="en" workspace={false}><HistoryActions /></DesktopLayout>);
    expect(screen.queryByRole('button', { name: 'History Projects' })).not.toBeInTheDocument();
  });

});


it('persists system appearance and follows OS changes while the app stays mounted', async () => {
  let listener: (() => void) | undefined;
  const media = { matches: false, addEventListener: vi.fn((_event, handler) => { listener = handler; }), removeEventListener: vi.fn() };
  const original = window.matchMedia;
  window.matchMedia = vi.fn(query => query === '(prefers-color-scheme: dark)' ? media as unknown as MediaQueryList : original(query));
  function Preferences() { const desktop = useDesktopLayout(); return <button onClick={() => desktop?.setAppearance?.('system')}>System appearance</button>; }
  const { unmount } = render(<DesktopLayout lang="en" workspace={false}><Preferences /></DesktopLayout>);
  try {
    fireEvent.click(screen.getByRole('button', { name: 'System appearance' }));
    await waitFor(() => expect(state.setTheme).toHaveBeenLastCalledWith(false));
    expect(localStorage.getItem('bgs-desktop-appearance')).toBe('system');
    media.matches = true;
    listener?.();
    expect(state.setTheme).toHaveBeenLastCalledWith(true);
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
  } finally { unmount(); window.matchMedia = original; }
});
