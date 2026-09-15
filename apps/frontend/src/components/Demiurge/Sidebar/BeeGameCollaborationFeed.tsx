import { Fragment, memo, useMemo, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { getWorkflowControlState, type ChatDisplayMessage, type ChatDisplaySource, type ProjectRuntimeDisplayModel } from '../../../viewModels/displayModels';
import { MarkdownRenderer } from './ChatMarkdownContent';
import type { Language } from '../AgentsConfig';
import { useBeeGameText, type BeeGameText } from '../../../i18n/useBeeGameTranslations';
import { Message } from '../../beui/registry/components/agents/message';
import type { WorkflowCardAction, WorkflowCardPayload } from '../../../types/message';
import {
    MessageMarker,
    MessageBubble,
    MessageBubbleContent,
    MessageContent,
    MessageGroup,
} from '../../beui/registry/components/agents/message';
import { AgentActivity, type AgentActivityItem } from '../../beui/registry/components/agents/agent-activity';
import { FileDiff, type FileDiffLine } from '../../beui/registry/components/agents/file-diff';
import { ReasoningText } from '../../beui/registry/components/agents/loading-states/reasoning-text';
import { StreamingResponse } from '../../beui/registry/components/agents/streaming-response';
import { TodoList, type TodoItem } from '../../beui/registry/components/agents/todo-list';

type BeeGameCollaborationFeedProps = {
    messages: ChatDisplayMessage[];
    projectStatus?: ProjectRuntimeDisplayModel | null;
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
    lang?: Language;
    currentUserDisplayName?: string;
    currentUserEmail?: string;
    currentUserAvatarUrl?: string;
    onEditMessage?: (message: ChatDisplayMessage) => void;
    onRetryResponse?: (message: string) => void;
    onWorkflowAction?: (action: WorkflowCardAction) => Promise<void> | void;
    isLoading?: boolean;
    streamingMessageId?: string | null;
};

type ToolFeedMessage = ChatDisplayMessage & {
    tool?: string;
    toolName?: string;
    toolUseId?: string;
    tool_status?: string;
    toolStatus?: string;
    tool_detail?: string;
    toolDetail?: string;
    tool_output?: string;
    toolOutput?: string;
    subagentPrompt?: string;
    subagentOutput?: string;
    subagentTrace?: string;
    artifact_id?: string;
    toolDiff?: string;
    toolPatch?: string;
    toolBefore?: string;
    toolAfter?: string;
    tool_diff?: string;
    tool_patch?: string;
    tool_before?: string;
    tool_after?: string;
    toolStructuredPatch?: unknown;
    structured_patch?: unknown;
    toolInput?: unknown;
    tool_input?: unknown;
};

type NormalizedTool = {
    id: string;
    name: string;
    status: 'running' | 'completed' | 'failed';
    detail: string;
    output: string;
    diff?: string;
    artifactId?: string;
    kind: ToolKind;
    timestamp: number;
    turnId?: string;
    toolUseId?: string;
    isSubagent?: boolean;
    subagentPrompt?: string;
    subagentOutput?: string;
    subagentTrace?: string;
    input?: unknown;
    before?: string;
    after?: string;
};

type ToolKind = 'search' | 'read' | 'write' | 'edit' | 'bash' | 'todo' | 'subagent' | 'generic';

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
    if (normalized === 'todowrite' || normalized === 'todo_write') return 'todo';
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
    const fullSubagentOutput = String(message.subagentOutput || '').trim();
    const output = fullSubagentOutput || String(message.toolOutput || message.tool_output || getStructuredLineValue(content, 'Output') || '').trim();
    const structuredPatch = message.toolStructuredPatch ?? message.structured_patch;
    const kind = getToolKind(name);
    const rawDiff = message.toolDiff || message.toolPatch || message.tool_diff || message.tool_patch || formatStructuredPatch(structuredPatch);
    const diff = String(
        rawDiff ||
        ((message.toolBefore !== undefined && message.toolAfter !== undefined)
            ? formatBeforeAfterDiff(message.toolBefore || message.tool_before || '', message.toolAfter || message.tool_after || '')
            : ''),
    ).trim() || undefined;
    if (!name && !rawDetail && !output) return null;
    return {
        id: message.id,
        name,
        status,
        detail: stripStructuredDetailLabel(rawDetail),
        output,
        diff,
        artifactId: String(message.artifactId || message.artifact_id || '').trim() || undefined,
        kind,
        timestamp: Number(message.timestamp || 0),
        turnId: message.turnId || message.turn_id,
        toolUseId: message.toolUseId,
        isSubagent: Boolean(message.isSubagentTool),
        subagentPrompt: message.subagentPrompt,
        subagentOutput: message.subagentOutput,
        subagentTrace: message.subagentTrace,
        input: message.toolInput ?? message.tool_input,
        before: message.toolBefore ?? message.tool_before,
        after: message.toolAfter ?? message.tool_after,
    };
};

