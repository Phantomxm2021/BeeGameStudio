import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
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

const BEEGAME_AVATAR_SRC = '/assets/beegame_avatar.png';

type BeeGameCollaborationFeedProps = {
    messages: ChatDisplayMessage[];
    projectStatus?: ProjectRuntimeDisplayModel | null;
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
    lang?: Language;
};

type BeeGameConversationOverviewRulerProps = {
    messages: ChatDisplayMessage[];
    lang?: Language;
    scrollContainerRef?: RefObject<HTMLDivElement | null>;
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

const getToolStatusLabel = (status: NormalizedTool['status'], text: BeeGameText): string => {
    if (status === 'completed') return text.toolCompleted;
    if (status === 'failed') return text.toolFailed;
    return text.toolRunning;
};

const getToolTitle = (tool: NormalizedTool, text: BeeGameText): string => {
    return `${tool.name} ${getToolStatusLabel(tool.status, text)}`;
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
    lang = 'en',
}: BeeGameCollaborationFeedProps) => {
    const entries = useMemo(() => buildFeedEntries(messages), [messages]);
    const text = useBeeGameText(lang);

    return (
        <div data-testid="beegame-collaboration-feed" className="relative min-h-full pl-12">
            <div className="relative z-10 space-y-3">
                {entries.map((entry) => (
                    entry.kind === 'user' ? (
                        <div key={entry.message.id} data-beegame-message-anchor={entry.message.id}>
                            <UserMessageCard message={entry.message} text={text} />
                        </div>
                    ) : entry.kind === 'agent' ? (
                        <div key={entry.message.id} data-beegame-message-anchor={entry.message.id}>
                            <AgentFeedGroup
                                message={entry.message}
                                tools={entry.tools}
                                onPreviewArtifact={onPreviewArtifact}
                                text={text}
                            />
                        </div>
                    ) : (
                        <div key={entry.id} data-beegame-message-anchor={entry.id}>
                            <ToolGroup tools={entry.tools} onPreviewArtifact={onPreviewArtifact} text={text} />
                        </div>
                    )
                ))}
            </div>
        </div>
    );
});

BeeGameCollaborationFeed.displayName = 'BeeGameCollaborationFeed';

export const BeeGameConversationOverviewRuler = memo(({
    messages,
    lang = 'en',
    scrollContainerRef,
}: BeeGameConversationOverviewRulerProps) => {
    const entries = useMemo(() => buildFeedEntries(messages), [messages]);
    const text = useBeeGameText(lang);
    const axisEntries = useMemo(() => buildAxisEntries(entries, text), [entries, text]);
    const [activeAxisId, setActiveAxisId] = useState<string | null>(null);

    useEffect(() => {
        if (axisEntries.length === 0) {
            setActiveAxisId(null);
            return;
        }

        const scrollParent = scrollContainerRef?.current || window;
        const updateActiveEntry = () => {
            const finalAxisId = axisEntries[axisEntries.length - 1]?.id || null;
            if (finalAxisId && isScrolledToEnd(scrollParent)) {
                setActiveAxisId(finalAxisId);
                return;
            }

            const viewportRect = 'getBoundingClientRect' in scrollParent && typeof scrollParent.getBoundingClientRect === 'function'
                ? scrollParent.getBoundingClientRect()
                : { top: 0, height: window.innerHeight || document.documentElement.clientHeight };
            const viewportCenter = viewportRect.top + viewportRect.height / 2;
            let nextActiveId = axisEntries[0]?.id || null;
            let closestDistance = Number.POSITIVE_INFINITY;

            for (const entry of axisEntries) {
                const target = document.querySelector<HTMLElement>(`[data-beegame-message-anchor="${CSS.escape(entry.id)}"]`);
                if (!target) continue;
                const rect = target.getBoundingClientRect();
                const targetCenter = rect.top + rect.height / 2;
                const distance = Math.abs(targetCenter - viewportCenter);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    nextActiveId = entry.id;
                }
            }

            setActiveAxisId(nextActiveId);
        };

        updateActiveEntry();
        scrollParent.addEventListener('scroll', updateActiveEntry, { passive: true });
        window.addEventListener('resize', updateActiveEntry);
        return () => {
            scrollParent.removeEventListener('scroll', updateActiveEntry);
            window.removeEventListener('resize', updateActiveEntry);
        };
    }, [axisEntries, scrollContainerRef]);

    return (
        <ConversationAxis
            entries={axisEntries}
            activeId={activeAxisId || axisEntries[0]?.id || null}
            scrollContainerRef={scrollContainerRef}
        />
    );
});

