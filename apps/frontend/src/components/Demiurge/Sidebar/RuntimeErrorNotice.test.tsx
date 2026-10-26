import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeErrorNotice, type ModelRequestRetryControl } from './RuntimeErrorNotice';

const control = (overrides: Partial<ModelRequestRetryControl> = {}): ModelRequestRetryControl => ({
    messageId: 'failure', disabled: false, onRetry: vi.fn(), ...overrides,
});
afterEach(() => vi.useRealTimers());

it.each([
    ['en', 'Retry', 'Selected model is at capacity. Please try a different model.'],
    ['zh', '重试', '所选模型当前已满负荷，请尝试其他模型。'],
    ['zh-TW', '重試', '所選模型目前已滿載，請嘗試其他模型。'],
    ['ja', '再試行', '選択したモデルは処理能力の上限に達しています。別のモデルをお試しください。'],
    ['ko', '재시도', '선택한 모델의 처리 용량이 가득 찼습니다. 다른 모델을 사용해 주세요.'],
    ['fr', 'Réessayer', 'Le modèle sélectionné est saturé. Veuillez essayer un autre modèle.'],
    ['de', 'Erneut versuchen', 'Das ausgewählte Modell ist ausgelastet. Bitte versuche ein anderes Modell.'],
    ['es', 'Reintentar', 'El modelo seleccionado está al límite de su capacidad. Prueba con otro modelo.'],
    ['it', 'Riprova', 'Il modello selezionato è al limite della capacità. Prova un altro modello.'],
    ['pt', 'Tentar novamente', 'O modelo selecionado está no limite da capacidade. Tente outro modelo.'],
] as const)('localizes the error copy and manual retry for %s', (lang, countdown, message) => {
    render(<RuntimeErrorNotice content="API Error: 400 [model_coming_soon] This model is coming soon." retry={control()} lang={lang} />);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button')).toHaveTextContent(countdown);
});

it('never submits automatically, and disables duplicate manual clicks until settlement', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const retry = control({ onRetry: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) });
    render(<RuntimeErrorNotice content="Connection error." retry={retry} lang="en" />);
    const button = screen.getByRole('button', { name: 'Retry now' });
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(retry.onRetry).not.toHaveBeenCalled();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(retry.onRetry).toHaveBeenCalledExactlyOnceWith();
    expect(screen.getByRole('alert')).toBeVisible();
    await act(async () => finish());
    expect(button).toBeEnabled();
});

it('does not submit while cleanup or permission checks disable recovery', async () => {
    vi.useFakeTimers();
    const retry = control({ disabled: true });
    render(<RuntimeErrorNotice content="Connection error." retry={retry} lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(retry.onRetry).not.toHaveBeenCalled();
});

it('shows a concise connection problem with the original diagnostic collapsed and no new request', async () => {
    vi.useFakeTimers();
    const content = 'unexpected status 502 Bad Gateway: The selected model provider transport failed (UND_ERR_SOCKET), url: http://127.0.0.1:12345/v1/responses';
    const retry = control();
    render(<RuntimeErrorNotice content={content} retry={retry} lang="zh" />);
    expect(screen.getByText('连接服务时发生错误，本次回复未能完成。')).toBeVisible();
    expect(screen.getByText(content)).not.toBeVisible();
    fireEvent.click(screen.getByText('错误详情'));
    expect(screen.getByText(content)).toBeVisible();
    fireEvent.click(screen.getByText('错误详情'));
    expect(screen.getByText(content)).not.toBeVisible();
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(retry.onRetry).not.toHaveBeenCalled();
});

it('keeps an actionable application error directly visible without replacing it with a generic connection error', () => {
    render(<RuntimeErrorNotice content="项目目录不可用，请重新选择目录。" lang="zh" />);
    expect(screen.getByRole('alert')).toHaveTextContent('项目目录不可用，请重新选择目录。');
    expect(screen.queryByText('错误详情')).not.toBeInTheDocument();
});
