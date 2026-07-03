import { useState, useMemo, memo } from 'react';
import { User, MessageSquare, ChevronDown, ChevronUp, AlertCircle, Bot, CheckCircle2, FileText, Terminal, Wrench, XCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { AGENT_UI_MAP, type Language } from '../AgentsConfig';
import { formatMessageContent } from '../../../utils/formatters';
import { artifactProcessor } from '../../../utils/artifactProcessor';
import { ArtifactCard } from './ArtifactCard';
import { getSystemStatusLabel, normalizeCanonicalMessageType } from '../../../utils/messageSemantics';
import type { ChatDisplayMessage } from '../../../viewModels/displayModels';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';

const BEEGAME_AVATAR_SRC = '/assets/beegame_avatar.png';

const normalizeEscapedNewlines = (input: string): string => {
    if (!input) return '';
    return input.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
};

const isLikelyCsvContent = (input: string): boolean => {
    const text = normalizeEscapedNewlines(input).trim();
    if (!text) return false;
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return false;
    if (/^name\s*,\s*path\s*,\s*purpose\s*,\s*notes$/i.test(lines[0])) return true;
    if (lines[0].toLowerCase().replace(/\s/g, '').includes('name,path,purpose')) return true;
    const firstCols = lines[0].split(',').length;
    if (firstCols < 3) return false;
    const hasLongHeaderCell = lines[0].split(',').some(col => col.trim().split(/\s+/).length > 4);
    if (hasLongHeaderCell) return false;
    let compatibleLines = 0;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].split(',').length === firstCols) compatibleLines += 1;
    }
    const matchRatio = compatibleLines / (lines.length - 1);
    return matchRatio >= 0.9;
};

