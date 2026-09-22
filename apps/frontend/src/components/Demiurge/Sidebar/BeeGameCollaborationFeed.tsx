import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Bot, ChevronDown, ChevronRight, FileText, Pencil } from 'lucide-react';
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
import { FileDiff, type FileDiffLine } from '../../beui/registry/components/agents/file-diff';
import { ReasoningText } from '../../beui/registry/components/agents/loading-states/reasoning-text';
import { StreamingResponse } from '../../beui/registry/components/agents/streaming-response';
import { ToolResult, ToolResultOutput } from '../../beui/registry/components/agents/tool-result';
import { Drawer } from '../../beui/registry/components/motion/drawer';
import { AnimatedBadge, type AnimatedBadgeStatus } from '../../beui/registry/components/motion/animated-badge';
import { shortenAbsolutePathsForDisplay } from '../../../utils/chatPathDisplay';
import { ArtifactCard } from './ArtifactCard';
import { chatStageLabels } from '../../../utils/chatStageLabels';
import { ChatAttachmentView } from './ChatAttachmentView';
import { SubagentActivityView } from './SubagentActivityView';

type BeeGameCollaborationFeedProps = {
    messages: ChatDisplayMessage[];
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
    lang?: Language;
    currentUserDisplayName?: string;
    currentUserEmail?: string;
    currentUserAvatarUrl?: string;
    onEditMessage?: (message: ChatDisplayMessage) => void;
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
    attachments?: ChatDisplayMessage['attachments'];
    completionReason?: ChatDisplayMessage['completionReason'];
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
    stage?: WorkflowStage;
};

type ToolKind = 'search' | 'read' | 'write' | 'edit' | 'bash' | 'todo' | 'subagent' | 'generic';
type WorkflowStage =
    | 'author'
    | 'content'
    | 'reviewer'
    | 'revision'
    | 'resources'
    | 'implementation'
    | 'acceptance';

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

const displayText = (value: string): string => shortenAbsolutePathsForDisplay(value);

const getToolKind = (toolName?: string): ToolKind => {
    const normalized = String(toolName || '').trim().toLowerCase();
    if (normalized === 'search' || normalized === 'grep' || normalized === 'glob' || normalized === 'websearch' || normalized === 'web_search') return 'search';
    if (normalized === 'todowrite' || normalized === 'todo_write') return 'todo';
    if (normalized === 'read') return 'read';
    if (normalized === 'write') return 'write';
    if (normalized === 'edit' || normalized === 'multiedit') return 'edit';
    if (normalized === 'bash') return 'bash';
    if (normalized === 'agent' || normalized === 'task' || normalized === 'subagent') return 'subagent';
    return 'generic';
};

const isHiddenPresentationTool = (toolName?: string): boolean => (
    String(toolName || '').trim().toLowerCase() === 'structuredoutput'
);

const inferWorkflowStage = (value: string): WorkflowStage | undefined => {
    const normalized = value.toLowerCase();
    if (normalized.includes('foundation-authoring')) return 'author';
    if (normalized.includes('foundation-reviewer') || normalized.includes('foundation-review')) return 'reviewer';
    return undefined;
};

const workflowStage = (message: ChatDisplayMessage): WorkflowStage | undefined => {
    const taskKind = String(message.taskKind || '').trim();
    if (taskKind.startsWith('workflow_stage:')) {
        const stage = taskKind.slice('workflow_stage:'.length) as WorkflowStage;
        return ['author', 'content', 'reviewer', 'revision', 'resources', 'implementation', 'acceptance'].includes(stage)
            ? stage
            : undefined;
    }

    // Read existing persisted worker history as a stage during the migration.
    // New events are normalized by the adapter above and never reach this path.
    const workerType = taskKind.startsWith('workflow_worker:')
        ? taskKind.slice('workflow_worker:'.length)
        : '';
    const stages: Record<string, WorkflowStage> = {
        'document-author': 'author',
        'content-author': 'content',
        'foundation-reviewer': 'reviewer',
        'foundation-document-reviser': 'revision',
        'resource-planner': 'resources',
        'implementation-worker': 'implementation',
        'acceptance-validator': 'acceptance',
    };
    return stages[workerType];
};

