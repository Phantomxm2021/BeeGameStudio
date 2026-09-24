import { memo } from 'react';
import { ListTodo } from 'lucide-react';
import { TodoList, type TodoItem } from '../../beui/registry/components/agents/todo-list';
import type { ProjectTodo } from '../../../utils/projectTodos';
import type { DocumentProgressItem } from '../../../utils/documentProgress';
import { chatStageLabels } from '../../../utils/chatStageLabels';
import type { Language } from '../AgentsConfig';

type TodoPanelProps = {
    items: ProjectTodo[];
    documentProgress?: DocumentProgressItem[];
    lang?: Language;
};

export const TodoPanel = memo(({ items, documentProgress = [], lang = 'en' }: TodoPanelProps) => {
    const groups = new Map<string, { title: string; items: TodoItem[] }>();
    for (const item of items) {
        const key = item.scope || item.stage || 'default';
        let group = groups.get(key);
        if (!group) {
            group = { title: chatStageLabels[item.stage || '']?.[lang === 'zh' ? 'zh' : 'en'] ||
                (lang === 'zh' ? '任务' : 'Tasks'), items: [] };
            groups.set(key, group);
        }
        group.items.push({ id: item.id, title: item.title, status: item.status });
    }

    return <div className="h-full min-w-0 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-4">
        {documentProgress.length > 0 ? <TodoList
            items={documentProgress.map(document => ({
                id: document.path,
                title: document.name,
                status: document.status === 'ready' ? 'completed'
                    : document.status === 'writing' ? 'in-progress'
                        : document.status === 'failed' ? 'cancelled' : 'pending',
            }))}
            title={lang === 'zh' ? '文档交付进度' : 'Document delivery'}
            open
            collapseOnComplete={false}
            expandToFit
            className="mb-4 bg-transparent"
        /> : null}
        {items.length > 0 ? [...groups.entries()].map(([key, group], index) => (
            <TodoList
                key={key}
                items={group.items}
                title={group.title + ([...groups.values()].filter(g => g.title === group.title).length > 1 ? ` · ${index + 1}` : '')}
                open
                collapseOnComplete={false}
                expandToFit
                className="mb-4 bg-transparent"
            />
        )) : documentProgress.length === 0 ? (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center text-[var(--text-muted)]" data-testid="beegame-todo-empty">
                <ListTodo className="h-6 w-6" aria-hidden="true" />
                <p className="type-footnote">{lang === 'zh' ? '暂无任务' : 'No tasks yet'}</p>
            </div>
        ) : null}
    </div>;
});

TodoPanel.displayName = 'TodoPanel';