BeeGameConversationOverviewRuler.displayName = 'BeeGameConversationOverviewRuler';

const isScrolledToEnd = (scrollParent: HTMLElement | Window): boolean => {
    if ('scrollTop' in scrollParent) {
        if (scrollParent.scrollHeight <= scrollParent.clientHeight) return false;
        return scrollParent.scrollTop + scrollParent.clientHeight >= scrollParent.scrollHeight - 4;
    }

    const documentElement = document.documentElement;
    const scrollTop = window.scrollY || documentElement.scrollTop || document.body.scrollTop || 0;
    const viewportHeight = window.innerHeight || documentElement.clientHeight || 0;
    const scrollHeight = documentElement.scrollHeight || document.body.scrollHeight || 0;
    if (scrollHeight <= viewportHeight) return false;
    return scrollTop + viewportHeight >= scrollHeight - 4;
};

type AxisEntry = {
    id: string;
    title: string;
    preview: string;
    tone: 'user' | 'agent' | 'tool';
};

const toAxisPreview = (content: string): string => {
    const normalized = content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ');
    if (normalized.length <= 92) return normalized;
    return `${normalized.slice(0, 92).trim()}...`;
};

const buildAxisEntries = (entries: FeedEntry[], text: BeeGameText): AxisEntry[] => {
    return entries.map((entry) => {
        if (entry.kind === 'user') {
            return {
                id: entry.message.id,
                title: text.you,
                preview: toAxisPreview(entry.message.content),
                tone: 'user',
            };
        }
        if (entry.kind === 'agent') {
            return {
                id: entry.message.id,
                title: 'BeeGame',
                preview: toAxisPreview(entry.message.content),
                tone: 'agent',
            };
        }
        const firstTool = entry.tools[0];
        return {
            id: entry.id,
            title: firstTool ? getToolTitle(firstTool, text) : GENERIC_TOOL_NAME,
            preview: toAxisPreview(entry.tools.map((tool) => getToolTitle(tool, text)).join('\n')),
            tone: 'tool',
        };
    });
};

