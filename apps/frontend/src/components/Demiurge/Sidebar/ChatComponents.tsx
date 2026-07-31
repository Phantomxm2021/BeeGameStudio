import { useState, useMemo, memo } from 'react';
import { MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { Language } from '../AgentsConfig';
import { formatMessageContent } from '../../../utils/formatters';
import { artifactProcessor } from '../../../utils/artifactProcessor';
import { useBeeGameText } from '../../../i18n/useBeeGameTranslations';

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

const structuredJsonToMarkdown = (value: unknown): string | null => {
    if (Array.isArray(value)) return null;
    if (!value || typeof value !== 'object') return null;
    const payload = value as Record<string, unknown>;
    const userFacingTextCandidates = [payload.final, payload.final_output, payload.summary, payload.message];
    for (const candidate of userFacingTextCandidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    const deliverable = payload.deliverable;
    if (typeof deliverable === 'string' && deliverable.trim()) return deliverable.trim();
    if (deliverable && typeof deliverable === 'object' && !Array.isArray(deliverable)) {
        const sections = Object.entries(deliverable as Record<string, unknown>)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()))
            .map(([key, sectionValue]) => `## ${key}\n\n${sectionValue.trim()}`);
        return sections.join('\n\n').trim() || null;
    }
    return null;
};

import MarkdownErrorBoundary from '../../Common/MarkdownErrorBoundary';

export const MarkdownRenderer = memo(({ content, isUser, messageId = 'unknown', lang = 'en' }: { content: string, isUser: boolean, messageId?: string; lang?: Language }) => {
    const isBeeGameVariant = true;
    const textColor = isBeeGameVariant ? 'text-zinc-200' : isUser ? 'text-white dark:text-zinc-900' : 'text-zinc-800 dark:text-zinc-100';
    const bodyClassName = isBeeGameVariant
        ? `min-w-0 max-w-full select-text ${textColor} break-words [overflow-wrap:anywhere]`
        : `type-body min-w-0 max-w-full select-text ${textColor} break-words [overflow-wrap:anywhere]`;
    const [isThoughtExpanded, setIsThoughtExpanded] = useState(false);
    const text = useBeeGameText(lang);

    const { thoughtContent, formattedMainContent, renderAsCsv } = useMemo(() => {
        const normalized = normalizeEscapedNewlines(content);
        const fromProcessor = artifactProcessor.stripMarkers(normalized);
        const structuredPayload = tryParseStructuredJson(fromProcessor);
        const structured = structuredPayload !== null
            ? structuredJsonToMarkdown(structuredPayload)
            : null;
        const thoughtMatch = fromProcessor.match(/<thought>([\s\S]*?)<\/thought>/);
        const main = fromProcessor.replace(/<thought>[\s\S]*?<\/thought>/, '').trim();
        const thought = thoughtMatch ? thoughtMatch[1].trim() : null;
        const visibleContent = structuredPayload !== null
            ? structured || ''
            : main || (thought ? '' : fromProcessor);
        const formatted = formatMessageContent(visibleContent);
        return { thoughtContent: thought, formattedMainContent: formatted, renderAsCsv: isLikelyCsvContent(formatted) };
    }, [content]);

    const csvData = useMemo(() => {
        if (!renderAsCsv) return null;
        const lines = normalizeEscapedNewlines(formattedMainContent).split('\n').map(l => l.trim()).filter(Boolean);
        const rows = lines.map(parseCsvLine);
        return { header: rows[0] || [], body: rows.slice(1) };
    }, [renderAsCsv, formattedMainContent]);

    if (!thoughtContent && !formattedMainContent) return null;

    return (
        <MarkdownErrorBoundary messageId={messageId} rawContent={content}>
            <div className={bodyClassName}>
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
                        <div className="my-6 w-full min-w-0 max-w-full overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
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
                                p: (props) => (
                                    <p
                                        className={isBeeGameVariant
                                            ? 'type-body mb-3 text-zinc-200/90 last:mb-0 break-words [overflow-wrap:anywhere]'
                                            : 'type-p mb-3 last:mb-0 opacity-90 break-words [overflow-wrap:anywhere]'}
                                        {...props}
                                    />
                                ),
                                ul: (props) => (
                                    <ul
                                        className={isBeeGameVariant
                                            ? 'type-body my-3 ml-5 list-disc space-y-1 text-zinc-200/90'
                                            : 'type-list list-disc opacity-90'}
                                        {...props}
                                    />
                                ),
                                ol: (props) => (
                                    <ol
                                        className={isBeeGameVariant
                                            ? 'type-body my-3 ml-5 list-decimal space-y-1 text-zinc-200/90'
                                            : 'type-list list-decimal opacity-90'}
                                        {...props}
                                    />
                                ),
                                li: (props) => <li className="break-words [overflow-wrap:anywhere]" {...props} />,
                                blockquote: (props) => <blockquote className={isBeeGameVariant ? 'my-4 border-l-2 border-white/15 pl-4 text-zinc-300/85' : 'type-blockquote my-4'} {...props} />,
                                h1: (props) => (
                                    <h1
                                        className={isBeeGameVariant
                                            ? 'type-title-2 mb-4 border-b border-white/10 pb-2 text-white'
                                            : 'type-title-2 border-b border-zinc-200 pb-2 mb-4 dark:border-zinc-700'}
                                        {...props}
                                    />
                                ),
                                h2: (props) => (
                                    <h2
                                        className={isBeeGameVariant
                                            ? 'type-title-3 mt-6 mb-3 text-white'
                                            : 'type-title-3 mt-6 mb-3'}
                                        {...props}
                                    />
                                ),
                                h3: (props) => (
                                    <h3
                                        className={isBeeGameVariant
                                            ? 'type-headline mt-5 mb-2 text-white'
                                            : 'type-headline mt-4 mb-2'}
                                        {...props}
                                    />
                                ),
	                                a: (props) => <a className="text-emerald-300 underline decoration-emerald-300/40 underline-offset-4 hover:text-emerald-200" target="_blank" rel="noreferrer" {...props} />,
	                                strong: (props) => <strong className="opacity-100" {...props} />,
                                table: (props) => (
                                    <div className="my-6 w-full min-w-0 max-w-full overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
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
	                                    <pre className={`type-code ${isBeeGameVariant ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-800 border-zinc-700/50'} my-4 max-w-full overflow-x-auto rounded-lg border p-4 text-zinc-100`}>
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
