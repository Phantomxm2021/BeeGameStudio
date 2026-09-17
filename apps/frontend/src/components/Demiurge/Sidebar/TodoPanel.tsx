import { memo } from 'react';
import { ListTodo } from 'lucide-react';
import { TodoList, type TodoItem } from '../../beui/registry/components/agents/todo-list';
import type { ProjectTodo } from '../../../utils/projectTodos';

type TodoPanelProps = {
    items: ProjectTodo[];
};

export const TodoPanel = memo(({ items }: TodoPanelProps) => {
    const todoItems: TodoItem[] = items.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
    }));

    return <div className="h-full min-w-0 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-4">
        {todoItems.length > 0 ? (
            <TodoList
                items={todoItems}
                title="Current tasks"
                open
                collapseOnComplete={false}
                expandToFit
                className="bg-transparent"
            />
        ) : (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center text-[var(--text-muted)]" data-testid="beegame-todo-empty">
                <ListTodo className="h-6 w-6" aria-hidden="true" />
                <p className="type-footnote">No tasks yet</p>
            </div>
        )}
    </div>;
});

TodoPanel.displayName = 'TodoPanel';
