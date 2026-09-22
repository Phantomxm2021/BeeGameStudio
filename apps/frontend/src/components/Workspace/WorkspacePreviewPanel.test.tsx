import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspacePreviewPanel } from './WorkspacePreviewPanel';

const props = {
  title: 'Preview',
  labels: { console: 'Console', fixBuildErrors: 'Fix build errors' },
  embeddedPreviewUrl: '',
  previewState: 'idle' as const,
  statusText: 'Waiting for a playable surface',
  previewDetailText: '',
  buildErrorLog: '',
  previewFrameRef: { current: null },
  canShowPreview: false,
};

describe('WorkspacePreviewPanel', () => {
  afterEach(() => vi.useRealTimers());
  const live = { ...props, canShowPreview: true, embeddedPreviewUrl: 'http://runtime/previews/session/', previewState: 'live' as const };
  it('ends loading with a retryable error when the iframe never reports document readiness', () => {
    vi.useFakeTimers();
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
});
