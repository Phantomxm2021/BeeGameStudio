import { describe, expect, it } from 'vitest';
import type { ChatDisplayMessage } from '../viewModels/displayModels';
import { deriveCurrentProjectTodos } from './projectTodos';

describe('deriveCurrentProjectTodos', () => {
    it('returns the latest TodoWrite snapshot', () => {
        const messages: ChatDisplayMessage[] = [
            {
                id: 'first', sender: 'system', content: '', timestamp: 1, type: 'tool', toolName: 'TodoWrite',
                toolInput: { todos: [{ content: 'Old task', status: 'pending' }] },
            },
            {
                id: 'latest', sender: 'system', content: '', timestamp: 2, type: 'tool', toolName: 'TodoWrite',
                toolInput: { todos: [
                    { content: 'Finished', status: 'completed' },
                    { content: 'Edit /Users/dev/game/src/App.tsx', status: 'in_progress' },
                ] },
            },
        ];

        expect(deriveCurrentProjectTodos(messages)).toEqual([
            { id: 'latest-0', title: 'Finished', status: 'completed' },
            { id: 'latest-1', title: 'Edit App.tsx', status: 'in-progress' },
        ]);
    });

    it('reads TodoWrite from assistant content blocks', () => {
        const messages: ChatDisplayMessage[] = [{
            id: 'assistant', sender: 'beegame', content: '', timestamp: 1,
            contentBlocks: [{ type: 'tool_use', toolName: 'todo_write', toolInput: { todos: [{ title: 'Review scene', status: 'running' }] } }],
        }];
        expect(deriveCurrentProjectTodos(messages)).toEqual([
            { id: 'assistant-block-0-0', title: 'Review scene', status: 'in-progress' },
        ]);
    });

    it('recognizes a historical TodoWrite event whose structured tool name was omitted', () => {
        const messages: ChatDisplayMessage[] = [
            {
                id: 'historical', sender: 'system', content: 'TodoWrite completed', timestamp: 1, type: 'tool',
                toolInput: { todos: [{ content: 'Old task', status: 'pending' }] },
            },
            {
                id: 'structured', sender: 'system', content: 'Tool: TodoWrite\nStatus: completed', timestamp: 2, type: 'tool',
                toolInput: { todos: [{ content: 'Recovered task', status: 'pending' }] },
            },
        ];
        expect(deriveCurrentProjectTodos(messages)).toEqual([
            { id: 'structured-0', title: 'Recovered task', status: 'pending' },
        ]);
    });
});
