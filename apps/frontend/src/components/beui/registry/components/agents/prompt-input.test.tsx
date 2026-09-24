import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptInput } from './prompt-input';

describe('PromptInput primary action', () => {
  it('shows one disabled Send action when idle and the draft is empty', () => {
    render(<PromptInput value="" onSubmit={vi.fn()} onStop={vi.fn()} allowSubmitWhileLoading />);
    expect(screen.getByRole('button', { name: 'Send prompt' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Stop generating' })).not.toBeInTheDocument();
  });

  it('switches the single action from Stop to Send when a running draft is entered', () => {
    const onStop = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(<PromptInput value="" loading onStop={onStop} onSubmit={onSubmit} allowSubmitWhileLoading />);
    expect(screen.getAllByRole('button', { name: /^(Stop generating|Send prompt)$/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));
    expect(onStop).toHaveBeenCalledOnce();

    rerender(<PromptInput value="Queue this" loading onStop={onStop} onSubmit={onSubmit} allowSubmitWhileLoading />);
    expect(screen.getAllByRole('button', { name: /^(Stop generating|Send prompt)$/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Stop generating' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send prompt' }));
    expect(onSubmit).toHaveBeenCalledWith('Queue this', undefined);
  });

  it('treats attachments as a sendable draft and respects a pending Stop request', () => {
    const { rerender } = render(<PromptInput value="" loading onStop={vi.fn()} allowSubmitWhileLoading stopDisabled />);
    expect(screen.getByRole('button', { name: 'Stop generating' })).toBeDisabled();
    rerender(<PromptInput value="" loading onStop={vi.fn()} allowSubmitWhileLoading allowEmptySubmit />);
    expect(screen.getByRole('button', { name: 'Send prompt' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Stop generating' })).not.toBeInTheDocument();
  });
});
