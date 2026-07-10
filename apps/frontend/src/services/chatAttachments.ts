export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENTS = 8;
export const MAX_CHAT_ATTACHMENT_TOTAL_BYTES = 32 * 1024 * 1024;

export type ChatImageAttachmentPayload = {
    type: 'image';
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
    data: string;
    filename?: string;
};

export type ChatFileAttachmentPayload = {
    type: 'file';
    mediaType: string;
    data: string;
    filename: string;
};

export type ChatAttachmentPayload = ChatImageAttachmentPayload | ChatFileAttachmentPayload;

type AllowedAttachmentKind = 'image' | 'file';

type AllowedAttachment = {
    kind: AllowedAttachmentKind;
    mediaTypes: string[];
};

const ALLOWED_ATTACHMENTS: Record<string, AllowedAttachment> = {
    '.png': { kind: 'image', mediaTypes: ['image/png'] },
    '.jpg': { kind: 'image', mediaTypes: ['image/jpeg'] },
    '.jpeg': { kind: 'image', mediaTypes: ['image/jpeg'] },
    '.webp': { kind: 'image', mediaTypes: ['image/webp'] },
    '.pdf': { kind: 'file', mediaTypes: ['application/pdf'] },
    '.doc': { kind: 'file', mediaTypes: ['application/msword'] },
    '.docx': { kind: 'file', mediaTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
    '.txt': { kind: 'file', mediaTypes: ['text/plain'] },
    '.md': { kind: 'file', mediaTypes: ['text/markdown', 'text/plain'] },
    '.csv': { kind: 'file', mediaTypes: ['text/csv', 'application/csv'] },
    '.xls': { kind: 'file', mediaTypes: ['application/vnd.ms-excel'] },
    '.xlsx': { kind: 'file', mediaTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
    '.json': { kind: 'file', mediaTypes: ['application/json', 'text/json'] },
    '.jsonl': { kind: 'file', mediaTypes: ['application/jsonl', 'application/x-ndjson', 'text/jsonl'] },
};

const GENERIC_UNKNOWN_MEDIA_TYPES = new Set(['', 'application/octet-stream']);

export const CHAT_ATTACHMENT_ACCEPT = Object.entries(ALLOWED_ATTACHMENTS)
    .flatMap(([extension, definition]) => [extension, ...definition.mediaTypes])
    .join(',');

const getExtension = (filename: string): string => {
    const lastDot = filename.lastIndexOf('.');
    return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
};

const getAllowedAttachment = (file: File): AllowedAttachment | undefined => {
    const definition = ALLOWED_ATTACHMENTS[getExtension(file.name)];
    if (!definition || file.size > MAX_CHAT_ATTACHMENT_BYTES) return undefined;
    const mediaType = file.type.trim().toLowerCase();
    if (GENERIC_UNKNOWN_MEDIA_TYPES.has(mediaType)) return definition;
    return definition.mediaTypes.includes(mediaType) ? definition : undefined;
};

export const isSupportedChatFile = (file: File): boolean => Boolean(getAllowedAttachment(file));

const fileToChatAttachment = (file: File): Promise<ChatAttachmentPayload | null> => {
    const definition = getAllowedAttachment(file);
    if (!definition) return Promise.resolve(null);

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const commaIndex = result.indexOf(',');
            const data = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
            if (!data) {
                resolve(null);
                return;
            }
            const mediaType = file.type || definition.mediaTypes[0];
            if (definition.kind === 'image') {
                resolve({
                    type: 'image',
                    mediaType: mediaType as ChatImageAttachmentPayload['mediaType'],
                    data,
                    filename: file.name || undefined,
                });
                return;
            }
            resolve({
                type: 'file',
                mediaType,
                data,
                filename: file.name,
            });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
};

export const filesToChatAttachments = async (files: File[]): Promise<ChatAttachmentPayload[]> => {
    const selectedFiles: File[] = [];
    let totalBytes = 0;
    for (const file of files) {
        if (selectedFiles.length >= MAX_CHAT_ATTACHMENTS) break;
        if (totalBytes + file.size > MAX_CHAT_ATTACHMENT_TOTAL_BYTES) break;
        selectedFiles.push(file);
        totalBytes += file.size;
    }
    const attachments = await Promise.all(selectedFiles.map(fileToChatAttachment));
    return attachments.filter((item): item is ChatAttachmentPayload => Boolean(item));
};
