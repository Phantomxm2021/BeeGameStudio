import { memo } from 'react';
import { ToolActivityRow } from './ToolActivityRow';
import type { SubagentActivitySnapshot } from '@bee-game-studio/agent-workflow/subagent-activity';
import { MarkdownRenderer } from './ChatMarkdownContent';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';
import { filterPathsForDisplay } from '../../../utils/chatPathDisplay';
import type { Language } from '../AgentsConfig';

export const SubagentActivityView = memo(function SubagentActivityView({ activity, lang, running }: {
    activity?: SubagentActivitySnapshot; lang: Language; running: boolean;
}) {
    const labels = useBeeGameText(lang).subagentActivity;
    if (!activity) return null;

    return <div className="space-y-3" data-testid="subagent-activity-list">
        {activity.truncated && <p className="type-caption-1 text-muted-foreground">{labels.recent}</p>}
        {activity.entries.map(entry => {
            if (entry.kind === 'permission') {
                const status = entry.status === 'pending' && !running ? 'incomplete' : entry.status;
                return <section key={entry.id} data-permission-id={entry.id} data-permission-status={status}
                    className="rounded-lg border border-border p-3 space-y-1.5">
                    <p className="type-caption-1 text-muted-foreground">{entry.toolName} · {labels[status]}</p>
                    <MarkdownRenderer content={filterPathsForDisplay(entry.message)} messageId={entry.id} lang={lang} />
                </section>;
            }
            if (entry.kind === 'message') return null;
            const state = entry.status === 'running' ? (running ? 'running' : 'incomplete')
                : entry.status === 'cancelled' ? 'stopped' : entry.status;
            return <ToolActivityRow key={entry.id} id={entry.id} name={entry.toolName}
                input={{ command: entry.command, file_path: entry.filePath }} state={state} lang={lang}
                duration={entry.elapsedTimeSeconds === undefined ? undefined : `${entry.elapsedTimeSeconds}s`} />;
        })}
    </div>;
});
