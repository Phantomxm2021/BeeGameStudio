import { RuntimeErrorNotice, type ModelRequestRetryControl } from './RuntimeErrorNotice';
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, Bot, Check, ChevronDown, CircleCheck, Copy, FileText, LoaderCircle, Minus, Pencil, Send, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type ChatDisplayMessage, type ChatDisplaySource } from '../../../viewModels/displayModels';
import { MarkdownRenderer } from './ChatMarkdownContent';
import type { Language } from '../AgentsConfig';
import { useBeeGameText, type BeeGameText } from '../../../i18n/useBeeGameTranslations';
import { Message } from '../../beui/registry/components/agents/message';
import {
    MessageMarker,
    MessageBubble,
    MessageBubbleContent,
    MessageContent,
    MessageGroup,
} from '../../beui/registry/components/agents/message';
import { AgentActivity, type AgentActivityItem } from '../../beui/registry/components/agents/agent-activity';
import { ReasoningText } from '../../beui/registry/components/agents/loading-states/reasoning-text';
import { StreamingResponse } from '../../beui/registry/components/agents/streaming-response';
import { Drawer } from '../../beui/registry/components/motion/drawer';
import { AnimatedBadge, type AnimatedBadgeStatus } from '../../beui/registry/components/motion/animated-badge';
import { Loader } from '../../beui/registry/components/motion/loader';
import { shortenAbsolutePathsForDisplay } from '../../../utils/chatPathDisplay';
import { activityToolKind, type ActivityToolKind } from '../../../utils/toolActivitySummary';
import { useSmoothStreamText } from '../../../hooks/useSmoothStreamText';
import { ArtifactCard } from './ArtifactCard';
import { ChatAttachmentView } from './ChatAttachmentView';
import { SubagentActivityView } from './SubagentActivityView';
import { ToolActivityRow } from './ToolActivityRow';
import { Button } from '../../beui/project-button';

type BeeGameCollaborationFeedProps = {
    messages: ChatDisplayMessage[];
    retry?: ModelRequestRetryControl;
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
    lang?: Language;
    currentUserDisplayName?: string;
    currentUserEmail?: string;
    currentUserAvatarUrl?: string;
    onEditMessage?: (message: ChatDisplayMessage) => void;
    editingMessageId?: string | null;
    editDraft?: string;
    onEditDraftChange?: (value: string) => void;
    onSubmitEdit?: () => void;
    onCancelEdit?: () => void;
    editDisabled?: boolean;
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
    subagentActivity?: ChatDisplayMessage['subagentActivity'];
    completionReason?: ChatDisplayMessage['completionReason'];
    id: string;
    name: string;
    status: 'running' | 'completed' | 'failed';
    detail: string;
    output: string;
    kind: ToolKind;
    timestamp: number;
    startedAt?: number;
    turnCompletedAt?: number;
    exitCode?: number;
    durationMs?: number;
    turnId?: string;
    toolUseId?: string;
    isSubagent?: boolean;
    subagentPrompt?: string;
    subagentOutput?: string;
    subagentTrace?: string;
    input?: unknown;
};

type ToolKind = ActivityToolKind;

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
    return message.taskKind === 'context_update' || raw.task_kind === 'context_update' ||
        message.taskKind === 'context_compaction' || raw.task_kind === 'context_compaction' ||
        message.taskKind === 'delivery_phase' || raw.task_kind === 'delivery_phase' ||
        message.taskKind === 'delivery_error' || raw.task_kind === 'delivery_error' ||
        message.taskKind === 'host_evidence' || raw.task_kind === 'host_evidence' ||
        message.taskKind === 'session_lifecycle' || raw.task_kind === 'session_lifecycle';
};

const displayText = (value: string): string => shortenAbsolutePathsForDisplay(value);

const getToolKind = (toolName?: string): ToolKind => activityToolKind(toolName || '');

const isHiddenPresentationTool = (toolName?: string): boolean => (
    String(toolName || '').trim().toLowerCase() === 'structuredoutput'
);

const normalizeToolMessage = (message: ToolFeedMessage): NormalizedTool | null => {
    const content = String(message.content || '');
    const name = String(message.toolName || message.tool || GENERIC_TOOL_NAME).trim() || GENERIC_TOOL_NAME;
    const rawStatus = String(message.toolStatus || message.tool_status || '').trim();
    const status: NormalizedTool['status'] = rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'running'
        ? rawStatus : (message.toolOutput || message.tool_output) ? 'completed' : 'running';
    const rawDetail = String(message.toolDetail || message.tool_detail || '').trim();
    const fullSubagentOutput = String(message.subagentOutput || '').trim();
    const output = fullSubagentOutput || String(message.toolOutput || message.tool_output || content).trim();
    const kind = getToolKind(name);
    if (!name && !rawDetail && !output) return null;
    return {
        id: message.id,
        name,
        status,
        completionReason: message.completionReason,
        detail: displayText(rawDetail),
        output,
        kind,
        timestamp: Number(message.timestamp || 0),
        startedAt: status === 'running' || (message.completionReason && message.turnCompletedAt) ? message.timestamp : undefined,
        turnCompletedAt: message.turnCompletedAt,
        exitCode: message.toolExitCode,
        durationMs: message.toolDurationMs,
        turnId: message.turnId || message.turn_id,
        toolUseId: message.toolUseId,
        isSubagent: Boolean(message.isSubagentTool),
        subagentPrompt: message.subagentPrompt,
        subagentOutput: message.subagentOutput,
        subagentTrace: message.subagentTrace,
        subagentActivity: message.subagentActivity,
        input: message.toolInput ?? message.tool_input,
    };
};

type ResponsePart =
    | { kind: 'thinking'; message: ChatDisplayMessage; timestamp: number; durationMs?: number; turnId?: string; activityGroupId?: string }
    | { kind: 'tool'; tool: NormalizedTool; timestamp: number; turnId?: string; activityGroupId?: string }
    | { kind: 'agent'; message: ChatDisplayMessage; sourceMessageId: string; timestamp: number; turnId?: string };

type AgentResponseTurn = {
    kind: 'response';
    id: string;
    turnId?: string;
    parts: ResponsePart[];
};