function formatBeforeAfterDiff(before: string, after: string): string {
    if (before === after) return '';
    const removed = before.split('\n').map((line) => `-${line}`).join('\n');
    const added = after.split('\n').map((line) => `+${line}`).join('\n');
    return `--- before\n+++ after\n@@\n${removed}\n${added}`;
}

function formatStructuredPatch(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (!Array.isArray(value) || value.length === 0) return '';
    const lines = value.flatMap((hunk) => {
        if (!hunk || typeof hunk !== 'object') return [];
        const record = hunk as Record<string, unknown>;
        if (Array.isArray(record.lines)) {
            return record.lines.map((line) => {
                if (typeof line === 'string') return line;
                if (!line || typeof line !== 'object') return String(line ?? '');
                const item = line as Record<string, unknown>;
                const origin = typeof item.origin === 'string' ? item.origin : ' ';
                const content = typeof item.content === 'string' ? item.content : '';
                return `${origin}${content}`;
            });
        }
        return [];
    });
    return lines.join('\n').trim();
}

function getUnifiedDiffStats(diff?: string): Pick<Extract<AgentActivityItem, { type: 'tool' }>, 'additions' | 'deletions'> {
    if (!diff) return {};
    let additions = 0;
    let deletions = 0;
    for (const line of diff.split('\n')) {
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
        if (line.startsWith('+')) additions += 1;
        if (line.startsWith('-')) deletions += 1;
    }
    return {
        ...(additions > 0 ? { additions } : {}),
        ...(deletions > 0 ? { deletions } : {}),
    };
}

function getActivityToolAction(tool: NormalizedTool): string {
    if (tool.kind === 'read') return 'read';
    if (tool.kind === 'write') return 'edit';
    if (tool.kind === 'edit') return 'edit';
    if (tool.kind === 'search') return 'search';
    return 'run';
}

function toActivityItem(
    part: Extract<ResponsePart, { kind: 'thinking' | 'tool' }>,
): AgentActivityItem {
    if (part.kind === 'thinking') {
        return {
            id: `activity-thinking-${part.message.id}`,
            type: 'text',
            content: part.message.thought || part.message.content || 'Thinking',
        };
    }
    if (part.tool.kind === 'search') {
        return {
            id: `activity-search-${part.tool.id}`,
            type: 'search',
            query: part.tool.detail || part.tool.name,
        };
    }
    return {
        id: `activity-tool-${part.tool.id}`,
        type: 'tool',
        action: getActivityToolAction(part.tool),
        target: part.tool.detail || part.tool.name,
        ...getUnifiedDiffStats(part.tool.diff),
    };
}

function parseDiffLines(diff: string): FileDiffLine[] {
    const lines: FileDiffLine[] = [];
    let oldLine = 1;
    let newLine = 1;
    for (const [index, line] of diff.split('\n').entries()) {
        const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (hunk) {
            oldLine = Number(hunk[1]);
            newLine = Number(hunk[2]);
            continue;
        }
        if (line.startsWith('---') || line.startsWith('+++')) continue;
        const type = line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'context';
        const content = type === 'context' ? line.startsWith(' ') ? line.slice(1) : line : line.slice(1);
        lines.push({
            id: `diff-line-${index}`,
            type,
            ...(type !== 'added' ? { oldLine } : {}),
            ...(type !== 'removed' ? { newLine } : {}),
            content,
        });
        if (type !== 'added') oldLine += 1;
        if (type !== 'removed') newLine += 1;
    }
    return lines;
}

