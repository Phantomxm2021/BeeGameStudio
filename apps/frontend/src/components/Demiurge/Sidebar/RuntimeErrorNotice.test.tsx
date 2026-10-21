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

it('drains the capsule over ten seconds and sends only one automatic retry', async () => {
    vi.useFakeTimers();
    const retry = control();
    render(<RuntimeErrorNotice content="Selected model is at capacity." retry={retry} lang="en" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Selected model is at capacity.');
    expect(screen.getByRole('button', { name: 'Retry now' })).toHaveTextContent('Retry in 10s');
    expect(screen.getByTestId('retry-progress')).toHaveStyle({ width: '100%' });
    await act(async () => vi.advanceTimersByTime(2500));
    expect(screen.getByTestId('retry-progress')).toHaveStyle({ width: '75%' });
    await act(async () => vi.advanceTimersByTime(2500));
    expect(screen.getByTestId('retry-progress')).toHaveStyle({ width: '50%' });
    expect(retry.onRetry).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(5000));
    expect(retry.onRetry).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(retry.onRetry).toHaveBeenCalledTimes(1);
});

it('manual retry wins over the timer, including rapid duplicate clicks', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const retry = control({ onRetry: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) });
    const view = render(<RuntimeErrorNotice key="failure" content="Connection error." retry={retry} lang="zh" />);
    await act(async () => vi.advanceTimersByTime(9900));
    const button = screen.getByRole('button', { name: '立即重试' });
    fireEvent.click(button);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(button);
    await act(async () => vi.advanceTimersByTime(20_000));
    expect(retry.onRetry).toHaveBeenCalledExactlyOnceWith(false);
    await act(async () => finish());
    view.rerender(<RuntimeErrorNotice key="failure" content="Connection error." lang="zh" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.rerender(<RuntimeErrorNotice key="new-failure" content="New connection error." lang="zh" retry={control({ messageId: 'new-failure', autoRetry: false })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('New connection error.');
    expect(screen.getByRole('button', { name: '立即重试' })).toBeEnabled();
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

it('shows a concise connection problem with the original diagnostic collapsed and no new request', async () => {
    vi.useFakeTimers();
    const content = 'unexpected status 502 Bad Gateway: The selected model provider transport failed (UND_ERR_SOCKET), url: http://127.0.0.1:12345/v1/responses';
    const retry = control({ autoRetry: false });
    render(<RuntimeErrorNotice content={content} retry={retry} lang="zh" />);
    expect(screen.getByText('连接服务时发生错误，本次回复未能完成。')).toBeVisible();
    expect(screen.getByText(content)).not.toBeVisible();
    fireEvent.click(screen.getByText('错误详情'));
    expect(screen.getByText(content)).toBeVisible();
    fireEvent.click(screen.getByText('错误详情'));
    expect(screen.getByText(content)).not.toBeVisible();
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(retry.onRetry).not.toHaveBeenCalled();
    expect(retry.onCancel).not.toHaveBeenCalled();
});

it('keeps an actionable application error directly visible without replacing it with a generic connection error', () => {
    render(<RuntimeErrorNotice content="项目目录不可用，请重新选择目录。" lang="zh" />);
    expect(screen.getByRole('alert')).toHaveTextContent('项目目录不可用，请重新选择目录。');
    expect(screen.queryByText('错误详情')).not.toBeInTheDocument();
});
