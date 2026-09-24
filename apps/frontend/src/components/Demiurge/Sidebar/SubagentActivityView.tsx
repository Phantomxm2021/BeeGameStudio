import { memo } from 'react';
import { FileText } from 'lucide-react';
import type { SubagentActivitySnapshot } from '@bee-game-studio/agent-workflow/subagent-activity';
import { AgentCode, type AgentCodeLanguage } from '../../beui/registry/components/agents/agent-code';
import { ToolResult } from '../../beui/registry/components/agents/tool-result';
import { MarkdownRenderer } from './ChatMarkdownContent';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';
import { filterPathsForDisplay } from '../../../utils/chatPathDisplay';
import type { Language } from '../AgentsConfig';

function fileLanguage(path?: string): AgentCodeLanguage {
    const extension = path?.split('.').pop()?.toLowerCase();
    if (extension === 'tsx' || extension === 'jsx') return 'tsx';
    if (['ts', 'js', 'mjs', 'cjs'].includes(extension ?? '')) return 'typescript';
    if (extension === 'json') return 'json';
    if (extension === 'sh' || extension === 'bash') return 'bash';
    return 'text';
}

function SourceOutput({ output, path }: { output: string; path?: string }) {
    const lines = output.replace(/\n$/, '').split('\n');
    // Only remove the Read tool's explicit line-number gutter, not numbers in code.
    const numbered = lines.map(line => /^\s*(\d+)(?:→|\t)(.*)$/.exec(line));
    const hasGutter = numbered.length > 0 && numbered.every(Boolean);
    const language = fileLanguage(path);
    return <div className="flex min-w-0 overflow-x-auto" data-language={language}>
        {hasGutter && <pre aria-hidden="true" className="m-0 shrink-0 select-none border-r border-border pr-3 font-mono text-xs leading-4 text-muted-foreground">
            {numbered.map(line => line![1]).join('\n')}
        </pre>}
        <AgentCode code={hasGutter ? numbered.map(line => line![2]).join('\n') : output} language={language}
            className={hasGutter ? 'overflow-visible pl-3' : 'overflow-visible'} />
    </div>;
}

export const SubagentActivityView = memo(function SubagentActivityView({ activity, legacyTrace, lang, running }: {
    activity?: SubagentActivitySnapshot; legacyTrace?: string; lang: Language; running: boolean;
}) {
    const labels = useBeeGameText(lang).subagentActivity;
    if (!activity) return <div className="space-y-2" data-testid="subagent-legacy-trace">
        <p className="type-caption-1 text-muted-foreground">{labels.legacy}</p>
        <div className="max-h-80 overflow-auto rounded-lg border border-border bg-muted/20 p-3">
            <AgentCode code={filterPathsForDisplay(legacyTrace || '')} language="text" />
        </div>
    </div>;

    return <div className="space-y-3" data-testid="subagent-activity-list">
        {activity.truncated && <p className="type-caption-1 text-muted-foreground">{labels.recent}</p>}
        {activity.entries.map(entry => {
            if (entry.kind === 'message') return <div key={entry.id}>
                <MarkdownRenderer content={filterPathsForDisplay(entry.text)} messageId={entry.id} lang={lang} />
                {entry.truncated && <p className="type-caption-1 text-muted-foreground">{labels.truncated}</p>}
            </div>;
            const isShell = entry.toolName === 'Bash';
            const isRead = entry.toolName === 'Read' && Boolean(entry.filePath) && entry.status !== 'failed';
            const status = entry.status === 'running' ? (running ? 'running' : 'cancelled') : entry.status === 'failed' ? 'error' : 'success';
            return <ToolResult key={entry.id} data-tool-id={entry.id} tool={entry.toolName || labels.output}
                title={entry.filePath ? filterPathsForDisplay(entry.filePath) : filterPathsForDisplay(entry.command?.split('\n')[0].slice(0, 100) || labels.output)}
                icon={entry.filePath ? <FileText className="size-4" /> : undefined}
                kind={isShell ? 'terminal' : 'custom'} status={status} defaultOpen={entry.status === 'failed'}
                collapseOnComplete={false} maxHeight={360} copyText={filterPathsForDisplay(entry.output || entry.command || entry.input || '')}
                className="min-w-0" contentClassName="space-y-3">
                {entry.command && <section aria-label={labels.command}>
                    <p className="mb-2 type-caption-1 text-muted-foreground">{labels.command}</p>
                    <AgentCode code={filterPathsForDisplay(entry.command)} language={isShell ? 'bash' : 'text'} />
                </section>}
                {entry.input && <AgentCode code={filterPathsForDisplay(entry.input)} language="json" />}
                {entry.output !== undefined && <section aria-label={isRead ? labels.file : labels.output}>
                    <p className="mb-2 type-caption-1 text-muted-foreground">{isRead ? labels.file : labels.output}</p>
                    {isRead ? <SourceOutput output={filterPathsForDisplay(entry.output)} path={entry.filePath} /> : <AgentCode code={filterPathsForDisplay(entry.output)} language="text" />}
                </section>}
                {entry.truncated && <p className="type-caption-1 text-muted-foreground">{labels.truncated}</p>}
            </ToolResult>;
        })}
    </div>;
});
