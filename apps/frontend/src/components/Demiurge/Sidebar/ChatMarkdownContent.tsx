import { useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { Language } from '../AgentsConfig';
import { formatMessageContent } from '../../../utils/formatters';
import { artifactProcessor } from '../../../utils/artifactProcessor';

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
        className="mr-1.5 inline-block h-3 w-3 rounded-sm border border-[var(--border)] align-middle shadow-sm"
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

export const MarkdownRenderer = memo(({ content, messageId = 'unknown', bubble = false }: { content: string, messageId?: string; lang?: Language; bubble?: boolean }) => {
    const bubbleTextClass = bubble ? 'text-[currentColor]' : 'text-[var(--text-primary)]';
    const { formattedMainContent, renderAsCsv } = useMemo(() => {
        const normalized = normalizeEscapedNewlines(content);
        const fromProcessor = artifactProcessor.stripMarkers(normalized);
        const structuredPayload = tryParseStructuredJson(fromProcessor);
        const structured = structuredPayload !== null
            ? structuredJsonToMarkdown(structuredPayload)
            : null;
        const main = fromProcessor.replace(/<thought>[\s\S]*?<\/thought>/, '').trim();
        const visibleContent = structuredPayload !== null
            ? structured || ''
            : main;
        const formatted = formatMessageContent(visibleContent);
        return { formattedMainContent: formatted, renderAsCsv: isLikelyCsvContent(formatted) };
    }, [content]);

    const csvData = useMemo(() => {
        if (!renderAsCsv) return null;
        const lines = normalizeEscapedNewlines(formattedMainContent).split('\n').map(l => l.trim()).filter(Boolean);
        const rows = lines.map(parseCsvLine);
        return { header: rows[0] || [], body: rows.slice(1) };
    }, [renderAsCsv, formattedMainContent]);

    if (!formattedMainContent) return null;

    return (
        <MarkdownErrorBoundary messageId={messageId} rawContent={content}>
            <div className={`min-w-0 max-w-full select-text break-words ${bubble ? 'text-background' : 'text-[var(--text-primary)]'} [overflow-wrap:anywhere]`}>
                <div className={`mt-1`}>
                    {renderAsCsv && csvData ? (
                        <div className="my-6 w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-[var(--border)]">
	                            <table className="type-table w-full border-collapse">
                                <thead className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                                    <tr className="transition-colors hover:bg-[var(--surface-hover)]">
                                        {csvData.header.map((cell, idx) => (
	                                            <th key={`${cell}-${idx}`} className={`type-table-head px-4 py-3 text-left ${bubble ? 'text-[currentColor]' : 'text-[var(--text-muted)]'}`}>
                                                {cell}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--border)]">
                                    {csvData.body.map((row, rIdx) => (
                                        <tr key={`row-${rIdx}`} className="transition-colors hover:bg-[var(--surface-hover)]">
                                            {row.map((cell, cIdx) => {
                                                const color = detectColor(cell);
                                                return (
	                                                    <td key={`cell-${rIdx}-${cIdx}`} className="type-table-cell whitespace-pre-wrap break-words border-[var(--border)] px-4 py-3">
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
                                        className={`type-body mb-3 ${bubbleTextClass} last:mb-0 break-words [overflow-wrap:anywhere]`}
                                        {...props}
                                    />
                                ),
                                ul: (props) => (
                                    <ul
                                        className={`type-body my-3 ml-5 list-disc space-y-1 ${bubbleTextClass}`}
                                        {...props}
                                    />
                                ),
                                ol: (props) => (
                                    <ol
                                        className={`type-body my-3 ml-5 list-decimal space-y-1 ${bubbleTextClass}`}
                                        {...props}
                                    />
                                ),
                                li: (props) => <li className="break-words [overflow-wrap:anywhere]" {...props} />,
                                blockquote: (props) => <blockquote className={`my-4 border-l-2 border-[var(--border-strong)] pl-4 ${bubbleTextClass}`} {...props} />,
                                h1: (props) => (
                                    <h1
                                        className={`type-title-2 mb-4 border-b border-[var(--border)] pb-2 ${bubbleTextClass}`}
                                        {...props}
                                    />
                                ),
                                h2: (props) => (
                                    <h2
                                        className={`type-title-3 mt-6 mb-3 ${bubbleTextClass}`}
                                        {...props}
                                    />
                                ),
                                h3: (props) => (
                                    <h3
                                        className={`type-headline mt-5 mb-2 ${bubbleTextClass}`}
                                        {...props}
                                    />
                                ),
	                                a: (props) => <a className="text-[var(--info)] underline decoration-[var(--info)]/40 underline-offset-4 hover:text-[var(--text-primary)]" target="_blank" rel="noreferrer" {...props} />,
	                                strong: (props) => <strong className="opacity-100" {...props} />,
                                table: (props) => (

                                    <div className="my-6 w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-[var(--border)]">
	                                        <table className="type-table w-full border-collapse" {...props} />
                                    </div>
                                ),
                                thead: (props) => <thead className="border-b border-[var(--border)] bg-[var(--surface-2)]" {...props} />,
                                tbody: (props) => <tbody className="divide-y divide-[var(--border)]" {...props} />,
                                tr: (props) => <tr className="transition-colors hover:bg-[var(--surface-hover)]" {...props} />,
                                th: (props) => <th className={`type-table-head px-4 py-3 text-left ${bubble ? 'text-[currentColor]' : 'text-[var(--text-muted)]'}`} {...props} />,
                                td: ({ children, ...props }) => {
                                    const cellContent = Array.isArray(children) ? children.map(c => typeof c === 'string' ? c : '').join('') : String(children);
                                    const color = detectColor(cellContent);
                                    return (
	                                        <td className="type-table-cell whitespace-pre-wrap break-words border-[var(--border)] px-4 py-3" {...props}>
                                            {color && <ColorSwatch color={color} />}
                                            {children}
                                        </td>
                                    );
                                },
                                pre: (props) => (
                                    <pre className={`type-code my-4 max-w-full overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-3)] p-4 ${bubbleTextClass}`}>
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
                                        <code className={`type-inline-code break-words bg-[var(--surface-3)] ${bubble ? 'text-[currentColor]' : 'text-[var(--text-secondary)]'}`} {...props}>
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
