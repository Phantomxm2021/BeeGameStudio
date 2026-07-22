import { memo, useEffect, useMemo, useState } from 'react';
import {
    ChevronDown,
    ChevronRight,
    LoaderCircle,
    Pencil,
} from 'lucide-react';
import type { ChatDisplayMessage, ProjectRuntimeDisplayModel } from '../../../viewModels/displayModels';
import { MarkdownRenderer } from './ChatComponents';
import type { Language } from '../AgentsConfig';
import { useBeeGameText, type BeeGameText } from '../../../i18n/useBeeGameTranslations';
import { MessageScrollerItem } from '../../ui/message-scroller';
import { Marker, MarkerContent, MarkerIcon } from '../../ui/marker';

type BeeGameCollaborationFeedProps = {
    messages: ChatDisplayMessage[];
    projectStatus?: ProjectRuntimeDisplayModel | null;
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
    lang?: Language;
    currentUserDisplayName?: string;
    currentUserEmail?: string;
    currentUserAvatarUrl?: string;
    onEditMessage?: (message: ChatDisplayMessage) => void;
};

const RUNTIME_ACTIVITY_MESSAGE_TIMESTAMP = 0;

type ToolFeedMessage = ChatDisplayMessage & {
    tool?: string;
    toolName?: string;
    tool_status?: string;
    toolStatus?: string;
    tool_detail?: string;
    toolDetail?: string;
    tool_output?: string;
    toolOutput?: string;
    artifact_id?: string;
};

type NormalizedTool = {
    id: string;
    name: string;
    status: 'running' | 'completed' | 'failed';
    detail: string;
    output: string;
    artifactId?: string;
    kind: ToolKind;
};

type ToolKind = 'search' | 'read' | 'write' | 'edit' | 'bash' | 'subagent' | 'generic';

const GENERIC_TOOL_NAME = 'Tool';

const isToolMessage = (message: ChatDisplayMessage): message is ToolFeedMessage => {
    const raw = message as ToolFeedMessage;
    return message.type === 'tool' || Boolean(raw.tool || raw.toolName || raw.tool_status || raw.toolStatus || raw.tool_detail || raw.toolDetail);
};

const isAgentMessage = (message: ChatDisplayMessage): boolean => {
    return message.sender === 'beegame' || message.sender === 'agent';
};

const isThinkingMessage = (message: ChatDisplayMessage): boolean => {
    const raw = message as ChatDisplayMessage & { task_kind?: string };
    return message.type === 'thought' || message.taskKind === 'assistant_thinking' || raw.task_kind === 'assistant_thinking';
};

const isContextUpdateMessage = (message: ChatDisplayMessage): boolean => {
    const raw = message as ChatDisplayMessage & { task_kind?: string };
    return message.taskKind === 'context_update' || raw.task_kind === 'context_update';
};

