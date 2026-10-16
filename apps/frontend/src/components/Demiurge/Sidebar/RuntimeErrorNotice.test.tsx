import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeErrorNotice, type ModelRequestRetryControl } from './RuntimeErrorNotice';

const control = (overrides: Partial<ModelRequestRetryControl> = {}): ModelRequestRetryControl => ({
    messageId: 'failure', autoRetry: true, disabled: false, onRetry: vi.fn(), onCancel: vi.fn(), ...overrides,
});
afterEach(() => vi.useRealTimers());

it.each([
    ['en', 'Retry in 10s', 'Selected model is at capacity. Please try a different model.'],
    ['zh', '10 秒后重试', '所选模型当前已满负荷，请尝试其他模型。'],
    ['zh-TW', '10 秒後重試', '所選模型目前已滿載，請嘗試其他模型。'],
    ['ja', '10秒後に再試行', '選択したモデルは処理能力の上限に達しています。別のモデルをお試しください。'],
    ['ko', '10초 후 재시도', '선택한 모델의 처리 용량이 가득 찼습니다. 다른 모델을 사용해 주세요.'],
    ['fr', 'Réessayer dans 10 s', 'Le modèle sélectionné est saturé. Veuillez essayer un autre modèle.'],
    ['de', 'Erneut versuchen in 10 s', 'Das ausgewählte Modell ist ausgelastet. Bitte versuche ein anderes Modell.'],
    ['es', 'Reintentar en 10 s', 'El modelo seleccionado está al límite de su capacidad. Prueba con otro modelo.'],
    ['it', 'Riprova tra 10 s', 'Il modello selezionato è al limite della capacità. Prova un altro modello.'],
    ['pt', 'Tentar novamente em 10 s', 'O modelo selecionado está no limite da capacidade. Tente outro modelo.'],
] as const)('localizes the reference copy and retry countdown for %s', (lang, countdown, message) => {
    render(<RuntimeErrorNotice content="API Error: 400 [model_coming_soon] This model is coming soon." retry={control()} lang={lang} />);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button')).toHaveTextContent(countdown);
});

it('fills the capsule over ten seconds and sends only one automatic retry', async () => {
    vi.useFakeTimers();
    const retry = control();
    render(<RuntimeErrorNotice content="Selected model is at capacity." retry={retry} lang="en" />);
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
    render(<RuntimeErrorNotice content="Connection error." retry={retry} lang="zh" />);
    await act(async () => vi.advanceTimersByTime(9900));
    fireEvent.click(screen.getByRole('button', { name: '立即重试' }));
    fireEvent.click(screen.getByRole('button', { name: '立即重试' }));
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(retry.onRetry).toHaveBeenCalledExactlyOnceWith(false);
    await act(async () => finish());
});

it('shows only the retry capsule without a close button', () => {
    render(<RuntimeErrorNotice content="Connection error." retry={control()} lang="zh" />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '立即重试' })).toHaveTextContent('10 秒后重试');
    expect(screen.queryByRole('button', { name: '取消自动重试' })).not.toBeInTheDocument();
});

it('waits for execution cleanup, and unmounting discards the timer', async () => {
    vi.useFakeTimers();
    const retry = control({ disabled: true });
    const view = render(<RuntimeErrorNotice content="Connection error." retry={retry} lang="zh" />);
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(retry.onRetry).not.toHaveBeenCalled();
    view.rerender(<RuntimeErrorNotice content="Connection error." retry={{ ...retry, disabled: false }} lang="zh" />);
    await act(async () => vi.advanceTimersByTime(9000));
    expect(retry.onRetry).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(retry.onRetry).not.toHaveBeenCalled();
});

it('never schedules a model request for a historical failure', async () => {
    vi.useFakeTimers();
    const retry = control({ autoRetry: false });
    render(<RuntimeErrorNotice content="Connection error." retry={retry} lang="zh" />);
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(retry.onRetry).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '立即重试' })).toHaveTextContent('重试');
});