const responseHistoryAnchorId = (entry: AgentResponseTurn): string => {
    const lastPart = entry.parts.at(-1);
    return `response:${lastPart?.kind === 'tool' ? lastPart.tool.id : lastPart?.message.id || entry.id}`;
};

type FeedEntry =
    | { kind: 'user'; message: ChatDisplayMessage }
    | { kind: 'context'; message: ChatDisplayMessage }
    | AgentResponseTurn;

type AgentRunDetail = { tool: NormalizedTool };

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
                timestamp: Math.max(current.timestamp, tool.timestamp),
                startedAt: current.startedAt ?? tool.startedAt,
                exitCode: tool.exitCode ?? current.exitCode,
                durationMs: tool.durationMs ?? current.durationMs,
                input: tool.input ?? current.input,
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
                sourceMessageId: message.messageId || message.id,
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
            if (synthetic && synthetic.kind !== 'todo' && !isHiddenPresentationTool(synthetic.name)) {
                appendTool(turn, synthetic, activityGroupId);
            }
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
            if (synthetic && !isHiddenPresentationTool(synthetic.name)) {
                appendTool(turn, synthetic, activityGroupId);
            }
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
    if (message.completionReason || message.turnCompletedAt) return false;
    if (message.streamStatus) return message.streamStatus === 'streaming';
    if (!streamingMessageId) return false;
    const id = String(message.id || '');
    return id === streamingMessageId ||
        message.messageId === streamingMessageId ||
        id.startsWith(`${streamingMessageId}-block-`);
};

const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
const LONG_MARKDOWN_COLLAPSED_HEIGHT = 480;

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

