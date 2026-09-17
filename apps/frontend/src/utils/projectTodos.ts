import type { ChatDisplayMessage } from '../viewModels/displayModels';
import { shortenAbsolutePathsForDisplay } from './chatPathDisplay';

export type ProjectTodoStatus = 'pending' | 'in-progress' | 'completed' | 'cancelled';

export type ProjectTodo = {
    id: string;
    title: string;
    status: ProjectTodoStatus;
};

const isTodoTool = (name: unknown): boolean => {
    const normalized = String(name || '').trim().toLowerCase();
    return normalized === 'todowrite' || normalized === 'todo_write';
};

const messageToolName = (message: ChatDisplayMessage): string => {
    if (message.toolName) return message.toolName;
    const lines = String(message.content || '').split('\n').map(line => line.trim()).filter(Boolean);
    const structuredName = lines.find(line => line.startsWith('Tool:'))?.slice('Tool:'.length).trim();
    if (structuredName) return structuredName;
    const firstLine = lines[0] || '';
    if (firstLine.startsWith('Running ')) return firstLine.slice('Running '.length).trim();
    for (const suffix of [' completed', ' failed']) {
        if (firstLine.endsWith(suffix)) return firstLine.slice(0, -suffix.length).trim();
    }
    return '';
};

const normalizeStatus = (status: unknown): ProjectTodoStatus => {
    const normalized = String(status || 'pending').trim().toLowerCase();
    if (normalized === 'in_progress' || normalized === 'in-progress' || normalized === 'running') return 'in-progress';
    if (normalized === 'completed' || normalized === 'complete' || normalized === 'done') return 'completed';
    if (normalized === 'cancelled' || normalized === 'canceled' || normalized === 'blocked') return 'cancelled';
    return 'pending';
};

const parseSnapshot = (input: unknown, messageId: string): ProjectTodo[] | null => {
    if (!input || typeof input !== 'object') return null;
    const todos = (input as { todos?: unknown }).todos;
    if (!Array.isArray(todos)) return null;
    return todos.flatMap((todo, index): ProjectTodo[] => {
        if (!todo || typeof todo !== 'object') return [];
        const record = todo as Record<string, unknown>;
        const title = typeof record.content === 'string'
            ? record.content
            : typeof record.title === 'string'
                ? record.title
                : '';
        if (!title.trim()) return [];
        return [{
            id: typeof record.id === 'string' && record.id ? record.id : `${messageId}-${index}`,
            title: shortenAbsolutePathsForDisplay(title.trim()),
            status: normalizeStatus(record.status),
        }];
    });
};

/** Returns every project task represented by native TodoWrite events. */
export const deriveCurrentProjectTodos = (messages: ChatDisplayMessage[]): ProjectTodo[] => {
    const todos = new Map<string, ProjectTodo>();
    const mergeSnapshot = (snapshot: ProjectTodo[]) => {
        for (const item of snapshot) {
            const existingKey = [...todos.entries()].find(([, current]) => current.title === item.title)?.[0];
            todos.set(existingKey || item.id, { ...item, id: existingKey || item.id });
        }
    };
    for (const message of messages) {
        if (isTodoTool(messageToolName(message))) {
            const snapshot = parseSnapshot(message.toolInput, message.id);
            if (snapshot) mergeSnapshot(snapshot);
        }
        for (const [index, block] of (message.contentBlocks || []).entries()) {
            if (block.type !== 'tool_use' || !isTodoTool(block.toolName)) continue;
            const snapshot = parseSnapshot(block.toolInput, `${message.id}-block-${index}`);
            if (snapshot) mergeSnapshot(snapshot);
        }
    }
    return [...todos.values()];
};
