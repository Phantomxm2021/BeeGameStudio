import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { beeGameAdapter } from '../../services/beeGameAdapter';
import { SceneEditorOverlay } from './SceneEditorOverlay';

describe('SceneEditorOverlay loading experience', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows no navigation chrome and closes after interrupting an in-flight load', () => {
    const signals: AbortSignal[] = [];
    const pending = (_projectId: string, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      if (!signal) return;
      signals.push(signal);
      signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')), { once: true });
    });
    vi.spyOn(beeGameAdapter, 'getProjectGameContent').mockImplementation(pending);
    vi.spyOn(beeGameAdapter, 'getProjectAssets').mockImplementation(pending);
    const onClose = vi.fn();

    const { container } = render(<SceneEditorOverlay projectId="project-1" onClose={onClose} />);

    expect(container.querySelector('header')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Scene loading progress' })).toHaveAttribute('aria-valuenow', '8');
    expect(screen.queryByRole('button', { name: 'Back to project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close Scene Editor' })).not.toBeInTheDocument();

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveClass('border', 'bg-transparent');
    fireEvent.click(cancel);

    expect(signals).toHaveLength(2);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
