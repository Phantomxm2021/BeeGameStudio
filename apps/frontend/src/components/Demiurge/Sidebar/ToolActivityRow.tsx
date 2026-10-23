import { AlertTriangle, CircleCheck, FileText, ImageIcon, LoaderCircle, Minus, Pencil, Search, SquareTerminal, Wrench, X } from 'lucide-react';
import type { Language } from '../AgentsConfig';
import { activityToolKind, toolActivitySummary } from '../../../utils/toolActivitySummary';

export type ToolActivityState = 'running' | 'completed' | 'failed' | 'stopped' | 'incomplete';

/** Execution metadata only: raw tool payloads stay in the transcript, outside Chat presentation. */
export function ToolActivityRow({ id, name, input, detail = '', state, duration, lang }: {
    id: string; name: string; input?: unknown; detail?: string; state: ToolActivityState; duration?: string; lang: Language;
}) {
    const kind = activityToolKind(name);
    // Legacy shell details can hold the command; arbitrary tool details can be raw JSON.
    const title = toolActivitySummary(name, input, kind === 'bash' ? detail : '', lang === 'zh');
    const labels = lang === 'zh'
        ? { running: '运行中', completed: '完成', failed: '失败', stopped: '已停止', incomplete: '未完成' }
        : { running: 'Running', completed: 'Completed', failed: 'Failed', stopped: 'Stopped', incomplete: 'Incomplete' };
    const Icon = kind === 'image' ? ImageIcon : kind === 'read' ? FileText
        : kind === 'write' || kind === 'edit' ? Pencil : kind === 'search' ? Search
        : kind === 'bash' ? SquareTerminal : Wrench;
    const StateIcon = state === 'running' ? LoaderCircle : state === 'completed' ? CircleCheck
        : state === 'failed' ? X : state === 'incomplete' ? AlertTriangle : Minus;
    return <div role="group" aria-label={title} aria-description={labels[state]}
        data-tool-id={id} data-tool-state={state}
        className="flex min-w-0 items-center gap-2 py-1.5 text-sm text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className={`flex shrink-0 items-center gap-1 text-xs ${state === 'failed' ? 'text-destructive' : ''}`}>
            <StateIcon aria-hidden="true" className={`size-3 ${state === 'running' ? 'motion-safe:animate-spin' : ''}`} />
            {labels[state]}
        </span>
        {duration && <span className="shrink-0 text-xs tabular-nums">{duration}</span>}
    </div>;
}
