import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { ToolResult, ToolResultOutput } from '@/components/beui/registry/components/agents/tool-result';
import { FileText, ImageIcon, Pencil, Search, SquareTerminal, Wrench } from 'lucide-react';
import type { Language } from '../AgentsConfig';
import { activityToolKind, toolActivitySummary } from '../../../utils/toolActivitySummary';
import { filterPathsForDisplay } from '../../../utils/chatPathDisplay';
import { redactImageConfigurationForDisplay } from '../../../utils/imageConfigurationDisplay';

export type ToolActivityState = 'running' | 'completed' | 'failed' | 'stopped' | 'incomplete';

// Bound automatic layout work; the complete result remains available to copy.
const OUTPUT_PREVIEW_CHARACTERS = 12_000;
const formatOutput = (output: string) => filterPathsForDisplay(redactImageConfigurationForDisplay(output));

export const ToolActivityRow = memo(function ToolActivityRow({ id, name, input, detail = '', output = '', children, state, duration, lang }: {
    id: string; name: string; input?: unknown; detail?: string; output?: string; children?: ReactNode;
    state: ToolActivityState; duration?: string; lang: Language;
}) {
    const kind = activityToolKind(name);
    const title = toolActivitySummary(name, input, kind === 'bash' ? detail : '', lang === 'zh');
    const labels = lang === 'zh'
        ? { running: '运行中', completed: '完成', failed: '失败', stopped: '已停止', incomplete: '未完成' }
        : { running: 'Running', completed: 'Completed', failed: 'Failed', stopped: 'Stopped', incomplete: 'Incomplete' };
    const Icon = kind === 'image' ? ImageIcon : kind === 'read' ? FileText
        : kind === 'write' || kind === 'edit' ? Pencil : kind === 'search' ? Search
        : kind === 'bash' ? SquareTerminal : Wrench;
    const [open, setOpen] = useState(state === 'running');
    const [previewCharacters, setPreviewCharacters] = useState(OUTPUT_PREVIEW_CHARACTERS);
    const truncated = output.length > previewCharacters;
    const visibleOutput = useMemo(() => {
        if (!open) return '';
        const half = Math.floor(previewCharacters / 2);
        return formatOutput(output.length > previewCharacters
            ? `${output.slice(0, half)}\n…\n${output.slice(-half)}` : output);
    }, [open, output, previewCharacters]);
    const copyOutput = useCallback(() => navigator.clipboard.writeText(formatOutput(output)), [output]);
    return <div role="group" aria-label={title} aria-description={labels[state]}
        data-tool-id={id} data-tool-state={state} className="min-w-0">
        <ToolResult tool={name === title ? null : name} title={title}
            kind={kind === 'bash' ? 'terminal' : 'custom'} icon={<Icon className="size-3.5" />}
            status={state === 'running' ? 'running' : state === 'completed' ? 'success' : state === 'failed' ? 'error' : 'cancelled'}
            statusLabel={labels[state]} open={open} onOpenChange={setOpen}
            collapseOnComplete={state === 'completed' || state === 'failed'}
            meta={duration ? <span className="tabular-nums">{duration}</span> : undefined}
            onCopy={output ? copyOutput : undefined}
            copyLabels={lang === 'zh' ? { copy: '复制结果', copied: '已复制', failed: '复制失败' } : undefined}>
            {visibleOutput ? <ToolResultOutput language="text">{visibleOutput}</ToolResultOutput>
                : !children && <p className="text-xs text-muted-foreground">{state === 'running'
                    ? (lang === 'zh' ? '等待工具输出…' : 'Waiting for tool output…')
                    : (lang === 'zh' ? '此工具没有返回文本结果。' : 'This tool returned no text output.')}</p>}
            {truncated && <div className="mt-2 text-xs text-muted-foreground">
                <p>{lang === 'zh' ? '当前显示部分输出；复制结果可获取全文。' : 'Showing partial output. Copy result for the full text.'}</p>
                <button type="button" className="mt-1 underline underline-offset-2"
                    onClick={() => setPreviewCharacters(size => size + OUTPUT_PREVIEW_CHARACTERS)}>
                    {lang === 'zh' ? '显示更多输出' : 'Show more output'}
                </button>
            </div>}
            {children}
        </ToolResult>
    </div>;
});