type ResponsePart =
    | { kind: 'thinking'; message: ChatDisplayMessage; timestamp: number; turnId?: string; activityGroupId?: string }
    | { kind: 'workflow'; workflow: WorkflowCardPayload; timestamp: number }
    | { kind: 'tool'; tool: NormalizedTool; timestamp: number; turnId?: string; activityGroupId?: string }
    | { kind: 'todo'; id: string; items: TodoItem[]; timestamp: number; turnId?: string }
    | { kind: 'agent'; message: ChatDisplayMessage; timestamp: number; turnId?: string };

type AgentResponseTurn = {
    kind: 'response';
    id: string;
    turnId?: string;
    parts: ResponsePart[];
};

type FeedEntry =
    | { kind: 'user'; message: ChatDisplayMessage }
    | { kind: 'context'; message: ChatDisplayMessage }
    | AgentResponseTurn;

type ToolPartReference = {
    turn: AgentResponseTurn;
    part: Extract<ResponsePart, { kind: 'tool' }>;
};

const mergeToolPart = (
    toolParts: Map<string, ToolPartReference>,
    turn: AgentResponseTurn,
    tool: NormalizedTool,
    activityGroupId?: string,
): void => {
    const existing = tool.toolUseId ? toolParts.get(tool.toolUseId) : undefined;
    if (existing) {
        const current = existing.part.tool;
        existing.part = {
            kind: 'tool',
            tool: {
                ...current,
                ...tool,
                id: current.id,
                name: tool.name === GENERIC_TOOL_NAME ? current.name : tool.name,
                detail: tool.detail || current.detail,
                output: tool.output || current.output,
                diff: tool.diff || current.diff,
                before: tool.before ?? current.before,
                after: tool.after ?? current.after,
                timestamp: Math.max(current.timestamp, tool.timestamp),
                status: tool.status === 'running' ? current.status : tool.status,
            },
            timestamp: Math.max(existing.part.timestamp, tool.timestamp),
            turnId: existing.part.turnId || tool.turnId,
            activityGroupId: existing.part.activityGroupId || activityGroupId,
        };
        const index = existing.turn.parts.indexOf(existing.part);
        if (index >= 0) existing.turn.parts[index] = existing.part;
        else {
            const previousIndex = existing.turn.parts.findIndex((part) => part.kind === 'tool' && part.tool.id === current.id);
            if (previousIndex >= 0) existing.turn.parts[previousIndex] = existing.part;
        }
        return;
    }
    const part: Extract<ResponsePart, { kind: 'tool' }> = {
        kind: 'tool',
        tool,
        timestamp: tool.timestamp,
        turnId: tool.turnId,
        activityGroupId,
    };
    turn.parts.push(part);
    if (tool.toolUseId) toolParts.set(tool.toolUseId, { turn, part });
};

const appendAssistantContentBlocks = (
    turn: AgentResponseTurn,
    message: ChatDisplayMessage,
    appendTool: (turn: AgentResponseTurn, tool: NormalizedTool, activityGroupId?: string) => void,
): boolean => {
    const blocks = message.contentBlocks;
    if (!blocks?.length) return false;
    const activityGroupId = blocks.some((block) => block.type === 'thinking' || block.type === 'tool_use')
        ? message.id
        : undefined;
    const results = new Map(blocks.filter((block) => block.type === 'tool_result' && block.toolUseId).map((block) => [block.toolUseId!, block]));
    blocks.forEach((block, index) => {
        const blockId = `${message.id}-block-${index}`;
        if (block.type === 'thinking') {
            turn.parts.push({
                kind: 'thinking',
                message: { ...message, id: blockId, content: 'Thinking', thought: block.text || '', type: 'thought' },
                timestamp: messageTimestamp(message),
                turnId: message.turnId || message.turn_id,
                activityGroupId,
            });
            return;
        }
        if (block.type === 'text') {
            turn.parts.push({
                kind: 'agent',
                message: { ...message, id: blockId, content: block.text || '', type: 'text' },
                timestamp: messageTimestamp(message),
                turnId: message.turnId || message.turn_id,
            });
            return;
        }
        if (block.type === 'tool_use') {
            const result = block.toolUseId ? results.get(block.toolUseId) : undefined;
            const synthetic = normalizeToolMessage({
                ...message,
                id: blockId,
                type: 'tool',
                toolName: block.toolName,
                toolUseId: block.toolUseId,
                toolInput: block.toolInput,
                toolStatus: result ? (result.isError ? 'failed' : 'completed') : 'running',
                toolOutput: result?.text,
                content: `Tool: ${block.toolName || 'Tool'}\nStatus: ${result ? (result.isError ? 'failed' : 'completed') : 'running'}`,
            });
            if (synthetic) appendTool(turn, synthetic, activityGroupId);
            return;
        }
        if (block.type === 'tool_result' && !block.toolUseId) {
            const synthetic = normalizeToolMessage({
                ...message,
                id: blockId,
                type: 'tool',
                toolName: 'Tool result',
                toolStatus: block.isError ? 'failed' : 'completed',
                toolOutput: block.text,
                content: `Tool result\nStatus: ${block.isError ? 'failed' : 'completed'}\nOutput: ${block.text || ''}`,
            });
            if (synthetic) appendTool(turn, synthetic, activityGroupId);
        }
    });
    return true;
};