const messageTimeLabel = (message: ChatDisplayMessage, lang: Language): string | undefined => {
    const timestamp = Number(message.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined;
    return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
        timeZone: SHANGHAI_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(new Date(timestamp));
};

const responseTimeLabel = (entry: AgentResponseTurn, lang: Language): string | undefined => {
    const completedAt = entry.parts
        .map((part) => part.kind === 'tool' ? part.tool.turnCompletedAt : part.message.turnCompletedAt)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const timestamps = entry.parts.map((part) => part.timestamp).filter(Number.isFinite);
    if (completedAt.length === 0 && timestamps.length === 0) return undefined;
    return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
        timeZone: SHANGHAI_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(new Date(Math.max(...(completedAt.length ? completedAt : timestamps))));
};

const feedEntryTimestamp = (entry: FeedEntry): number => {
    if (entry.kind === 'user' || entry.kind === 'context') return messageTimestamp(entry.message);
    return Math.min(...entry.parts.map((part) => part.timestamp));
};

const buildFeedEntries = (messages: ChatDisplayMessage[]): FeedEntry[] => {
    const entries: FeedEntry[] = [];
    const toolParts = new Map<string, ToolPartReference>();
    let activeTurn: AgentResponseTurn | null = null;

    const ensureTurn = (id: string, turnId?: string, reuseAnonymousActivity = false): AgentResponseTurn => {
        if (activeTurn && turnId && activeTurn.turnId === turnId) {
            return activeTurn;
        }
        if (reuseAnonymousActivity && activeTurn && !turnId && !activeTurn.turnId) {
            const lastPart = activeTurn.parts.at(-1);
            if (lastPart?.kind === 'thinking' || lastPart?.kind === 'tool') return activeTurn;
        }
        activeTurn = { kind: 'response', id, turnId, parts: [] };
        entries.push(activeTurn);
        return activeTurn;
    };

    for (const message of messages) {
        if (message.type === 'error') {
            entries.push({ kind: 'context', message });
            activeTurn = null;
            continue;
        }
        if (message.sender === 'user') {
            entries.push({ kind: 'user', message });
            activeTurn = null;
            continue;
        }

        if (isAgentMessage(message) && message.contentBlocks?.length) {
            const hasVisibleBlock = message.contentBlocks.some((block) => (
                block.type === 'text' ||
                block.type === 'thinking' ||
                (block.type === 'tool_use' && getToolKind(block.toolName) !== 'todo' && !isHiddenPresentationTool(block.toolName)) ||
                (block.type === 'tool_result' && !block.toolUseId)
            ));
            if (!hasVisibleBlock) continue;
            const turn = ensureTurn(message.id, message.turnId || message.turn_id);
            appendAssistantContentBlocks(turn, message, mergeToolPart.bind(null, toolParts));
            continue;
        }

        if (isThinkingMessage(message)) {
            const turn = ensureTurn(message.id, message.turnId || message.turn_id);
            turn.parts.push({
                kind: 'thinking',
                message,
                timestamp: messageTimestamp(message),
                durationMs: message.thinkingDurationMs,
                turnId: message.turnId || message.turn_id,
            });
            continue;
        }

        if (isContextUpdateMessage(message)) {
            entries.push({ kind: 'context', message });
            activeTurn = null;
            continue;
        }

        if (isToolMessage(message)) {
            const tool = normalizeToolMessage(message);
            if (!tool) continue;
            if (tool.kind === 'todo' || isHiddenPresentationTool(tool.name)) continue;
            const turn = ensureTurn(message.id, tool.turnId, true);
            mergeToolPart(toolParts, turn, tool);
            continue;
        }

        if (isAgentMessage(message)) {
            const turn = ensureTurn(message.id, message.turnId || message.turn_id);
            turn.parts.push({ kind: 'agent', message, sourceMessageId: message.messageId || message.id, timestamp: messageTimestamp(message), turnId: message.turnId || message.turn_id });
        }
    }

    // Parts already arrive in the runtime event order. Do not sort by a
    // display timestamp: replayed events can legitimately carry an older
    // timestamp while still appearing later in the response stream.
    return entries;
};

const hasLaterAgentResponseInTurn = (entries: FeedEntry[], entryIndex: number): boolean => {
    const entry = entries[entryIndex];
    if (entry.kind !== 'response') return false;
    for (const candidate of entries.slice(entryIndex + 1)) {
        if (candidate.kind === 'user') return false;
        if (candidate.kind !== 'response') continue;
        if (candidate.turnId !== entry.turnId) return false;
        if (candidate.parts.some((part) => part.kind === 'agent' && part.message.content.trim())) {
            return true;
        }
    }
    return false;
};

// Only the trailing assistant message is a final reply. Text before another
// thought/tool remains process commentary, including within mixed blocks.
const splitResponseParts = (parts: ResponsePart[], completed: boolean) => {
    const last = parts.at(-1);
    let finalStart = parts.length;
    if (completed && last?.kind === 'agent') {
        while (finalStart > 0) {
            const part = parts[finalStart - 1];
            if (part.kind !== 'agent' || part.sourceMessageId !== last.sourceMessageId) break;
            finalStart -= 1;
        }
    }
    return { activity: parts.slice(0, finalStart), final: parts.slice(finalStart) };
};

export const BeeGameCollaborationFeed = memo(({
    messages,
    retry,
    lang = 'en',
    onEditMessage,
    editingMessageId = null,
    editDraft = '',
    onEditDraftChange,
    onSubmitEdit,
    onCancelEdit,
    editDisabled = false,
    onPreviewArtifact,
    isLoading = false,
    streamingMessageId = null,
}: BeeGameCollaborationFeedProps) => {
    const text = useBeeGameText(lang);
    const [detail, setDetail] = useState<AgentRunDetail | null>(null);
    const entries = useMemo(() => {
        const result = buildFeedEntries(messages);
        // Transcript flags can outlive a worker after interruption or a missed
        // terminal event. The runtime busy signal owns whether activity is live.
        if (!isLoading) for (const entry of result) {
            if (entry.kind !== 'response') continue;
            for (const part of entry.parts) {
                if (part.kind === 'tool') {
                    if (part.tool.status === 'running' && !part.tool.completionReason)
                        part.tool = { ...part.tool, completionReason: 'incomplete' };
                } else if (matchesStreamingMessage(part.message, streamingMessageId)) {
                    part.message = { ...part.message, completionReason: 'incomplete', streamStatus: 'complete' };
                }
            }
        }
        return result;
    }, [messages, isLoading, streamingMessageId]);
    const latestResponseIndex = entries.reduce((last, entry, index) => entry.kind === 'response' ? index : last, -1);
    const latestUserIndex = entries.reduce((last, entry, index) => entry.kind === 'user' ? index : last, -1);
    const activeResponseIndex = latestResponseIndex > latestUserIndex ? latestResponseIndex : -1;
    const isCompacting = entries.some((entry, index) => index > latestUserIndex && entry.kind === 'context' &&
        entry.message.taskKind === 'context_compaction' && entry.message.streamStatus === 'streaming');
    const latestUserMessageId = [...entries].reverse().find(entry => entry.kind === 'user')?.message.id;
    const currentDetail = useMemo(() => {
        if (!detail) return null;
        for (const entry of entries) {
            if (entry.kind !== 'response') continue;
            for (const part of entry.parts) {
                if (part.kind === 'tool' && part.tool.id === detail.tool.id) return { ...detail, tool: part.tool };
            }
        }
        return detail;
    }, [detail, entries]);
    const hasStreamingMessage = Boolean(entries.some((entry) => entry.kind === 'response' && entry.parts.some((part) => (
        (part.kind === 'tool' && part.tool.status === 'running' && !part.tool.completionReason) ||
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

    const openDetail = (nextDetail: AgentRunDetail) => {
        setDetail(nextDetail);
    };

    return (
        <>
        <MessageGroup spacing="compact">
            {entriesWithDates.map(({ entry, dateKey, dateLabel, showDateSeparator }, entryIndex) => {
                const hasLaterResponseInTurn = entry.kind === 'response' && hasLaterAgentResponseInTurn(entries, entryIndex);
                return <Fragment key={entry.kind === 'user' || entry.kind === 'context' ? entry.message.id : entry.id}>
                    {showDateSeparator && dateKey && dateLabel ? <DateSeparator dateKey={dateKey} label={dateLabel} /> : null}
                    {entry.kind === 'user' ? (
                        <Message key={entry.message.id} data-message-id={entry.message.id} data-history-anchor-id={`user:${entry.message.id}`} data-scroll-anchor="false" from="user" className="mb-3 min-w-0"><UserMessageCard
                            message={entry.message}
                            lang={lang}
                            onEdit={entry.message.id === latestUserMessageId && entry.message.rewindAvailable ? onEditMessage : undefined}
                            isEditing={entry.message.id === latestUserMessageId && entry.message.rewindAvailable === true && editingMessageId === entry.message.id}
                            editDraft={editDraft}
                            onEditDraftChange={onEditDraftChange}
                            onSubmitEdit={onSubmitEdit}
                            onCancelEdit={onCancelEdit}
                            editDisabled={editDisabled}
                        /></Message>

                    ) : entry.kind === 'context' ? (
                        entry.message.type === 'error'
                            ? <RuntimeErrorNotice key={entry.message.id} content={displayText(entry.message.content)} lang={lang}
                                retry={retry?.messageId === entry.message.id ? retry : undefined} />
                            : entry.message.taskKind === 'context_compaction'
                            ? <CompactionMarker key={entry.message.id} message={entry.message} text={text} isLoading={isLoading} />
                            : <ContextUpdateSeparator key={entry.message.id} message={entry.message} text={text} lang={lang} />
                    ) : (
                    <Message
                        key={entry.id}
                        data-testid={`beegame-agent-turn-${entry.id}`}
                        data-message-id={entry.turnId || entry.id}
                        data-history-anchor-id={responseHistoryAnchorId(entry)}
                        data-scroll-anchor="false"
                        from="assistant"
                        className="mb-3 min-w-0"
                    >
                        <MessageContent>
                            {(() => {
                                const completedAt = entry.parts.map(part => part.kind === 'tool' ? part.tool.turnCompletedAt : part.message.turnCompletedAt)
                                    .filter((at): at is number => at !== undefined).at(-1);
                                const childRunning = entry.parts.some(part => part.kind === 'tool' && part.tool.isSubagent &&
                                    part.tool.status === 'running' && !part.tool.completionReason && !part.tool.turnCompletedAt);
                                const working = isLoading && entryIndex === activeResponseIndex && (!completedAt || childRunning);
                                const { activity, final } = splitResponseParts(entry.parts, !working && !hasLaterResponseInTurn);
                                const responseText = final
                                    .filter((part): part is Extract<ResponsePart, { kind: 'agent' }> => part.kind === 'agent')
                                    .map((part) => displayText(part.message.content.trim()))
                                    .filter(Boolean)
                                    .join('\n\n');
                                const sources = final.flatMap((part) => part.kind === 'agent' ? getMessageSources(part.message) : [])
                                    .filter((source, sourceIndex, allSources) => allSources.findIndex((candidate) => (candidate.id || candidate.url || `${candidate.title}:${candidate.domain || ''}`) === (source.id || source.url || `${source.title}:${source.domain || ''}`)) === sourceIndex);
                                const status = working ? 'streaming' as const : 'complete' as const;
                                const response = <StreamingResponse
                                    status={status}
                                    copyText={responseText || undefined}
                                    timeLabel={responseText && !hasLaterResponseInTurn && status === 'complete'
                                        ? responseTimeLabel(entry, lang) : undefined}
                                    announce={false}
                                    showActions={Boolean(responseText) && !hasLaterResponseInTurn}
                                    sources={sources}
                                    className="w-full"
                                    contentClassName="text-[var(--text-primary)]"
                                >
                                    {activity.length > 0 && <ActivityTimeline
                                        parts={activity}
                                        working={working}
                                        hasFinalResponse={final.length > 0}
                                        completedAt={completedAt}
                                        lang={lang}
                                        streamingMessageId={streamingMessageId}
                                        onOpenSubagent={(tool) => openDetail({ tool })}
                                        onPreviewArtifact={onPreviewArtifact}
                                    />}
                                    <ResponseParts parts={final} lang={lang} streamingMessageId={streamingMessageId}
                                        onPreviewArtifact={onPreviewArtifact} />
                                </StreamingResponse>;
                                return response;
                            })()}
                        </MessageContent>
                    </Message>
                    )}
                </Fragment>;
            })}
            {isLoading && !isCompacting && !hasStreamingMessage && activeResponseIndex < 0 ? <Message data-testid="beegame-loading-message" from="assistant" className="mb-3 min-w-0"><MessageContent><ReasoningText phrases={[text.waitingForModelResponse || text.aiProcessing || '']} variant="scramble" /></MessageContent></Message> : null}
        </MessageGroup>
        <Drawer
            open={Boolean(detail)}
            onOpenChange={(open) => { if (!open) setDetail(null); }}
            ariaLabel={lang === 'zh' ? 'Agent 执行详情' : 'Agent run details'}
            className="overflow-hidden"
        >
            {detail ? <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                <AgentRunDetailView
                    detail={currentDetail ?? detail}
                    lang={lang}
                    onBack={() => setDetail(null)}
                />
            </div> : null}
        </Drawer>
        </>
    );
});

BeeGameCollaborationFeed.displayName = 'BeeGameCollaborationFeed';

function toolActivityState(tool: NormalizedTool) {
    const state = tool.completionReason || tool.status;
    const endedAt = state === 'running' ? Date.now() : tool.turnCompletedAt ??
        (tool.status === 'running' ? undefined : tool.timestamp);
    const elapsed = tool.durationMs ?? (tool.startedAt === undefined || endedAt === undefined ? undefined
        : Math.max(0, endedAt - tool.startedAt));
    const seconds = elapsed === undefined ? undefined : Math.floor(elapsed / 1000);
    const duration = seconds === undefined ? '' : seconds < 1 ? '<1s' : seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return { state, duration };
}

function ToolActivity({ tool, lang }: { tool: NormalizedTool; lang: Language }) {
    const { state, duration } = toolActivityState(tool);
    return <ToolActivityRow id={tool.id} name={tool.name} input={tool.input} detail={tool.detail}
        state={state} duration={duration} lang={lang} />;
}

function ActivityTimeline({ parts, working, hasFinalResponse, completedAt, lang, streamingMessageId, onOpenSubagent, onPreviewArtifact }: {
    parts: ResponsePart[];
    working: boolean;
    hasFinalResponse: boolean;
    completedAt?: number;
    lang: Language;
    streamingMessageId: string | null;
    onOpenSubagent: (tool: NormalizedTool) => void;
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
}) {
    const text = useBeeGameText(lang).chatActivity;
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (!working) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [working]);
    // Use observed start/end times, never the sum of thinking durations.
    // Completed-only legacy tools have no known start, so omit their timer.
    const first = parts[0];
    const last = parts.at(-1);
    const startedAt = first?.kind === 'tool' ? first.tool.startedAt : first?.timestamp;
    const endedAt = working ? now : completedAt ?? (last?.kind === 'tool'
        ? last.tool.status !== 'running' && !last.tool.completionReason ? last.tool.timestamp : undefined
        : last?.kind === 'thinking' && last.durationMs !== undefined ? last.timestamp + last.durationMs : undefined);
    const elapsed = startedAt !== undefined && endedAt !== undefined && Number.isFinite(startedAt)
        && Number.isFinite(endedAt) && startedAt > 0 && endedAt >= startedAt ? endedAt - startedAt : undefined;
    const seconds = Math.floor((elapsed ?? 0) / 1000);
    const duration = elapsed === undefined ? '' : elapsed < 1000
        ? (lang === 'zh' ? '少于 1 秒' : 'less than 1s')
        : seconds < 60 ? (lang === 'zh' ? `${seconds} 秒` : `${seconds}s`)
        : lang === 'zh' ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const heading = `${text.details}${duration ? ` · ${duration}` : ''}`;
    const latestProgress = [...parts].reverse().find((part): part is Extract<ResponsePart, { kind: 'agent' }> =>
        part.kind === 'agent' && !part.message.requiresUserAction && messagePresentation(part.message) !== 'artifact');
    // Show the latest progress until a final reply arrives; keep artifacts and
    // requests accessible. Execution details contain tool records only.
    const visibleParts = parts.filter(part => part.kind === 'agent' && (
        part.message.requiresUserAction || messagePresentation(part.message) === 'artifact' ||
        (!hasFinalResponse && part.sourceMessageId === latestProgress?.sourceMessageId)
    ));
    const hasDetails = parts.some(part => part.kind === 'tool');
    return <>
        <ResponseParts parts={visibleParts} lang={lang} streamingMessageId={streamingMessageId} onPreviewArtifact={onPreviewArtifact} />
        {working && <div role="status" data-testid="beegame-work-status"
            className="my-3 flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 motion-safe:animate-spin" />
            {text.working}
        </div>}
        {hasDetails && <AgentActivity
        items={parts.flatMap((part, index): AgentActivityItem[] => {
            if (part.kind !== 'tool') return [];
            const isSubagent = (candidate: ResponsePart | undefined): boolean =>
                candidate?.kind === 'tool' && Boolean(candidate.tool.isSubagent || candidate.tool.kind === 'subagent');
            if (part.kind === 'tool' && isSubagent(part)) {
                if (isSubagent(parts[index - 1])) return [];
                const subagents = [part.tool];
                for (let next = index + 1; next < parts.length; next += 1) {
                    const candidate = parts[next];
                    if (candidate.kind !== 'tool' || !isSubagent(candidate)) break;
                    subagents.push(candidate.tool);
                }
                return [{ id: `activity-subagent-${part.tool.id}`, type: 'text',
                    content: <div className="my-1 flex max-w-full flex-wrap items-center gap-2" data-testid="beegame-subagent-row">
                        {subagents.map(tool => <SubagentToolSummary key={tool.id} tool={tool} lang={lang} onOpen={() => onOpenSubagent(tool)} />)}
                    </div>,
                }];
            }
            return [{ id: `activity-tool-${part.tool.id}`, type: 'text',
                content: <ToolActivity tool={part.tool} lang={lang} /> }];
        })}
        variant="timeline" defaultOpen={false} collapseOnComplete={false} maxHeight={360}
        status={working ? 'working' : 'complete'} activeLabel={heading} summary={heading}
        className="w-full text-[var(--text-secondary)]" contentClassName="pl-4" />}
    </>;
}

function subagentStatus(tool: NormalizedTool, lang: Language) {
    // Cancellation / incomplete snapshots are terminal, not successful completions.
    const state = tool.completionReason === 'stopped' || tool.completionReason === 'incomplete'
        ? tool.completionReason : tool.status;
    const labels: Record<typeof state, { status: AnimatedBadgeStatus; zh: string; en: string }> = {
        running: { status: 'loading', zh: '工作中', en: 'Working' },
        completed: { status: 'success', zh: '已完成', en: 'Completed' },
        failed: { status: 'danger', zh: '失败', en: 'Failed' },
        stopped: { status: 'neutral', zh: '已停止', en: 'Stopped' },
        incomplete: { status: 'warning', zh: '未完成', en: 'Incomplete' },
    };
    const { status, ...label } = labels[state];
    const text = lang.startsWith('zh') ? label.zh : label.en;
    return { state, status, text };
}

function SubagentStatusBadge({ tool, lang }: { tool: NormalizedTool; lang: Language }) {
    const { state, status, text } = subagentStatus(tool, lang);
    return <AnimatedBadge status={status} size="sm" contentKey={state}
        icon={state === 'completed' ? <CircleCheck className="size-3" /> : undefined}
        role="status" aria-label={text} aria-live="polite" aria-atomic="true"
        data-subagent-state={state} className="text-xs">
        {text}
    </AnimatedBadge>;
}

function subagentHash(id: string): number {
    let hash = 2166136261;
    for (let index = 0; index < id.length; index += 1) {
        hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
    }
    return hash >>> 0;
}

function subagentAvatarUrl(id: string): string {
    return `https://api.dicebear.com/10.x/bottts/svg?seed=bgs-${subagentHash(id).toString(36)}`;
}

const SUBAGENT_NAMES = ['Nova', 'Pico', 'Echo', 'Clover', 'Orbit', 'Milo', 'Luna', 'Pixel', 'Rune', 'Comet'];

function subagentDisplayName(tool: NormalizedTool): string {
    const name = tool.name.trim();
    if (name && !['agent', 'subagent', 'task'].includes(name.toLowerCase())) return name;
    return SUBAGENT_NAMES[subagentHash(tool.id) % SUBAGENT_NAMES.length];
}

function SubagentAvatar({ id }: { id: string }) {
    const src = subagentAvatarUrl(id);
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    return <span className="inline-flex size-[17px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-current/10" aria-hidden="true">
        {failedSrc === src ? <Bot className="size-3" /> : <img src={src} alt="" width={17} height={17}
            loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />}
    </span>;
}

const SubagentStateIcon = memo(function SubagentStateIcon({ state }: { state: ReturnType<typeof subagentStatus>['state'] }) {
    const reduceMotion = useReducedMotion();
    return <span className="ml-2 inline-flex size-[13px] shrink-0 items-center justify-center" aria-hidden="true">
        <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={state} className="inline-flex items-center justify-center"
                initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: reduceMotion ? 0 : 0.2 }}>
                {state === 'running' ? <Loader variant="dot-matrix" size={12} label="" className="text-current" />
                    : state === 'completed' ? <CircleCheck className="size-[13px]" />
                        : state === 'failed' ? <X className="size-[13px]" />
                            : state === 'incomplete' ? <AlertTriangle className="size-[13px]" />
                                : <Minus className="size-[13px]" />}
            </motion.span>
        </AnimatePresence>
    </span>;
});

function SubagentToolSummary({ tool, lang, onOpen }: { tool: NormalizedTool; lang: Language; onOpen: () => void }) {
    const name = subagentDisplayName(tool);
    const { state, status, text } = subagentStatus(tool, lang);
    return <div
        className="shrink-0"
        data-testid={`beegame-subagent-disclosure-${tool.id}`}
    >
        <AnimatedBadge
            role="button"
            tabIndex={0}
            status={status}
            size="md"
            showIcon={false}
            pulse={false}
            contentKey={tool.id}
            data-subagent-state={state}
            aria-label={`${name} · ${text}`}
            aria-haspopup="dialog"
            onClick={onOpen}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); }
            }}
            className="max-w-full cursor-pointer text-left outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
            <span className="inline-flex min-w-0 items-center gap-1.5">
                <SubagentAvatar id={tool.id} />
                <span className="min-w-0 max-w-40 truncate">{name}</span>
                <SubagentStateIcon state={state} />
            </span>
        </AnimatedBadge>
    </div>;
}

