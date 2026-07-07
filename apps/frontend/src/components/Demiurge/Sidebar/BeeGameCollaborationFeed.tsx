import { memo, useEffect, useMemo, useState } from 'react';
import {
    ChevronDown,
    ChevronRight,
    CheckCircle2,
    FileText,
    FolderOpen,
    GitCompare,
    LoaderCircle,
    Terminal,
    User,
    XCircle,
} from 'lucide-react';
import type { ChatDisplayMessage, ProjectRuntimeDisplayModel } from '../../../viewModels/displayModels';
import { MarkdownRenderer } from './ChatComponents';
import type { Language } from '../AgentsConfig';
import { useBeeGameText, type BeeGameText } from '../../../i18n/useBeeGameTranslations';
import { MessageScrollerItem } from '../../ui/message-scroller';

const BEEGAME_AVATAR_SRC = '/assets/beegame_avatar.png';

type BeeGameCollaborationFeedProps = {
    messages: ChatDisplayMessage[];
    projectStatus?: ProjectRuntimeDisplayModel | null;
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
    lang?: Language;
    currentUserDisplayName?: string;
    currentUserEmail?: string;
    currentUserAvatarUrl?: string;
};

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
};

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
    };
};

const getToolStatusLabel = (status: NormalizedTool['status'], text: BeeGameText): string => {
    if (status === 'completed') return text.toolCompleted;
    if (status === 'failed') return text.toolFailed;
    return text.toolRunning;
};

const getToolTitle = (tool: NormalizedTool, text: BeeGameText): string => {
    if (isWriteTool(tool.name) && tool.detail) {
        return `Write ${getPathFileName(tool.detail)}`;
    }
    return `${tool.name} ${getToolStatusLabel(tool.status, text)}`;
};

const getToolIcon = (toolName?: string) => {
    const normalized = String(toolName || '').toLowerCase();
    if (normalized === 'bash') return Terminal;
    return FileText;
};

const isWriteTool = (toolName?: string): boolean => String(toolName || '').trim().toLowerCase() === 'write';

const getPathFileName = (value: string): string => {
    const normalized = value.replaceAll('\\', '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || value;
};

const getUserInitial = (value?: string): string => {
    const trimmed = String(value || '').trim();
    return trimmed ? trimmed.slice(0, 1).toUpperCase() : '';
};

const getAgentPreview = (content: string): { preview: string; isTruncated: boolean } => {
    const lines = content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const previewLines = lines.slice(0, 5);
    const joined = previewLines.join('\n');
    const maxLength = 360;
    if (joined.length > maxLength) {
        return { preview: `${joined.slice(0, maxLength).trim()}...`, isTruncated: true };
    }
    return {
        preview: joined,
        isTruncated: lines.length > previewLines.length,
    };
};

type FeedEntry =
    | { kind: 'user'; message: ChatDisplayMessage }
    | { kind: 'thinking'; message: ChatDisplayMessage }
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
    onPreviewArtifact,
    lang = 'en',
    currentUserDisplayName,
    currentUserEmail,
    currentUserAvatarUrl,
}: BeeGameCollaborationFeedProps) => {
    const entries = useMemo(() => buildFeedEntries(messages), [messages]);
    const text = useBeeGameText(lang);

    return (
        <>
            {entries.map((entry) => (
                entry.kind === 'user' ? (
                    <MessageScrollerItem
                        key={entry.message.id}
                        messageId={entry.message.id}
                        scrollAnchor
                        className="relative z-10 mb-3 pl-12"
                    >
                        <UserMessageCard
                            message={entry.message}
                            text={text}
                            lang={lang}
                            currentUserDisplayName={currentUserDisplayName}
                            currentUserEmail={currentUserEmail}
                            currentUserAvatarUrl={currentUserAvatarUrl}
                        />
                    </MessageScrollerItem>
                ) : entry.kind === 'thinking' ? (
                    <MessageScrollerItem
                        key={entry.message.id}
                        messageId={entry.message.id}
                        className="relative z-10 mb-3 pl-12"
                    >
                        <ThinkingStatusCard
                            message={entry.message}
                            lang={lang}
                            isRunning={projectStatus?.phase === 'running'}
                        />
                    </MessageScrollerItem>
                ) : entry.kind === 'agent' ? (
                    <MessageScrollerItem
                        key={entry.message.id}
                        messageId={entry.message.id}
                        className="relative z-10 mb-3 pl-12"
                    >
                        <AgentFeedGroup
                            message={entry.message}
                            tools={entry.tools}
                            onPreviewArtifact={onPreviewArtifact}
                            text={text}
                            lang={lang}
                        />
                    </MessageScrollerItem>
                ) : (
                    <MessageScrollerItem
                        key={entry.id}
                        messageId={entry.id}
                        className="relative z-10 mb-3 pl-12"
                    >
                        <ToolGroup tools={entry.tools} onPreviewArtifact={onPreviewArtifact} text={text} />
                    </MessageScrollerItem>
                )
            ))}
        </>
    );
});