const getStructuredLineValue = (content: string, label: string): string => {
    const prefix = `${label}:`;
    const line = content
        .split('\n')
        .map((item) => item.trim())
        .find((item) => item.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : '';
};

const getStatusFromText = (value: string): NormalizedTool['status'] | '' => {
    const lower = value.trim().toLowerCase();
    if (lower === 'completed' || lower.endsWith(' completed')) return 'completed';
    if (lower === 'failed' || lower.endsWith(' failed')) return 'failed';
    if (lower === 'running' || lower.startsWith('running ')) return 'running';
    return '';
};

const getToolNameFromTitle = (value: string): string => {
    const text = value.trim();
    for (const suffix of [' completed', ' failed']) {
        if (text.endsWith(suffix)) return text.slice(0, -suffix.length).trim();
    }
    if (text.startsWith('Running ')) return text.slice('Running '.length).trim();
    return '';
};

const stripStructuredDetailLabel = (value: string): string => {
    for (const label of ['Target:', 'Command:', 'Prompt:', 'Type:']) {
        if (value.startsWith(label)) return value.slice(label.length).trim();
    }
    return value;
};

const getToolKind = (toolName?: string): ToolKind => {
    const normalized = String(toolName || '').trim().toLowerCase();
    if (normalized === 'search' || normalized === 'grep' || normalized === 'glob') return 'search';
    if (normalized === 'read') return 'read';
    if (normalized === 'write') return 'write';
    if (normalized === 'edit' || normalized === 'multiedit') return 'edit';
    if (normalized === 'bash') return 'bash';
    if (normalized === 'task' || normalized === 'subagent') return 'subagent';
    return 'generic';
};

const normalizeToolMessage = (message: ToolFeedMessage): NormalizedTool | null => {
    const content = String(message.content || '');
    const firstLine = content.split('\n').map((item) => item.trim()).find(Boolean) || '';
    const structuredTool = getStructuredLineValue(content, 'Tool');
    const titleTool = getToolNameFromTitle(firstLine);
    const rawName = String(message.toolName || message.tool || structuredTool || titleTool || '').trim();
    const name = rawName && rawName !== GENERIC_TOOL_NAME ? rawName : titleTool || structuredTool || GENERIC_TOOL_NAME;
    const rawStatus = String(message.toolStatus || message.tool_status || getStructuredLineValue(content, 'Status') || '').trim();
    const status = getStatusFromText(rawStatus) || getStatusFromText(firstLine) || 'running';
    const structuredDetail = getStructuredLineValue(content, 'Target') || getStructuredLineValue(content, 'Command') || getStructuredLineValue(content, 'Prompt');
    const rawDetail = String(message.toolDetail || message.tool_detail || structuredDetail || '').trim();
    const output = String(message.toolOutput || message.tool_output || getStructuredLineValue(content, 'Output') || '').trim();
    if (!name && !rawDetail && !output) return null;
    return {
        id: message.id,
        name,
        status,
        detail: stripStructuredDetailLabel(rawDetail),
        output,
        artifactId: String(message.artifactId || message.artifact_id || '').trim() || undefined,
        kind: getToolKind(name),
    };
};

const getToolStatusLabel = (status: NormalizedTool['status'], text: BeeGameText): string => {
    if (status === 'completed') return text.toolCompleted;
    if (status === 'failed') return text.toolFailed;
    return text.toolRunning;
};

const getToolTitle = (tool: NormalizedTool, text: BeeGameText): string => {
    if (isEditableTool(tool) && tool.detail) {
        return `Write ${getPathFileName(tool.detail)}`;
    }
    if (tool.kind === 'read' && tool.detail) {
        return `Read ${getPathFileName(tool.detail)}`;
    }
    if (tool.kind === 'search') return text.toolSearchCompleted;
    return `${tool.name} ${getToolStatusLabel(tool.status, text)}`;
};

const isEditableTool = (tool: NormalizedTool): boolean => tool.kind === 'write' || tool.kind === 'edit';

const getPathFileName = (value: string): string => {
    const normalized = value.replaceAll('\\', '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || value;
};

type FeedEntry =
    | { kind: 'user'; message: ChatDisplayMessage }
    | { kind: 'thinking'; message: ChatDisplayMessage }
    | { kind: 'context'; message: ChatDisplayMessage }
    | { kind: 'agent'; message: ChatDisplayMessage; tools: NormalizedTool[] }
    | { kind: 'tools'; id: string; tools: NormalizedTool[] };

const buildFeedEntries = (messages: ChatDisplayMessage[]): FeedEntry[] => {
    const entries: FeedEntry[] = [];

    for (const message of messages) {
        if (message.sender === 'user') {
            entries.push({ kind: 'user', message });
            continue;
        }

        if (isThinkingMessage(message)) {
            entries.push({ kind: 'thinking', message });
            continue;
        }

        if (isContextUpdateMessage(message)) {
            entries.push({ kind: 'context', message });
            continue;
        }

        if (isToolMessage(message)) {
            const tool = normalizeToolMessage(message);
            if (!tool) continue;
            const latest = entries[entries.length - 1];
            if (latest?.kind === 'agent') {
                latest.tools.push(tool);
                continue;
            }
            if (latest?.kind === 'tools') {
                latest.tools.push(tool);
                continue;
            }
            entries.push({ kind: 'tools', id: `tools-${tool.id}`, tools: [tool] });
            continue;
        }

        if (isAgentMessage(message)) {
            entries.push({ kind: 'agent', message, tools: [] });
        }
    }

    return entries;
};

export const BeeGameCollaborationFeed = memo(({
    messages,
    projectStatus,
    lang = 'en',
    onEditMessage,
}: BeeGameCollaborationFeedProps) => {
    const entries = useMemo(() => buildFeedEntries(messages), [messages]);
    const text = useBeeGameText(lang);
    const hasThinkingEntry = entries.some((entry) => entry.kind === 'thinking');
    const showRuntimeActivity = projectStatus?.phase === 'running' && !hasThinkingEntry;

    return (
        <>
            {entries.map((entry) => (
                entry.kind === 'user' ? (
                    <MessageScrollerItem
                        key={entry.message.id}
                        messageId={entry.message.id}
                        className="relative z-10 mb-4 pl-12"
                    >
                        <UserMessageCard
                            message={entry.message}
                            lang={lang}
                            onEdit={onEditMessage}
                        />
                    </MessageScrollerItem>
                ) : entry.kind === 'thinking' ? (
                    <MessageScrollerItem
                        key={entry.message.id}
                        messageId={entry.message.id}
                        className="relative z-10 mb-4 pl-12"
                    >
                        <ThinkingStatusCard
                            message={entry.message}
                            text={text}
                            isRunning={projectStatus?.phase === 'running'}
                        />
                    </MessageScrollerItem>
                ) : entry.kind === 'context' ? (
                    <MessageScrollerItem
                        key={entry.message.id}
                        messageId={entry.message.id}
                        className="relative z-10 mb-4 pl-12"
                    >
                        <ContextUpdateSeparator text={text} />
                    </MessageScrollerItem>
                ) : entry.kind === 'agent' ? (
                    <MessageScrollerItem
                        key={entry.message.id}
                        messageId={entry.message.id}
                        className="relative z-10 mb-4 pl-12"
                    >
                        <AgentFeedGroup
                            message={entry.message}
                            tools={entry.tools}
                            text={text}
                            lang={lang}
                        />
                    </MessageScrollerItem>
                ) : (
                    <MessageScrollerItem
                        key={entry.id}
                        messageId={entry.id}
                        className="relative z-10 mb-4 pl-12"
                    >
                        <ToolGroup tools={entry.tools} text={text} lang={lang} />
                    </MessageScrollerItem>
                )
            ))}
            {showRuntimeActivity ? (
                <MessageScrollerItem
                    messageId="beegame-runtime-activity"
                    className="relative z-10 mb-4 pl-12"
                >
                    <ThinkingStatusCard
                        message={{
                            id: 'beegame-runtime-activity',
                            sender: 'system',
                            content: text.thinkingActive,
                            timestamp: RUNTIME_ACTIVITY_MESSAGE_TIMESTAMP,
                            type: 'thought',
                            taskKind: 'assistant_thinking',
                        }}
                        text={text}
                        isRunning
                    />
                </MessageScrollerItem>
            ) : null}
        </>
    );
});

BeeGameCollaborationFeed.displayName = 'BeeGameCollaborationFeed';

function ThinkingStatusCard({
    message,
    text,
    isRunning,
}: {
    message: ChatDisplayMessage;
    text: BeeGameText;
    isRunning: boolean;
}) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!isRunning) return undefined;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [isRunning]);

    const elapsedMs = Math.max(0, now - Number(message.timestamp || now));
    const isStalled = isRunning && elapsedMs >= 60000;
    const label = isStalled ? text.thinkingStalled : text.thinkingActive;

    return (
        <section
            data-testid={`beegame-thinking-message-${message.id}`}
            className="glass-control inline-flex max-w-full items-center gap-2 rounded-2xl px-3 py-2 text-zinc-400 shadow-sm backdrop-blur-2xl"
        >
            <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-500" />
            <span className="shimmer type-footnote min-w-0 truncate text-muted-foreground">{label}</span>
        </section>
    );
}

