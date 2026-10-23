import { describe, expect, it } from 'vitest';
import type { ChatDisplayMessage } from '../viewModels/displayModels';
import { deriveCurrentProjectTodos } from './projectTodos';

describe('deriveCurrentProjectTodos', () => {
    it('replaces the main agent list across turns, including renames and an empty latest list', () => {
        const snapshot = (id: string, turnId: string, timestamp: number, todos: unknown[]): ChatDisplayMessage => ({
            id, taskId: 'session', turnId, timestamp, sender: 'system', content: '', toolName: 'TodoWrite',
            toolInput: { todos },
        });
        const earlier = snapshot('initial', 'turn-6', 1, [
            { content: 'Generate atlas', status: 'in_progress' },
            { content: 'Get font or fallback', status: 'pending' },
        ]);
        const latest = snapshot('finished', 'turn-7', 2, [
            { content: 'Generate atlas', status: 'completed' },
            { content: 'Get font', status: 'completed' },
        ]);
        const items = deriveCurrentProjectTodos([latest, earlier]);
        expect(items.map(item => [item.title, item.status])).toEqual([
            ['Generate atlas', 'completed'], ['Get font', 'completed'],
        ]);
        expect(deriveCurrentProjectTodos([earlier, latest, snapshot('cleared', 'turn-8', 3, [])])).toEqual([]);
    });
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

});