const getMessageSources = (message: ChatDisplayMessage): ChatDisplaySource[] => {
    const sources = [...(message.sources || []), ...(message.citations || [])];
    return sources.filter((source, index) => {
        const key = source.id || source.url || `${source.title}:${source.domain || ''}`;
        return sources.findIndex((candidate) => (candidate.id || candidate.url || `${candidate.title}:${candidate.domain || ''}`) === key) === index;
    });
};

const messageTimestamp = (message: ChatDisplayMessage): number => Number(message.timestamp || Number.POSITIVE_INFINITY);

const matchesStreamingMessage = (message: ChatDisplayMessage, streamingMessageId: string | null): boolean => {
    if (!streamingMessageId) return false;
    const id = String(message.id || '');
    const legacyMessageId = (message as ChatDisplayMessage & { message_id?: string }).message_id;
    return id === streamingMessageId ||
        message.messageId === streamingMessageId ||
        legacyMessageId === streamingMessageId ||
        id.startsWith(`${streamingMessageId}-block-`);
};

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';

const calendarDateKey = (timestamp: number): string | undefined => {
    if (!Number.isFinite(timestamp)) return undefined;
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: SHANGHAI_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return values.year && values.month && values.day ? `${values.year}-${values.month}-${values.day}` : undefined;
};

const calendarDateLabel = (timestamp: number, lang: Language): string => new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
}).format(new Date(timestamp));

const feedEntryTimestamp = (entry: FeedEntry): number => {
    if (entry.kind === 'user' || entry.kind === 'context') return messageTimestamp(entry.message);
    return Math.min(...entry.parts.map((part) => part.timestamp));
};

const workflowTimestamp = (workflow: WorkflowCardPayload): number => {
    const timestamp = Date.parse(workflow.createdAt || '');
    return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
};

