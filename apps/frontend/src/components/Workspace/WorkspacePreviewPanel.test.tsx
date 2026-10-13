import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspacePreviewPanel } from './WorkspacePreviewPanel';
import { getDailyAvatar } from '../Demiurge/Landing/useDailyAvatar';

vi.mock('../Demiurge/Landing/DotsAvatar', () => ({
  DotsAvatar: ({ token, mood, label }: { token: string; mood: string; label: string }) => <div role="img" aria-label={label} data-dot-token={token} data-mood={mood} />,
}));

const props = {
  title: 'Preview',
  labels: {
    previewActions: 'Preview actions',
    closePreviewActions: 'Close preview actions', fullScreenPreview: 'Full-screen preview',
    refreshPreview: 'Refresh preview', previewPaused: 'Preview paused',
    previewViewport: 'Viewport', previewViewportTitle: 'Preview viewport',
    previewViewportDesktop: 'PC', previewViewportIpad: 'iPad', previewViewportMobile: 'Mobile',
    previewViewportWidth: 'Width', previewViewportHeight: 'Height',
    previewViewportApply: 'Apply', previewViewportClose: 'Close viewport settings',
    previewConsole: 'Console', closePreviewConsole: 'Close console',
    clearPreviewConsole: 'Clear console', emptyPreviewConsole: 'No console output yet',
    previewConsoleFilters: 'Console filters', previewConsoleAll: 'All', previewConsoleInfo: 'Info',
    previewConsoleWarning: 'Warning', previewConsoleError: 'Error',
    emptyFilteredPreviewConsole: 'No matching console output', newPreviewConsoleOutput: 'New console output',
  },
  embeddedPreviewUrl: '',
  previewState: 'idle' as const,
  statusText: 'Waiting for a playable surface',
  previewDetailText: '',
  previewFrameRef: { current: null },
  canShowPreview: false,
};