const parseCsvLine = (line: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        const next = line[i + 1];
        if (ch === '"' && inQuotes && next === '"') {
            current += '"';
            i += 1;
            continue;
        }
        if (ch === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (ch === ',' && !inQuotes) {
            cells.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    cells.push(current.trim());
    return cells;
};

const ColorSwatch = memo(({ color }: { color: string }) => (
    <span
        className="inline-block w-3 h-3 rounded-sm border border-zinc-200 dark:border-zinc-700 mr-1.5 align-middle shadow-sm"
        style={{ backgroundColor: color }}
        title={color}
    />
));
ColorSwatch.displayName = 'ColorSwatch';

const detectColor = (text: string): string | null => {
    const hexRegex = /^#([A-Fa-f0-9]{3}){1,2}$/;
    const rgbRegex = /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i;
    const trimmed = text.trim();
    if (hexRegex.test(trimmed) || rgbRegex.test(trimmed)) return trimmed;
    return null;
};

const tryParseStructuredJson = (input: string): unknown | null => {
    const text = normalizeEscapedNewlines(input).trim();
    if (!text || (!text.startsWith('{') && !text.startsWith('['))) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

const isReviewerSummaryPayload = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const payload = value as Record<string, unknown>;
    if (typeof payload.verdict !== 'string' || typeof payload.summary !== 'string') return false;
    return (
        Array.isArray(payload.issues) ||
        Array.isArray(payload.blockers) ||
        Array.isArray(payload.affected_sections) ||
        Boolean(payload.issue_resolutions_by_id && typeof payload.issue_resolutions_by_id === 'object')
    );
};

const reviewerSummaryToMarkdown = (payload: Record<string, unknown>): string => {
    const verdict = String(payload.verdict || '').trim();
    const summary = String(payload.summary || '').trim();
    const blockers = Array.isArray(payload.blockers)
        ? payload.blockers.map((item) => String(item).trim()).filter(Boolean)
        : [];
    const improvements = Array.isArray(payload.improvements)
        ? payload.improvements.map((item) => String(item).trim()).filter(Boolean).slice(0, 3)
        : [];
    const affectedSections = Array.isArray(payload.affected_sections)
        ? payload.affected_sections.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
        : [];

    const lines: string[] = [];
    if (verdict) lines.push(`**Verdict:** ${verdict}`);
    if (summary) lines.push(summary);
    lines.push(`**Blocking issues:** ${blockers.length}`);

    if (improvements.length > 0) {
        lines.push('');
        lines.push('**Improvements**');
        improvements.forEach((item) => lines.push(`- ${item}`));
    }

    if (affectedSections.length > 0) {
        lines.push('');
        lines.push(`**Affected sections:** ${affectedSections.join(', ')}`);
    }

    return lines.join('\n');
};

const formatStructuredPrimitive = (value: unknown): string => {
    if (value === null) return 'null';
    if (typeof value === 'string') return value.trim();
    return String(value);
};

const formatStructuredSection = (key: string, value: unknown, depth = 2): string => {
    const headingLevel = '#'.repeat(Math.min(depth, 6));
    const title = `${headingLevel} ${key}`;

    if (Array.isArray(value)) {
        if (value.length === 0) return `${title}\n\n- None`;
        const items = value.map((item, index) => {
            if (item && typeof item === 'object') {
                const nested = formatStructuredObject(item as Record<string, unknown>, depth + 1);
                return `- Item ${index + 1}\n${nested.split('\n').map((line) => `  ${line}`).join('\n')}`;
            }
            return `- ${formatStructuredPrimitive(item)}`;
        });
        return `${title}\n\n${items.join('\n')}`;
    }

    if (value && typeof value === 'object') {
        return `${title}\n\n${formatStructuredObject(value as Record<string, unknown>, depth + 1)}`;
    }

    return `${title}\n\n${formatStructuredPrimitive(value)}`;
};

const formatStructuredObject = (value: Record<string, unknown>, depth = 2): string => {
    const visibleEntries = Object.entries(value).filter(([key]) => !['perceive', 'model', 'plan', 'verify'].includes(key));
    if (visibleEntries.length === 0) return 'Structured output generated.';
    return visibleEntries.map(([key, sectionValue]) => formatStructuredSection(key, sectionValue, depth)).join('\n\n');
};

const structuredJsonToMarkdown = (value: unknown): string | null => {
    if (Array.isArray(value)) {
        if (value.length === 0) return 'Structured output produced an empty list.';
        const previewItems = value.slice(0, 5).map((item, index) => {
            if (item && typeof item === 'object') {
                const record = item as Record<string, unknown>;
                const label = String(record.name || record.id || record.key || `Item ${index + 1}`);
                return `- ${label}`;
            }
            return `- ${String(item)}`;
        });
        return `Structured output (${value.length} items)\n\n${previewItems.join('\n')}`;
    }
    if (!value || typeof value !== 'object') return null;
    const payload = value as Record<string, unknown>;
    if (isReviewerSummaryPayload(payload)) {
        return reviewerSummaryToMarkdown(payload);
    }
    const userFacingTextCandidates = [payload.final, payload.final_output, payload.summary, payload.message];
    for (const candidate of userFacingTextCandidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    const deliverable = payload.deliverable;
    if (typeof deliverable === 'string' && deliverable.trim()) return deliverable.trim();
    if (deliverable && typeof deliverable === 'object' && !Array.isArray(deliverable)) {
        const sections = Object.entries(deliverable as Record<string, unknown>).map(([key, sectionValue]) => {
            if (typeof sectionValue === 'string') return `## ${key}\n\n${sectionValue.trim()}`;
            return `## ${key}\n\n\`\`\`json\n${JSON.stringify(sectionValue, null, 2)}\n\`\`\``;
        });
        return sections.join('\n\n').trim();
    }
    return formatStructuredObject(payload);
};

import MarkdownErrorBoundary from '../../Common/MarkdownErrorBoundary';

export const MarkdownRenderer = memo(({ content, isUser, messageId = 'unknown', variant = 'legacy', lang = 'en' }: { content: string, isUser: boolean, messageId?: string; variant?: 'legacy' | 'beegame'; lang?: Language }) => {
    const isBeeGameVariant = variant === 'beegame';
    const textColor = isBeeGameVariant ? 'text-zinc-200' : isUser ? 'text-white dark:text-zinc-900' : 'text-zinc-800 dark:text-zinc-100';
    const [isThoughtExpanded, setIsThoughtExpanded] = useState(false);
    const text = useBeeGameText(lang);

    const { thoughtContent, formattedMainContent, renderAsCsv } = useMemo(() => {
        const normalized = normalizeEscapedNewlines(content);
        const fromProcessor = artifactProcessor.stripMarkers(normalized);
        const structuredPayload = tryParseStructuredJson(fromProcessor);
        const structured = structuredPayload ? structuredJsonToMarkdown(structuredPayload) : null;
        const thoughtMatch = fromProcessor.match(/<thought>([\s\S]*?)<\/thought>/);
        const main = fromProcessor.replace(/<thought>[\s\S]*?<\/thought>/, '').trim();
        const thought = thoughtMatch ? thoughtMatch[1].trim() : null;
        const formatted = formatMessageContent(structured || main || (thought ? '' : fromProcessor));
        return { thoughtContent: thought, formattedMainContent: formatted, renderAsCsv: isLikelyCsvContent(formatted) };
    }, [content]);

    const csvData = useMemo(() => {
        if (!renderAsCsv) return null;
        const lines = normalizeEscapedNewlines(formattedMainContent).split('\n').map(l => l.trim()).filter(Boolean);
        const rows = lines.map(parseCsvLine);
        return { header: rows[0] || [], body: rows.slice(1) };
    }, [renderAsCsv, formattedMainContent]);

    return (
        <MarkdownErrorBoundary messageId={messageId} rawContent={content}>
            <div className={`type-body max-w-none select-text ${textColor} break-words [overflow-wrap:anywhere]`}>
                {thoughtContent && (
                    <div className="mb-4 rounded-2xl bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                        <button
                            onClick={() => setIsThoughtExpanded(!isThoughtExpanded)}
                            className="type-caption-1 w-full px-4 py-2 flex items-center justify-between opacity-50 hover:opacity-100 transition-opacity"
                        >
                            <span className="flex items-center space-x-2">
                                <MessageSquare className="w-3 h-3" />
                                <span>{text.innerThought}</span>
                            </span>
                            {isThoughtExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                        {isThoughtExpanded && (
                            <div className="type-footnote px-4 pb-4 italic opacity-70 border-t border-zinc-200 dark:border-zinc-700 mt-2 pt-4">
                                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                                    {thoughtContent}
                                </ReactMarkdown>
                            </div>
                        )}
                    </div>
                )}

                <div className={`mt-1`}>
                    {renderAsCsv && csvData ? (
                        <div className="my-6 w-full overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
	                            <table className="type-table w-full border-collapse">
                                <thead className="bg-zinc-100/50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
                                    <tr className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors">
                                        {csvData.header.map((cell, idx) => (
	                                            <th key={`${cell}-${idx}`} className="type-table-head px-4 py-3 text-left text-zinc-500 dark:text-zinc-400">
                                                {cell}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                                    {csvData.body.map((row, rIdx) => (
                                        <tr key={`row-${rIdx}`} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors">
                                            {row.map((cell, cIdx) => {
                                                const color = detectColor(cell);
                                                return (
	                                                    <td key={`cell-${rIdx}-${cIdx}`} className="type-table-cell px-4 py-3 border-zinc-200 dark:border-zinc-800 whitespace-pre-wrap break-words">
                                                        {color && <ColorSwatch color={color} />}
                                                        {cell}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkBreaks]}
                            components={{
                                p: (props) => <p className="type-p mb-3 last:mb-0 opacity-90 break-words [overflow-wrap:anywhere]" {...props} />,
                                ul: (props) => <ul className="type-list list-disc opacity-90" {...props} />,
                                ol: (props) => <ol className="type-list list-decimal opacity-90" {...props} />,
                                li: (props) => <li className="break-words [overflow-wrap:anywhere]" {...props} />,
                                blockquote: (props) => <blockquote className="type-blockquote my-4" {...props} />,
                                h1: (props) => <h1 className="type-title-2 border-b border-zinc-200 pb-2 mb-4 dark:border-zinc-700" {...props} />,
                                h2: (props) => <h2 className="type-title-3 mt-6 mb-3" {...props} />,
                                h3: (props) => <h3 className="type-headline mt-4 mb-2" {...props} />,
	                                a: (props) => <a className="text-emerald-300 underline decoration-emerald-300/40 underline-offset-4 hover:text-emerald-200" target="_blank" rel="noreferrer" {...props} />,
	                                strong: (props) => <strong className="opacity-100" {...props} />,
                                table: (props) => (
                                    <div className="my-6 w-full overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
	                                        <table className="type-table w-full border-collapse" {...props} />
                                    </div>
                                ),
                                thead: (props) => <thead className="bg-zinc-100/50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800" {...props} />,
                                tbody: (props) => <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800" {...props} />,
                                tr: (props) => <tr className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors" {...props} />,
	                                th: (props) => <th className="type-table-head px-4 py-3 text-left text-zinc-500 dark:text-zinc-400" {...props} />,
                                td: ({ children, ...props }) => {
                                    const cellContent = Array.isArray(children) ? children.map(c => typeof c === 'string' ? c : '').join('') : String(children);
                                    const color = detectColor(cellContent);
                                    return (
	                                        <td className="type-table-cell px-4 py-3 border-zinc-200 dark:border-zinc-800 whitespace-pre-wrap break-words" {...props}>
                                            {color && <ColorSwatch color={color} />}
                                            {children}
                                        </td>
                                    );
                                },
                                pre: (props) => (
	                                    <pre className={`type-code ${isBeeGameVariant ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-800 border-zinc-700/50'} my-4 overflow-x-auto rounded-lg border p-4 text-zinc-100`}>
                                        {props.children}
                                    </pre>
                                ),
                                code: ({ className, children, ...props }) => {
                                    const match = /language-(\w+)/.exec(className || '');
                                    // Detect inline if no language match and no newlines (languageless blocks have newlines)
                                    const isInline = !match && !String(children).includes('\n');
                                    
                                    if (isInline) {
                                      const color = typeof children === 'string' ? detectColor(children) : null;
                                      return (
	                                        <code className={`type-inline-code ${isBeeGameVariant ? 'bg-zinc-950 text-zinc-300' : 'bg-zinc-200 dark:bg-zinc-700'} break-words`} {...props}>
                                            {color && <ColorSwatch color={color} />}
                                            {children}
                                        </code>
                                      );
                                    }

                                    return (
                                      <code className={className} {...props}>
                                        {children}
                                      </code>
                                    );
                                }
                            }}
                        >
                            {formattedMainContent}
                        </ReactMarkdown>
                    )}
                </div>
            </div>
        </MarkdownErrorBoundary>
    );
});
MarkdownRenderer.displayName = 'MarkdownRenderer';

const isContextUseMessage = (message: ChatDisplayMessage): boolean => {
    if (message.taskKind === 'context_use') return true;
    return /\b\w+\s+phase\s+generated\s+\d+\s+artifact\(s\)\s+using\s+context\s+bundle\s+\S+/i.test(message.content);
};

const getToolInfo = (message: ChatDisplayMessage): { name: string; status: 'running' | 'completed' | 'failed'; detail: string; output: string; isSubagent: boolean } => {
    if (message.toolName || message.toolStatus || message.toolDetail || message.toolOutput) {
        return {
            name: message.toolName || 'Tool',
            status: message.toolStatus || 'running',
            detail: message.toolDetail || '',
            output: message.toolOutput || '',
            isSubagent: Boolean(message.isSubagentTool),
        };
    }
    const content = message.content;
    const normalized = content.trim();
    const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
    const field = (label: string): string => {
        const prefix = `${label}:`;
        return lines.find(line => line.toLowerCase().startsWith(prefix.toLowerCase()))?.slice(prefix.length).trim() || '';
    };
    const explicitStatus = field('Status').toLowerCase();
    const status = explicitStatus === 'completed' || normalized.includes('工具完成') || normalized.toLowerCase().includes('completed')
        ? 'completed'
        : explicitStatus === 'failed' || normalized.includes('failed') || normalized.includes('失败')
            ? 'failed'
            : 'running';
    const subagent = field('Subagent');
    const nameMatch = normalized.match(/(?:调用工具|工具完成):\s*([^\n]+)/) || normalized.match(/Tool:\s*([^\n]+)/i);
    const name = (nameMatch?.[1] || normalized.split('\n')[0] || 'Tool').replace(/^✅|^🔧/g, '').trim();
    const target = field('Target');
    const command = field('Command');
    const subagentType = field('Type');
    const prompt = field('Prompt');
    const hasStructuredFields = Boolean(field('Tool') || subagent || explicitStatus || target || command || subagentType || prompt);
    const output = field('Output') || (hasStructuredFields ? '' : normalized.split('\n').slice(1).join('\n').replace(/^输出:\s*/i, '').trim());
    const detail = subagent
        ? [subagentType ? `Type: ${subagentType}` : '', prompt ? `Prompt: ${prompt}` : ''].filter(Boolean).join(' · ')
        : target ? `Target: ${target}` : command ? `Command: ${command}` : '';
    return { name: subagent || name, status, detail, output, isSubagent: Boolean(subagent) };
};

const ToolMessageCard = memo(({ message, variant = 'legacy' }: { message: ChatDisplayMessage; variant?: 'legacy' | 'beegame' }) => {
    const tool = getToolInfo(message);
    const isBeeGameVariant = variant === 'beegame';
    const Icon = tool.isSubagent
        ? Bot
        : tool.name.toLowerCase().includes('bash')
        ? Terminal
        : tool.name.toLowerCase().includes('read') || tool.name.toLowerCase().includes('write') || tool.name.toLowerCase().includes('edit')
            ? FileText
            : Wrench;
    const StatusIcon = tool.status === 'completed' ? CheckCircle2 : tool.status === 'failed' ? XCircle : Wrench;
    const statusClass = tool.status === 'completed'
        ? 'text-emerald-500'
        : tool.status === 'failed'
            ? 'text-rose-500'
            : 'text-emerald-300';

    return (
        <div
            data-testid={isBeeGameVariant ? 'beegame-tool-card' : undefined}
            className={isBeeGameVariant
                ? 'glass-control flex items-start gap-3 rounded-2xl px-3 py-3 text-zinc-200 shadow-sm backdrop-blur-2xl'
                : 'flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-200'
            }
        >
            <div className={isBeeGameVariant
                ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-200'
                : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-zinc-700 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
            }>
                <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                    <StatusIcon className={`h-4 w-4 shrink-0 ${statusClass}`} />
	                    <div className={isBeeGameVariant ? 'type-footnote truncate text-zinc-100' : 'type-caption-1 truncate'}>
                        {tool.name} {tool.status}
                    </div>
                </div>
                {tool.detail ? (
                    <div className={isBeeGameVariant
	                        ? 'type-code-sm mt-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-400 [overflow-wrap:anywhere]'
	                        : 'type-code-sm mt-1 line-clamp-2 text-zinc-500 [overflow-wrap:anywhere] dark:text-zinc-400'
                    }>
                        {tool.detail}
                    </div>
                ) : null}
                {tool.output ? (
                    <div className={isBeeGameVariant ? 'type-footnote mt-2 line-clamp-2 text-zinc-500 [overflow-wrap:anywhere]' : 'type-footnote mt-1 line-clamp-1 text-zinc-400 [overflow-wrap:anywhere] dark:text-zinc-500'}>
                        {tool.output}
                    </div>
                ) : null}
            </div>
        </div>
    );
});
ToolMessageCard.displayName = 'ToolMessageCard';

const EvidenceDivider = memo(({ label, content, messageId }: { label: string; content: string; messageId: string }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className="w-full">
            <button
                type="button"
                onClick={() => setIsExpanded((value) => !value)}
                className="type-caption-1 group flex w-full items-center gap-3 py-1 text-zinc-400 transition-colors hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300"
                aria-expanded={isExpanded}
            >
                <span className="h-px flex-1 bg-zinc-200 transition-colors group-hover:bg-zinc-300 dark:bg-zinc-800 dark:group-hover:bg-zinc-700" />
                <span className="flex items-center gap-2 whitespace-nowrap">
                    <span>{label}</span>
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </span>
                <span className="h-px flex-1 bg-zinc-200 transition-colors group-hover:bg-zinc-300 dark:bg-zinc-800 dark:group-hover:bg-zinc-700" />
            </button>
            {isExpanded && (
                <div className="overflow-hidden">
                    <div className="mx-6 mt-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                        <MarkdownRenderer content={content} isUser={false} messageId={messageId} />
                    </div>
                </div>
            )}
        </div>
    );
});
EvidenceDivider.displayName = 'EvidenceDivider';

const DeliveryReviewAlert = memo(({ message, variant = 'legacy', lang = 'en' }: { message: ChatDisplayMessage; variant?: 'legacy' | 'beegame'; lang?: Language }) => {
    const text = useBeeGameText(lang);
    return (
    <div
        className={variant === 'beegame'
            ? 'glass-control w-full rounded-2xl p-3 text-zinc-100 backdrop-blur-2xl'
            : 'w-full rounded-2xl border border-sky-200 bg-sky-50/80 p-4 text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/20 dark:text-sky-100'
        }
    >
        <div className={variant === 'beegame' ? 'type-caption-1 mb-2 flex items-center gap-2 text-zinc-300' : 'type-caption-1 mb-2 flex items-center gap-2 text-sky-600 dark:text-sky-300'}>
            <CheckCircle2 className="h-4 w-4" />
            {text.evidenceForReview}
        </div>
        <div className="type-callout opacity-85 [overflow-wrap:anywhere]">
            <MarkdownRenderer content={message.content} isUser={false} messageId={message.id} variant={variant} lang={lang} />
        </div>
    </div>
    );
});
DeliveryReviewAlert.displayName = 'DeliveryReviewAlert';

export const MessageItem = memo(({
    m,
    onPreviewArtifact,
    onContinueFixing,
    variant = 'legacy',
    lang = 'en',
}: {
    m: ChatDisplayMessage,
    onPreviewArtifact?: (artifactId: string, title: string, content?: string) => void,
    onContinueFixing?: (content: string) => void,
    variant?: 'legacy' | 'beegame',
    lang?: Language,
}) => {
    const agent = AGENT_UI_MAP[m.sender];
    const isUser = m.sender === 'user';
    const semanticType = normalizeCanonicalMessageType({
        type: m.type,
        renderHint: m.renderHint,
        isDocument: m.isDocument,
        taskKind: m.taskKind,
        nextAction: m.nextAction,
        requiresUserAction: m.requiresUserAction,
        content: m.content,
    });
    const isError = semanticType === 'error';
    const [isHovered, setIsHovered] = useState(false);
    const isBeeGameVariant = variant === 'beegame';
    const text = useBeeGameText(lang);

    if (semanticType === 'tool') return <ToolMessageCard message={m} variant={variant} />;

    if (!isUser && m.taskKind === 'context_update') {
        return <EvidenceDivider label={text.contextUpdate} content={m.content} messageId={m.id} />;
    }

    if (!isUser && isContextUseMessage(m)) {
        return <EvidenceDivider label={text.useContext} content={m.content} messageId={m.id} />;
    }

    if (!isUser && m.taskKind === 'last_check_failed') {
        const continueMessage = text.continueFromLastFailedCheckPrompt;
        return (
            <div
                className={isBeeGameVariant
                    ? 'glass-control flex w-full items-start space-x-3 rounded-2xl p-4 text-zinc-100 backdrop-blur-2xl'
                    : 'w-full p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 flex items-start space-x-3'
                }
            >
                <AlertCircle className={isBeeGameVariant ? 'mt-0.5 h-5 w-5 flex-shrink-0 text-amber-200' : 'w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5'} />
                <div className="flex-1 min-w-0">
                    <div className={isBeeGameVariant ? 'type-caption-1 mb-1 text-zinc-300' : 'type-caption-1 text-amber-600 dark:text-amber-400 mb-1'}>
                        {text.lastCheckFailed}
                    </div>
                    <div className={isBeeGameVariant ? 'type-callout text-zinc-200 opacity-85 break-words [overflow-wrap:anywhere] whitespace-pre-wrap' : 'type-callout text-amber-950 dark:text-amber-100 opacity-85 break-words [overflow-wrap:anywhere] whitespace-pre-wrap'}>
                        {m.content}
                    </div>
                    <button
                        type="button"
                        disabled={!onContinueFixing}
                        onClick={() => onContinueFixing?.(continueMessage)}
                        className="primary-pill mt-3 inline-flex items-center justify-center px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {text.continueFixing}
                    </button>
                </div>
            </div>
        );
    }

    if (!isUser && m.taskKind === 'delivery_review') {
        return <DeliveryReviewAlert message={m} variant={variant} lang={lang} />;
    }

    if (isError) {
        return (
            <div
                className={isBeeGameVariant
                    ? 'glass-control flex w-full items-start space-x-3 rounded-2xl p-4 text-zinc-100 backdrop-blur-2xl'
                    : 'w-full p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/50 flex items-start space-x-3'
                }
            >
                <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <div className={isBeeGameVariant ? 'type-caption-1 mb-1 text-zinc-300' : 'type-caption-1 text-rose-500 mb-1'}>{text.systemError}</div>
                    <div className={isBeeGameVariant ? 'type-callout text-zinc-200 opacity-85 break-words [overflow-wrap:anywhere]' : 'type-callout text-rose-900 dark:text-rose-100 opacity-80 break-words [overflow-wrap:anywhere]'}>{m.content}</div>
                </div>
            </div>
        );
    }

    return (
        <div
            className={isBeeGameVariant ? 'flex items-start gap-3' : `flex items-start space-x-4 ${isUser ? 'flex-row-reverse space-x-reverse' : ''}`}
        >
            <div className="relative">
                <div
                    onMouseEnter={() => !isUser && setIsHovered(true)}
                    onMouseLeave={() => !isUser && setIsHovered(false)}
                    className={isBeeGameVariant
                        ? `flex h-8 w-8 items-center justify-center rounded-2xl shadow-sm transition-all hover:scale-[1.03] ${isUser ? 'border border-white/10 bg-white/[0.04] text-zinc-200' : 'overflow-hidden border border-white/10 bg-black/25'}`
                        : `w-12 h-12 rounded-[1.2rem] flex items-center justify-center shadow-lg transition-all ${isUser
                            ? 'bg-zinc-900 dark:bg-white dark:text-zinc-900 text-white'
                            : (agent?.color || 'bg-zinc-500') + ' text-white'
                            }`
                    }
                >
                    {isUser ? (
                        <User className={isBeeGameVariant ? 'h-4 w-4' : 'w-6 h-6'} />
                    ) : isBeeGameVariant ? (
                        <img
                            src={BEEGAME_AVATAR_SRC}
                            alt={text.assistantName}
                            className="h-6 w-6 object-contain"
                            draggable={false}
                        />
                    ) : (
                        agent && <agent.icon className="w-6 h-6" />
                    )}
                </div>

                {isHovered && agent && (
                    <div
                        className={`absolute ${isUser ? 'right-full' : 'left-full'} top-0 z-50 mx-3 w-56 rounded-3xl border border-white/15 bg-black/50 p-4 text-white shadow-2xl shadow-black/40 backdrop-blur-2xl pointer-events-none`}
                    >
                        <div className="type-caption-1 opacity-50 mb-1">{agent.role}</div>
                        <div className="type-footnote mb-2">{agent.name}</div>
                        <p className="type-footnote opacity-70 italic">{agent.bio}</p>
                    </div>
                )}
            </div>

            <div
                data-testid={isBeeGameVariant ? 'beegame-message-card' : undefined}
                className={isBeeGameVariant
                    ? 'glass-control min-w-0 flex-1 rounded-3xl px-4 py-3 text-zinc-200 shadow-sm backdrop-blur-2xl break-words [overflow-wrap:anywhere]'
                    : `max-w-[82%] p-5 rounded-[1.8rem] shadow-sm border break-words [overflow-wrap:anywhere] ${isUser
                        ? 'bg-zinc-900 text-white border-transparent dark:bg-zinc-100 dark:text-zinc-900'
                        : `bg-white dark:bg-zinc-800/40 dark:border-zinc-700/50 ${agent?.border || ''}`
                        }`
                }
            >
                {m.sender !== 'user' && agent && (
                    <div className={`type-caption-1 mb-2 flex items-center space-x-2 ${isBeeGameVariant ? 'text-zinc-300' : agent.text}`}>
                        <span>{agent.role}</span>
                        <span className="opacity-30">•</span>
                        <span>{agent.name}</span>
                    </div>
                )}


                {(() => {
                    const isDocument = !isUser && semanticType === 'artifact_card';

                    if (isDocument) {
                        return (
                            <ArtifactCard
                                title={m.documentTitle}
                                sender={agent?.name || m.sender}
                                content={m.content}
                                artifactType={m.artifactType}
                                onPreview={() => {
                                    if (onPreviewArtifact) {
                                        onPreviewArtifact(m.artifactId || m.id, m.documentTitle || 'Document', m.artifactId ? undefined : m.content);
                                    }
                                }}
                                agentColor={agent?.color}
                            />
                        );
                    }
                    if (!isUser && semanticType === 'system_status') {
                        return (
                            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-900/40 px-4 py-3">
                                <div className="type-caption-1 text-zinc-500 dark:text-zinc-400 mb-1">
                                    {getSystemStatusLabel(m)}
                                </div>
                                <MarkdownRenderer content={m.content} isUser={isUser} messageId={m.id} variant={variant} lang={lang} />
                            </div>
                        );
                    }
                    if (!isUser && (semanticType === 'approval_request' || semanticType === 'revision_request')) {
                        const isApproval = semanticType === 'approval_request';
                        const title = isApproval ? text.approvalRequest : text.revisionRequest;
                        const accentColor = isApproval ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400';
                        const borderColor = isApproval ? 'border-emerald-500/20' : 'border-amber-500/20';
                        
                        return (
                            <div className={`mt-2 pt-3 border-t ${borderColor}`}>
                                <div className="flex items-center justify-between gap-3 mb-2">
                                    <div className={`type-caption-1 ${accentColor}`}>
                                        {title}
                                    </div>
                                    {m.nextAction ? (
                                        <div className="type-caption-1 text-zinc-500 dark:text-zinc-400">
                                            {m.nextAction.replace(/_/g, ' ')}
                                        </div>
                                    ) : null}
                                </div>
                                <MarkdownRenderer content={m.content} isUser={isUser} messageId={m.id} variant={variant} lang={lang} />
                            </div>
                        );
                    }
                    return <MarkdownRenderer content={m.content} isUser={isUser} messageId={m.id} variant={variant} lang={lang} />;
                })()}

                {m.thought && !isUser && (
                    <div className="type-footnote mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700/50 text-zinc-500 dark:text-zinc-400 italic bg-zinc-50 dark:bg-zinc-900/50 p-3 rounded-xl">
	                        <span className="mr-2 text-zinc-100">{text.thinking}:</span>
                        <span>{m.thought}</span>
                    </div>
                )}
            </div>
        </div>
    );
});
MessageItem.displayName = 'MessageItem';