const buildFeedEntries = (
    messages: ChatDisplayMessage[],
    workflow?: WorkflowCardPayload,
): FeedEntry[] => {
    const entries: FeedEntry[] = [];
    const toolParts = new Map<string, ToolPartReference>();
    let activeTurn: AgentResponseTurn | null = null;

    const ensureTurn = (id: string, turnId?: string): AgentResponseTurn => {
        if (activeTurn && turnId && activeTurn.turnId === turnId) {
            return activeTurn;
        }
        activeTurn = { kind: 'response', id, turnId, parts: [] };
        entries.push(activeTurn);
        return activeTurn;
    };

    for (const message of messages) {
        if (message.sender === 'user') {
            entries.push({ kind: 'user', message });
            activeTurn = null;
            continue;
        }

        if (isAgentMessage(message) && message.contentBlocks?.length) {
            const turn = ensureTurn(message.id, message.turnId || message.turn_id);
            appendAssistantContentBlocks(turn, message, mergeToolPart.bind(null, toolParts));
            continue;
        }

        if (isThinkingMessage(message)) {
            const turn = ensureTurn(message.id, message.turnId || message.turn_id);
            turn.parts.push({ kind: 'thinking', message, timestamp: messageTimestamp(message), turnId: message.turnId || message.turn_id });
            continue;
        }

        if (isContextUpdateMessage(message)) {
            entries.push({ kind: 'context', message });
            continue;
        }

        if (isToolMessage(message)) {
            const tool = normalizeToolMessage(message);
            if (!tool) continue;
            const turn = ensureTurn(message.id, tool.turnId);
            if (tool.kind === 'todo') {
                const input = tool.input && typeof tool.input === 'object' ? tool.input as { todos?: unknown } : undefined;
                const items = Array.isArray(input?.todos)
                    ? input.todos.flatMap((todo, index): TodoItem[] => {
                        if (!todo || typeof todo !== 'object') return [];
                        const record = todo as Record<string, unknown>;
                        const title = typeof record.content === 'string' ? record.content : typeof record.title === 'string' ? record.title : '';
                        if (!title) return [];
                        const rawStatus = String(record.status || 'pending');
                        const status: TodoItem['status'] = rawStatus === 'in_progress' || rawStatus === 'in-progress'
                            ? 'in-progress'
                            : rawStatus === 'completed'
                                ? 'completed'
                                : rawStatus === 'cancelled' || rawStatus === 'blocked'
                                    ? 'cancelled'
                                    : 'pending';
                        return [{ id: `${tool.id}-${index}`, title, status }];
                    })
                    : [];
                if (items.length > 0) turn.parts.push({ kind: 'todo', id: tool.id, items, timestamp: tool.timestamp || messageTimestamp(message), turnId: tool.turnId });
                continue;
            }
            mergeToolPart(toolParts, turn, tool);
            continue;
        }

        if (isAgentMessage(message)) {
            const turn = ensureTurn(message.id, message.turnId || message.turn_id);
            turn.parts.push({ kind: 'agent', message, timestamp: messageTimestamp(message), turnId: message.turnId || message.turn_id });
        }
    }

    if (workflow) {
        const target = [...entries].reverse().find((entry): entry is AgentResponseTurn => entry.kind === 'response');
        if (target) {
            const workflowPart: ResponsePart = { kind: 'workflow', workflow, timestamp: workflowTimestamp(workflow) };
            const workflowTime = workflowPart.timestamp;
            if (Number.isFinite(workflowTime)) {
                const insertionIndex = target.parts.findIndex((part) => Number.isFinite(part.timestamp) && part.timestamp > workflowTime);
                if (insertionIndex >= 0) target.parts.splice(insertionIndex, 0, workflowPart);
                else target.parts.push(workflowPart);
            } else {
                target.parts.push(workflowPart);
            }
        } else {
            entries.push({ kind: 'response', id: `workflow-${workflow.runId || 'current'}`, parts: [{ kind: 'workflow', workflow, timestamp: workflowTimestamp(workflow) }] });
        }
    }

    // Parts already arrive in the runtime event order. Do not sort by a
    // display timestamp: replayed events can legitimately carry an older
    // timestamp while still appearing later in the response stream.
    return entries;
};