BeeGameCollaborationFeed.displayName = 'BeeGameCollaborationFeed';

function ThinkingStatusCard({
    message,
    lang,
    isRunning,
}: {
    message: ChatDisplayMessage;
    lang: Language;
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
    const label = lang.startsWith('zh')
        ? (isStalled ? '仍在 Thinking，可继续等待或停止' : 'AI 正在思考...')
        : (isStalled ? 'Still thinking. You can wait or stop.' : 'Thinking...');

    return (
        <section
            data-testid={`beegame-thinking-message-${message.id}`}
            className="glass-control inline-flex max-w-full items-center gap-2 rounded-2xl px-3 py-2 text-zinc-400 shadow-sm backdrop-blur-2xl"
        >
            <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-500" />
            <span className="type-footnote min-w-0 truncate">{label}</span>
        </section>
    );
}

function UserMessageCard({
    message,
    text,
    lang,
    currentUserDisplayName,
    currentUserEmail,
    currentUserAvatarUrl,
}: {
    message: ChatDisplayMessage;
    text: BeeGameText;
    lang: Language;
    currentUserDisplayName?: string;
    currentUserEmail?: string;
    currentUserAvatarUrl?: string;
}) {
    const userLabel = currentUserDisplayName || currentUserEmail || text.you;
    const initial = getUserInitial(userLabel);
    return (
        <section
            data-testid={`beegame-user-message-${message.id}`}
            className="w-full rounded-3xl border border-emerald-300/15 bg-emerald-300/[0.055] px-4 py-3 text-zinc-100 shadow-sm shadow-emerald-950/10 backdrop-blur-2xl"
        >
            <div className="mb-2 flex items-center justify-end gap-2">
                <span className="type-caption-1 max-w-[14rem] truncate text-emerald-100/85">{userLabel}</span>
                <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full border border-emerald-200/20 bg-emerald-200/[0.08] text-emerald-100">
                    {currentUserAvatarUrl ? (
                        <img
                            src={currentUserAvatarUrl}
                            alt={userLabel}
                            className="h-full w-full object-cover"
                            draggable={false}
                        />
                    ) : initial ? (
                        <span className="type-caption-1 text-emerald-50">{initial}</span>
                    ) : (
                        <User className="h-4 w-4" />
                    )}
                </span>
            </div>
            <MarkdownRenderer
                content={message.content}
                isUser
                messageId={message.id}
                variant="beegame"
                lang={lang}
            />
        </section>
    );
}

function AgentFeedGroup({
    message,
    tools,
    onPreviewArtifact,
    text,
    lang,
}: {
    message: ChatDisplayMessage;
    tools: NormalizedTool[];
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
    text: BeeGameText;
    lang: Language;
}) {
    const [isCollapsed, setIsCollapsed] = useState(false);

    return (
        <div className="space-y-3">
            <AgentSummaryCard
                message={message}
                isCollapsed={isCollapsed}
                onToggleCollapsed={() => setIsCollapsed((value) => !value)}
                text={text}
                lang={lang}
            />
            {!isCollapsed && tools.length > 0 ? (
                <ToolGroup tools={tools} onPreviewArtifact={onPreviewArtifact} text={text} />
            ) : null}
        </div>
    );
}

function AgentSummaryCard({
    message,
    isCollapsed,
    onToggleCollapsed,
    text,
    lang,
}: {
    message: ChatDisplayMessage;
    isCollapsed: boolean;
    onToggleCollapsed: () => void;
    text: BeeGameText;
    lang: Language;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const preview = getAgentPreview(message.content);
    const content = isExpanded ? message.content : preview.preview;

    return (
        <section data-testid={`beegame-agent-message-${message.id}`} className="glass-control rounded-3xl px-4 py-3 text-zinc-100 shadow-sm backdrop-blur-2xl">
            <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-black/25 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04),0_8px_18px_rgba(0,0,0,0.28)]">
                        <img
                            src={BEEGAME_AVATAR_SRC}
                            alt={text.assistantName}
                            className="h-5 w-5 object-contain"
                            draggable={false}
                        />
                    </span>
                    <button
                        type="button"
                        aria-expanded={!isCollapsed}
                        aria-label={isCollapsed ? text.expandMessage : text.collapseMessage}
                        onClick={onToggleCollapsed}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                    >
                        <span className="type-caption-1 min-w-0 truncate text-zinc-300">
                            {text.assistantName}
                        </span>
                        {isCollapsed ? (
                            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
                        ) : (
                            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
                        )}
                    </button>
                </div>
                {!isCollapsed ? (
                    <>
                        <MarkdownRenderer
                            content={content}
                            isUser={false}
                            messageId={message.id}
                            variant="beegame"
                            lang={lang}
                        />
                        {preview.isTruncated ? (
                            <button
                                type="button"
                                onClick={() => setIsExpanded((value) => !value)}
                                className="type-footnote mt-2 inline-flex items-center gap-1 text-zinc-300 hover:text-white"
                            >
                                {isExpanded ? text.hideSummaryDetails : text.viewSummaryDetails}
                                {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                        ) : null}
                    </>
                ) : null}
            </div>
        </section>
    );
}

function ToolGroup({
    tools,
    onPreviewArtifact,
    text,
}: {
    tools: NormalizedTool[];
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
    text: BeeGameText;
}) {
    return (
        <div className="relative ml-8 pl-8">
            <div className="space-y-3">
                {tools.map((message, index) => (
                    <ToolTimelineCard
                        key={message.id}
                        message={message}
                        isLast={index === tools.length - 1}
                        onPreviewArtifact={onPreviewArtifact}
                        text={text}
                    />
                ))}
            </div>
        </div>
    );
}

function ToolTimelineCard({
    message,
    isLast,
    onPreviewArtifact,
    text,
}: {
    message: NormalizedTool;
    isLast: boolean;
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
    text: BeeGameText;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const Icon = getToolIcon(message.name);
    const isCompleted = message.status === 'completed';
    const isFailed = message.status === 'failed';
    const isRunning = !isCompleted && !isFailed;
    const StatusIcon = isCompleted ? CheckCircle2 : isFailed ? XCircle : LoaderCircle;
    const statusClassName = isCompleted ? 'text-emerald-300' : isFailed ? 'text-red-300' : 'text-zinc-300';
    const detail = message.detail;
    const output = message.output;
    const title = getToolTitle(message, text);
    const previewId = message.artifactId || message.id;
    const previewTitle = detail || title;
    const previewContent = message.artifactId ? undefined : [detail, output].filter(Boolean).join('\n\n');
    const canPreviewTool = isWriteTool(message.name) && Boolean(detail || output);
    const diffContent = [
        `Tool: ${message.name}`,
        `Status: ${message.status}`,
        detail ? `Target: ${detail}` : '',
        output ? `\n${output}` : '',
    ].filter(Boolean).join('\n');

    return (
        <div data-testid="beegame-tool-timeline-card" data-tool-id={message.id} className="glass-control relative rounded-2xl p-3 backdrop-blur-2xl">
            {!isLast ? (
                <div
                    data-testid="beegame-tool-connector"
                    className="absolute -left-[1.1rem] top-10 h-[calc(100%+0.75rem)] w-px bg-white/10"
                />
            ) : null}
            <div
                data-testid="beegame-tool-status-icon"
                className={`absolute -left-[1.55rem] top-5 flex h-4 w-4 items-center justify-center ${statusClassName}`}
            >
                <StatusIcon className={`h-4 w-4 ${isRunning ? 'animate-spin' : ''}`} />
            </div>
            <div className="flex items-start gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300">
                    <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => setIsExpanded((value) => !value)}
                        className="flex w-full min-w-0 items-center justify-between gap-3 text-left"
                    >
                        <span className="flex min-w-0 items-center gap-2">
                            <span className="type-footnote truncate text-zinc-100">{title}</span>
                        </span>
                        {isExpanded ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500" />
                        ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
                        )}
                    </button>
                    {isExpanded ? (
                        <div>
                            {detail ? (
	                                <div className="type-code-sm mt-2 rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-zinc-400 [overflow-wrap:anywhere]">
                                    {detail}
                                </div>
                            ) : null}
                            {output ? (
                                <div className="type-footnote mt-2 line-clamp-3 text-zinc-500 [overflow-wrap:anywhere]">
                                    {output}
                                </div>
                            ) : null}
                            {canPreviewTool ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        aria-label={`${text.open} ${previewTitle}`}
                                        onClick={() => onPreviewArtifact?.(previewId, previewTitle, previewContent || undefined)}
                                        className="type-footnote inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-zinc-300 hover:border-white/20 hover:bg-white/[0.06]"
                                    >
                                        <FolderOpen className="h-3.5 w-3.5" />
                                        {text.open}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`${text.diff} ${previewTitle}`}
                                        onClick={() => onPreviewArtifact?.(`${previewId}:diff`, `${text.diff}: ${previewTitle}`, diffContent)}
                                        className="type-footnote inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-zinc-300 hover:border-white/20 hover:bg-white/[0.06]"
                                    >
                                        <GitCompare className="h-3.5 w-3.5" />
                                        {text.diff}
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
