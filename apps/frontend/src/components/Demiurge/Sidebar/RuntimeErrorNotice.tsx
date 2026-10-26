import { useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Language } from '../AgentsConfig';

export type ModelRequestRetryControl = {
    messageId: string;
    disabled: boolean;
    onRetry: () => void | Promise<void>;
};

/** The CLI owns automatic recovery; this control requires a user click. */
export function RuntimeErrorNotice({ content, retry, lang }: {
    content: string; retry?: ModelRequestRetryControl; lang: Language;
}) {
    const { i18n } = useTranslation('beegame');
    const t = i18n.getFixedT(lang, 'beegame');
    const message = /model_coming_soon|at capacity|overloaded_error/i.test(content)
        ? t('modelRequestError.capacity')
        : /provider transport failed|UND_ERR_SOCKET|^Connection error\.$|ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|request timed out|network error|unexpected status 50[234]/i.test(content)
            ? t('modelRequestError.connection') : content;
    const [pending, setPending] = useState(false);
    const inFlight = useRef(false);
    const fire = async () => {
        if (!retry || retry.disabled || inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        try { await retry.onRetry(); }
        finally { inFlight.current = false; setPending(false); }
    };
    return <div role="alert" className="my-2 flex min-w-0 flex-wrap items-start gap-3 rounded-xl bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text-primary)]">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--text-muted)]" />
        <div className="min-w-0 flex-1 basis-40">
            <p className="break-words whitespace-pre-wrap leading-5">{message}</p>
            {message !== content && <details className="mt-2 text-xs text-[var(--text-muted)]">
                <summary className="cursor-pointer">{t('modelRequestError.details')}</summary>
                <pre className="mt-2 break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{content}</pre>
            </details>}
        </div>
        {retry && <div className="flex shrink-0 items-center gap-1">
            <button type="button" disabled={retry.disabled || pending} onClick={() => void fire()}
                aria-label={t('modelRequestError.retryNow')}
                className={`relative isolate flex h-8 ${['en', 'zh', 'zh-TW', 'ja', 'ko'].includes(lang) ? 'w-32' : 'w-52'} items-center justify-center gap-1.5 overflow-hidden rounded-full border border-[var(--border)] px-3 text-sm leading-5 whitespace-nowrap tabular-nums disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]`}>
                {t('modelRequestError.retry')}
            </button>
        </div>}
    </div>;
}