export const BeeGameCollaborationFeed = memo(({
    messages,
    projectStatus,
    lang = 'en',
    onEditMessage,
    onRetryResponse,
    onWorkflowAction,
    isLoading = false,
    streamingMessageId = null,
}: BeeGameCollaborationFeedProps) => {
    const text = useBeeGameText(lang);
    const workflow = getWorkflowControlState(projectStatus);
    const entries = useMemo(
        () => buildFeedEntries(messages, workflow),
        [messages, workflow],
    );
    const hasStreamingMessage = Boolean(streamingMessageId && entries.some((entry) => entry.kind === 'response' && entry.parts.some((part) => (
        (part.kind === 'tool' && part.tool.status === 'running') ||
        ((part.kind === 'thinking' || part.kind === 'agent') && matchesStreamingMessage(part.message, streamingMessageId))
    ))));
    const entriesWithDates = useMemo(() => {
        const dateKeys = entries.map((entry) => calendarDateKey(feedEntryTimestamp(entry)));
        return entries.map((entry, index) => {
            const dateKey = dateKeys[index];
            return {
                entry,
                dateKey,
                dateLabel: dateKey ? calendarDateLabel(feedEntryTimestamp(entry), lang) : undefined,
                showDateSeparator: Boolean(dateKey && dateKey !== dateKeys[index - 1]),
            };
        });
    }, [entries, lang]);

    return (
        <MessageGroup spacing="compact">
            {entriesWithDates.map(({ entry, dateKey, dateLabel, showDateSeparator }, entryIndex) => {
                const previousUserMessage = entry.kind === 'response'
                    ? [...entries.slice(0, entryIndex)].reverse().find((candidate): candidate is Extract<FeedEntry, { kind: 'user' }> => candidate.kind === 'user')?.message
                    : undefined;
                return <Fragment key={entry.kind === 'user' || entry.kind === 'context' ? entry.message.id : entry.id}>
                    {showDateSeparator && dateKey && dateLabel ? <DateSeparator dateKey={dateKey} label={dateLabel} /> : null}
                    {entry.kind === 'user' ? (
                        <Message key={entry.message.id} data-message-id={entry.message.id} data-scroll-anchor="false" from="user" className="mb-3 min-w-0"><UserMessageCard
                            message={entry.message}
                            lang={lang}
                            onEdit={onEditMessage}
                        /></Message>

                    ) : entry.kind === 'context' ? (
                        <ContextUpdateSeparator key={entry.message.id} text={text} />
                    ) : (
                    <Message key={entry.id} data-testid={`beegame-agent-turn-${entry.id}`} data-message-id={entry.turnId || entry.id} data-scroll-anchor="false" from="assistant" className="mb-3 min-w-0">
                        <MessageContent>
                            {(() => {
                                const responseText = entry.parts
                                    .filter((part): part is Extract<ResponsePart, { kind: 'agent' }> => part.kind === 'agent')
                                    .map((part) => part.message.content.trim())
                                    .filter(Boolean)
                                    .join('\n\n');
                                const sources = entry.parts.flatMap((part) => part.kind === 'agent' ? getMessageSources(part.message) : [])
                                    .filter((source, sourceIndex, allSources) => allSources.findIndex((candidate) => (candidate.id || candidate.url || `${candidate.title}:${candidate.domain || ''}`) === (source.id || source.url || `${source.title}:${source.domain || ''}`)) === sourceIndex);
                                const status = entry.parts.some((part) => (
                                    (part.kind === 'tool' && part.tool.status === 'running') ||
                                    ((part.kind === 'thinking' || part.kind === 'agent') && matchesStreamingMessage(part.message, streamingMessageId))
                                )) ? 'streaming' as const : 'complete' as const;
                                return <StreamingResponse
                                    status={status}
                                    copyText={responseText || undefined}
                                    onRetry={previousUserMessage && onRetryResponse ? () => onRetryResponse(previousUserMessage.content) : undefined}
                                    announce={false}
                                    showActions={Boolean(responseText)}
                                    sources={sources}
                                    className="w-full"
                                    contentClassName="text-[var(--text-primary)]"
                                >
                                    <ResponseParts
                                        parts={entry.parts}
                                        text={text}
                                        lang={lang}
                                        streamingMessageId={streamingMessageId}
                                        onWorkflowAction={onWorkflowAction}
                                    />
                                </StreamingResponse>;
                            })()}
                        </MessageContent>
                    </Message>
                    )}
                </Fragment>;
            })}
            {isLoading && !hasStreamingMessage ? <Message data-testid="beegame-loading-message" from="assistant" className="mb-3 min-w-0"><MessageContent><ReasoningText phrases={[text.thinkingActive || text.aiProcessing || '']} variant="scramble" /></MessageContent></Message> : null}
        </MessageGroup>
    );
});

BeeGameCollaborationFeed.displayName = 'BeeGameCollaborationFeed';

function BeUiAgentActivity({
    items,
    status,
    duration,
}: {
    items: AgentActivityItem[];
    status: 'working' | 'complete';
    duration: number;
}) {
    return <div className="w-full" data-testid="beegame-agent-activity-group">
        <AgentActivity
            items={items}
            status={status}
            duration={duration}
            defaultOpen={false}
            className="w-full text-[var(--text-secondary)]"
        />
    </div>;
}