function ContextUpdateSeparator({ text }: { text: BeeGameText }) {
    return (
        <Marker
            data-testid="beegame-context-separator"
            variant="separator"
            className="type-muted py-2 text-muted-foreground"
        >
            <MarkerContent className="shrink-0 text-center">
                {text.contextCompacted}
            </MarkerContent>
        </Marker>
    );
}

function UserMessageCard({
    message,
    lang,
    onEdit,
}: {
    message: ChatDisplayMessage;
    lang: Language;
    onEdit?: (message: ChatDisplayMessage) => void;
}) {
    return (
        <section
            data-testid={`beegame-user-message-${message.id}`}
            className="w-full max-w-[46rem] rounded-3xl border border-emerald-300/15 bg-emerald-300/[0.055] px-4 py-3 text-zinc-100 shadow-sm shadow-emerald-950/10 backdrop-blur-2xl"
        >
            <div className="group/message relative">
                <MarkdownRenderer
                    content={message.content}
                    isUser
                    messageId={message.id}
                    lang={lang}
                />
                {onEdit ? (
                    <button
                        type="button"
                        aria-label="Edit message"
                        title="Edit message"
                        onClick={() => onEdit(message)}
                        className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-zinc-950/90 text-zinc-400 opacity-0 shadow-lg transition-opacity hover:text-zinc-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70 group-hover/message:opacity-100"
                    >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                ) : null}
            </div>
        </section>
    );
}