describe('WorkspacePreviewPanel', () => {
  afterEach(() => vi.useRealTimers());
  const live = { ...props, canShowPreview: true, embeddedPreviewUrl: 'http://runtime/previews/session/', previewState: 'live' as const };
  const reportLoaded = (frame: HTMLIFrameElement) => fireEvent(window, new MessageEvent('message', {
    origin: 'null', source: frame.contentWindow,
    data: { type: 'beegame.preview.lifecycle', sessionId: 'session', status: 'loaded' },
  }));
  it('ends loading with a retryable error when the iframe never reports document readiness', () => {
    vi.useFakeTimers();
    const head = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    render(<WorkspacePreviewPanel {...live} />);
    const frame = screen.getByTitle('Preview');
    fireEvent.load(frame); // a 503 HTML response can also fire this event
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByRole('alert')).toHaveTextContent('failed to load');
    expect(screen.queryByTitle('Preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload preview' }));
    expect(screen.getByTitle('Preview')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    head.mockRestore();
  });
  it('accepts measured static Preview only after its iframe loads and a HEAD probe confirms the measured origin', async () => {
    const head = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, {
      status: 200, headers: { 'X-BeeGame-Preview-Mode': 'measured-static' },
    }));
    try {
      render(<WorkspacePreviewPanel {...live} />);
      const frame = screen.getByTitle('Preview');
      expect(screen.getByRole('status')).toBeTruthy();
      fireEvent.load(frame);
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
      expect(screen.queryByRole('alert')).toBeNull();
      expect(head).toHaveBeenCalledWith(live.embeddedPreviewUrl, { method: 'HEAD', mode: 'cors', cache: 'no-store' });
    } finally { head.mockRestore(); }
  });
  it('accepts readiness only from this frame and session, and surfaces subsequent errors', () => {
    vi.useFakeTimers();
    render(<WorkspacePreviewPanel {...live} />);
    const frame = screen.getByTitle('Preview') as HTMLIFrameElement;
    const data = { type: 'beegame.preview.lifecycle', sessionId: 'session', status: 'loaded' };
    fireEvent(window, new MessageEvent('message', { origin: 'null', source: window, data }));
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent(window, new MessageEvent('message', { origin: 'null', source: frame.contentWindow, data: { ...data, sessionId: 'other' } }));
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent(window, new MessageEvent('message', { origin: 'null', source: frame.contentWindow, data }));
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent(window, new MessageEvent('message', { origin: 'null', source: frame.contentWindow, data: { ...data, status: 'failed' } }));
    expect(screen.getByRole('alert')).toBeTruthy();
  });
  it('uses one semantic preview well without an elevated border or shadow', () => {
    render(<WorkspacePreviewPanel {...props} />);
    const surface = screen.getByTestId('beegame-preview-surface');
    expect(surface).toHaveClass('bg-[var(--preview-well)]', 'rounded-xl');
    expect(surface).not.toHaveClass('border', 'shadow', 'shadow-lg');
  });
  it('uses today’s home avatar, keeps it thinking during startup and only wakes on click while idle', () => {
    vi.useFakeTimers();
    const { rerender } = render(<WorkspacePreviewPanel {...props} previewState="starting" />);
    const avatar = screen.getByRole('img');
    expect(avatar).toHaveAttribute('data-dot-token', getDailyAvatar());
    expect(avatar).toHaveAttribute('data-mood', 'thinking');

    fireEvent.click(screen.getByTestId('beegame-preview-surface'));
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(avatar).toHaveAttribute('data-mood', 'thinking');

    rerender(<WorkspacePreviewPanel {...props} />);
    expect(avatar).toHaveAttribute('data-mood', 'sleeping');
    fireEvent.click(screen.getByTestId('beegame-preview-surface'));
    expect(avatar).toHaveAttribute('data-mood', 'idle');

    act(() => { vi.advanceTimersByTime(3_000); });
    expect(avatar).toHaveAttribute('data-mood', 'sleeping');
  });
  it('ignores preview clicks while the agent-working status is shown', () => {
    vi.useFakeTimers();
    const { rerender } = render(<WorkspacePreviewPanel {...props} isAgentWorking statusText="Bee Game Studio工作中" />);
    const avatar = screen.getByRole('img');
    expect(avatar).toHaveAttribute('data-mood', 'thinking');
    fireEvent.click(screen.getByTestId('beegame-preview-surface'));
    expect(avatar).toHaveAttribute('data-mood', 'thinking');
    rerender(<WorkspacePreviewPanel {...props} isAgentWorking previewState="starting" statusText="Bee Game Studio工作中" />);
    fireEvent.click(screen.getByTestId('beegame-preview-surface'));
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(avatar).toHaveAttribute('data-mood', 'thinking');
  });
  it('reveals Gooey preview actions only after the preview has loaded', async () => {
    render(<WorkspacePreviewPanel {...live} />);
    expect(screen.queryByTestId('beegame-preview-actions')).toBeNull();
    reportLoaded(screen.getByTitle('Preview') as HTMLIFrameElement);
    const toolbar = screen.getByTestId('beegame-preview-actions');
    expect(toolbar).toHaveClass('h-32', 'w-32');
    expect(screen.getByTestId('preview-gooey-menu').querySelector('[data-gooey-svg]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview actions' })).toHaveClass('rounded-full');
    fireEvent.click(screen.getByRole('button', { name: 'Preview actions' }));
    expect(screen.getByRole('button', { name: 'Full-screen preview' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Viewport' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Console' })).toBeTruthy();
    for (const name of ['Full-screen preview', 'Refresh preview', 'Viewport', 'Console']) {
      expect(screen.getByRole('button', { name })).toHaveClass('rounded-full');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Close preview actions' }));
    expect(screen.queryByRole('button', { name: 'Console' })).toBeNull();
    expect(toolbar.querySelector('button[aria-label="Console"]')).toBeDisabled();
  });
  it('pauses the iframe after opening a new tab and reloads on refresh', () => {
    const onOpenExternal = vi.fn();
    render(<WorkspacePreviewPanel {...live} onOpenExternal={onOpenExternal} />);
    reportLoaded(screen.getByTitle('Preview') as HTMLIFrameElement);
    fireEvent.click(screen.getByRole('button', { name: 'Preview actions' }));
    expect(screen.getByRole('button', { name: 'Console' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Full-screen preview' }));
    expect(onOpenExternal).toHaveBeenCalledWith(live.embeddedPreviewUrl);
    expect(screen.queryByTitle('Preview')).toBeNull();
    expect(screen.getByTestId('beegame-preview-paused')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
    expect(screen.getByTitle('Preview')).toBeTruthy();
  });
  it('changes only the iframe viewport, keeps the preview session, and preserves the choice on refresh', () => {
    render(<WorkspacePreviewPanel {...live} />);
    const frame = screen.getByTitle('Preview') as HTMLIFrameElement;
    reportLoaded(frame);
    fireEvent.click(screen.getByRole('button', { name: 'Preview actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Viewport' }));
    expect(screen.getByRole('dialog', { name: 'Preview viewport' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Viewport presets' }));
    fireEvent.click(screen.getByRole('option', { name: /Mobile/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByTitle('Preview')).toBe(frame);
    expect(frame).toHaveStyle({ width: '390px', height: '844px' });
    fireEvent.click(screen.getByRole('button', { name: 'Preview actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
    expect(screen.getByTitle('Preview')).toHaveStyle({ width: '390px', height: '844px' });
  });
  it('accepts a custom viewport and can return to the responsive preview', () => {
    render(<WorkspacePreviewPanel {...live} />);
    reportLoaded(screen.getByTitle('Preview') as HTMLIFrameElement);
    fireEvent.click(screen.getByRole('button', { name: 'Preview actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Viewport' }));
    fireEvent.click(screen.getByRole('button', { name: 'Viewport presets' }));
    fireEvent.click(screen.getByRole('option', { name: /iPad/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Width' }), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByTitle('Preview')).toHaveStyle({ width: '600px', height: '1024px' });
    fireEvent.click(screen.getByRole('button', { name: 'Preview actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Viewport' }));
    fireEvent.click(screen.getByRole('button', { name: 'Viewport presets' }));
    fireEvent.click(screen.getByRole('option', { name: /Fit panel/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByTestId('beegame-preview-viewport')).toHaveClass('h-full', 'w-full');
  });
  it('does not cover the preview with build logs', () => {
    render(<WorkspacePreviewPanel {...props} previewState="failed" previewDetailText="Build failed" />);
    expect(screen.getByText('Build failed')).toBeTruthy();
    expect(screen.queryByTestId('beegame-preview-error-overlay')).toBeNull();
  });
  it('shows only this preview session’s console output in an on-demand panel', () => {
    render(<WorkspacePreviewPanel {...live} />);
    const frame = screen.getByTitle('Preview') as HTMLIFrameElement;
    reportLoaded(frame);
    fireEvent.click(screen.getByRole('button', { name: 'Preview actions' }));
    expect(screen.queryByTestId('beegame-preview-console')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Console' }));
    expect(screen.getByTestId('beegame-preview-console')).toHaveClass('inset-x-0', 'bottom-0', 'rounded-t-2xl');
    expect(screen.queryByTestId('beegame-preview-actions')).toBeNull();
    expect(screen.getByText('No console output yet')).toBeTruthy();
    const message = { type: 'beegame.preview.console', sessionId: 'session', level: 'warn', message: 'Game warning' };
    fireEvent(window, new MessageEvent('message', { origin: 'null', source: window, data: message }));
    fireEvent(window, new MessageEvent('message', { origin: 'null', source: frame.contentWindow, data: { ...message, sessionId: 'other' } }));
    expect(screen.queryByText('Game warning')).toBeNull();
    fireEvent(window, new MessageEvent('message', { origin: 'null', source: frame.contentWindow, data: message }));
    expect(screen.getByText('Game warning')).toBeTruthy();
    fireEvent(window, new MessageEvent('message', { origin: 'null', source: frame.contentWindow,
      data: { ...message, level: 'error', message: 'Failed in /Users/alice/game/src/Player.ts' } }));
    fireEvent(window, new MessageEvent('message', { origin: 'null', source: frame.contentWindow,
      data: { ...message, level: 'debug', message: 'Game state ready' } }));
    expect(screen.getByText('Failed in Player.ts')).toBeTruthy();
    expect(screen.queryByText(/\/Users\/alice/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Info' }));
    expect(screen.getByText('Game state ready')).toBeTruthy();
    expect(screen.queryByText('Game warning')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Warning' }));
    expect(screen.getByText('Game warning')).toBeTruthy();
    expect(screen.queryByText('Failed in Player.ts')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Error' }));
    expect(screen.getByText('Failed in Player.ts')).toBeTruthy();
    expect(screen.queryByText('Game warning')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear console' }));
    expect(screen.queryByText('Game warning')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close console' }));
    expect(screen.queryByTestId('beegame-preview-console')).toBeNull();
    expect(screen.getByTestId('beegame-preview-actions')).toBeTruthy();
  });
  it('shows an unread dot on the collapsed menu and console action until new logs are viewed', () => {
    render(<WorkspacePreviewPanel {...live} />);
    const frame = screen.getByTitle('Preview') as HTMLIFrameElement;
    reportLoaded(frame);
    const sendLog = (level: string, message: string) => fireEvent(window, new MessageEvent('message', {
      origin: 'null', source: frame.contentWindow,
      data: { type: 'beegame.preview.console', sessionId: 'session', level, message },
    }));
    expect(screen.queryByTestId('beegame-console-unread-dot')).toBeNull();
    sendLog('info', 'Game started');
    expect(screen.getByTestId('beegame-console-unread-dot')).toHaveClass('bg-blue-400');
    sendLog('warn', 'Warning');
    expect(screen.getByTestId('beegame-console-unread-dot')).toHaveClass('bg-amber-400');
    sendLog('debug', 'Debug detail');
    expect(screen.getByTestId('beegame-console-unread-dot')).toHaveClass('bg-amber-400');
    const dot = screen.getByTestId('beegame-console-unread-dot');
    fireEvent.click(screen.getByRole('button', { name: 'Preview actions' }));
    expect(screen.getByTestId('beegame-console-unread-dot')).toBe(dot);
    expect(screen.getByTestId('beegame-console-unread-dot')).toHaveClass('bg-amber-400');
    fireEvent.click(screen.getByRole('button', { name: 'Console' }));
    expect(screen.queryByTestId('beegame-console-unread-dot')).toBeNull();
    sendLog('warn', 'Low health');
    fireEvent.click(screen.getByRole('button', { name: 'Close console' }));
    expect(screen.queryByTestId('beegame-console-unread-dot')).toBeNull();
    sendLog('error', 'Game failed');
    expect(screen.getByTestId('beegame-console-unread-dot')).toHaveClass('bg-[var(--destructive)]');
    sendLog('log', 'Another log');
    expect(screen.getByTestId('beegame-console-unread-dot')).toHaveClass('bg-[var(--destructive)]');
    fireEvent.click(screen.getByRole('button', { name: 'Preview actions' }));
    expect(screen.getByTestId('beegame-console-unread-dot')).toHaveClass('bg-[var(--destructive)]');
    fireEvent.click(screen.getByRole('button', { name: 'Close preview actions' }));
    expect(screen.getByTestId('beegame-console-unread-dot')).toHaveClass('bg-[var(--destructive)]');
  });
  it('renders selectable console blocks and sends the selected error to the repair callback', async () => {
    const onFixConsoleError = vi.fn().mockResolvedValue(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<WorkspacePreviewPanel {...live} onFixConsoleError={onFixConsoleError} />);
    const frame = screen.getByTitle('Preview') as HTMLIFrameElement;
    reportLoaded(frame);
    fireEvent.click(screen.getByRole('button', { name: 'Preview actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Console' }));

    const message = "SecurityError: localStorage is unavailable\n    at Player (src/Player.ts:12:3)";
    fireEvent(window, new MessageEvent('message', {
      origin: 'null', source: frame.contentWindow,
      data: { type: 'beegame.preview.console', sessionId: 'session', level: 'error', message },
    }));

    const entry = screen.getByTestId('beegame-console-entry-0');
    const selectButton = within(entry).getByRole('button', { pressed: false });
    expect(selectButton).toHaveAttribute('aria-pressed', 'false');
    expect(within(entry).getByRole('button', { name: 'Copy response' })).toBeTruthy();
    expect(within(entry).getByRole('button', { name: 'Fix' })).toBeTruthy();
    fireEvent.click(selectButton);
    expect(selectButton).toHaveAttribute('aria-pressed', 'true');
    expect(within(entry).getByText(/Stack trace/)).toBeTruthy();
    fireEvent.click(within(entry).getByRole('button', { name: 'Copy response' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('SecurityError: localStorage is unavailable')));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Player.ts:12:3'));
    await waitFor(() => expect(within(entry).getByRole('button', { name: 'Copied' })).toBeTruthy());
    fireEvent.click(within(entry).getByRole('button', { name: 'Fix' }));
    await waitFor(() => expect(onFixConsoleError).toHaveBeenCalledWith(message));
  });
});
