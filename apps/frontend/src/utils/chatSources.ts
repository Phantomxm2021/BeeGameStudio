import type { Message } from '../types/message';

/** Keep source metadata across transport/history; only web URLs are clickable. */
export function normalizeChatSources(value: unknown): Message['sources'] {
    if (!Array.isArray(value)) return undefined;
    const sources = value.flatMap((entry): NonNullable<Message['sources']> => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const record = entry as Record<string, unknown>;
        const url = typeof record.url === 'string' && /^https?:\/\//i.test(record.url.trim()) ? record.url.trim() : undefined;
        const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : url;
        if (!title) return [];
        return [{
            title, ...(url ? { url } : {}),
            ...(typeof record.id === 'string' ? { id: record.id } : {}),
            ...(typeof record.domain === 'string' ? { domain: record.domain } : {}),
        }];
    });
    return sources.length ? sources : undefined;
}