function AgentFeedGroup({
    message,
    tools,
    text,
    lang,
}: {
    message: ChatDisplayMessage;
    tools: NormalizedTool[];
    text: BeeGameText;
    lang: Language;
}) {
    return (
        <div
            data-testid={`beegame-agent-feed-group-${message.id}`}
            className="max-w-[46rem]"
        >
            <AgentResponseBlock
                message={message}
                lang={lang}
            />
            {tools.length > 0 ? (
                <ToolGroup tools={tools} text={text} lang={lang} />
            ) : null}
        </div>
    );
}

function AgentResponseBlock({
    message,
    lang,
}: {
    message: ChatDisplayMessage;
    lang: Language;
}) {
    return (
        <section data-testid={`beegame-agent-message-${message.id}`} className="beegame-ai-prose w-full px-0 py-0 text-zinc-100">
            <MarkdownRenderer
                content={message.content}
                isUser={false}
                messageId={message.id}
                lang={lang}
            />
        </section>
    );
}

function ToolGroup({
    tools,
    text,
    lang,
}: {
    tools: NormalizedTool[];
    text: BeeGameText;
    lang: Language;
}) {
    const shouldCollapseGroup = tools.length > 1;
    const [isExpanded, setIsExpanded] = useState(!shouldCollapseGroup);
    const summary = getToolGroupSummary(tools, lang);

    return (
        <div className="relative mt-2 max-w-full" data-testid="beegame-tool-group">
            {shouldCollapseGroup ? (
                <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setIsExpanded((value) => !value)}
                    className="group inline-flex max-w-full rounded-xl px-0 py-0.5 text-left text-muted-foreground transition-colors hover:text-zinc-400"
                >
                    <Marker className="type-muted min-h-6 text-muted-foreground group-hover:text-zinc-400">
                        <MarkerIcon>
                            <StatusDot status={getToolGroupStatus(tools)} />
                        </MarkerIcon>
                        <MarkerContent className="truncate">{summary}</MarkerContent>
                        {isExpanded ? (
                            <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-zinc-600 group-hover:text-zinc-400" />
                        ) : (
                            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-zinc-600 group-hover:text-zinc-400" />
                        )}
                    </Marker>
                </button>
            ) : null}
            {isExpanded ? (
                <div
                    data-testid="beegame-tool-list"
                    className={`${shouldCollapseGroup ? 'ml-[7px] border-l border-white/10 pl-4' : 'pl-0'} space-y-0.5 pt-1`}
                >
                    {tools.map((message) => (
                        <ToolTimelineCard
                            key={message.id}
                            message={message}
                            text={text}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function getToolGroupStatus(tools: NormalizedTool[]): NormalizedTool['status'] {
    if (tools.some((tool) => tool.status === 'failed')) return 'failed';
    if (tools.some((tool) => tool.status === 'running')) return 'running';
    return 'completed';
}

function getToolGroupSummary(tools: NormalizedTool[], lang: Language): string {
    const completed = tools.filter((tool) => tool.status === 'completed').length;
    const failed = tools.filter((tool) => tool.status === 'failed').length;
    const running = tools.length - completed - failed;
    if (lang.startsWith('zh')) {
        return [
            `执行了 ${tools.length} 次工具调用`,
            completed ? `${completed} 成功` : '',
            running ? `${running} 运行中` : '',
            failed ? `${failed} 失败` : '',
        ].filter(Boolean).join(' · ');
    }
    return [
        `${tools.length} tool calls`,
        completed ? `${completed} completed` : '',
        running ? `${running} running` : '',
        failed ? `${failed} failed` : '',
    ].filter(Boolean).join(' · ');
}

function ToolTimelineCard({
    message,
    text,
}: {
    message: NormalizedTool;
    text: BeeGameText;
}) {
    const title = getToolTitle(message, text);

    return (
        <div
            data-testid="beegame-tool-timeline-card"
            data-tool-id={message.id}
            className="relative py-0.5"
        >
            <Marker className="type-muted min-h-6 text-muted-foreground">
                <MarkerIcon>
                    <StatusDot status={message.status} />
                </MarkerIcon>
                <MarkerContent className="truncate text-muted-foreground">
                    {title}
                </MarkerContent>
            </Marker>
        </div>
    );
}

function StatusDot({ status }: { status: NormalizedTool['status'] }) {
    const colorClass = status === 'failed'
        ? 'border-rose-300/55 text-rose-300'
        : status === 'running'
            ? 'border-amber-300/55 text-amber-300'
            : 'border-emerald-300/55 text-emerald-300';
    return (
        <span
            className={`relative block h-3.5 w-3.5 rounded-full border ${colorClass} before:absolute before:inset-[4px] before:rounded-full before:bg-current before:opacity-60`}
        />
    );
}