function AgentRunDetailView({
    detail,
    lang,
    onBack,
}: {
    detail: AgentRunDetail;
    lang: Language;
    onBack: () => void;
}) {
    const title = subagentDisplayName(detail.tool);
    const prompt = displayText(String(detail.tool.subagentPrompt || detail.tool.detail || '').trim());
    const output = detail.tool.status === 'running' ? '' : displayText(String(detail.tool.subagentOutput || detail.tool.output || '').trim());

    return <section className="min-w-0 space-y-4 px-1 py-2" data-testid="beegame-agent-run-detail">
        <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
            <button
                type="button"
                onClick={onBack}
                aria-label={lang === 'zh' ? '返回聊天' : 'Back to chat'}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
                <ArrowLeft aria-hidden="true" className="size-4" />
            </button>
            <Bot aria-hidden="true" className="size-4 shrink-0 text-[var(--text-secondary)]" />
            <div className="min-w-0 flex-1">
                <h2 className="type-chat-h3 truncate text-[var(--text-primary)]">{title}</h2>
            </div>
            <SubagentStatusBadge tool={detail.tool} lang={lang} />
        </header>
        <div className="space-y-4" data-testid={`beegame-subagent-detail-${detail.tool.id}`}>
            {prompt ? <section>
                <h3 className="mb-1 type-caption-1 font-medium text-[var(--text-muted)]">{lang === 'zh' ? '任务' : 'Task'}</h3>
                <MarkdownRenderer content={prompt} messageId={`${detail.tool.id}-subagent-task`} lang={lang} />
            </section> : null}
            {output ? <section>
                <h3 className="mb-1 type-caption-1 font-medium text-[var(--text-muted)]">{lang === 'zh' ? '结果' : 'Result'}</h3>
                <MarkdownRenderer content={output} messageId={`${detail.tool.id}-subagent-output`} lang={lang} />
            </section> : null}
            {detail.tool.subagentActivity ? <section>
                <h3 className="mb-1 type-caption-1 font-medium text-[var(--text-muted)]">{lang === 'zh' ? '执行记录' : 'Trace'}</h3>
                <SubagentActivityView activity={detail.tool.subagentActivity} lang={lang}
                    running={detail.tool.status === 'running' && !detail.tool.completionReason} />
            </section> : null}
        </div>
    </section>;
}

