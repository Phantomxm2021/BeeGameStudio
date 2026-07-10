import { describe, expect, it } from 'vitest';

import {
    CHAT_ATTACHMENT_ACCEPT,
    filesToChatAttachments,
    isSupportedChatFile,
    MAX_CHAT_ATTACHMENTS,
    MAX_CHAT_ATTACHMENT_TOTAL_BYTES,
    MAX_CHAT_ATTACHMENT_BYTES,
} from './chatAttachments';

describe('chat attachment policy', () => {
    it('exposes an accept list covering all supported extensions and MIME types', () => {
        expect(CHAT_ATTACHMENT_ACCEPT).toContain('.png');
        expect(CHAT_ATTACHMENT_ACCEPT).toContain('image/png');
        expect(CHAT_ATTACHMENT_ACCEPT).toContain('.pdf');
        expect(CHAT_ATTACHMENT_ACCEPT).toContain('application/pdf');
        expect(CHAT_ATTACHMENT_ACCEPT).toContain('.jsonl');
    });

    it('accepts all supported image and document file categories', () => {
        const files = [
            new File(['image'], 'screen.png', { type: 'image/png' }),
            new File(['image'], 'screen.jpg', { type: 'image/jpeg' }),
            new File(['image'], 'screen.jpeg', { type: 'image/jpeg' }),
            new File(['image'], 'screen.webp', { type: 'image/webp' }),
            new File(['document'], 'brief.pdf', { type: 'application/pdf' }),
            new File(['document'], 'outline.doc', { type: 'application/msword' }),
            new File(['document'], 'outline.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
            new File(['notes'], 'notes.txt', { type: 'text/plain' }),
            new File(['notes'], 'notes.md', { type: 'text/markdown' }),
            new File(['records'], 'events.csv', { type: 'text/csv' }),
            new File(['records'], 'sheet.xls', { type: 'application/vnd.ms-excel' }),
            new File(['records'], 'sheet.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
            new File(['{"ok":true}'], 'data.json', { type: 'application/json' }),
            new File(['{"ok":true}\n'], 'events.jsonl', { type: 'application/jsonl' }),
        ];

        expect(files.every(isSupportedChatFile)).toBe(true);
    });

    it('accepts an allowed extension when the browser MIME is empty or generic', () => {
        expect(isSupportedChatFile(new File(['records'], 'events.jsonl'))).toBe(true);
        expect(isSupportedChatFile(new File(['records'], 'events.jsonl', { type: 'application/octet-stream' }))).toBe(true);
    });

    it('rejects GIF, unrelated files, and explicit MIME conflicts', () => {
        expect(isSupportedChatFile(new File(['image'], 'animation.gif', { type: 'image/gif' }))).toBe(false);
        expect(isSupportedChatFile(new File(['image'], 'screen.png', { type: 'application/pdf' }))).toBe(false);
        expect(isSupportedChatFile(new File(['image'], 'screen.png', { type: 'image/gif' }))).toBe(false);
        expect(isSupportedChatFile(new File(['video'], 'clip.mp4', { type: 'video/mp4' }))).toBe(false);
        expect(isSupportedChatFile(new File(['archive'], 'bundle.zip', { type: 'application/zip' }))).toBe(false);
    });

    it('rejects oversized attachments', () => {
        expect(isSupportedChatFile(new File([new Uint8Array(MAX_CHAT_ATTACHMENT_BYTES + 1)], 'large.txt', { type: 'text/plain' }))).toBe(false);
    });

    it('converts files into typed Base64 attachments without including the data URL prefix', async () => {
        const attachments = await filesToChatAttachments([
            new File(['image'], 'screen.png', { type: 'image/png' }),
            new File(['image'], 'screen.webp', { type: 'image/webp' }),
            new File(['{"ok":true}\n'], 'events.jsonl', { type: 'application/jsonl' }),
        ]);

        expect(attachments).toEqual([
            expect.objectContaining({ type: 'image', mediaType: 'image/png', filename: 'screen.png' }),
            expect.objectContaining({ type: 'image', mediaType: 'image/webp', filename: 'screen.webp' }),
            expect.objectContaining({ type: 'file', mediaType: 'application/jsonl', filename: 'events.jsonl' }),
        ]);
        expect(attachments[0]?.data).toBe('aW1hZ2U=');
        expect(attachments[1]?.data).toBe('aW1hZ2U=');
        expect(attachments[2]?.data).toBe('eyJvayI6dHJ1ZX0K');
    });

    it('caps attachment count and aggregate input size before Base64 conversion', async () => {
        const files = Array.from({ length: MAX_CHAT_ATTACHMENTS + 2 }, (_, index) => (
            new File([`file-${index}`], `file-${index}.txt`, { type: 'text/plain' })
        ));
        const attachments = await filesToChatAttachments(files);
        expect(attachments).toHaveLength(MAX_CHAT_ATTACHMENTS);

        const oversized = new File([new Uint8Array(MAX_CHAT_ATTACHMENT_TOTAL_BYTES)], 'large.txt', { type: 'text/plain' });
        expect(await filesToChatAttachments([oversized, new File(['second'], 'second.txt', { type: 'text/plain' })])).toHaveLength(0);
    });
});