const isLocalSearchTool = (tool: NormalizedTool): boolean => {
    const normalized = tool.name.trim().toLowerCase();
    return normalized === 'search' || normalized === 'grep' || normalized === 'glob';
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
        completionReason: message.completionReason,
        attachments: message.attachments,
        detail: displayText(stripStructuredDetailLabel(rawDetail)),
        output,
        diff: diff ? displayText(diff) : undefined,
        artifactId: String(message.artifactId || message.artifact_id || '').trim() || undefined,
        kind,
        timestamp: Number(message.timestamp || 0),
        turnId: message.turnId || message.turn_id,
        toolUseId: message.toolUseId,
        isSubagent: Boolean(message.isSubagentTool),
        subagentPrompt: message.subagentPrompt,
        subagentOutput: message.subagentOutput,
        subagentTrace: message.subagentTrace,
        subagentActivity: message.subagentActivity,
        input: message.toolInput ?? message.tool_input,
        before: message.toolBefore ?? message.tool_before,
        after: message.toolAfter ?? message.tool_after,
        stage: workflowStage(message) || inferWorkflowStage(`${rawDetail}\n${content}`),
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
            content: displayText(part.message.thought || part.message.content || 'Thinking'),
        };
    }
    // This feed has one compact activity presentation for every tool kind.
    // Keeping search as a `tool` as well prevents a search + command batch
    // from silently becoming beUI's generic "mixed" activity.
    return {
        id: `activity-tool-${part.tool.id}`,
        type: 'tool',
        action: getActivityToolAction(part.tool),
        target: displayText(part.tool.detail || part.tool.name),
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
    | { kind: 'thinking'; message: ChatDisplayMessage; timestamp: number; durationMs?: number; turnId?: string; activityGroupId?: string }
    | { kind: 'tool'; tool: NormalizedTool; timestamp: number; turnId?: string; activityGroupId?: string }
    | { kind: 'agent'; message: ChatDisplayMessage; timestamp: number; turnId?: string };

type AgentResponseTurn = {
    kind: 'response';
    id: string;
    turnId?: string;
    parts: ResponsePart[];
    stage?: WorkflowStage;
};

type FeedEntry =
    | { kind: 'user'; message: ChatDisplayMessage }
    | { kind: 'context'; message: ChatDisplayMessage }
    | AgentResponseTurn;

type AgentRunDetail = { kind: 'subagent' | 'tool'; tool: NormalizedTool };

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
                attachments: tool.attachments ?? current.attachments,
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
            if (synthetic && synthetic.kind !== 'todo' && !isHiddenPresentationTool(synthetic.name)) {
                turn.stage ||= synthetic.stage;
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
                turn.stage ||= synthetic.stage;
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
    if (message.streamStatus) return message.streamStatus === 'streaming';
    if (!streamingMessageId) return false;
    const id = String(message.id || '');
    const legacyMessageId = (message as ChatDisplayMessage & { message_id?: string }).message_id;
    return id === streamingMessageId ||
        message.messageId === streamingMessageId ||
        legacyMessageId === streamingMessageId ||
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

const feedEntryTimestamp = (entry: FeedEntry): number => {
    if (entry.kind === 'user' || entry.kind === 'context') return messageTimestamp(entry.message);
    return Math.min(...entry.parts.map((part) => part.timestamp));
};

const buildFeedEntries = (messages: ChatDisplayMessage[]): FeedEntry[] => {
    const entries: FeedEntry[] = [];
    const toolParts = new Map<string, ToolPartReference>();
    let activeTurn: AgentResponseTurn | null = null;

    const ensureTurn = (id: string, turnId?: string, reuseAnonymousActivity = false, stage?: WorkflowStage): AgentResponseTurn => {
        if (activeTurn && turnId && activeTurn.turnId === turnId) {
            activeTurn.stage ||= stage;
            return activeTurn;
        }
        if (reuseAnonymousActivity && activeTurn && !turnId && !activeTurn.turnId) {
            const lastPart = activeTurn.parts.at(-1);
            if (lastPart?.kind === 'thinking' || lastPart?.kind === 'tool') return activeTurn;
        }
        activeTurn = { kind: 'response', id, turnId, parts: [], stage };
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
            const hasVisibleBlock = message.contentBlocks.some((block) => (
                block.type === 'text' ||
                block.type === 'thinking' ||
                (block.type === 'tool_use' && getToolKind(block.toolName) !== 'todo' && !isHiddenPresentationTool(block.toolName)) ||
                (block.type === 'tool_result' && !block.toolUseId)
            ));
            if (!hasVisibleBlock) continue;
            const turn = ensureTurn(message.id, message.turnId || message.turn_id, false, workflowStage(message));
            appendAssistantContentBlocks(turn, message, mergeToolPart.bind(null, toolParts));
            continue;
        }

        if (isThinkingMessage(message)) {
            const turn = ensureTurn(message.id, message.turnId || message.turn_id, false, workflowStage(message));
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
            const turn = ensureTurn(message.id, tool.turnId, true, workflowStage(message));
            turn.stage ||= tool.stage;
            mergeToolPart(toolParts, turn, tool);
            continue;
        }

        if (isAgentMessage(message)) {
            const turn = ensureTurn(message.id, message.turnId || message.turn_id, false, workflowStage(message));
            turn.parts.push({ kind: 'agent', message, timestamp: messageTimestamp(message), turnId: message.turnId || message.turn_id });
        }
    }

    // Parts already arrive in the runtime event order. Do not sort by a
    // display timestamp: replayed events can legitimately carry an older
    // timestamp while still appearing later in the response stream.
    return entries;
};

const hasLaterAgentResponseBeforeUser = (entries: FeedEntry[], entryIndex: number): boolean => {
    for (const candidate of entries.slice(entryIndex + 1)) {
        if (candidate.kind === 'user') return false;
        if (candidate.kind === 'response' && candidate.parts.some((part) => part.kind === 'agent' && part.message.content.trim())) {
            return true;
        }
    }
    return false;
};

export const BeeGameCollaborationFeed = memo(({
    messages,
    lang = 'en',
    onEditMessage,
    onPreviewArtifact,
    isLoading = false,
    streamingMessageId = null,
}: BeeGameCollaborationFeedProps) => {
    const text = useBeeGameText(lang);
    const [detail, setDetail] = useState<AgentRunDetail | null>(null);
    const entries = useMemo(() => buildFeedEntries(messages), [messages]);
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
        (part.kind === 'tool' && part.tool.status === 'running') ||
        ((part.kind === 'thinking' || part.kind === 'agent') && matchesStreamingMessage(part.message, streamingMessageId))
    ))));
    const entriesWithDates = useMemo(() => {
        const dateKeys = entries.map((entry) => calendarDateKey(feedEntryTimestamp(entry)));
        let previousStage: WorkflowStage | undefined;
        return entries.map((entry, index) => {
            const dateKey = dateKeys[index];
            const stage = entry.kind === 'response' ? entry.stage : undefined;
            const showStageSeparator = Boolean(stage && stage !== previousStage);
            if (stage) previousStage = stage;
            return {
                entry,
                dateKey,
                dateLabel: dateKey ? calendarDateLabel(feedEntryTimestamp(entry), lang) : undefined,
                showDateSeparator: Boolean(dateKey && dateKey !== dateKeys[index - 1]),
                showStageSeparator,
                stage,
            };
        });
    }, [entries, lang]);

    const openDetail = (nextDetail: AgentRunDetail) => {
        setDetail(nextDetail);
    };

    return (
        <>
        <MessageGroup spacing="compact">
            {entriesWithDates.map(({ entry, dateKey, dateLabel, showDateSeparator, showStageSeparator, stage }, entryIndex) => {
                const hasLaterResponseInConversationTurn = entry.kind === 'response' && hasLaterAgentResponseBeforeUser(entries, entryIndex);
                return <Fragment key={entry.kind === 'user' || entry.kind === 'context' ? entry.message.id : entry.id}>
                    {showDateSeparator && dateKey && dateLabel ? <DateSeparator dateKey={dateKey} label={dateLabel} /> : null}
                    {showStageSeparator && stage ? <StageSeparator stage={stage} lang={lang} /> : null}
                    {entry.kind === 'user' ? (
                        <Message key={entry.message.id} data-message-id={entry.message.id} data-scroll-anchor="false" from="user" className="mb-3 min-w-0"><UserMessageCard
                            message={entry.message}
                            lang={lang}
                            onEdit={onEditMessage}
                        /></Message>

                    ) : entry.kind === 'context' ? (
                        <ContextUpdateSeparator key={entry.message.id} text={text} />
                    ) : (
                    <Message
                        key={entry.id}
                        data-testid={`beegame-agent-turn-${entry.id}`}
                        data-message-id={entry.turnId || entry.id}
                        data-scroll-anchor="false"
                        from="assistant"
                        className="mb-3 min-w-0"
                    >
                        <MessageContent>
                            {(() => {
                                const responseText = entry.parts
                                    .filter((part): part is Extract<ResponsePart, { kind: 'agent' }> => part.kind === 'agent')
                                    .map((part) => displayText(part.message.content.trim()))
                                    .filter(Boolean)
                                    .join('\n\n');
                                const sources = entry.parts.flatMap((part) => part.kind === 'agent' ? getMessageSources(part.message) : [])
                                    .filter((source, sourceIndex, allSources) => allSources.findIndex((candidate) => (candidate.id || candidate.url || `${candidate.title}:${candidate.domain || ''}`) === (source.id || source.url || `${source.title}:${source.domain || ''}`)) === sourceIndex);
                                const status = entry.parts.some((part) => (
                                    (part.kind === 'tool' && part.tool.status === 'running') ||
                                    ((part.kind === 'thinking' || part.kind === 'agent') && matchesStreamingMessage(part.message, streamingMessageId))
                                )) ? 'streaming' as const : 'complete' as const;
                                const response = <StreamingResponse
                                    status={status}
                                    copyText={responseText || undefined}
                                    announce={false}
                                    showActions={Boolean(responseText) && !hasLaterResponseInConversationTurn}
                                    sources={sources}
                                    className="w-full"
                                    contentClassName="text-[var(--text-primary)]"
                                >
                                    <ResponseParts
                                        parts={entry.parts}
                                        lang={lang}
                                        streamingMessageId={streamingMessageId}
                                        onOpenSubagent={(tool) => openDetail({ kind: 'subagent', tool })}
                                        onOpenTool={(tool) => openDetail({ kind: 'tool', tool })}
                                        onPreviewArtifact={onPreviewArtifact}
                                    />
                                </StreamingResponse>;
                                return response;
                            })()}
                        </MessageContent>
                    </Message>
                    )}
                </Fragment>;
            })}
            {isLoading && !hasStreamingMessage ? <Message data-testid="beegame-loading-message" from="assistant" className="mb-3 min-w-0"><MessageContent><ReasoningText phrases={[text.thinkingActive || text.aiProcessing || '']} variant="scramble" /></MessageContent></Message> : null}
        </MessageGroup>
        <Drawer
            open={Boolean(detail)}
            onOpenChange={(open) => { if (!open) setDetail(null); }}
            ariaLabel={lang === 'zh' ? 'Agent 执行详情' : 'Agent run details'}
            className="overflow-hidden"
        >
            {detail ? <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {detail.kind === 'tool' ? <ToolResultDetail tool={(currentDetail ?? detail).tool} lang={lang} /> : <AgentRunDetailView
                    detail={currentDetail ?? detail}
                    lang={lang}
                    onBack={() => setDetail(null)}
                />}
            </div> : null}
        </Drawer>
        </>
    );
});

