import { describe, expect, it } from 'vitest';
import type { ChatDisplayMessage } from '../viewModels/displayModels';
import { deriveCurrentProjectTodos } from './projectTodos';

describe('deriveCurrentProjectTodos', () => {
    it('keeps same-named tasks in separate execution scopes and compares paths before display shortening', () => {
        const make = (id: string, scope: string, timestamp: number, content: string, status: string): ChatDisplayMessage => ({
            id, todoScope: scope, sender: 'system', content: 'TodoWrite', timestamp, toolName: 'TodoWrite',
            toolInput: { todos: [{ content, status }] },
        });
        const items = deriveCurrentProjectTodos([
            make('last', 'author', 4, 'Review', 'completed'),
            make('a', 'author', 1, 'Review', 'pending'),
            make('b', 'reviewer', 2, 'Review', 'in_progress'),
            make('c', 'author', 3, 'Edit /Users/a/index.ts', 'pending'),
            make('d', 'author', 5, 'Edit /Users/b/index.ts', 'pending'),
        ]);
        expect(items.map(t => [t.title, t.status])).toEqual([
            ['Edit index.ts', 'pending'], ['Review', 'in-progress'],
        ]);
        expect(new Set(items.map(t => t.id)).size).toBe(2);
    });
    it('replaces a scope snapshot instead of retaining renamed or removed tasks', () => {
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
