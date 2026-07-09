import { describe, expect, it } from 'vitest';

import {
    filesToChatAttachments,
    isSupportedChatFile,
    MAX_CHAT_ATTACHMENT_BYTES,
} from './chatAttachments';

describe('chat attachment policy', () => {
    it('accepts the supported image and document formats', () => {
        const files = [
            new File(['image'], 'screen.png', { type: 'image/png' }),
            new File(['document'], 'brief.pdf', { type: 'application/pdf' }),
            new File(['records'], 'events.jsonl', { type: 'application/jsonl' }),
        ];

        expect(files.every(isSupportedChatFile)).toBe(true);
    });

    it('rejects GIF and unrelated file formats', () => {
        expect(isSupportedChatFile(new File(['image'], 'animation.gif', { type: 'image/gif' }))).toBe(false);
        expect(isSupportedChatFile(new File(['video'], 'clip.mp4', { type: 'video/mp4' }))).toBe(false);
        expect(isSupportedChatFile(new File(['archive'], 'bundle.zip', { type: 'application/zip' }))).toBe(false);
    });

    it('accepts an allowed extension when the browser reports an empty MIME type', () => {
        expect(isSupportedChatFile(new File(['records'], 'events.jsonl'))).toBe(true);
    });

    it('rejects a conflicting MIME type and oversized file', () => {
        expect(isSupportedChatFile(new File(['image'], 'screen.png', { type: 'application/pdf' }))).toBe(false);
        expect(isSupportedChatFile(new File([new Uint8Array(MAX_CHAT_ATTACHMENT_BYTES + 1)], 'large.txt', { type: 'text/plain' }))).toBe(false);
    });

    it('converts images and documents into typed Base64 attachments', async () => {
        const attachments = await filesToChatAttachments([
            new File(['image'], 'screen.webp', { type: 'image/webp' }),
            new File(['{"ok":true}\n'], 'events.jsonl', { type: 'application/jsonl' }),
        ]);

        expect(attachments).toEqual([
            expect.objectContaining({ type: 'image', mediaType: 'image/webp', filename: 'screen.webp' }),
            expect.objectContaining({ type: 'file', mediaType: 'application/jsonl', filename: 'events.jsonl' }),
        ]);
        expect(attachments[0]?.data).toBeTruthy();
        expect(attachments[1]?.data).toBeTruthy();
    });
});
