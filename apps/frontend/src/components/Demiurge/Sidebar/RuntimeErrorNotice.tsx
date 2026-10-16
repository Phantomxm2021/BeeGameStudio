import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CircleAlert, RotateCw } from 'lucide-react';

export type ModelRequestRetryControl = {
    messageId: string;
    autoRetry: boolean;
    disabled: boolean;
    onRetry: (automatic: boolean) => void | Promise<void>;
    onCancel: () => void;
};

/** Only a newly observed native failure can arm the timer. History is manual. */
export function RuntimeErrorNotice({ content, retry, zh }: {
    content: string; retry?: ModelRequestRetryControl; zh: boolean;
}) {
    const [remaining, setRemaining] = useState(10_000);
    const [pending, setPending] = useState(false);
    const latest = useRef(retry);
    const inFlight = useRef(false);
    const attempted = useRef(false);
    useLayoutEffect(() => { latest.current = retry; }, [retry]);
    const fire = useCallback(async (automatic = false) => {
        const control = latest.current;
        if (!control || control.disabled || inFlight.current) return;
        inFlight.current = true;
        attempted.current = true;
        setPending(true);
        control.onCancel();
        try { await control.onRetry(automatic); }
        finally { inFlight.current = false; setPending(false); }
    }, []);
    const armed = Boolean(retry?.autoRetry && !retry.disabled && !attempted.current);
    useEffect(() => {
        if (!armed) return;
        const deadline = Date.now() + 10_000;
        setRemaining(10_000);
        const timer = setInterval(() => {
            const next = Math.max(0, deadline - Date.now());
            setRemaining(next);
            if (next === 0) {
                clearInterval(timer);
                void fire(true);
            }
        }, 100);
        return () => clearInterval(timer);
    }, [armed, fire]);
    return <div role="alert" className="my-2 flex min-w-0 items-start gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text-primary)]">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--text-muted)]" />
        <p className="min-w-0 flex-1 break-words whitespace-pre-wrap">{content}</p>
        {retry && <div className="flex shrink-0 items-center gap-1">
            <button type="button" disabled={retry.disabled || pending} onClick={() => void fire()}
                aria-label={zh ? '立即重试' : 'Retry now'}
                className="relative isolate flex h-7 min-w-24 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-[var(--border)] px-2 text-xs disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
                {armed && <span data-testid="retry-progress" aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 -z-10 bg-blue-500/15 transition-[width] duration-100 ease-linear motion-reduce:transition-none"
                    style={{ width: `${(1 - remaining / 10_000) * 100}%` }} />}
                <RotateCw aria-hidden="true" className={`size-3 ${pending ? 'animate-spin' : ''}`} />
                {pending ? (zh ? '重试中…' : 'Retrying…') : armed ? `Retry in ${Math.ceil(remaining / 1000)}s` : 'Retry'}
            </button>
        </div>}
    </div>;
}
