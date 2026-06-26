import { memo, useMemo, useState } from 'react';
import {
    Bot,
    ChevronDown,
    ChevronRight,
    CheckCircle2,
    CircleDotDashed,
    FileText,
    FolderOpen,
    GitCompare,
    Terminal,
    User,
    XCircle,
} from 'lucide-react';
import type { ChatDisplayMessage, ProjectRuntimeDisplayModel } from '../../../viewModels/displayModels';
import { MarkdownRenderer } from './ChatComponents';

type BeeGameCollaborationFeedProps = {
    messages: ChatDisplayMessage[];
    projectStatus?: ProjectRuntimeDisplayModel | null;
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
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

const getToolTitle = (tool: NormalizedTool): string => {
    return `${tool.name} ${tool.status}`;
};

const getToolIcon = (toolName?: string) => {
    const normalized = String(toolName || '').toLowerCase();
    if (normalized === 'bash') return Terminal;
    return FileText;
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
    | { kind: 'agent'; message: ChatDisplayMessage; tools: NormalizedTool[] }
    | { kind: 'tools'; id: string; tools: NormalizedTool[] };

const buildFeedEntries = (messages: ChatDisplayMessage[]): FeedEntry[] => {
    const entries: FeedEntry[] = [];

    for (const message of messages) {
        if (message.sender === 'user') {
            entries.push({ kind: 'user', message });
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
    onPreviewArtifact,
}: BeeGameCollaborationFeedProps) => {
    const entries = useMemo(() => buildFeedEntries(messages), [messages]);

    return (
        <div data-testid="beegame-collaboration-feed" className="space-y-3">
            {entries.map((entry) => (
                entry.kind === 'user' ? (
                    <UserMessageCard key={entry.message.id} message={entry.message} />
                ) : entry.kind === 'agent' ? (
                    <AgentFeedGroup
                        key={entry.message.id}
                        message={entry.message}
                        tools={entry.tools}
                        onPreviewArtifact={onPreviewArtifact}
                    />
                ) : (
                    <ToolGroup key={entry.id} tools={entry.tools} onPreviewArtifact={onPreviewArtifact} />
                )
            ))}
        </div>
    );
});

BeeGameCollaborationFeed.displayName = 'BeeGameCollaborationFeed';

function UserMessageCard({ message }: { message: ChatDisplayMessage }) {
    return (
        <section
            data-testid={`beegame-user-message-${message.id}`}
            className="ml-auto max-w-[88%] rounded-xl border border-zinc-700 bg-zinc-100 px-4 py-3 text-zinc-950 shadow-sm"
        >
            <div className="mb-2 flex items-center justify-end gap-2">
                <span className="text-[11px] font-black uppercase tracking-widest text-zinc-500">You</span>
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-zinc-950 text-zinc-100">
                    <User className="h-4 w-4" />
                </span>
            </div>
            <MarkdownRenderer
                content={message.content}
                isUser
                messageId={message.id}
                variant="beegame"
            />
        </section>
    );
}

function AgentFeedGroup({
    message,
    tools,
    onPreviewArtifact,
}: {
    message: ChatDisplayMessage;
    tools: NormalizedTool[];
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
}) {
    const [isCollapsed, setIsCollapsed] = useState(false);

    return (
        <div className="space-y-3">
            <AgentSummaryCard
                message={message}
                isCollapsed={isCollapsed}
                onToggleCollapsed={() => setIsCollapsed((value) => !value)}
            />
            {!isCollapsed && tools.length > 0 ? (
                <ToolGroup tools={tools} onPreviewArtifact={onPreviewArtifact} />
            ) : null}
        </div>
    );
}

function AgentSummaryCard({
    message,
    isCollapsed,
    onToggleCollapsed,
}: {
    message: ChatDisplayMessage;
    isCollapsed: boolean;
    onToggleCollapsed: () => void;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const preview = getAgentPreview(message.content);
    const content = isExpanded ? message.content : preview.preview;

    return (
        <section data-testid={`beegame-agent-message-${message.id}`} className="rounded-xl border border-zinc-800 bg-zinc-900/55 p-3">
            <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-orange-500/30 bg-orange-500/15 text-orange-300">
                    <Bot className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        aria-expanded={!isCollapsed}
                        aria-label={isCollapsed ? 'Expand BeeGame message' : 'Collapse BeeGame message'}
                        onClick={onToggleCollapsed}
                        className="flex w-full items-start justify-between gap-3 text-left"
                    >
                        <span className="min-w-0">
                            <span className="block text-sm font-black text-orange-400">BeeGame</span>
                            <span className="mt-0.5 block text-[11px] font-bold text-zinc-500">游戏构建代理 · Harness Engineer</span>
                        </span>
                        {isCollapsed ? (
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                        ) : (
                            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                        )}
                    </button>
                    {!isCollapsed ? (
                        <>
                            <div className="mt-3">
                                <MarkdownRenderer
                                    content={content}
                                    isUser={false}
                                    messageId={message.id}
                                    variant="beegame"
                                />
                            </div>
                            {preview.isTruncated ? (
                                <button
                                    type="button"
                                    onClick={() => setIsExpanded((value) => !value)}
                                    className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-orange-300 hover:text-orange-200"
                                >
                                    {isExpanded ? 'Hide summary details' : 'View summary details'}
                                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                </button>
                            ) : null}
                        </>
                    ) : null}
                </div>
            </div>
        </section>
    );
}

function ToolGroup({
    tools,
    onPreviewArtifact,
}: {
    tools: NormalizedTool[];
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
}) {
    return (
        <div className="relative pl-8">
            <div className="space-y-3">
                {tools.map((message, index) => (
                    <ToolTimelineCard
                        key={message.id}
                        message={message}
                        isLast={index === tools.length - 1}
                        onPreviewArtifact={onPreviewArtifact}
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
}: {
    message: NormalizedTool;
    isLast: boolean;
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const Icon = getToolIcon(message.name);
    const isCompleted = message.status === 'completed';
    const isFailed = message.status === 'failed';
    const StatusIcon = isCompleted ? CheckCircle2 : isFailed ? XCircle : CircleDotDashed;
    const detail = message.detail;
    const output = message.output;
    const title = getToolTitle(message);
    const previewId = message.artifactId || message.id;
    const previewTitle = detail || title;
    const previewContent = message.artifactId ? undefined : [detail, output].filter(Boolean).join('\n\n');
    const diffContent = [
        `Tool: ${message.name}`,
        `Status: ${message.status}`,
        detail ? `Target: ${detail}` : '',
        output ? `\n${output}` : '',
    ].filter(Boolean).join('\n');

    return (
        <div data-testid="beegame-tool-timeline-card" data-tool-id={message.id} className="relative rounded-xl border border-zinc-800 bg-zinc-900/55 p-3">
            {!isLast ? (
                <div
                    data-testid="beegame-tool-connector"
                    className="absolute -left-[1.1rem] top-10 h-[calc(100%+0.75rem)] w-px bg-zinc-800"
                />
            ) : null}
            <div className={`absolute -left-[1.85rem] top-4 grid h-6 w-6 place-items-center rounded-full border bg-zinc-950 ${isCompleted ? 'border-emerald-500 text-emerald-400' : isFailed ? 'border-red-500 text-red-400' : 'border-orange-500 text-orange-400'}`}>
                <StatusIcon className="h-4 w-4" />
            </div>
            <div className="flex items-start gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-zinc-950 text-zinc-300 ring-1 ring-zinc-800">
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
                            <span className="truncate text-sm font-black text-zinc-100">{title}</span>
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
                                <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs leading-5 text-zinc-400 [overflow-wrap:anywhere]">
                                    {detail}
                                </div>
                            ) : null}
                            {output ? (
                                <div className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-500 [overflow-wrap:anywhere]">
                                    {output}
                                </div>
                            ) : null}
                            {(detail || output) ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        aria-label={`Open ${previewTitle}`}
                                        onClick={() => onPreviewArtifact?.(previewId, previewTitle, previewContent || undefined)}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/70"
                                    >
                                        <FolderOpen className="h-3.5 w-3.5" />
                                        Open
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`Diff ${previewTitle}`}
                                        onClick={() => onPreviewArtifact?.(`${previewId}:diff`, `Diff: ${previewTitle}`, diffContent)}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/70"
                                    >
                                        <GitCompare className="h-3.5 w-3.5" />
                                        Diff
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