function ResponseParts({
    parts,
    lang,
    streamingMessageId,
    onPreviewArtifact,
}: {
    parts: ResponsePart[];
    lang: Language;
    streamingMessageId: string | null;
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
}) {
    const rendered: ReactNode[] = [];
    for (const part of parts) {
        if (part.kind !== 'agent') continue;
        const presentation = messagePresentation(part.message);
        if (presentation === 'artifact' && part.message.artifactId && onPreviewArtifact) {
            const title = displayText(part.message.documentTitle || (lang === 'zh' ? '项目产物' : 'Project artifact'));
            const content = displayText(part.message.content);
            rendered.push(<ArtifactCard
                key={`artifact-${part.message.id}`}
                title={title}
                sender={part.message.sender}
                content={content}
                artifactType={part.message.artifactType}
                onPreview={() => onPreviewArtifact(part.message.artifactId!, title, content)}
            />);
            continue;
        }
        rendered.push(<LongMarkdownMessage
            key={`agent-${part.message.id}`}
            message={part.message}
            lang={lang}
            collapsible={!matchesStreamingMessage(part.message, streamingMessageId)}
            streaming={matchesStreamingMessage(part.message, streamingMessageId)}
            presentation={presentation}
        />);
    }
    return <>{rendered}</>;
}