BeeGameCollaborationFeed.displayName = 'BeeGameCollaborationFeed';

function ToolResultDetail({ tool, lang }: { tool: NormalizedTool; lang: Language }) {
    return <ToolResult title={tool.name} status={tool.status === 'completed' ? 'success' : tool.status === 'failed' ? 'error' : 'running'}
        defaultOpen collapseOnComplete={false} kind={tool.kind === 'bash' ? 'terminal' : 'custom'} copyText={tool.output}>
        <div className="space-y-4">
            {tool.input !== undefined && <section>
                <h3 className="mb-2 type-caption-1 text-[var(--text-muted)]">{lang === 'zh' ? '输入' : 'Input'}</h3>
                <ToolResultOutput language="json">{JSON.stringify(tool.input, null, 2)}</ToolResultOutput>
            </section>}
            <section>
                <h3 className="mb-2 type-caption-1 text-[var(--text-muted)]">{lang === 'zh' ? '输出' : 'Output'}</h3>
                <ToolResultOutput>{tool.output || (lang === 'zh' ? '暂无输出' : 'No output yet')}</ToolResultOutput>
            </section>
        </div>
    </ToolResult>;
}

function ThinkingActivity({ part, lang, working }: { part: Extract<ResponsePart, { kind: 'thinking' }>; lang: Language; working: boolean }) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (!working) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [working]);
    const elapsed = working ? Math.max(0, now - part.timestamp) : part.durationMs;
    const duration = elapsed === undefined ? '' : elapsed < 1000
        ? (lang === 'zh' ? '少于 1 秒' : 'less than 1s')
        : (lang === 'zh' ? `${Math.floor(elapsed / 1000)} 秒` : `${Math.floor(elapsed / 1000)}s`);
    return <AgentActivity items={[{ id: part.message.id, type: 'text', content: <MarkdownRenderer
        content={part.message.thought || part.message.content || ''} messageId={part.message.id} lang={lang} /> }]}
        contentType="text" status={working ? 'working' : 'complete'}
        activeLabel={`${lang === 'zh' ? '正在思考' : 'Thinking'}${duration ? ` · ${duration}` : ''}`}
        summary={`${part.message.completionReason ? (lang === 'zh' ? '思考已中断' : 'Thinking interrupted') : (lang === 'zh' ? '已思考' : 'Thought')}${duration ? ` · ${duration}` : ''}`}
        defaultOpen={false} className="w-full text-[var(--text-secondary)]" />;
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
        role="status" aria-label={text} aria-live="polite" aria-atomic="true"
        data-subagent-state={state} className="text-xs">
        {text}
    </AnimatedBadge>;
}