function ResponseParts({
    parts,
    text,
    lang,
    streamingMessageId,
    onWorkflowAction,
}: {
    parts: ResponsePart[];
    text: BeeGameText;
    lang: Language;
    streamingMessageId: string | null;
    onWorkflowAction?: (action: WorkflowCardAction) => Promise<void> | void;
}) {
    const rendered: ReactNode[] = [];
    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        const isActivityPart = part.kind === 'thinking' || part.kind === 'tool';
        if (isActivityPart) {
            const segmentStartIndex = index;
            const activityGroupId = 'activityGroupId' in part ? part.activityGroupId : undefined;
            const belongsToActivity = (candidate: ResponsePart) => {
                const candidateGroupId = 'activityGroupId' in candidate ? candidate.activityGroupId : undefined;
                if (activityGroupId) return candidateGroupId === activityGroupId;
                return (candidate.kind === 'thinking' || candidate.kind === 'tool') && !candidateGroupId;
            };
            while (index < parts.length && belongsToActivity(parts[index])) {
                index += 1;
            }
            index -= 1;
            const segmentParts = parts.slice(segmentStartIndex, index + 1).filter(
                (candidate): candidate is Extract<ResponsePart, { kind: 'thinking' | 'tool' }> => belongsToActivity(candidate),
            );
            const renderActivity = (activityParts: typeof segmentParts, key: string) => {
                if (!activityParts.length) return;
                const activityItems = activityParts.map((candidate) => toActivityItem(candidate));
                const activityTimestamps = activityParts.map((candidate) => candidate.timestamp).filter((timestamp) => Number.isFinite(timestamp));
                const activityDuration = activityTimestamps.length > 1
                    ? Math.max(0, (Math.max(...activityTimestamps) - Math.min(...activityTimestamps)) / 1000)
                    : 0;
                const activityStatus: 'working' | 'complete' = activityParts.some((candidate) => (
                    (candidate.kind === 'tool' && candidate.tool.status === 'running') ||
                    (candidate.kind === 'thinking' && matchesStreamingMessage(candidate.message, streamingMessageId))
                )) ? 'working' : 'complete';
                rendered.push(<BeUiAgentActivity key={`agent-activity-${key}`} items={activityItems} status={activityStatus} duration={activityDuration} />);
            };
            // A contiguous run is one beUI mixed activity. File previews follow the
            // activity while the tool invocation stays in its original row/order.
            renderActivity(segmentParts, `segment-${segmentStartIndex}`);
            const artifactTools = segmentParts
                .filter((candidate): candidate is Extract<ResponsePart, { kind: 'tool' }> => candidate.kind === 'tool')
                .map((candidate) => candidate.tool)
                .filter((tool) => Boolean(tool.diff));
            artifactTools.forEach((tool) => {
                const lines = parseDiffLines(tool.diff!);
                rendered.push(<FileDiff key={`agent-file-diff-${tool.id}`} file={tool.detail || tool.name} lines={lines} status={tool.status === 'running' ? 'streaming' : 'complete'} defaultOpen={false} copyText={lines.map((line) => line.content).join('\n')} />);
            });
            continue;
        }
        if (part.kind === 'workflow') {
            rendered.push(<div key={`workflow-${part.workflow.runId || 'current'}`} className="min-w-0" data-testid={`beegame-workflow-plan-${part.workflow.runId || 'current'}`} data-message-id={`beegame-workflow-${part.workflow.runId || 'current'}`}>
                <AgentTodoPlan workflow={part.workflow} text={text} onWorkflowAction={onWorkflowAction} />
            </div>);
            continue;
        }
        if (part.kind === 'todo') {
            rendered.push(<div key={`todo-${part.id}`} className="min-w-0" data-testid={`beegame-todo-event-${part.id}`}>
                <TodoList items={part.items} title="To-dos" defaultOpen collapseOnComplete className="w-full bg-transparent p-0" />
            </div>);
            continue;
        }
        rendered.push(<div key={`agent-${part.message.id}`} className="beegame-ai-prose min-w-0" data-slot="message-content" data-testid={`beegame-agent-message-${part.message.id}`} data-message-id={part.message.id}>
            <MarkdownRenderer content={part.message.content} messageId={part.message.id} lang={lang} />
        </div>);
    }
    return <>{rendered}</>;
}

