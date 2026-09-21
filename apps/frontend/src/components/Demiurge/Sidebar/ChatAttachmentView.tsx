import { useEffect, useState } from 'react';
import { FileText, ImageOff, LoaderCircle } from 'lucide-react';
import type { ChatAttachment } from '../../../services/chatAttachments';
import { authenticatedFetch, buildApiUrl } from '../../../services/apiClient';

export function ChatAttachmentView({ attachment }: { attachment: ChatAttachment }) {
    const [image, setImage] = useState<{ url?: string; error?: boolean }>({});
    const reference = 'storageId' in attachment ? attachment : undefined;
    const source = reference ? buildApiUrl(`/api/projects/${encodeURIComponent(reference.projectId)}/chat-attachments/${encodeURIComponent(reference.storageId)}`) : undefined;
    useEffect(() => {
        setImage({});
        if (attachment.type !== 'image' || !source) return;
        const controller = new AbortController();
        let objectUrl: string | undefined;
        void (async () => {
            try {
                const response = await authenticatedFetch(source, { signal: controller.signal });
                if (!response.ok) throw new Error('Attachment unavailable');
                const blob = await response.blob();
                if (controller.signal.aborted) return;
                objectUrl = URL.createObjectURL(blob);
                setImage({ url: objectUrl });
            } catch {
                if (!controller.signal.aborted) setImage({ error: true });
            }
        })();
        return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [source, attachment.type]);
    const url = attachment.data ? `data:${attachment.mediaType};base64,${attachment.data}` : image.url;
    if (attachment.type === 'image' && url && !image.error) return <img src={url}
        alt={attachment.filename || 'Image'} loading="lazy" decoding="async"
        onError={() => setImage({ error: true })}
        className="max-h-48 max-w-full rounded-lg object-contain" />;
    const pending = attachment.type === 'image' && Boolean(source) && !image.error;
    const Icon = pending ? LoaderCircle : attachment.type === 'image' ? ImageOff : FileText;
    return <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-current/10 px-2 py-1 type-caption-1"
        aria-busy={pending}>
        <Icon className={`size-4 shrink-0${pending ? ' animate-spin' : ''}`} aria-hidden="true" />
        <span className="truncate">{attachment.filename || 'Attachment'}</span>
    </span>;
}
