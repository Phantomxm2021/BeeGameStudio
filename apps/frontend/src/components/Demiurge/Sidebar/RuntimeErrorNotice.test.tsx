import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeErrorNotice, type ModelRequestRetryControl } from './RuntimeErrorNotice';

const control = (overrides: Partial<ModelRequestRetryControl> = {}): ModelRequestRetryControl => ({
    messageId: 'failure', autoRetry: true, disabled: false, onRetry: vi.fn(), onCancel: vi.fn(), ...overrides,
});
afterEach(() => vi.useRealTimers());

it('fills the capsule over ten seconds and sends only one automatic retry', async () => {
    vi.useFakeTimers();
    const retry = control();
    render(<RuntimeErrorNotice content="Selected model is at capacity." retry={retry} zh={false} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Selected model is at capacity.');
    expect(screen.getByRole('button', { name: 'Retry now' })).toHaveTextContent('Retry in 10s');
    await act(async () => vi.advanceTimersByTime(5000));
    expect(screen.getByTestId('retry-progress')).toHaveStyle({ width: '50%' });
    expect(retry.onRetry).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(5000));
    expect(retry.onRetry).toHaveBeenCalledExactlyOnceWith(true);
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(retry.onRetry).toHaveBeenCalledTimes(1);
});

it('manual retry wins over the timer, including rapid duplicate clicks', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const retry = control({ onRetry: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) });
    render(<RuntimeErrorNotice content="Connection error." retry={retry} zh />);
    await act(async () => vi.advanceTimersByTime(9900));
    fireEvent.click(screen.getByRole('button', { name: '立即重试' }));
    fireEvent.click(screen.getByRole('button', { name: '立即重试' }));
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(retry.onRetry).toHaveBeenCalledExactlyOnceWith(false);
    await act(async () => finish());
});

it('shows only the retry capsule without a close button', () => {
    render(<RuntimeErrorNotice content="Connection error." retry={control()} zh />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '立即重试' })).toHaveTextContent('Retry in 10s');
    expect(screen.queryByRole('button', { name: '取消自动重试' })).not.toBeInTheDocument();
});

it('waits for execution cleanup, and unmounting discards the timer', async () => {
    vi.useFakeTimers();
    const retry = control({ disabled: true });
    const view = render(<RuntimeErrorNotice content="Connection error." retry={retry} zh />);
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(retry.onRetry).not.toHaveBeenCalled();
    view.rerender(<RuntimeErrorNotice content="Connection error." retry={{ ...retry, disabled: false }} zh />);
    await act(async () => vi.advanceTimersByTime(9000));
    expect(retry.onRetry).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(retry.onRetry).not.toHaveBeenCalled();
});

it('never schedules a model request for a historical failure', async () => {
    vi.useFakeTimers();
    const retry = control({ autoRetry: false });
    render(<RuntimeErrorNotice content="Connection error." retry={retry} zh />);
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(retry.onRetry).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '立即重试' })).toHaveTextContent('Retry');
});