function ContextUpdateSeparator({ text }: { text: BeeGameText }) {
    return (
        <MessageMarker
            data-testid="beegame-context-separator"
            data-slot="marker"
            data-variant="separator"
            className="type-muted bg-transparent py-2 text-[var(--text-muted)]"
        >
            {text.contextCompacted}
        </MessageMarker>
    );
}

function DateSeparator({ dateKey, label }: { dateKey: string; label: string }) {
    return (
        <MessageMarker
            data-testid="beegame-date-separator"
            data-date-key={dateKey}
            data-slot="marker"
            data-variant="separator"
            className="type-muted bg-transparent py-1 text-[var(--text-muted)]"
        >
            {label}
        </MessageMarker>
    );
}

function AgentTodoPlan({
    workflow,
    text,
    onWorkflowAction,
}: {
    workflow: WorkflowCardPayload;
    text: BeeGameText;
    onWorkflowAction?: (action: WorkflowCardAction) => Promise<void> | void;
}) {
    const sourceTasks = workflow.tasks?.length
        ? workflow.tasks
        : workflow.stageSnapshots?.flatMap(snapshot => (snapshot.tasks || []).map(task => ({ ...task, id: `${snapshot.stageId}:${task.id}` }))) || [];
    const progress = workflow.totalTaskCount
        ? Math.round(((workflow.completedTaskCount || 0) / workflow.totalTaskCount) * 100)
        : undefined;
    const items: TodoItem[] = sourceTasks.length
        ? sourceTasks.map(task => {
            const status: TodoItem['status'] = task.status === 'completed'
                ? 'completed'
                : task.status === 'running'
                    ? 'in-progress'
                    : task.status === 'failed' || task.status === 'blocked' || task.status === 'stopped'
                        ? 'cancelled'
                        : 'pending';
            const detail = task.failureReason || (task.durationMs !== undefined ? `${Math.max(0, Math.round(task.durationMs))}ms` : undefined);
            return {
                id: task.id,
                title: task.title,
                status,
                progress: status === 'completed' ? 100 : status === 'in-progress' ? progress : undefined,
                detail,
            };
        })
        : [{
            id: `${workflow.runId}:phase`,
            title: workflow.currentPhase || text.aiProcessing || '',
            status: workflow.status === 'completed' ? 'completed' : workflow.status === 'running' ? 'in-progress' : workflow.status === 'failed' || workflow.status === 'blocked' || workflow.status === 'cancelled' || workflow.status === 'stale' ? 'cancelled' : 'pending',
            progress,
            detail: workflow.block?.detail || workflow.block?.message || workflow.thinking,
        }];
    const isRunning = workflow.status === 'running' || workflow.status === 'verifying';
    const actionLabel = workflow.nextAction === 'resume'
        ? text.resume || 'Resume'
        : text.retry || 'Retry';

    return (
        <div className="w-full min-w-0 space-y-2" data-testid={`beegame-todo-plan-${workflow.runId}`}>
            <TodoList
                items={items}
                title={workflow.currentPhase || text.aiProcessing || ''}
                defaultOpen={isRunning}
                collapseOnComplete
                className="w-full bg-transparent p-0"
            />
            {workflow.nextAction && onWorkflowAction ? (
                <button
                    type="button"
                    data-testid={`beegame-workflow-action-${workflow.nextAction}`}
                    className="text-sm font-medium text-[var(--primary)] underline-offset-4 hover:underline"
                    onClick={() => void onWorkflowAction(workflow.nextAction!)}
                >
                    {actionLabel}
                </button>
            ) : null}
        </div>
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
            <MessageContent
            data-testid={`beegame-user-message-${message.id}`}
            className="group/message relative min-w-0 !items-start"
            >
                <MessageBubble variant="solid" className="max-w-full">
                    <MessageBubbleContent className="max-w-full">
                        <MarkdownRenderer content={message.content} messageId={message.id} lang={lang} bubble />
                    {onEdit ? <button
                        type="button"
                        aria-label="Edit message"
                        title="Edit message"
                        onClick={() => onEdit(message)}
                        className="absolute right-0 top-0 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-secondary)] opacity-0 transition-opacity hover:text-[var(--text-primary)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] group-hover/message:opacity-100"
                    >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button> : null}
                    </MessageBubbleContent>
                </MessageBubble>
            </MessageContent>
    );
}