function SubagentToolSummary({ tool, lang, onOpen }: { tool: NormalizedTool; lang: Language; onOpen: () => void }) {
    const title = lang.startsWith('zh') ? '子任务' : 'Subagent';
    const normalizedName = tool.name.trim().toLowerCase();
    const name = normalizedName && !['agent', 'subagent', 'task'].includes(normalizedName) ? tool.name : title;
    const { state, status, text } = subagentStatus(tool, lang);
    return <div
        className="my-1"
        data-testid={`beegame-subagent-disclosure-${tool.id}`}
    >
        <AnimatedBadge
            role="button"
            tabIndex={0}
            status={status}
            size="md"
            contentKey={`${name}-${state}`}
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
                <span className="min-w-0 max-w-40 truncate">{name}</span>
                <span aria-hidden="true" className="opacity-40">·</span>
                <span role="status" aria-label={text} aria-live="polite" aria-atomic="true">{text}</span>
                <ChevronRight aria-hidden="true" className="size-3 shrink-0 opacity-60" />
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
    const title = lang === 'zh' ? '子任务' : 'Subagent';
    const prompt = displayText(String(detail.tool.subagentPrompt || detail.tool.detail || '').trim());
    const output = detail.tool.status === 'running' ? '' : displayText(String(detail.tool.subagentOutput || detail.tool.output || '').trim());
    const trace = displayText(String(detail.tool.subagentTrace || '').trim());

    return <section className="min-w-0 space-y-4 px-1 py-2" data-testid="beegame-agent-run-detail">
        <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
            <button
                type="button"
                onClick={onBack}
                aria-label={lang === 'zh' ? '返回聊天' : 'Back to chat'}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
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
            {detail.tool.subagentActivity || trace ? <section>
                <h3 className="mb-1 type-caption-1 font-medium text-[var(--text-muted)]">{lang === 'zh' ? '执行记录' : 'Trace'}</h3>
                <SubagentActivityView activity={detail.tool.subagentActivity} legacyTrace={trace} lang={lang}
                    running={detail.tool.status === 'running' && !detail.tool.completionReason} />
            </section> : null}
        </div>
    </section>;
}

