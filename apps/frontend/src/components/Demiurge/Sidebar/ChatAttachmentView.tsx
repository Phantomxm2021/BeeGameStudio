import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { ChatImage } from './ChatImage';
import type { ChatAttachment } from '../../../services/chatAttachments';
import { authenticatedFetch, buildApiUrl } from '../../../services/apiClient';

export function ChatAttachmentView({ attachment, lang = 'en' }: { attachment: ChatAttachment; lang?: string }) {
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
    if (attachment.type === 'image') return <ChatImage key={url || source} src={url}
        alt={attachment.filename || (lang === 'zh' ? '图片' : 'Image')} lang={lang}
        pending={!url && Boolean(source) && !image.error} error={image.error || (!url && !source)} />;
    return <span className="inline-flex max-w-full items-center gap-2 rounded-lg border border-current/10 px-2 py-1 type-caption-1"
        >
        <FileText className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{attachment.filename || 'Attachment'}</span>
    </span>;
}