function LongMarkdownMessage({
    message,
    lang,
    collapsible,
    streaming,
    presentation,
}: {
    message: ChatDisplayMessage;
    lang: Language;
    collapsible: boolean;
    streaming: boolean;
    presentation: MessagePresentation;
}) {
    const content = displayText(message.content);
    const visibleContent = useSmoothStreamText(content, streaming);
    const contentRef = useRef<HTMLDivElement>(null);
    const [isLong, setIsLong] = useState(false);
    const [open, setOpen] = useState(false);
    const contentId = `beegame-long-markdown-${message.id}`;

    useLayoutEffect(() => {
        if (!collapsible) {
            setIsLong(false);
            return;
        }
        const node = contentRef.current;
        if (!node) return;
        const measure = () => {
            const renderedHeight = node.scrollHeight;
            // jsdom has no layout engine; the fallback only keeps the behavior
            // testable there. Real browsers always use the rendered height.
            const testEnvironmentFallback = renderedHeight === 0 && content.length >= 1_200;
            setIsLong(renderedHeight > LONG_MARKDOWN_COLLAPSED_HEIGHT || testEnvironmentFallback);
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, [collapsible, content]);

    const characterCount = useMemo(() => content.replace(/\s/g, '').length, [content]);
    const moreLabel = lang === 'zh'
        ? `展开全文 · ${characterCount.toLocaleString('zh-CN')} 字`
        : `Show full response · ${characterCount.toLocaleString('en-US')} chars`;

    return <div
        className={`beegame-ai-prose min-w-0 ${presentation === 'article' ? 'rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3' : ''}`}
        data-slot="message-content"
        data-testid={`beegame-agent-message-${message.id}`}
        data-message-id={message.id}
    >
        {presentation === 'article' ? <div
            data-testid={`beegame-article-message-${message.id}`}
            className="mb-3 flex items-center gap-1.5 border-b border-[var(--border-subtle)] pb-2 type-caption-1 font-medium text-[var(--text-muted)]"
        >
            <FileText aria-hidden="true" className="h-3.5 w-3.5" />
            <span>{lang === 'zh' ? '详细内容' : 'Detailed content'}</span>
        </div> : null}
        <div className="relative min-w-0">
            <div
                ref={contentRef}
                id={contentId}
                className={isLong && !open ? 'overflow-hidden' : undefined}
                style={isLong && !open ? { maxHeight: LONG_MARKDOWN_COLLAPSED_HEIGHT } : undefined}
            >
                <MarkdownRenderer content={visibleContent} messageId={message.id} lang={lang} streaming={streaming} />
            </div>
            {isLong && !open ? <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-[var(--background)]"
            /> : null}
        </div>
        {isLong ? <button
            type="button"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={() => setOpen((current) => !current)}
            className="mx-auto mt-2 flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
            <span>{open ? (lang === 'zh' ? '收起全文' : 'Show less') : moreLabel}</span>
            <ChevronDown
                aria-hidden="true"
                className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
            />
        </button> : null}
    </div>;
}

type MessagePresentation = 'chat' | 'article' | 'artifact';

/**
 * Presentation is an explicit producer contract. We deliberately never infer an
 * article from prose length or Markdown syntax: normal conversational replies
 * can be long too, and must retain the lightweight chat treatment.
 */
function messagePresentation(message: ChatDisplayMessage): MessagePresentation {
    const hint = String(message.renderHint || '').trim().toLowerCase();
    if ((hint === 'artifact_card' || message.type === 'artifact_card') && message.artifactId) return 'artifact';
    if (hint === 'article' || hint === 'document' || message.isDocument) return 'article';
    return 'chat';
}

const deliveryPhaseLabels: Record<string, Record<string, string>> = {
    en: { brief: 'Production brief', playable: 'Integrated playable sample', production: 'Completing release', legacy: 'Retired workflow — migration required', author: 'Writing documents', review: 'Reviewing documents', revision: 'Revising documents', resources: 'Preparing resources', content: 'Building scene and UI content', implementation: 'Implementing game', acceptance: 'Verifying delivery', complete: 'Delivery complete' },
    zh: { brief: '制作说明', playable: '代表性可玩样板', production: '完善首发游戏', legacy: '旧流程已退役，需迁移', author: '编写项目文档', review: '评审文档', revision: '修订文档', resources: '准备资源', content: '构建场景与 UI 内容', implementation: '实现游戏', acceptance: '交付验收', complete: '交付完成' },
    'zh-TW': { brief: '製作說明', playable: '代表性可玩樣板', production: '完善首發遊戲', legacy: '舊流程已退役，需遷移', author: '編寫專案文件', review: '審查文件', revision: '修訂文件', resources: '準備資源', content: '建立場景與 UI 內容', implementation: '實作遊戲', acceptance: '交付驗收', complete: '交付完成' },
    ja: { brief: '制作方針', playable: '統合プレイサンプル', production: '初回リリース制作', legacy: '旧フロー移行が必要', author: 'ドキュメント作成', review: 'ドキュメント審査', revision: 'ドキュメント修正', resources: 'アセット準備', content: 'シーンと UI の構築', implementation: 'ゲーム実装', acceptance: '納品検証', complete: '納品完了' },
    ko: { brief: '제작 개요', playable: '통합 플레이 샘플', production: '출시 제작', legacy: '이전 흐름 이관 필요', author: '문서 작성', review: '문서 검토', revision: '문서 수정', resources: '리소스 준비', content: '장면 및 UI 구성', implementation: '게임 구현', acceptance: '납품 검증', complete: '납품 완료' },
};

function ContextUpdateSeparator({ message, text, lang }: { message: ChatDisplayMessage; text: BeeGameText; lang: Language }) {
    if (message.taskKind === 'host_evidence') return (
        <aside data-testid="beegame-host-evidence" aria-label="BGS host evidence" className="my-2 rounded border border-[var(--border-subtle)] p-3 text-sm whitespace-pre-wrap">
            {displayText(message.content)}
        </aside>
    );
    const labels = deliveryPhaseLabels[lang] || deliveryPhaseLabels.en;
    const label = message.taskKind === 'delivery_error' ? displayText(message.content)
        : message.taskKind === 'delivery_phase' ? labels[message.content] || message.content
        : message.taskKind === 'session_lifecycle'
            ? message.content === 'stopped' ? lang === 'zh' ? '任务已停止' : lang === 'zh-TW' ? '任務已停止' : lang === 'ja' ? 'タスク停止' : lang === 'ko' ? '작업 중지' : 'Task stopped'
                : lang === 'zh' ? '任务已恢复' : lang === 'zh-TW' ? '任務已恢復' : lang === 'ja' ? 'タスク再開' : lang === 'ko' ? '작업 재개' : 'Task resumed'
            : text.contextUpdate;
    return (
        <MessageMarker
            data-testid="beegame-context-separator"
            data-slot="marker"
            data-variant="separator"
            className="type-muted bg-transparent py-2 text-[var(--text-muted)]"
        >
            {label}
        </MessageMarker>
    );
}

function CompactionMarker({ message, text, isLoading }: { message: ChatDisplayMessage; text: BeeGameText; isLoading?: boolean }) {
    const running = message.streamStatus === 'streaming' && isLoading;
    const stopped = message.streamStatus === 'streaming' && !isLoading;
    return (
        <MessageMarker
            data-testid="beegame-compaction-marker"
            data-slot="marker"
            data-variant={running ? 'status' : 'separator'}
            role={running ? 'status' : undefined}
            className="type-muted bg-transparent py-2 text-[var(--text-muted)]"
        >
            {running ? <LoaderCircle aria-hidden="true" className="mr-2 size-3.5 animate-spin" /> : null}
            {running ? text.contextCompacting : stopped ? text.contextCompactionStopped : text.contextCompacted}
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

const userMessageActionLabels: Record<Language, { copy: string; copied: string; edit: string; cancel: string; send: string; placeholder: string }> = {
    en: { copy: 'Copy message', copied: 'Message copied', edit: 'Edit message', cancel: 'Cancel', send: 'Send edit', placeholder: 'Edit your message…' },
    zh: { copy: '复制消息', copied: '已复制消息', edit: '编辑消息', cancel: '取消', send: '发送修改', placeholder: '编辑你的消息…' },
    'zh-TW': { copy: '複製訊息', copied: '已複製訊息', edit: '編輯訊息', cancel: '取消', send: '送出修改', placeholder: '編輯你的訊息…' },
    ja: { copy: 'メッセージをコピー', copied: 'コピーしました', edit: 'メッセージを編集', cancel: 'キャンセル', send: '変更を送信', placeholder: 'メッセージを編集…' },
    ko: { copy: '메시지 복사', copied: '복사됨', edit: '메시지 편집', cancel: '취소', send: '수정 전송', placeholder: '메시지 편집…' },
    fr: { copy: 'Copier le message', copied: 'Message copié', edit: 'Modifier le message', cancel: 'Annuler', send: 'Envoyer la modification', placeholder: 'Modifier votre message…' },
    de: { copy: 'Nachricht kopieren', copied: 'Nachricht kopiert', edit: 'Nachricht bearbeiten', cancel: 'Abbrechen', send: 'Änderung senden', placeholder: 'Nachricht bearbeiten…' },
    es: { copy: 'Copiar mensaje', copied: 'Mensaje copiado', edit: 'Editar mensaje', cancel: 'Cancelar', send: 'Enviar cambio', placeholder: 'Edita tu mensaje…' },
    it: { copy: 'Copia messaggio', copied: 'Messaggio copiato', edit: 'Modifica messaggio', cancel: 'Annulla', send: 'Invia modifica', placeholder: 'Modifica il tuo messaggio…' },
    pt: { copy: 'Copiar mensagem', copied: 'Mensagem copiada', edit: 'Editar mensagem', cancel: 'Cancelar', send: 'Enviar alteração', placeholder: 'Edite sua mensagem…' },
};

function UserMessageCard({
    message,
    lang,
    onEdit,
    isEditing,
    editDraft,
    onEditDraftChange,
    onSubmitEdit,
    onCancelEdit,
    editDisabled,
}: {
    message: ChatDisplayMessage;
    lang: Language;
    onEdit?: (message: ChatDisplayMessage) => void;
    isEditing: boolean;
    editDraft: string;
    onEditDraftChange?: (value: string) => void;
    onSubmitEdit?: () => void;
    onCancelEdit?: () => void;
    editDisabled: boolean;
}) {
    const [copied, setCopied] = useState(false);
    const copyTimer = useRef<number | undefined>(undefined);
    const editInputRef = useRef<HTMLTextAreaElement>(null);
    const labels = userMessageActionLabels[lang];
    const timeLabel = messageTimeLabel(message, lang);
    const handleCopy = async () => {
        if (!navigator.clipboard?.writeText || !message.content) return;
        try {
            await navigator.clipboard.writeText(message.content);
            setCopied(true);
            if (copyTimer.current) window.clearTimeout(copyTimer.current);
            copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
        } catch {
            setCopied(false);
        }
    };

    useEffect(() => () => {
        if (copyTimer.current) window.clearTimeout(copyTimer.current);
    }, []);

    useEffect(() => {
        if (!isEditing) return;
        editInputRef.current?.focus();
        const end = editInputRef.current?.value.length ?? 0;
        editInputRef.current?.setSelectionRange(end, end);
    }, [isEditing]);

    useLayoutEffect(() => {
        if (!isEditing || !editInputRef.current) return;
        const input = editInputRef.current;
        input.style.height = 'auto';
        input.style.height = `${Math.min(input.scrollHeight, 320)}px`;
        input.style.overflowY = input.scrollHeight > 320 ? 'auto' : 'hidden';
    }, [editDraft, isEditing]);

    return (
            <MessageContent
            data-testid={`beegame-user-message-${message.id}`}
            className="group/message min-w-0 !items-start"
            >
                <div className="w-full min-w-0">
                    {isEditing ? <div
                        data-testid={`beegame-user-message-edit-input-${message.id}`}
                        className="w-full min-w-0"
                    >
                        <div className="flex min-h-[200px] w-full min-w-0 flex-col rounded-[24px] border border-[var(--border)] bg-[var(--surface-3)] p-6 shadow-none">
                            <textarea
                                ref={editInputRef}
                                aria-label={labels.edit}
                                data-testid={`beegame-user-message-edit-textarea-${message.id}`}
                                value={editDraft}
                                onChange={event => onEditDraftChange?.(event.target.value)}
                                onKeyDown={event => {
                                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                        event.preventDefault();
                                        if (!editDisabled && editDraft.trim()) onSubmitEdit?.();
                                    }
                                }}
                                disabled={editDisabled}
                                rows={2}
                                placeholder={labels.placeholder}
                                className="type-chat-body box-border block min-h-[112px] w-full min-w-0 max-w-full flex-1 resize-none rounded-lg border border-transparent bg-transparent px-0 py-0 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus-visible:border-transparent focus-visible:ring-0 disabled:opacity-60"
                            />
                            <div className="mt-auto flex justify-end gap-2 pt-4">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    aria-label={labels.cancel}
                                    onClick={onCancelEdit}
                                    disabled={editDisabled}
                                    className="rounded-full text-[var(--text-secondary)]"
                                >
                                    <X className="h-3.5 w-3.5" aria-hidden="true" />{labels.cancel}
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    aria-label={labels.send}
                                    onClick={onSubmitEdit}
                                    disabled={editDisabled || !editDraft.trim()}
                                    className="rounded-full"
                                >
                                    <Send className="h-3.5 w-3.5" aria-hidden="true" />{labels.send}
                                </Button>
                            </div>
                        </div>
                    </div> : (
                        <MessageBubble variant="solid" className="max-w-full">
                            <MessageBubbleContent className="max-w-full">
                                <MarkdownRenderer content={message.content} messageId={message.id} lang={lang} bubble />
                                {message.attachments?.length ? <div className="chat-image-gallery">
                                    {message.attachments.map((attachment, index) => <ChatAttachmentView key={index} attachment={attachment} lang={lang} />)}
                                </div> : null}
                            </MessageBubbleContent>
                        </MessageBubble>
                    )}
                </div>
                {!isEditing && (message.content || onEdit) ? <div
                    data-testid={`beegame-user-message-actions-${message.id}`}
                    className="flex w-full items-center justify-end gap-1 px-2 pt-1 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100"
                >
                    {timeLabel ? <time
                        dateTime={new Date(Number(message.timestamp)).toISOString()}
                        className="type-caption-2 tabular-nums text-[var(--text-muted)]"
                    >{timeLabel}</time> : null}
                    {message.content ? <button
                        type="button"
                        aria-label={copied ? userMessageActionLabels[lang].copied : userMessageActionLabels[lang].copy}
                        title={copied ? userMessageActionLabels[lang].copied : userMessageActionLabels[lang].copy}
                        onClick={() => void handleCopy()}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                        {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button> : null}
                    {onEdit ? <button
                        type="button"
                        aria-label={labels.edit}
                        title={labels.edit}
                        onClick={() => onEdit(message)}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button> : null}
                </div> : null}
            </MessageContent>
    );
}
