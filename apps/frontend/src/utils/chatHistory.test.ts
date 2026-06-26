import { describe, expect, it } from 'vitest';
import { normalizeChatHistory } from './chatHistory';

describe('normalizeChatHistory semantic metadata', () => {
    it('maps render and artifact metadata into frontend messages', () => {
        const messages = normalizeChatHistory([
            {
                id: 'msg-1',
                sender: 'logos',
                content: '已生成产物：FrozenBrief.md',
                message_type: 'artifact_card',
                artifact_id: 'art-1',
                timestamp: 1710000000,
                metadata: {
                    render_hint: 'artifact_card',
                    artifact_type: 'GDD',
                    next_action: 'preview_artifact',
                    requires_user_action: false,
                },
            },
        ]);

        expect(messages).toHaveLength(1);
        expect(messages[0].renderHint).toBe('artifact_card');
        expect(messages[0].artifactType).toBe('GDD');
        expect(messages[0].nextAction).toBe('preview_artifact');
        expect(messages[0].requiresUserAction).toBe(false);
    });

    it('maps backend synthesized artifact-card history into previewable messages', () => {
        const messages = normalizeChatHistory([
            {
                id: 'artifact-art-1',
                message_id: 'artifact-art-1',
                sender: 'metis',
                content: 'Artifact created: GDD.md',
                type: 'artifact_card',
                artifact_id: 'art-1',
                artifact_type: 'gdd',
                document_title: 'GDD.md',
                task_kind: 'artifact_created',
                timestamp: '2026-04-26T10:00:00Z',
            },
        ]);

        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
            id: 'artifact-art-1',
            messageId: 'artifact-art-1',
            sender: 'metis',
            type: 'artifact_card',
            artifactId: 'art-1',
            artifactType: 'gdd',
            documentTitle: 'GDD.md',
            taskKind: 'artifact_created',
        });
    });

    it('preserves camelCase action metadata from adapter history replay', () => {
        const messages = normalizeChatHistory([
            {
                id: 'failed-check-1',
                message_id: 'failed-check-1',
                sender: 'system',
                content: 'Last check failed.\nCommand: game-engine build\nOutput: Exit code 1',
                type: 'text',
                taskKind: 'last_check_failed',
                nextAction: 'continue_from_last_failed_check',
                requiresUserAction: true,
                timestamp: '2026-06-21T00:00:00Z',
            },
        ]);

        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
            taskKind: 'last_check_failed',
            nextAction: 'continue_from_last_failed_check',
            requiresUserAction: true,
        });
    });

    it('keeps backend message ids and deduplicates optimistic user history by client identity', () => {
        const messages = normalizeChatHistory([
            {
                id: 'msg_backend_1',
                role: 'user',
                content: 'hello',
                task_id: 'task-1',
                timestamp: '2026-03-26T10:00:00Z',
                metadata: {
                    client_message_id: 'client-msg-1',
                },
            },
            {
                id: 'msg_backend_1',
                role: 'user',
                content: 'hello',
                task_id: 'task-1',
                timestamp: '2026-03-26T10:00:00Z',
                metadata: {
                    client_message_id: 'client-msg-1',
                },
            },
        ]);

        expect(messages).toHaveLength(1);
        expect(messages[0].id).toBe('msg_backend_1');
        expect(messages[0].messageId).toBe('msg_backend_1');
        expect(messages[0].clientMessageId).toBe('client-msg-1');
        expect(messages[0].dedupeKey).toBeTruthy();
    });
});