function ConversationAxis({
    entries,
    activeId,
    scrollContainerRef,
}: {
    entries: AxisEntry[];
    activeId: string | null;
    scrollContainerRef?: RefObject<HTMLDivElement | null>;
}) {
    const railRef = useRef<HTMLDivElement>(null);
    const shellRef = useRef<HTMLDivElement>(null);
    const scrollAnimationRef = useRef<number | null>(null);
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const [previewTop, setPreviewTop] = useState(0);
    const hoveredIndex = entries.findIndex((entry) => entry.id === hoveredId);
    const hoveredEntry = entries.find((entry) => entry.id === hoveredId);

    useEffect(() => {
        if (!activeId) return;
        const target = railRef.current?.querySelector<HTMLElement>(`[data-axis-entry-id="${CSS.escape(activeId)}"]`);
        if (typeof target?.scrollIntoView === 'function') {
            target.scrollIntoView({ block: 'nearest' });
        }
    }, [activeId]);

    useEffect(() => {
        return () => {
            if (scrollAnimationRef.current !== null) {
                window.cancelAnimationFrame(scrollAnimationRef.current);
            }
        };
    }, []);

    const animateScrollTo = (scrollContainer: HTMLDivElement, nextScrollTop: number) => {
        if (scrollAnimationRef.current !== null) {
            window.cancelAnimationFrame(scrollAnimationRef.current);
        }

        const startScrollTop = scrollContainer.scrollTop;
        const distance = nextScrollTop - startScrollTop;
        if (Math.abs(distance) < 1) {
            scrollContainer.scrollTop = nextScrollTop;
            scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
            return;
        }

        const duration = Math.min(560, Math.max(240, Math.abs(distance) * 0.55));
        const startedAt = performance.now();
        const easeOutCubic = (progress: number) => 1 - Math.pow(1 - progress, 3);

        const step = (timestamp: number) => {
            const progress = Math.min(1, (timestamp - startedAt) / duration);
            scrollContainer.scrollTop = startScrollTop + distance * easeOutCubic(progress);
            scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));

            if (progress < 1) {
                scrollAnimationRef.current = window.requestAnimationFrame(step);
                return;
            }

            scrollContainer.scrollTop = nextScrollTop;
            scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
            scrollAnimationRef.current = null;
        };

        scrollAnimationRef.current = window.requestAnimationFrame(step);
    };

    const scrollToEntry = (id: string) => {
        const target = document.querySelector<HTMLElement>(`[data-beegame-message-anchor="${CSS.escape(id)}"]`);
        if (!target) return;

        const scrollContainer = scrollContainerRef?.current;
        if (!scrollContainer) {
            target.scrollIntoView({ block: 'center', behavior: 'auto' });
            return;
        }

        const containerRect = scrollContainer.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const targetTop = targetRect.top - containerRect.top + scrollContainer.scrollTop;
        const targetHeight = target.offsetHeight || targetRect.height;
        const nextScrollTop = Math.max(0, targetTop - (scrollContainer.clientHeight - targetHeight) / 2);
        animateScrollTo(scrollContainer, nextScrollTop);
    };
    const updateHoveredEntry = (entryId: string, element: HTMLElement) => {
        setHoveredId(entryId);
        const shellRect = shellRef.current?.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        if (!shellRect) {
            setPreviewTop(element.offsetTop + element.offsetHeight / 2);
            return;
        }

        const visibleCenter = elementRect.top - shellRect.top + elementRect.height / 2;
        setPreviewTop(Math.max(16, Math.min(shellRect.height - 16, visibleCenter)));
    };

    return (
        <div
            data-testid="beegame-conversation-axis"
            className="pointer-events-none sticky top-1/2 z-50 h-0 w-0"
        >
            <div
                ref={shellRef}
                data-testid="beegame-conversation-axis-shell"
                className="absolute left-0 top-0 h-72 w-10 -translate-y-1/2 overflow-visible"
            >
                <div
                    ref={railRef}
                    data-testid="beegame-conversation-axis-rail"
                    className="pointer-events-auto relative h-72 w-10 overflow-y-auto overscroll-contain py-12 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                    onWheel={(event) => event.stopPropagation()}
                    style={{
                        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 14%, black 86%, transparent 100%)',
                        maskImage: 'linear-gradient(to bottom, transparent 0, black 14%, black 86%, transparent 100%)',
                    }}
                >
                    <div className="flex min-h-full flex-col items-start justify-center gap-1">
                        {entries.map((entry, index) => {
                            const isActive = activeId === entry.id;
                            const presentation = getAxisLinePresentation(index, hoveredIndex, isActive);
                            return (
                                <button
                                    key={entry.id}
                                    type="button"
                                    aria-label={`Jump to message ${index + 1}`}
                                    data-axis-entry-id={entry.id}
                                    data-active={isActive ? 'true' : 'false'}
                                    onMouseEnter={(event) => updateHoveredEntry(entry.id, event.currentTarget)}
                                    onMouseLeave={() => setHoveredId(null)}
                                    onFocus={(event) => updateHoveredEntry(entry.id, event.currentTarget)}
                                    onBlur={() => setHoveredId(null)}
                                    onClick={() => scrollToEntry(entry.id)}
                                    className="group flex h-2.5 w-10 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70"
                                >
                                    <span
                                        data-testid="beegame-conversation-axis-line"
                                        data-length={presentation.length}
                                        data-cascade={presentation.cascade}
                                        className={`block h-1 rounded-full transition-all duration-200 ${presentation.widthClassName} ${presentation.colorClassName}`}
                                    />
                                </button>
                            );
                        })}
                    </div>
                </div>
                {hoveredEntry ? (
                    <div
                        role="tooltip"
                        data-testid="beegame-conversation-axis-preview"
                        data-anchor-index={String(hoveredIndex)}
                        className="pointer-events-none absolute left-10 z-30 w-72 -translate-y-1/2 rounded-2xl border border-zinc-700 bg-zinc-800/95 px-4 py-3 text-zinc-100 shadow-2xl shadow-black/40 backdrop-blur-xl"
                        style={{ top: previewTop }}
                    >
                        <div className="type-footnote truncate text-zinc-100">{hoveredEntry.title}</div>
                        <div className="type-footnote mt-1 line-clamp-3 text-zinc-400">{hoveredEntry.preview}</div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

const getAxisLinePresentation = (
    index: number,
    hoveredIndex: number,
    isActive: boolean,
): {
    cascade: string;
    length: 'short' | 'near-3' | 'near-2' | 'near-1' | 'full';
    widthClassName: string;
    colorClassName: string;
} => {
    if (hoveredIndex >= 0) {
        const distance = Math.abs(index - hoveredIndex);
        if (distance <= 3) {
            const widthByDistance = ['w-9', 'w-7', 'w-5', 'w-3'] as const;
            const lengthByDistance = ['full', 'near-1', 'near-2', 'near-3'] as const;
            return {
                cascade: String(distance),
                length: lengthByDistance[distance],
                widthClassName: widthByDistance[distance],
                colorClassName: distance === 0
                    ? 'bg-zinc-100 shadow-[0_0_14px_rgba(255,255,255,0.35)]'
                    : 'bg-orange-300/80 shadow-[0_0_10px_rgba(251,146,60,0.18)]',
            };
        }
    }

    return {
        cascade: '',
        length: 'short',
        widthClassName: 'w-3',
        colorClassName: isActive
            ? 'bg-orange-400/90 shadow-[0_0_12px_rgba(251,146,60,0.28)]'
            : 'bg-zinc-600/70',
    };
};

function UserMessageCard({ message, text }: { message: ChatDisplayMessage; text: BeeGameText }) {
    return (
        <section
            data-testid={`beegame-user-message-${message.id}`}
            className="ml-auto max-w-[88%] rounded-xl border border-zinc-700/70 bg-zinc-800/45 px-4 py-3 text-zinc-100 shadow-sm"
        >
            <div className="mb-2 flex items-center justify-end gap-2">
                <span className="type-caption-1 text-zinc-400">{text.you}</span>
                <span className="grid h-7 w-7 place-items-center rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300">
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
    text,
}: {
    message: ChatDisplayMessage;
    tools: NormalizedTool[];
    onPreviewArtifact?: (id: string, title: string, content?: string) => void;
    text: BeeGameText;
}) {
    const [isCollapsed, setIsCollapsed] = useState(false);

    return (
        <div className="space-y-3">
            <AgentSummaryCard
                message={message}
                isCollapsed={isCollapsed}
                onToggleCollapsed={() => setIsCollapsed((value) => !value)}
                text={text}
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
}: {
    message: ChatDisplayMessage;
    isCollapsed: boolean;
    onToggleCollapsed: () => void;
    text: BeeGameText;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const preview = getAgentPreview(message.content);
    const content = isExpanded ? message.content : preview.preview;

    return (
        <section data-testid={`beegame-agent-message-${message.id}`} className="rounded-xl border border-orange-500/20 bg-orange-950/15 px-4 py-3 text-zinc-100 shadow-sm">
            <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg border border-orange-400/35 bg-orange-950/40 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04),0_8px_18px_rgba(0,0,0,0.28)]">
                        <img
                            src={BEEGAME_AVATAR_SRC}
                            alt="BeeGame"
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
                        <span className="type-caption-1 min-w-0 truncate text-orange-300">
                            BeeGame
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
                        />
                        {preview.isTruncated ? (
                            <button
                                type="button"
                                onClick={() => setIsExpanded((value) => !value)}
                                className="type-footnote mt-2 inline-flex items-center gap-1 text-orange-300 hover:text-orange-200"
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
        <div className="relative pl-8">
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
    const statusClassName = isCompleted ? 'text-emerald-400' : isFailed ? 'text-red-400' : 'text-orange-400';
    const detail = message.detail;
    const output = message.output;
    const title = getToolTitle(message, text);
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
            <div
                data-testid="beegame-tool-status-icon"
                className={`absolute -left-[1.55rem] top-5 flex h-4 w-4 items-center justify-center ${statusClassName}`}
            >
                <StatusIcon className={`h-4 w-4 ${isRunning ? 'animate-spin' : ''}`} />
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
	                                <div className="type-code-sm mt-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-400 [overflow-wrap:anywhere]">
                                    {detail}
                                </div>
                            ) : null}
                            {output ? (
                                <div className="type-footnote mt-2 line-clamp-3 text-zinc-500 [overflow-wrap:anywhere]">
                                    {output}
                                </div>
                            ) : null}
                            {(detail || output) ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        aria-label={`${text.open} ${previewTitle}`}
                                        onClick={() => onPreviewArtifact?.(previewId, previewTitle, previewContent || undefined)}
                                        className="type-footnote inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/70"
                                    >
                                        <FolderOpen className="h-3.5 w-3.5" />
                                        {text.open}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`${text.diff} ${previewTitle}`}
                                        onClick={() => onPreviewArtifact?.(`${previewId}:diff`, `${text.diff}: ${previewTitle}`, diffContent)}
                                        className="type-footnote inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-3 py-1.5 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/70"
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
