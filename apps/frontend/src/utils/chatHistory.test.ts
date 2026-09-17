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

    it('preserves file write diff fields from persisted tool history', () => {
        const messages = normalizeChatHistory([
            {
                id: 'write-1',
                message_id: 'write-1',
                sender: 'beegame',
                content: 'Write completed: src/StartScreen.tsx',
                type: 'tool_result',
                tool_name: 'Write',
                tool_use_id: 'tool-write-1',
                tool_diff: '--- a/src/StartScreen.tsx\n+++ b/src/StartScreen.tsx\n@@\n-old\n+new',
                structured_patch: { files: ['src/StartScreen.tsx'] },
                tool_input: { file_path: 'src/StartScreen.tsx', content: 'new' },
                timestamp: '2026-06-21T00:00:00Z',
            },
        ]);

        expect(messages[0]).toMatchObject({
            toolName: 'Write',
            toolDiff: '--- a/src/StartScreen.tsx\n+++ b/src/StartScreen.tsx\n@@\n-old\n+new',
            toolStructuredPatch: { files: ['src/StartScreen.tsx'] },
            toolInput: { file_path: 'src/StartScreen.tsx', content: 'new' },
        });
    });

    it('preserves completed tool presentation metadata from persisted history', () => {
        const messages = normalizeChatHistory([{
            id: 'read-complete',
            sender: 'system',
            content: 'Read completed',
            type: 'tool',
            tool_name: 'Read',
            tool_status: 'completed',
            tool_detail: 'docs/GDD.md',
            tool_output: 'done',
            timestamp: 1,
        }]);

        expect(messages[0]).toMatchObject({
            toolName: 'Read',
            toolStatus: 'completed',
            toolDetail: 'docs/GDD.md',
            toolOutput: 'done',
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

    it('preserves source order inside a turn when replay timestamps are reversed', () => {
        const messages = normalizeChatHistory([
            { id: 'thought-1', sender: 'beegame', content: 'Thinking', type: 'thought', turnId: 'turn-replay', timestamp: 300 },
            { id: 'tool-1', sender: 'system', content: 'Read completed', type: 'tool', turnId: 'turn-replay', timestamp: 100 },
            { id: 'agent-1', sender: 'agent', content: 'Final response', turnId: 'turn-replay', timestamp: 200 },
        ]);

        expect(messages.map((message) => message.id)).toEqual(['thought-1', 'tool-1', 'agent-1']);
        expect(messages.every((message) => message.turnId === 'turn-replay')).toBe(true);
    });

    it('preserves the persisted thinking duration for the Chat activity', () => {
        const messages = normalizeChatHistory([
            {
                id: 'thought-duration',
                sender: 'beegame',
                content: 'Checking references.',
                type: 'thought',
                timestamp: 300,
                thinking_duration_ms: 379_000,
            },
        ]);

        expect(messages[0].thinkingDurationMs).toBe(379_000);
    });

    it('preserves adapter-normalized camelCase tool block fields', () => {
        const messages = normalizeChatHistory([{
            id: 'assistant-tool',
            sender: 'beegame',
            content: '',
            type: 'text',
            timestamp: 1,
            contentBlocks: [{
                type: 'tool_use',
                toolUseId: 'tool-canonical-1',
                toolName: 'Write',
                toolInput: { file_path: 'docs/checklist.md' },
            }],
        }]);

        expect(messages[0].contentBlocks?.[0]).toMatchObject({
            type: 'tool_use',
            toolUseId: 'tool-canonical-1',
            toolName: 'Write',
            toolInput: { file_path: 'docs/checklist.md' },
        });
    });
});
