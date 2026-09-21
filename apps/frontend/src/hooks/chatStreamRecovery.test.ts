import { expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useProjectEventPolling } from './useProjectEventPolling';
import { authenticatedFetch } from '../services/apiClient';

vi.mock('../services/apiClient', () => ({ authenticatedFetch: vi.fn(), isAuthenticationServiceUnavailable: () => false }));

it('recovers a silent socket through the real SSE adapter without refreshing, replaying text or losing thinking duration', async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onMessage = vi.fn();
    const event = (id: number, type: string, text: string, payload: Record<string, unknown> = {}) => ({
        id, sessionId: 'session', turnId: 'turn', type, text, createdAt: new Date(id * 1000).toISOString(), payload,
    });
    const start = event(1, 'assistant.thinking', 'Thinking', { status: 'started', thinkingBlockId: 'thought', thinkingStartedAt: new Date(1000).toISOString() });
    const end = event(3, 'assistant.thinking', 'Thinking', { status: 'ended', thinkingBlockId: 'thought', thinkingStartedAt: new Date(1000).toISOString() });
    const encode = (events: unknown[]) => new TextEncoder().encode(`data: ${JSON.stringify({ events })}\n\n`);
    const cancel = vi.fn();
    vi.mocked(authenticatedFetch)
        .mockResolvedValueOnce(new Response(new ReadableStream({ start: controller => controller.enqueue(encode([start])), cancel })))
        .mockResolvedValueOnce(new Response(new ReadableStream({ start: controller => controller.enqueue(encode([
            start, event(2, 'assistant.thinking', 'Plan', { thinkingBlockId: 'thought' }), end,
            event(4, 'assistant.message', 'Complete', { messageId: 'answer' }),
        ])) })));
    const view = renderHook(() => useProjectEventPolling({ projectId: 'recovery-integration', onMessage }));
    try {
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'think_start' }));
        await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
        expect(view.result.current.state).toBe('reconnecting');
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        expect(view.result.current.state).toBe('connected');
        expect(cancel).toHaveBeenCalled();
        expect(vi.mocked(authenticatedFetch).mock.calls[1]?.[0]).toContain('after=1');
        expect(onMessage.mock.calls.filter(([message]) => message.type === 'think_start')).toHaveLength(1);
        expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'think_end', thinking_duration_ms: 2000 }));
        expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent_message', content: 'Complete' }));
    } finally {
        view.unmount(); warning.mockRestore(); vi.useRealTimers();
    }
});
