import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorLoadingView, type EditorLoadState } from './EditorLoadingView';

const state = (status: EditorLoadState['status']): EditorLoadState => ({
  status,
  progress: status === 'error' ? 100 : 42,
  label: status === 'error' ? 'Could not open editor' : 'Opening editor',
  detail: status === 'error' ? 'The editor could not be loaded.' : 'Preparing the editor…',
});

describe('EditorLoadingView actions', () => {
  it('keeps Cancel available while loading and stops through onStop', () => {
    const onStop = vi.fn();

    render(
      <EditorLoadingView
        state={state('loading')}
        progressLabel="Editor loading progress"
        onStop={onStop}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('uses distinct pill-shaped BeUI variants for retry and close actions', () => {
    const onRetry = vi.fn();
    const onExit = vi.fn();

    render(
      <EditorLoadingView
        state={state('error')}
        progressLabel="Editor loading progress"
        onStop={vi.fn()}
        onRetry={onRetry}
        onExit={onExit}
      />,
    );

    const retry = screen.getByRole('button', { name: 'Try again' });
    const close = screen.getByRole('button', { name: 'Close editor' });
    expect(retry).toHaveClass('rounded-full', 'bg-primary', 'text-primary-foreground');
    expect(close).toHaveClass('rounded-full', 'border', 'bg-transparent');
    expect(retry).not.toHaveClass('bg-transparent');
    expect(close).not.toHaveClass('bg-primary');

    fireEvent.click(retry);
    fireEvent.click(close);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