function ResponseParts({
    parts,
    lang,
    streamingMessageId,
    onOpenSubagent,
    onOpenTool,
    onPreviewArtifact,
}: {
    parts: ResponsePart[];
    lang: Language;
    streamingMessageId: string | null;
    onOpenSubagent: (tool: NormalizedTool) => void;
    onOpenTool: (tool: NormalizedTool) => void;
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
}) {
    const rendered: ReactNode[] = [];
    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        const isSubagentPart = part.kind === 'tool' && (part.tool.isSubagent || part.tool.kind === 'subagent');
        if (isSubagentPart) {
            rendered.push(<SubagentToolSummary key={`subagent-${part.tool.id}`} tool={part.tool} lang={lang} onOpen={() => onOpenSubagent(part.tool)} />);
            continue;
        }
        if (part.kind === 'thinking') {
            rendered.push(<ThinkingActivity
                key={`thinking-activity-${part.message.id}`}
                part={part} lang={lang} working={matchesStreamingMessage(part.message, streamingMessageId)}
            />);
            continue;
        }
        if (part.kind === 'tool') {
            const segmentStartIndex = index;
            const activityGroupId = part.activityGroupId;
            const activityTurnId = part.turnId;
            const belongsToToolGroup = (candidate: ResponsePart) => {
                if (candidate.kind !== 'tool' || candidate.tool.isSubagent || candidate.tool.kind === 'subagent') return false;
                if (activityGroupId) return candidate.activityGroupId === activityGroupId;
                return !candidate.activityGroupId && candidate.turnId === activityTurnId;
            };
            while (index < parts.length && belongsToToolGroup(parts[index])) index += 1;
            index -= 1;
            const toolParts = parts.slice(segmentStartIndex, index + 1).filter(
                (candidate): candidate is Extract<ResponsePart, { kind: 'tool' }> => belongsToToolGroup(candidate),
            );
            const stoppedCount = toolParts.filter(candidate => candidate.tool.completionReason === 'stopped').length;
            const incompleteCount = toolParts.filter(candidate => candidate.tool.completionReason === 'incomplete').length;
            const failedCount = toolParts.filter(candidate => candidate.tool.status === 'failed' &&
                candidate.tool.completionReason !== 'stopped' && candidate.tool.completionReason !== 'incomplete').length;
            const outcomeSummary = [
                failedCount ? (lang === 'zh' ? `${failedCount} 次失败` : `${failedCount} failed`) : '',
                stoppedCount ? (lang === 'zh' ? `${stoppedCount} 次已停止` : `${stoppedCount} stopped`) : '',
                incompleteCount ? (lang === 'zh' ? `${incompleteCount} 次未完成` : `${incompleteCount} incomplete`) : '',
            ].filter(Boolean).join(' · ');
            const status: 'working' | 'complete' = toolParts.some((candidate) => candidate.tool.status === 'running')
                ? 'working'
                : 'complete';
            const localSearchOnly = toolParts.length > 0 && toolParts.every((candidate) => isLocalSearchTool(candidate.tool));
            // Tool calls deliberately go straight to the beUI AgentActivity
            // component. Thinking is a separate lifecycle, not an extra item
            // in a synthetic mixed activity.
            rendered.push(<AgentActivity
                key={`tool-activity-${segmentStartIndex}`}
                items={toolParts.map((candidate) => ({ ...toActivityItem(candidate), target: <button type="button"
                    className={`text-left hover:underline ${candidate.tool.status === 'failed' ? 'text-[var(--destructive)]' : ''}`}
                    onClick={() => onOpenTool(candidate.tool)}>{displayText(candidate.tool.detail || candidate.tool.name)}</button> }))}
                status={status}
                activeLabel={localSearchOnly ? (lang === 'zh' ? '正在搜索文件' : 'Searching files') : undefined}
                summary={outcomeSummary ? `${lang === 'zh' ? `${toolParts.length} 次工具调用` : `${toolParts.length} tool calls`} · ${outcomeSummary}` : localSearchOnly ? (lang === 'zh' ? '已搜索文件' : 'Searched files') : undefined}
                defaultOpen={status === 'working'}
                className="w-full text-[var(--text-secondary)]"
            />);
            const images = toolParts.flatMap(({ tool }) => (tool.attachments || []).map((attachment, attachmentIndex) =>
                <ChatAttachmentView key={`tool-image-${tool.id}-${attachmentIndex}`} attachment={attachment} lang={lang} />));
            if (images.length) rendered.push(<div key={`tool-images-${part.tool.id}`} className="chat-image-gallery" role="group"
                aria-label={lang === 'zh' ? '工具输出素材' : 'Tool media'}>{images}</div>);
            const artifactTools = toolParts
                .map((candidate) => candidate.tool)
                .filter((tool) => Boolean(tool.diff));
            artifactTools.forEach((tool) => {
                const lines = parseDiffLines(tool.diff!);
                rendered.push(<FileDiff key={`agent-file-diff-${tool.id}`} file={displayText(tool.detail || tool.name)} lines={lines} status={tool.status === 'running' ? 'streaming' : 'complete'} defaultOpen={false} copyText={lines.map((line) => line.content).join('\n')} />);
            });
            continue;
        }
        const presentation = messagePresentation(part.message);
        if (presentation === 'artifact' && part.message.artifactId && onPreviewArtifact) {
            const title = part.message.documentTitle || part.message.artifactPath || (lang === 'zh' ? '项目产物' : 'Project artifact');
            rendered.push(<ArtifactCard
                key={`artifact-${part.message.id}`}
                title={title}
                sender={part.message.sender}
                content={displayText(part.message.content)}
                artifactType={part.message.artifactType}
                onPreview={() => onPreviewArtifact(part.message.artifactId!, title, part.message.content)}
            />);
            continue;
        }
        rendered.push(<LongMarkdownMessage
            key={`agent-${part.message.id}`}
            message={part.message}
            lang={lang}
            collapsible={!matchesStreamingMessage(part.message, streamingMessageId)}
            presentation={presentation}
        />);
    }
    return <>{rendered}</>;
}

function LongMarkdownMessage({
    message,
    lang,
    collapsible,
    presentation,
}: {
    message: ChatDisplayMessage;
    lang: Language;
    collapsible: boolean;
    presentation: MessagePresentation;
}) {
    const content = displayText(message.content);
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
                <MarkdownRenderer content={content} messageId={message.id} lang={lang} />
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

function StageSeparator({ stage, lang }: { stage: WorkflowStage; lang: Language }) {
    return (
        <MessageMarker
            data-testid={`beegame-stage-separator-${stage}`}
            data-slot="marker"
            data-variant="separator"
            className="type-muted bg-transparent py-2 text-[var(--text-muted)]"
        >
            {chatStageLabels[stage][lang === 'zh' ? 'zh' : 'en']}
        </MessageMarker>
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
                        {message.attachments?.length ? <div className="chat-image-gallery">
                            {message.attachments.map((attachment, index) => <ChatAttachmentView key={index} attachment={attachment} lang={lang} />)}
                        </div> : null}
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
