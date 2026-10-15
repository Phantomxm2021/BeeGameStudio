import { useMemo, memo } from 'react';
import { ChatImage } from './ChatImage';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import type { Language } from '../AgentsConfig';

const normalizeEscapedNewlines = (input: string): string => {
    if (!input) return '';
    return input.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');
};

const isLikelyCsvContent = (input: string): boolean => {
    const text = input.trim();
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
    const text = input.trim();
    if (!text || (!text.startsWith('{') && !text.startsWith('['))) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

import MarkdownErrorBoundary from '../../Common/MarkdownErrorBoundary';

export const MarkdownRenderer = memo(({ content, messageId = 'unknown', bubble = false, lang = 'en' }: { content: string, messageId?: string; lang?: Language; bubble?: boolean }) => {
    const bodyTextClass = bubble ? 'text-[currentColor]' : 'text-[var(--text-secondary)]';
    const headingTextClass = bubble ? 'text-[currentColor]' : 'text-[var(--text-primary)]';
    // Stable renderers preserve image load state while subsequent text streams in.
    const markdownComponents = useMemo<Components>(() => ({
        img: ({ src, alt }) => <ChatImage key={typeof src === 'string' ? src : ''} src={typeof src === 'string' ? src : undefined}
            alt={alt || (lang === 'zh' ? '图片' : 'Image')} lang={lang} animateReveal={!bubble} />,
        p: ({ node, ...props }) => node?.children.some(child => child.type === 'element' && child.tagName === 'img') &&
            node.children.every(child => child.type === 'text' ? !child.value.trim() : child.type === 'element' && ['img', 'br'].includes(child.tagName))
            ? <div className="chat-image-gallery" {...props} /> : (
            <p
                className={`type-chat-body mb-2.5 ${bodyTextClass} last:mb-0 break-words [overflow-wrap:anywhere]`}
                {...props}
            />
        ),
        ul: (props) => (
            <ul
                className={`type-chat-body my-2 ml-4 list-disc space-y-0.5 ${bodyTextClass}`}
                {...props}
            />
        ),
        ol: (props) => (
            <ol
                className={`type-chat-body my-2 ml-4 list-decimal space-y-0.5 ${bodyTextClass}`}
                {...props}
            />
        ),
        li: (props) => <li className="break-words [overflow-wrap:anywhere]" {...props} />,
        blockquote: (props) => <blockquote className={`type-chat-body my-3 border-l-2 border-[var(--border-strong)] pl-3 ${bodyTextClass}`} {...props} />,
        h1: (props) => (
            <h1
                className={`type-chat-h1 mb-3 border-b border-[var(--border)] pb-2 ${headingTextClass}`}
                {...props}
            />
        ),
        h2: (props) => (
            <h2
                className={`type-chat-h2 mt-5 mb-2.5 ${headingTextClass}`}
                {...props}
            />
        ),
        h3: (props) => (
            <h3
                className={`type-chat-h3 mt-4 mb-2 ${headingTextClass}`}
                {...props}
            />
        ),
            a: (props) => <a className="text-[var(--info)] underline decoration-[var(--info)]/40 underline-offset-4 hover:text-[var(--text-primary)]" target="_blank" rel="noreferrer" {...props} />,
            strong: (props) => <strong className={bubble ? 'opacity-100' : 'text-[var(--text-primary)]'} {...props} />,
        table: (props) => (

            <div className="my-6 w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-[var(--border)]">
                    <table className="type-chat-body w-full border-collapse" {...props} />
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
                    <td className="type-chat-body whitespace-pre-wrap break-words border-[var(--border)] px-3 py-2.5" {...props}>
                    {color && <ColorSwatch color={color} />}
                    {children}
                </td>
            );
        },
        pre: (props) => (
            <pre className={`type-code my-3 max-w-full overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-3)] p-3 ${bodyTextClass}`}>
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
                <code className={`type-chat-inline-code break-words bg-[var(--surface-3)] ${bubble ? 'text-[currentColor]' : 'text-[var(--text-secondary)]'}`} {...props}>
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
    }), [lang, bubble, bodyTextClass, headingTextClass]);
    const { formattedMainContent, renderAsCsv, renderAsJson } = useMemo(() => {
        // Event classification belongs to the adapter, not to a field-name
        // heuristic that discards parts of a model's visible response.
        const json = tryParseStructuredJson(content) !== null;
        return { formattedMainContent: content, renderAsCsv: !json && isLikelyCsvContent(content), renderAsJson: json };
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
                    {renderAsJson ? (
                        <pre className={`type-code max-w-full rounded-lg p-3 ${bubble
                            ? 'whitespace-pre-wrap break-all !bg-transparent text-[currentColor]'
                            : 'overflow-x-auto bg-[var(--surface-3)]'}`}><code className={bubble ? '!bg-transparent !text-[currentColor]' : undefined}>{content}</code></pre>
                    ) : renderAsCsv && csvData ? (
                        <div className="my-6 w-full min-w-0 max-w-full overflow-x-auto rounded-lg border border-[var(--border)]">
	                            <table className="type-chat-body w-full border-collapse">
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
	                                                    <td key={`cell-${rIdx}-${cIdx}`} className="type-chat-body whitespace-pre-wrap break-words border-[var(--border)] px-3 py-2.5">
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
                            components={markdownComponents}
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
