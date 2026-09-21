import type { ChatDisplayMessage } from '../viewModels/displayModels';
import { shortenAbsolutePathsForDisplay } from './chatPathDisplay';

export type ProjectTodoStatus = 'pending' | 'in-progress' | 'completed' | 'cancelled';

export type ProjectTodo = {
    id: string;
    title: string;
    status: ProjectTodoStatus;
    scope?: string;
    stage?: string;
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

type TodoRecord = ProjectTodo & { key: string };
const parseSnapshot = (input: unknown, messageId: string): TodoRecord[] | null => {
    if (!input || typeof input !== 'object') return null;
    const todos = (input as { todos?: unknown }).todos;
    if (!Array.isArray(todos)) return null;
    return todos.flatMap((todo, index): TodoRecord[] => {
        if (!todo || typeof todo !== 'object') return [];
        const record = todo as Record<string, unknown>;
        const title = typeof record.content === 'string'
            ? record.content
            : typeof record.title === 'string'
                ? record.title
                : '';
        if (!title.trim()) return [];
        return [{
            id: `${messageId}-${index}`,
            key: typeof record.id === 'string' && record.id ? record.id : title.trim(),
            title: shortenAbsolutePathsForDisplay(title.trim()),
            status: normalizeStatus(record.status),
        }];
    });
};

/** TodoWrite replaces its execution's list; retain other executions, not stale snapshots. */
export const deriveCurrentProjectTodos = (messages: ChatDisplayMessage[]): ProjectTodo[] => {
    const scopes = new Map<string, ProjectTodo[]>();
    const mergeSnapshot = (snapshot: TodoRecord[], scope: string, message: ChatDisplayMessage) => {
        scopes.set(scope, snapshot.map(item => ({ id: item.id, title: item.title, status: item.status,
                ...(message.todoScope ? { scope: message.todoScope } : {}),
                ...(message.taskKind?.startsWith('workflow_stage:') ? { stage: message.taskKind.slice('workflow_stage:'.length) } : {}),
            })));
    };
    for (const message of [...messages].sort((a, b) =>
        a.sequence !== undefined && b.sequence !== undefined ? a.sequence - b.sequence : a.timestamp - b.timestamp)) {
        const scope = message.todoScope || JSON.stringify([message.taskId || '', message.taskKind || '', message.turnId || '']);
        if (isTodoTool(messageToolName(message))) {
            const snapshot = parseSnapshot(message.toolInput, message.id);
            if (snapshot) mergeSnapshot(snapshot, scope, message);
        }
        for (const [index, block] of (message.contentBlocks || []).entries()) {
            if (block.type !== 'tool_use' || !isTodoTool(block.toolName)) continue;
            const snapshot = parseSnapshot(block.toolInput, `${message.id}-block-${index}`);
            if (snapshot) mergeSnapshot(snapshot, scope, message);
        }
    }
    return [...scopes.values()].flat();
};
